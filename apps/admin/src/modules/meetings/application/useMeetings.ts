import type { AgendaItem, Meeting, MeetingAttendance, MeetingStatus, MeetingVote, Tally, VoteChoice } from '@gobernansa/shared/domain/meeting.ts';
import type { Property } from '@gobernansa/shared/domain/property.ts';
import type { MaybeRefOrGetter } from 'vue';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { isApproved, meetingStatus, voteChoices } from '@gobernansa/shared/domain/meeting.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, doc, getDocs, query, serverTimestamp, Timestamp, where, writeBatch } from 'firebase/firestore';
import { computed, toValue } from 'vue';
import { useCollection, useDocument } from 'vuefire';

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
	return {
		meeting: useDocument<Meeting>(meetingRef),
		attendance: useCollection<MeetingAttendance>(computed(() => meetingRef.value && collection(meetingRef.value, 'attendance'))),
		ballots: useCollection<MeetingVote>(computed(() => meetingRef.value && collection(meetingRef.value, 'ballots'))),
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

// Creates it as a draft when there's no id. Returns its id
export async function saveMeeting(communityId: string, id: string | undefined, { date, time, place, link: url, agenda, ...form }: MeetingForm) {
	const uid = auth.currentUser!.uid;
	const meetingRef = id ? doc(meetingsRef(communityId), id) : doc(meetingsRef(communityId));
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
	batch.set(meetingRef, id ? data : { ...data, status: 'draft', votingOpen: false, createdAt: serverTimestamp(), createdBy: uid }, { merge: true });
	logActivity(batch, communityId, {
		area: 'meeting',
		summary: `${id ? 'Editó' : 'Creó'} la junta «${data.title}»`,
		link: link(communityId, meetingRef.id),
	});
	await batch.commit();
	return meetingRef.id;
}

export async function setMeetingStatus(meeting: Meeting, status: MeetingStatus) {
	const batch = writeBatch(db);
	// Voting closes with the meeting
	batch.update(doc(meetingsRef(meeting.communityId), meeting.id), {
		status,
		...(status === 'convened' ? {} : { votingOpen: false }),
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
