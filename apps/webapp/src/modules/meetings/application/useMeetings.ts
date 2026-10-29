import type { AgendaItem, Meeting, MeetingAttendance, MeetingVote, VoteChoice } from '@gobernansa/shared/domain/meeting.ts';
import type { Property } from '@gobernansa/shared/domain/property.ts';
import type { MaybeRefOrGetter } from 'vue';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { collection, doc, getFirestore, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
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

	const meetingsRef = computed(() => userCommunity.value
		? query(communityCollection<Meeting>(db, userCommunity.value.id, 'meetings'), where('status', 'in', VISIBLE_STATUS))
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

	const meetingRef = computed(() => userCommunity.value
		? communityDoc(db, userCommunity.value.id, 'meetings', toValue(meetingId))
		: null);
	const meeting = useDocument<Meeting>(meetingRef);

	const attendanceRef = computed(() => meetingRef.value && user.value ? doc(meetingRef.value, 'attendance', user.value.id) : null);
	const attendance = useDocument<MeetingAttendance>(attendanceRef);

	// Everyone's once held, for the results. Before, only the user's: a meeting can have hundreds and each one is a read.
	// A boolean, so other changes to the meeting don't listen to the ballots again
	const held = computed(() => meeting.value ? meeting.value.status === 'held' : undefined);
	const ballots = useCollection<MeetingVote>(computed(() => {
		if (!meetingRef.value || !user.value || held.value === undefined) {
			return null;
		}
		const all = collection(meetingRef.value, 'ballots');
		return held.value ? all : query(all, where('voterId', '==', user.value.id));
	}));

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

	return {
		meeting,
		loading: computed(() => !meetingRef.value || meeting.pending.value),
		attendance,
		ballots,
		answerAttendance,
		vote,
	};
}

// e.g. "jueves, 12 de marzo de 2026, 19:30"
export function formatMeetingDate(date: Meeting['date']) {
	return date.toDate().toLocaleString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
