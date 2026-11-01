import type { AgendaItem, Meeting, MeetingAttendance, MeetingStatus, MeetingVote, Tally, VoteChoice } from '@gobernansa/shared/domain/meeting.ts';
import type { MeetingNotice, Minutes, NoticeKind, NoticeOwner, Signer, SignerRole } from '@gobernansa/shared/domain/minutes.ts';
import type { Property } from '@gobernansa/shared/domain/property.ts';
import type { MaybeRefOrGetter } from 'vue';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { demoBurofaxTracking } from '@gobernansa/shared/domain/arrears.ts';
import { isEmail, renderMail } from '@gobernansa/shared/domain/mail.ts';
import { isApproved, meetingStatus, voteChoices } from '@gobernansa/shared/domain/meeting.ts';
import { isFullySigned, MINUTES_ID, minutesHash } from '@gobernansa/shared/domain/minutes.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { arrayUnion, collection, deleteField, doc, getDocFromServer, getDocs, query, serverTimestamp, Timestamp, where, writeBatch } from 'firebase/firestore';
import { computed, toValue } from 'vue';
import { useCollection, useDocument } from 'vuefire';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { meetingMail, queueMail } from '@/modules/mail/application/mail.ts';

export type MeetingForm = Pick<Meeting, 'title' | 'type' | 'agenda'> & { date: string; time: string; place: string; link: string };

function meetingsRef(communityId: string) {
	return collection(db, 'communities', communityId, 'meetings');
}

function link(communityId: string, meetingId: string) {
	return `/communities/${communityId}/meetings/${meetingId}`;
}

// All of the community's, a few a year. Sorted by the page, so no index is needed
export function useMeetings(communityId: string) {
	return useCollection<Meeting>(meetingsRef(communityId));
}

// Live, so answers and votes cast from the webapp show up during the meeting. Nothing to read for a new one
export function useMeeting(communityId: string, meetingId: MaybeRefOrGetter<string>) {
	const meetingRef = computed(() => toValue(meetingId) === 'new' ? null : doc(meetingsRef(communityId), toValue(meetingId)));
	const meeting = useDocument<Meeting>(meetingRef);
	// Booleans, so other changes to the meeting don't listen again. The acta once held, the notices once any is sent
	const held = computed(() => meeting.value?.status === 'held');
	const notified = computed(() => !!meeting.value?.notifiedAt);
	return {
		meeting,
		attendance: useCollection<MeetingAttendance>(computed(() => meetingRef.value && collection(meetingRef.value, 'attendance'))),
		ballots: useCollection<MeetingVote>(computed(() => meetingRef.value && collection(meetingRef.value, 'ballots'))),
		minutes: useDocument<Minutes>(computed(() => meetingRef.value && held.value ? doc(meetingRef.value, 'minutes', MINUTES_ID) : null)),
		notices: useCollection<MeetingNotice>(computed(() => meetingRef.value && notified.value ? collection(meetingRef.value, 'notices') : null)),
	};
}

// Once, for coefficients: the census doesn't change during a meeting
export async function loadProperties(communityId: string) {
	const snapshot = await getDocs(query(collection(db, 'properties'), where('communityId', '==', communityId)));
	return snapshot.docs.map(property => ({ ...property.data(), id: property.id }) as Property);
}

