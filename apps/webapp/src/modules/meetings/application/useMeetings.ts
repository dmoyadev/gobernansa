import type { AgendaItem, Meeting, MeetingAttendance, MeetingVote, VoteChoice } from '@gobernansa/shared/domain/meeting.ts';
import type { MeetingNotice, Minutes, NoticeKind, SignerRole } from '@gobernansa/shared/domain/minutes.ts';
import type { Property } from '@gobernansa/shared/domain/property.ts';
import type { MaybeRefOrGetter, Ref } from 'vue';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { isFullySigned, MINUTES_ID, minutesHash } from '@gobernansa/shared/domain/minutes.ts';
import { auth } from '@gobernansa/shared/infrastructure/firebase.ts';
import { reportError } from '@gobernansa/shared/infrastructure/monitoring.ts';
import { arrayUnion, collection, doc, getDocFromServer, getFirestore, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { computed, toValue } from 'vue';
import { useCollection, useDocument } from 'vuefire';
import { useUserCommunity } from '@/modules/community/application/useUserCommunity.ts';
import { communityCollection, communityDoc } from '@/shared/infrastructure/useFirestoreDocument.ts';

// The rules only let neighbours read convened meetings, so drafts must be left out of the query itself
const VISIBLE_STATUS: Meeting['status'][] = ['convened', 'held', 'cancelled'];

/**
 * The meetings of the user's community, a few a year, so they are all listened to and sorted here (no index needed).
 */
export function useMeetings() {
	const db = getFirestore();
	const { userCommunity } = useUserCommunity();
	// The id, so changes to the community don't listen again
	const communityId = computed(() => userCommunity.value?.id);

	const meetingsRef = computed(() => communityId.value
		? query(communityCollection<Meeting>(db, communityId.value, 'meetings'), where('status', 'in', VISIBLE_STATUS))
		: null);
	const allMeetings = useCollection<Meeting>(meetingsRef, { ssrKey: 'meetings' });
	const meetings = computed(() => [...allMeetings.value].sort((a, b) => b.date.toMillis() - a.date.toMillis()));
	// From the start of today, so today's meeting is still the next one while it's held
	const nextMeeting = computed(() => {
		const today = new Date().setHours(0, 0, 0, 0);
		return meetings.value.filter(meeting => meeting.status === 'convened' && meeting.date.toMillis() >= today).at(-1);
	});

	return {
		meetings,
		nextMeeting,
		// Also while the community loads, so the empty message doesn't flash first
		loading: computed(() => !meetingsRef.value || allMeetings.pending.value),
		error: allMeetings.error,
	};
}

/**
 * One meeting, with the user's attendance answer and ballots (every property's once held, for the results).
 */
export function useMeeting(meetingId: MaybeRefOrGetter<string>) {
	const db = getFirestore();
	const { user } = useAuth();
	const { userCommunity } = useUserCommunity();
	const communityId = computed(() => userCommunity.value?.id);

	const meetingRef = computed(() => communityId.value
		? communityDoc(db, communityId.value, 'meetings', toValue(meetingId))
		: null);
	const meeting = useDocument<Meeting>(meetingRef);

	const uid = computed(() => user.value?.id);
	const attendanceRef = computed(() => meetingRef.value && uid.value ? doc(meetingRef.value, 'attendance', uid.value) : null);
	const attendance = useDocument<MeetingAttendance>(attendanceRef);

	// Only the user's: a meeting can have hundreds and each one is a read. Once held the admin keeps the tally on the
	// meeting (results); everyone's only for a held meeting from before that, until the admin opens it again.
	// Booleans, so other changes to the meeting don't listen to the ballots again
	const held = computed(() => meeting.value ? meeting.value.status === 'held' : undefined);
	const tallied = computed(() => !!meeting.value?.results);
	const ballots = useCollection<MeetingVote>(computed(() => {
		if (!meetingRef.value || !uid.value || held.value === undefined) {
			return null;
		}
		const all = collection(meetingRef.value, 'ballots');
		return held.value && !tallied.value ? all : query(all, where('voterId', '==', uid.value));
	}));

	// The acta for its signers before it's sent and for every owner after, and the user's notices of it and of the convocatoria.
	// Only what the rules let them read, as booleans so other changes to the meeting don't listen again
	const isSigner = computed(() => !!uid.value && !!meeting.value?.minutesSigners?.includes(uid.value));
	const callSent = computed(() => !!meeting.value?.notifiedAt?.call);
	const minutesSent = computed(() => !!meeting.value?.notifiedAt?.minutes);
	const minutesRef = computed(() => meetingRef.value && (isSigner.value || minutesSent.value) ? doc(meetingRef.value, 'minutes', MINUTES_ID) : null);
	const minutes = useDocument<Minutes>(minutesRef);
	const noticeRef = (kind: NoticeKind, isSent: Ref<boolean>) => computed(() => meetingRef.value && uid.value && isSent.value ? doc(meetingRef.value, 'notices', `${kind}_${uid.value}`) : null);
	const callNotice = useDocument<MeetingNotice>(noticeRef('call', callSent));
	const minutesNotice = useDocument<MeetingNotice>(noticeRef('minutes', minutesSent));

	function getMe() {
		if (!meetingRef.value || !user.value) {
			throw new Error('The meeting and the user must be loaded first');
		}
		return { meetingRef: meetingRef.value, me: user.value };
	}

	async function answerAttendance(status: MeetingAttendance['status'], delegateName?: string) {
		const { meetingRef, me } = getMe();
		await setDoc(doc(meetingRef, 'attendance', me.id), {
			uid: me.id,
			name: me.name || '',
			status,
			...(status === 'delegated' && delegateName ? { delegateName } : {}),
			updatedAt: serverTimestamp(),
		});
	}

	// Once per item and property, voting again changes it. The rules check the property is theirs and its coefficient
	async function vote(item: AgendaItem, property: Property, choice: VoteChoice) {
		const { meetingRef, me } = getMe();
		await setDoc(doc(meetingRef, 'ballots', `${item.id}_${property.id}`), {
			itemId: item.id,
			propertyId: property.id,
			propertyName: property.name,
			coefficient: property.coefficient ?? 0,
			choice,
			voterId: me.id,
			voterName: me.name || '',
			votedAt: serverTimestamp(),
		});
	}

	// Their own slot, signed with their account, and marked on the meeting for the list. Sealed if it's the second, from the
	// server's copy so the signing times are the stored ones. The admin also seals it when it sees it, so if this fails it's left to it
	async function signMinutes(role: SignerRole, path: string) {
		const { meetingRef, me } = getMe();
		const ref = minutesRef.value!;
		const batch = writeBatch(db);
		batch.update(ref, {
			[`signatures.${role}`]: { ...minutes.value![role], path, signedAt: serverTimestamp(), byUid: me.id, byEmail: auth.currentUser?.email ?? '' },
		});
		batch.update(meetingRef, { minutesSigned: arrayUnion(me.id) });
		await batch.commit();
		const seal = async () => {
			const current = (await getDocFromServer(ref)).data() as Omit<Minutes, 'id'> | undefined;
			if (current && !current.closedAt && isFullySigned(current)) {
				await updateDoc(ref, { hash: await minutesHash(current), closedAt: serverTimestamp() });
			}
		};
		// The last two signers can seal it at once, and the rules take only one: that's not a failure
		await seal().catch(async (error: unknown) => {
			const sealed = await getDocFromServer(ref).then(snapshot => !!snapshot.get('closedAt'), () => false);
			if (!sealed) {
				reportError(error, { action: 'Sellar el acta' });
			}
		});
	}

	// readAt or receivedAt, once, by the server's clock
	async function markNotice(notice: MeetingNotice, field: 'readAt' | 'receivedAt') {
		const { meetingRef } = getMe();
		await updateDoc(doc(meetingRef, 'notices', notice.id), { [field]: serverTimestamp() });
	}

	// Art. 17.8 LPH, one agreement at a time
	async function dissent(notice: MeetingNotice, itemId: string) {
		const { meetingRef } = getMe();
		await updateDoc(doc(meetingRef, 'notices', notice.id), { [`dissent.${itemId}`]: serverTimestamp() });
	}

	return {
		meeting,
		loading: computed(() => !meetingRef.value || meeting.pending.value),
		attendance,
		ballots,
		minutes,
		callNotice,
		minutesNotice,
		answerAttendance,
		vote,
		signMinutes,
		markNotice,
		dissent,
	};
}

// e.g. "jueves, 12 de marzo de 2026, 19:30"
export function formatMeetingDate(date: Meeting['date']) {
	return date.toDate().toLocaleString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
