import type { Charge, ChargeReturn } from '@gobernansa/shared/domain/finance.ts';
import type { Property } from '@gobernansa/shared/domain/property.ts';
import type { Remittance, RemittanceItem, ReturnReason, SepaMandate } from '@gobernansa/shared/domain/sepa.ts';
import type { Timestamp, WriteBatch } from 'firebase/firestore';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { remittanceStatuses, returnReasons } from '@gobernansa/shared/domain/sepa.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { reportError } from '@gobernansa/shared/infrastructure/monitoring.ts';
import { plural } from '@gobernansa/shared/utils/helpers.ts';
import { arrayRemove, arrayUnion, collection, deleteField, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { toDueDate } from './useFinances.ts';

// Each debit writes its charge and, the first time, its mandate, plus the remittance and the activity entry: within
// the 500 writes of a batch. Bigger communities make several remittances
export const MAX_REMITTANCE_ITEMS = 240;

function remittancesRef(communityId: string) {
	return collection(db, 'communities', communityId, 'remittances');
}

function chargesRef(communityId: string) {
	return collection(db, 'communities', communityId, 'charges');
}

function propertyRef(propertyId: string) {
	return doc(db, 'properties', propertyId);
}

function signedUid() {
	const uid = auth.currentUser?.uid;
	if (!uid) {
		throw new Error('The admin must be signed in to change the accounts');
	}
	return uid;
}

function link(communityId: string) {
	return `/communities/${communityId}/remittances`;
}

// null removes it
export async function saveMandate(communityId: string, property: Property, mandate: SepaMandate | null) {
	const batch = writeBatch(db);
	batch.update(propertyRef(property.id), {
		mandate: mandate ?? deleteField(),
		updatedAt: serverTimestamp(),
		updatedBy: signedUid(),
	});
	logActivity(batch, communityId, {
		area: 'finance',
		summary: mandate
			? `Guardó el mandato SEPA ${mandate.reference} de ${property.name} (${mandate.status === 'active' ? 'activo' : 'cancelado'})`
			: `Quitó el mandato SEPA de ${property.name}`,
		link: `/communities/${communityId}/mandates`,
	});
	await batch.commit();
}

// ponytail: every remittance once, about a dozen a year; filter by year when a community piles up hundreds
export async function loadRemittances(communityId: string) {
	const snapshot = await getDocs(remittancesRef(communityId));
	return snapshot.docs.map(remittance => ({ ...remittance.data(), id: remittance.id }) as Remittance)
		.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
}

export type RemittanceData = Pick<Remittance, 'reference' | 'collectionDate' | 'issuedAt' | 'creditor' | 'items' | 'total'>;

// The charges are tied to it so they can't go in another one, and the mandates debited first (FRST) remember it
export async function createRemittance(communityId: string, id: string, data: RemittanceData) {
	const uid = signedUid();
	const now = serverTimestamp();
	const batch = writeBatch(db);
	batch.set(doc(remittancesRef(communityId), id), { ...data, status: 'generated', createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid });
	for (const item of data.items) {
		batch.update(doc(chargesRef(communityId), item.chargeId), { remittanceId: id, updatedAt: now, updatedBy: uid });
		if (item.sequence === 'FRST') {
			batch.update(propertyRef(item.propertyId), { 'mandate.firstRemittanceId': id });
		}
	}
	logActivity(batch, communityId, {
		area: 'finance',
		summary: `Generó la remesa ${data.reference}: ${data.items.length} recibos domiciliados por ${formatCents(data.total)}, cargo el ${data.collectionDate.split('-').reverse().join('/')}`,
		link: link(communityId),
	});
	await batch.commit();
}

// Only one not sent yet: its charges are freed and the mandates it debited first are first again
export async function deleteRemittance(communityId: string, remittance: Remittance) {
	const uid = signedUid();
	// Those still tied to it, a charge deleted since can't be updated
	const charges = await getDocs(query(chargesRef(communityId), where('remittanceId', '==', remittance.id)));
	const firsts = await Promise.all(remittance.items.filter(item => item.sequence === 'FRST').map(async item => getDoc(propertyRef(item.propertyId))));
	const batch = writeBatch(db);
	batch.delete(doc(remittancesRef(communityId), remittance.id));
	for (const charge of charges.docs) {
		batch.update(charge.ref, { remittanceId: deleteField(), updatedAt: serverTimestamp(), updatedBy: uid });
	}
	for (const property of firsts) {
		if ((property.data() as Property | undefined)?.mandate?.firstRemittanceId === remittance.id) {
			batch.update(property.ref, { 'mandate.firstRemittanceId': deleteField() });
		}
	}
	logActivity(batch, communityId, {
		area: 'finance',
		summary: `Borró la remesa ${remittance.reference} (${remittance.items.length} recibos por ${formatCents(remittance.total)})`,
		link: link(communityId),
	});
	await batch.commit();
}

/**
 * Collected marks its charges paid, the returned ones are no longer tied to it and stay unpaid. Going back from
 * collected (undo) marks unpaid again those it paid. `also` adds to the same batch, e.g. the bank movement that
 * collected it. Returns the remittance as it's now
 */
export async function setRemittanceStatus(communityId: string, remittance: Remittance, status: Remittance['status'], at: Timestamp | null, also?: (batch: WriteBatch) => void) {
	const uid = signedUid();
	const now = serverTimestamp();
	const batch = writeBatch(db);
	const dates = status === 'generated'
		? { sentAt: null, collectedAt: null }
		: status === 'sent' ? { sentAt: remittance.sentAt ?? at, collectedAt: null } : { collectedAt: at };
	batch.update(doc(remittancesRef(communityId), remittance.id), { status, ...dates, updatedAt: now, updatedBy: uid });
	let changed = 0;
	if (status === 'collected' || remittance.status === 'collected') {
		const charges = await getDocs(query(chargesRef(communityId), where('remittanceId', '==', remittance.id)));
		// Those already paid by hand keep their date, and only those this remittance paid go back to unpaid
		const collectedAt = remittance.collectedAt?.toMillis();
		for (const charge of charges.docs) {
			const paidAt = (charge.data() as Charge).paidAt;
			if (status === 'collected' ? !paidAt : paidAt?.toMillis() === collectedAt) {
				batch.update(charge.ref, { paidAt: status === 'collected' ? at : null, updatedAt: now, updatedBy: uid });
				changed++;
			}
		}
	}
	logActivity(batch, communityId, {
		area: 'finance',
		summary: `Marcó la remesa ${remittance.reference} (${plural(remittance.items.length, 'recibo', 'recibos')} por ${formatCents(remittance.total)}) como ${remittanceStatuses[status].toLowerCase()}${
			status === 'collected' ? `: ${plural(changed, 'recibo queda pagado', 'recibos quedan pagados')}` : remittance.status === 'collected' ? `: ${plural(changed, 'recibo vuelve', 'recibos vuelven')} a pendiente` : ''}`,
		link: link(communityId),
	});
	also?.(batch);
	await batch.commit();
	return { ...remittance, status, ...dates } as Remittance;
}

export interface ReturnData {
	reason: ReturnReason;
	// 'YYYY-MM-DD'
	date: string;
	// Gastos de devolución charged to the property
	fee?: { cents: number };
}

/**
 * Devolución of one debit: the charge is unpaid again and free for another remittance, keeping the return, and a first
 * debit returned makes the mandate's next one first again. In a transaction on the remittance as stored, so the same
 * return registered twice (another tab, the bank's report after doing it by hand) is only registered once, and returns
 * registered meanwhile aren't overwritten. Resolves to the remittance as it's now and how to undo it, with no undo when
 * it was already returned
 */
export async function returnDebit(communityId: string, remittance: Remittance, item: RemittanceItem, { reason, date, fee: feeData }: ReturnData) {
	const uid = signedUid();
	const now = serverTimestamp();
	const remittanceRef = doc(remittancesRef(communityId), remittance.id);
	const chargeRef = doc(chargesRef(communityId), item.chargeId);
	// From the debit, so its gastos can't be charged twice either
	const fee = feeData && { id: `return-${remittance.id}-${item.chargeId}`, cents: feeData.cents };
	const result = await runTransaction(db, async (transaction) => {
		const [remittanceSnapshot, chargeSnapshot, propertySnapshot] = await Promise.all([transaction.get(remittanceRef), transaction.get(chargeRef), transaction.get(propertyRef(item.propertyId))]);
		if (!remittanceSnapshot.exists()) {
			throw new Error('la remesa ya no existe');
		}
		const stored = { ...remittanceSnapshot.data(), id: remittance.id } as Remittance;
		if (stored.items.find(other => other.chargeId === item.chargeId)?.returned) {
			return { remittance: stored };
		}
		if (!chargeSnapshot.exists()) {
			throw new Error('el recibo ya no existe');
		}
		const charge = chargeSnapshot.data() as Charge;
		const property = propertySnapshot.data() as Property | undefined;
		// The mandate is first again only if none of its first debits in this remittance went through
		const resetsFirst = item.sequence === 'FRST' && property?.mandate?.firstRemittanceId === remittance.id
			&& !stored.items.some(other => other.chargeId !== item.chargeId && other.propertyId === item.propertyId && other.sequence === 'FRST' && !other.returned);
		const entry: ChargeReturn = { remittanceId: remittance.id, reason, date, amount: item.amount };
		const returned = { ...stored, items: stored.items.map(other => other.chargeId === item.chargeId ? { ...other, returned: { reason, date, ...(fee ? { feeChargeId: fee.id } : {}) } } : other) };

		transaction.update(remittanceRef, { items: returned.items, updatedAt: now, updatedBy: uid });
		transaction.update(chargeRef, { paidAt: null, remittanceId: deleteField(), returns: arrayUnion(entry), updatedAt: now, updatedBy: uid });
		if (resetsFirst) {
			transaction.update(propertyRef(item.propertyId), { 'mandate.firstRemittanceId': deleteField() });
		}
		if (fee) {
			transaction.set(doc(chargesRef(communityId), fee.id), {
				communityId,
				propertyId: item.propertyId,
				propertyName: item.propertyName,
				ownerUid: property?.ownerUid ?? charge.ownerUid,
				...(property?.ownerName ? { ownerName: property.ownerName } : {}),
				type: 'fee',
				concept: `Gastos de devolución · ${item.concept}`,
				amount: fee.cents,
				dueDate: toDueDate(date),
				paidAt: null,
				batchId: `return-${remittance.id}`,
				createdAt: now,
				createdBy: uid,
				updatedAt: now,
				updatedBy: uid,
			});
		}
		logActivity(transaction, communityId, {
			area: 'finance',
			summary: `Registró la devolución de «${item.concept}» de ${item.propertyName} (${formatCents(item.amount)}, ${reason} ${returnReasons[reason].toLowerCase()})${fee ? ` y le cargó ${formatCents(fee.cents)} de gastos` : ''}`,
			link: link(communityId),
		});
		return { remittance: returned, charge, entry, resetsFirst };
	});
	if (!result.entry) {
		return { remittance: result.remittance, undo: undefined };
	}
	const { remittance: returned, charge, entry, resetsFirst } = result;

	// Only this debit's return is undone, others registered since are kept. Resolves to the remittance as it's then
	async function undo() {
		const current = await getDoc(remittanceRef);
		const items = ((current.data() as Remittance | undefined)?.items ?? returned.items).map((other) => {
			if (other.chargeId !== item.chargeId) {
				return other;
			}
			const copy = { ...other };
			delete copy.returned;
			return copy;
		});
		const batch = writeBatch(db);
		batch.update(remittanceRef, { items, updatedAt: serverTimestamp(), updatedBy: uid });
		batch.update(chargeRef, { paidAt: charge.paidAt ?? null, remittanceId: remittance.id, returns: arrayRemove(entry), updatedAt: serverTimestamp(), updatedBy: uid });
		if (resetsFirst) {
			batch.update(propertyRef(item.propertyId), { 'mandate.firstRemittanceId': remittance.id });
		}
		if (fee) {
			batch.delete(doc(chargesRef(communityId), fee.id));
		}
		logActivity(batch, communityId, {
			area: 'finance',
			summary: `Deshizo la devolución de «${item.concept}» de ${item.propertyName}`,
			link: link(communityId),
		});
		await batch.commit();
		return { ...returned, items };
	}

	return { remittance: returned, undo };
}

// What a bank report brought (MON-4): the returns registered from it, each logged on its own, and those left out, why.
// Not waited for, the returns are registered already
export function logReturnsReport(communityId: string, file: string, registered: RemittanceItem[], unmatched: { problem?: string }[]) {
	const batch = writeBatch(db);
	const reasons = [...new Set(unmatched.map(match => match.problem))].join('; ');
	logActivity(batch, communityId, {
		area: 'finance',
		summary: `Importó las devoluciones de ${file}: ${plural(registered.length, 'casada', 'casadas')} por ${formatCents(registered.reduce((sum, item) => sum + item.amount, 0))}${
			unmatched.length ? ` y ${plural(unmatched.length, 'sin casar', 'sin casar')} (${reasons})` : ''}`,
		link: link(communityId),
	});
	void batch.commit().catch(error => reportError(error, { action: 'No se ha podido registrar el informe de devoluciones' }));
}