export function toMeetingForm(meeting?: Meeting): MeetingForm {
	const date = meeting?.date.toDate();
	const pad = (n: number) => String(n).padStart(2, '0');
	return {
		title: meeting?.title ?? '',
		type: meeting?.type ?? 'ordinary',
		date: date ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` : '',
		time: date ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : '18:00',
		place: meeting?.place ?? '',
		link: meeting?.link ?? '',
		// Copied, so the form doesn't edit the live document
		agenda: meeting?.agenda.map(item => ({ ...item })) ?? [],
	};
}

// Creates it as a draft when `create`, with the id made when its form opened, so sending it twice writes it once
export async function saveMeeting(communityId: string, id: string, { date, time, place, link: url, agenda, ...form }: MeetingForm, create = false) {
	const uid = auth.currentUser!.uid;
	const meetingRef = doc(meetingsRef(communityId), id);
	const data = {
		...form,
		title: form.title.trim(),
		communityId,
		date: Timestamp.fromDate(new Date(`${date}T${time}`)),
		place: place.trim(),
		link: url.trim(),
		agenda: agenda.filter(item => item.title.trim()).map(item => ({ ...item, title: item.title.trim(), description: item.description?.trim() ?? '' })),
		updatedAt: serverTimestamp(),
		updatedBy: uid,
	};

	const batch = writeBatch(db);
	batch.set(meetingRef, !create ? data : { ...data, status: 'draft', votingOpen: false, createdAt: serverTimestamp(), createdBy: uid }, { merge: true });
	logActivity(batch, communityId, {
		area: 'meeting',
		summary: `${create ? 'Creó' : 'Editó'} la junta «${data.title}»`,
		link: link(communityId, meetingRef.id),
	});
	await batch.commit();
}

// votingOpen: to bring back how it was when undoing
export async function setMeetingStatus(meeting: Meeting, status: MeetingStatus, votingOpen?: boolean) {
	const batch = writeBatch(db);
	// Voting closes with the meeting
	batch.update(doc(meetingsRef(meeting.communityId), meeting.id), {
		status,
		...(status === 'convened' ? (votingOpen === undefined ? {} : { votingOpen }) : { votingOpen: false }),
		updatedAt: serverTimestamp(),
		updatedBy: auth.currentUser!.uid,
	});
	logActivity(batch, meeting.communityId, {
		area: 'meeting',
		summary: `Cambió el estado de la junta «${meeting.title}» a ${meetingStatus[status]}`,
		link: link(meeting.communityId, meeting.id),
	});
	await batch.commit();
}

export async function setVotingOpen(meeting: Meeting, votingOpen: boolean) {
	const batch = writeBatch(db);
	batch.update(doc(meetingsRef(meeting.communityId), meeting.id), { votingOpen, updatedAt: serverTimestamp(), updatedBy: auth.currentUser!.uid });
	logActivity(batch, meeting.communityId, {
		area: 'meeting',
		summary: `${votingOpen ? 'Abrió' : 'Cerró'} la votación de la junta «${meeting.title}»`,
		link: link(meeting.communityId, meeting.id),
	});
	await batch.commit();
}

export async function deleteMeeting(meeting: Meeting) {
	const batch = writeBatch(db);
	batch.delete(doc(meetingsRef(meeting.communityId), meeting.id));
	logActivity(batch, meeting.communityId, { area: 'meeting', summary: `Borró el borrador de la junta «${meeting.title}»` });
	await batch.commit();
}

// Undoes deleteMeeting with the data it had, kept from the page. Its answers and votes were never deleted
export async function restoreMeeting({ id, ...meeting }: Meeting) {
	const batch = writeBatch(db);
	batch.set(doc(meetingsRef(meeting.communityId), id), meeting);
	logActivity(batch, meeting.communityId, { area: 'meeting', summary: `Restauró el borrador de la junta «${meeting.title}»`, link: link(meeting.communityId, id) });
	await batch.commit();
}

// For a neighbour who answers in person or by paper, with their uid as id as when they answer from the webapp
export async function recordAttendance(meeting: Meeting, person: { id: string; name: string }, status: MeetingAttendance['status'], delegateName: string) {
	const batch = writeBatch(db);
	batch.set(doc(meetingsRef(meeting.communityId), meeting.id, 'attendance', person.id), {
		uid: person.id,
		name: person.name,
		status,
		delegateName: status === 'delegated' ? delegateName.trim() : '',
		updatedAt: serverTimestamp(),
	});
	logActivity(batch, meeting.communityId, {
		area: 'meeting',
		summary: `Anotó la asistencia de ${person.name} a la junta «${meeting.title}»`,
		link: link(meeting.communityId, meeting.id),
	});
	await batch.commit();
}

export async function removeAttendance(meeting: Meeting, attendance: MeetingAttendance) {
	const batch = writeBatch(db);
	batch.delete(doc(meetingsRef(meeting.communityId), meeting.id, 'attendance', attendance.id));
	logActivity(batch, meeting.communityId, {
		area: 'meeting',
		summary: `Quitó la asistencia de ${attendance.name} a la junta «${meeting.title}»`,
		link: link(meeting.communityId, meeting.id),
	});
	await batch.commit();
}

// The vote of a property, e.g. of an owner present or represented. Replaces the one it had
export async function recordBallot(meeting: Meeting, item: AgendaItem, property: Property, choice: VoteChoice) {
	const { user } = useAuth();
	const batch = writeBatch(db);
	batch.set(doc(meetingsRef(meeting.communityId), meeting.id, 'ballots', `${item.id}_${property.id}`), {
		itemId: item.id,
		propertyId: property.id,
		propertyName: property.name,
		coefficient: property.coefficient ?? 0,
		choice,
		voterId: auth.currentUser!.uid,
		voterName: user.value?.name || auth.currentUser!.email || '',
		votedAt: serverTimestamp(),
	});
	logActivity(batch, meeting.communityId, {
		area: 'meeting',
		summary: `Anotó el voto de ${property.name} en «${item.title}»: ${voteChoices[choice]}`,
		link: link(meeting.communityId, meeting.id),
	});
	await batch.commit();
}

export async function removeBallot(meeting: Meeting, item: AgendaItem, ballot: MeetingVote) {
	const batch = writeBatch(db);
	batch.delete(doc(meetingsRef(meeting.communityId), meeting.id, 'ballots', ballot.id));
	logActivity(batch, meeting.communityId, {
		area: 'meeting',
		summary: `Anuló el voto de ${ballot.propertyName} en «${item.title}»`,
		link: link(meeting.communityId, meeting.id),
	});
	await batch.commit();
}

// Undoes removeBallot as it was, with who cast it and when
export async function restoreBallot(meeting: Meeting, item: AgendaItem, { id, ...ballot }: MeetingVote) {
	const batch = writeBatch(db);
	batch.set(doc(meetingsRef(meeting.communityId), meeting.id, 'ballots', id), ballot);
	logActivity(batch, meeting.communityId, {
		area: 'meeting',
		summary: `Restauró el voto de ${ballot.propertyName} en «${item.title}»`,
		link: link(meeting.communityId, meeting.id),
	});
	await batch.commit();
}

function minutesRef(meeting: Meeting) {
	return doc(meetingsRef(meeting.communityId), meeting.id, 'minutes', MINUTES_ID);
}

// The acta to sign, from the text composed on the page and then as edited. Saving takes off the signatures there were
export async function saveMinutes(meeting: Meeting, text: string, president: Signer, secretary: Signer, create: boolean) {
	const uid = auth.currentUser!.uid;
	const batch = writeBatch(db);
	batch.set(minutesRef(meeting), {
		communityId: meeting.communityId,
		meetingId: meeting.id,
		text: text.trim(),
		president,
		secretary,
		signatures: {},
		hash: '',
		closedAt: null,
		updatedAt: serverTimestamp(),
		updatedBy: uid,
	});
	batch.update(doc(meetingsRef(meeting.communityId), meeting.id), { minutesSigners: [president.uid, secretary.uid], minutesSigned: [], updatedAt: serverTimestamp(), updatedBy: uid });
	logActivity(batch, meeting.communityId, {
		area: 'meeting',
		summary: `${create ? 'Preparó' : 'Editó'} el acta de la junta «${meeting.title}»`,
		link: link(meeting.communityId, meeting.id),
	});
	await batch.commit();
}

// A signer's own signature, or theirs drawn in person on this screen, which records who was signed in. Sealed if it's the second
export async function signMinutes(meeting: Meeting, signer: Signer, role: SignerRole, path: string) {
	const { uid, email } = auth.currentUser!;
	const batch = writeBatch(db);
	batch.update(minutesRef(meeting), { [`signatures.${role}`]: { ...signer, path, signedAt: serverTimestamp(), byUid: uid, byEmail: email ?? '' } });
	batch.update(doc(meetingsRef(meeting.communityId), meeting.id), { minutesSigned: arrayUnion(signer.uid) });
	logActivity(batch, meeting.communityId, {
		area: 'meeting',
		summary: signer.uid === uid ? `Firmó el acta de la junta «${meeting.title}»` : `Recogió en persona la firma de ${signer.name} en el acta de la junta «${meeting.title}»`,
		link: link(meeting.communityId, meeting.id),
	});
	await batch.commit();
	await sealMinutes(meeting);
}

// Once both have signed: its hash, from the server's copy so the signing times are the stored ones. The webapp's signer
// seals it too when they sign last, so if both try at once the rules refuse the second: then it's sealed and that's fine
export async function sealMinutes(meeting: Meeting) {
	const snapshot = await getDocFromServer(minutesRef(meeting));
	const minutes = snapshot.data() as Omit<Minutes, 'id'> | undefined;
	if (!minutes || minutes.closedAt || !isFullySigned(minutes)) {
		return;
	}

	const batch = writeBatch(db);
	batch.update(snapshot.ref, { hash: await minutesHash(minutes), closedAt: serverTimestamp() });
	logActivity(batch, meeting.communityId, { area: 'meeting', summary: `Cerró el acta firmada de la junta «${meeting.title}»`, link: link(meeting.communityId, meeting.id) });
	await batch.commit().catch(async (error: unknown) => {
		if (!(await getDocFromServer(snapshot.ref)).data()?.closedAt) {
			throw error;
		}
	});
}

// Art. 17.8 LPH: a dissent received by post, burofax or in person, from an owner with an account or without, kept apart from
// those made in the app. receivedOn: the day it arrived
export async function recordDissent(meeting: Meeting, notice: MeetingNotice, item: AgendaItem, receivedOn: Date) {
	const batch = writeBatch(db);
	batch.update(doc(meetingsRef(meeting.communityId), meeting.id, 'notices', notice.id), {
		[`recordedDissent.${item.id}`]: { receivedOn: Timestamp.fromDate(receivedOn), recordedAt: serverTimestamp(), recordedBy: auth.currentUser!.uid },
	});
	logActivity(batch, meeting.communityId, {
		area: 'meeting',
		summary: `Anotó la discrepancia de ${notice.name || notice.propertyNames.join(', ')} con «${item.title}» en la junta «${meeting.title}»`,
		link: link(meeting.communityId, meeting.id),
	});
	await batch.commit();
}

// Undoes recordDissent
export async function removeRecordedDissent(meeting: Meeting, notice: MeetingNotice, item: AgendaItem) {
	const batch = writeBatch(db);
	batch.update(doc(meetingsRef(meeting.communityId), meeting.id, 'notices', notice.id), { [`recordedDissent.${item.id}`]: deleteField() });
	logActivity(batch, meeting.communityId, {
		area: 'meeting',
		summary: `Quitó la discrepancia anotada de ${notice.name || notice.propertyNames.join(', ')} con «${item.title}» en la junta «${meeting.title}»`,
		link: link(meeting.communityId, meeting.id),
	});
	await batch.commit();
}

/**
 * The one place a meeting's notices are sent, to the owners given (those without one of this kind yet): in the app when they
 * have an account, by email when the census has theirs (queued in the outbox, mail.ts), and certified by post in test mode,
 * with a made-up reference and nothing sent. Another channel goes here too
 */
export async function sendNotices(meeting: Meeting, kind: NoticeKind, owners: (NoticeOwner & { absent: boolean })[]) {
	const uid = auth.currentUser!.uid;
	const items = kind === 'minutes' ? meeting.agenda.filter(item => item.votable).map(item => item.id) : [];
	const emailed = owners.filter(owner => isEmail(owner.email));
	// Read once when there are emails: the community's name and the acta's text, which goes in them
	const [community, minutes] = emailed.length
		? await Promise.all([
				loadCommunity(meeting.communityId),
				kind === 'minutes' ? getDocFromServer(doc(meetingsRef(meeting.communityId), meeting.id, 'minutes', MINUTES_ID)) : undefined,
			])
		: [];
	const mailOf = (owner: NoticeOwner & { absent: boolean }) => meetingMail(meeting, kind, owner, { name: community?.name ?? '', address: community?.address }, (minutes?.data() as Minutes | undefined)?.text);
	// A batch takes up to 500 writes and 10 MiB: a notice and an email per owner, and each email can carry the whole acta
	const size = emailed.length ? new TextEncoder().encode(JSON.stringify(renderMail(mailOf(emailed[0])))).length : 0;
	const perBatch = size ? Math.max(1, Math.min(240, Math.floor(8_000_000 / size))) : 450;
	for (let start = 0; start < owners.length; start += perBatch) {
		const batch = writeBatch(db);
		for (const { key, absent, ...owner } of owners.slice(start, start + perBatch)) {
			if (isEmail(owner.email)) {
				queueMail(batch, {
					...mailOf({ ...owner, key, absent }),
					to: owner.email,
					communityId: meeting.communityId,
					kind: kind === 'call' ? 'meeting-call' : 'meeting-minutes',
					link: link(meeting.communityId, meeting.id),
				});
			}
			batch.set(doc(meetingsRef(meeting.communityId), meeting.id, 'notices', `${kind}_${key}`), {
				kind,
				...owner,
				absent: kind === 'minutes' && absent,
				items,
				app: !!owner.uid,
				certified: { mode: 'test', reference: demoBurofaxTracking() },
				sentAt: serverTimestamp(),
				sentBy: uid,
				readAt: null,
				receivedAt: null,
				dissent: {},
			});
		}
		if (!start) {
			batch.update(doc(meetingsRef(meeting.communityId), meeting.id), { [`notifiedAt.${kind}`]: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: uid });
			logActivity(batch, meeting.communityId, {
				area: 'meeting',
				summary: `Notificó ${kind === 'call' ? 'la convocatoria' : 'el acta'} de la junta «${meeting.title}» a ${owners.length} propietarios${emailed.length ? `, ${emailed.length} por email` : ''}`,
				link: link(meeting.communityId, meeting.id),
			});
		}
		await batch.commit();
	}
}

const percent = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatPercent(value: number) {
	return `${percent.format(value)} %`;
}

// An item's result as the minutes word it, e.g. «Se aprueba con 12 votos a favor (54,30 %), 3 en contra (12,10 %) y 1 abstención (2,00 %)».
// Percentages over the community's whole coefficient
export function describeResult(tally: Tally[], total: number) {
	if (!tally.some(entry => entry.votes)) {
		return 'No se emitieron votos.';
	}

	const share = (coefficient: number) => formatPercent(total ? coefficient / total * 100 : 0);
	const [yes, no, abstain] = (['yes', 'no', 'abstain'] as const).map(choice => tally.find(entry => entry.choice === choice)!);
	const count = (votes: number, one: string, many: string) => `${votes} ${votes === 1 ? one : many}`;
	return `${isApproved(tally) ? 'Se aprueba' : 'No se aprueba'} con ${count(yes.votes, 'voto', 'votos')} a favor (${share(yes.coefficient)}), `
		+ `${no.votes} en contra (${share(no.coefficient)}) y ${count(abstain.votes, 'abstención', 'abstenciones')} (${share(abstain.coefficient)}).`;
}
