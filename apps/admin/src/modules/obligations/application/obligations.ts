import type { Obligation, ObligationType } from '@gobernansa/shared/domain/obligation.ts';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, deleteField, doc, serverTimestamp, Timestamp, writeBatch } from 'firebase/firestore';
import { useCollection } from 'vuefire';

function obligationsRef(communityId: string) {
	return collection(db, 'communities', communityId, 'obligations');
}

function link(communityId: string) {
	return `/communities/${communityId}/obligations`;
}

// A handful per community, so live
export function useObligations(communityId: string) {
	return useCollection<Obligation>(obligationsRef(communityId));
}

export interface ObligationValues {
	type: ObligationType;
	title: string;
	dueAt: Date;
	everyMonths?: number;
	provider?: { id: string; name: string };
	notes?: string;
	// A one-off one done is pending again once it gets another date or stops repeating
	stillDone: boolean;
}

// New or edited, merged so the optional fields left empty are removed. 2 writes with the activity
export async function saveObligation(communityId: string, id: string, values: ObligationValues, editing: boolean) {
	const uid = auth.currentUser!.uid;
	const now = serverTimestamp();
	const batch = writeBatch(db);
	batch.set(doc(obligationsRef(communityId), id), {
		communityId,
		type: values.type,
		title: values.title,
		dueAt: Timestamp.fromDate(values.dueAt),
		everyMonths: values.everyMonths ?? deleteField(),
		provider: values.provider ?? deleteField(),
		notes: values.notes || deleteField(),
		...(values.stillDone ? {} : { lastDoneAt: deleteField() }),
		updatedAt: now,
		updatedBy: uid,
		...(editing ? {} : { createdAt: now, createdBy: uid }),
	}, { merge: true });
	logActivity(batch, communityId, {
		area: 'obligation',
		summary: `${editing ? 'Editó' : 'Añadió'} la obligación «${values.title}», vence el ${values.dueAt.toLocaleDateString('es')}`,
		link: link(communityId),
	});
	await batch.commit();
}

// Done now, and due again on next when it repeats
export async function markObligationDone(communityId: string, obligation: Obligation, next?: Date) {
	const batch = writeBatch(db);
	batch.update(doc(obligationsRef(communityId), obligation.id), {
		lastDoneAt: serverTimestamp(),
		...(next ? { dueAt: Timestamp.fromDate(next) } : {}),
		updatedAt: serverTimestamp(),
		updatedBy: auth.currentUser!.uid,
	});
	logActivity(batch, communityId, {
		area: 'obligation',
		summary: `Marcó como hecha «${obligation.title}»${next ? `, la próxima vence el ${next.toLocaleDateString('es')}` : ''}`,
		link: link(communityId),
	});
	await batch.commit();
}

// Undoes markObligationDone with the dates it had before
export async function unmarkObligationDone(communityId: string, { id, title, dueAt, lastDoneAt }: Obligation) {
	const batch = writeBatch(db);
	batch.update(doc(obligationsRef(communityId), id), {
		lastDoneAt: lastDoneAt ?? deleteField(),
		dueAt,
		updatedAt: serverTimestamp(),
		updatedBy: auth.currentUser!.uid,
	});
	logActivity(batch, communityId, { area: 'obligation', summary: `Desmarcó como hecha «${title}»`, link: link(communityId) });
	await batch.commit();
}

export async function removeObligation(communityId: string, obligation: Obligation) {
	const batch = writeBatch(db);
	batch.delete(doc(obligationsRef(communityId), obligation.id));
	logActivity(batch, communityId, { area: 'obligation', summary: `Borró la obligación «${obligation.title}»` });
	await batch.commit();
}

// Undoes removeObligation with the data it had, kept from the list
export async function restoreObligation(communityId: string, { id, ...obligation }: Obligation) {
	const batch = writeBatch(db);
	batch.set(doc(obligationsRef(communityId), id), obligation);
	logActivity(batch, communityId, { area: 'obligation', summary: `Restauró la obligación «${obligation.title}»`, link: link(communityId) });
	await batch.commit();
}
