import type { BankMovement, GatewayPayment, MatchCandidate, MovementData } from '@gobernansa/shared/domain/bank.ts';
import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { Expense } from '@gobernansa/shared/domain/finance.ts';
import type { PaymentOrder, Remittance } from '@gobernansa/shared/domain/sepa.ts';
import type { WriteBatch } from 'firebase/firestore';
import type { ExpenseData } from './useFinances.ts';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { movementIds } from '@gobernansa/shared/domain/bank.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, deleteField, doc, getDoc, getDocs, query, serverTimestamp, Timestamp, where, writeBatch } from 'firebase/firestore';
import { addExpense, deleteExpense } from './useFinances.ts';
import { setPaymentOrderExecuted } from './usePaymentOrders.ts';
import { setRemittanceStatus } from './useRemittances.ts';

// A batch takes up to 500 writes, one of them is the activity entry
const MOVEMENTS_PER_BATCH = 499;

function movementsRef(communityId: string) {
	return collection(db, 'communities', communityId, 'bankMovements');
}

function signedUid() {
	const uid = auth.currentUser?.uid;
	if (!uid) {
		throw new Error('The admin must be signed in to change the accounts');
	}
	return uid;
}

function link(communityId: string) {
	return `/communities/${communityId}/bank`;
}

// The day the bank booked it, at noon so no time zone moves it to another day
function movementDay(movement: Pick<BankMovement, 'date'>) {
	return Timestamp.fromDate(new Date(`${movement.date}T12:00`));
}

/**
 * Those still to reconcile, however old, and every one since `since` ('YYYY-MM-DD'), once. Statements pile up month
 * after month, so older reconciled ones aren't read. Newest first
 */
export async function loadBankMovements(communityId: string, since: string) {
	const [pending, recent] = await Promise.all([
		getDocs(query(movementsRef(communityId), where('status', '==', 'pending'))),
		getDocs(query(movementsRef(communityId), where('date', '>=', since))),
	]);
	const movements = new Map([...pending.docs, ...recent.docs].map(movement => [movement.id, { ...movement.data(), id: movement.id } as BankMovement]));
	return [...movements.values()].sort((a, b) => b.date.localeCompare(a.date) || b.position - a.position);
}

/**
 * The online payments made since `since` ('YYYY-MM-DD'), once, for the gateway's payouts. One where() on their date:
 * the reconciled and reverted ones are left out in the browser
 */
export async function loadGatewayPayments(communityId: string, since: string) {
	const snapshot = await getDocs(query(collection(db, 'communities', communityId, 'payments'), where('createdAt', '>=', Timestamp.fromDate(new Date(`${since}T00:00`)))));
	return snapshot.docs.map(payment => ({ ...payment.data(), id: payment.id }) as GatewayPayment);
}

// The documents a match points to: a payout's are the payments it carried
function matchedRef(communityId: string, kind: 'charges' | 'expenses' | 'payout', id: string) {
	return doc(db, 'communities', communityId, kind === 'payout' ? 'payments' : kind, id);
}

/**
 * Only those not imported before, by their deterministic ids: those already there are left as they are, reconciled or
 * not. One read of what's there between the statement's first and last days. Resolves to those added
 */
export async function importMovements(communityId: string, source: BankMovement['source'], data: MovementData[], label: string) {
	if (!data.length) {
		return [];
	}
	const uid = signedUid();
	const ids = await movementIds(data);
	const from = data.reduce((min, movement) => movement.date < min ? movement.date : min, data[0].date);
	const to = data.reduce((max, movement) => movement.date > max ? movement.date : max, data[0].date);
	const existing = new Set((await getDocs(query(movementsRef(communityId), where('date', '>=', from), where('date', '<=', to)))).docs.map(movement => movement.id));
	const fresh = data.flatMap((movement, index) => existing.has(ids[index]) ? [] : [{ ...movement, id: ids[index] }]);

	// ponytail: past 499 movements the import is split in several batches, a failure halfway leaves the first ones, importing again adds the rest
	for (let start = 0; start < fresh.length; start += MOVEMENTS_PER_BATCH) {
		const batch = writeBatch(db);
		const now = serverTimestamp();
		for (const { id, ...movement } of fresh.slice(start, start + MOVEMENTS_PER_BATCH)) {
			batch.set(doc(movementsRef(communityId), id), { ...movement, source, status: 'pending', createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid });
		}
		logActivity(batch, communityId, {
			area: 'finance',
			summary: `Importó ${fresh.length} movimientos bancarios de ${label}`,
			link: link(communityId),
		});
		await batch.commit();
	}
	return fresh.map(movement => ({ ...movement, source, status: 'pending' }) as BankMovement);
}

// Undoes importMovements: only those still pending, a reconciled one has to be undone first
export async function removeMovements(communityId: string, movements: BankMovement[], label: string) {
	const pending = movements.filter(movement => movement.status === 'pending');
	for (let start = 0; start < pending.length; start += MOVEMENTS_PER_BATCH) {
		const batch = writeBatch(db);
		for (const movement of pending.slice(start, start + MOVEMENTS_PER_BATCH)) {
			batch.delete(doc(movementsRef(communityId), movement.id));
		}
		logActivity(batch, communityId, { area: 'finance', summary: `Quitó ${pending.length} movimientos bancarios de ${label}`, link: link(communityId) });
		await batch.commit();
	}
}

/**
 * Reconciles a movement with what it paid or collected, marked paid on the movement's day, in one batch: charges and
 * invoices point back to it, a remittance is collected and a payment order executed. A payout's payments only point back
 * to it, they were paid the day the neighbour paid. Resolves to the movement as it's now
 */
export async function matchMovement(communityId: string, movement: BankMovement, candidate: MatchCandidate, documents: { remittances: Remittance[]; orders: PaymentOrder[] }) {
	const uid = signedUid();
	const at = movementDay(movement);
	const match = { kind: candidate.kind, ids: candidate.ids, label: candidate.label };
	const matched = { ...movement, status: 'matched', match } as BankMovement;
	const markMovement = (batch: WriteBatch) => batch.update(doc(movementsRef(communityId), movement.id), { status: 'matched', match, updatedAt: serverTimestamp(), updatedBy: uid });

	if (candidate.kind === 'remittance' || candidate.kind === 'paymentOrder') {
		if (candidate.kind === 'remittance') {
			const remittance = documents.remittances.find(other => other.id === candidate.ids[0]);
			if (!remittance) {
				throw new Error('la remesa ya no existe');
			}
			await setRemittanceStatus(communityId, remittance, 'collected', at, markMovement);
		} else {
			const order = documents.orders.find(other => other.id === candidate.ids[0]);
			if (!order) {
				throw new Error('la orden de pago ya no existe');
			}
			await setPaymentOrderExecuted(communityId, order, at, markMovement);
		}
		return matched;
	}

	const batch = writeBatch(db);
	for (const id of candidate.ids) {
		batch.update(matchedRef(communityId, candidate.kind, id), candidate.kind === 'payout'
			? { bankMovementId: movement.id }
			: { paidAt: at, bankMovementId: movement.id, updatedAt: serverTimestamp(), updatedBy: uid });
	}
	markMovement(batch);
	logActivity(batch, communityId, {
		area: 'finance',
		summary: `Concilió el movimiento «${movement.concept}» de ${formatCents(movement.amount)} con ${candidate.label}`,
		link: link(communityId),
	});
	await batch.commit();
	return matched;
}

/**
 * Undoes matchMovement, also later: what it marked paid is unpaid again, unless paid otherwise since, and the movement
 * is pending. Resolves to the movement as it's now
 */
export async function unmatchMovement(communityId: string, movement: BankMovement) {
	const uid = signedUid();
	// The match as stored: an old undo after matching it again elsewhere would undo the wrong one
	const stored = await getDoc(doc(movementsRef(communityId), movement.id));
	const match = stored.data()?.status === 'matched' ? (stored.data() as BankMovement).match : undefined;
	const pending = { ...movement, status: 'pending' } as BankMovement;
	delete pending.match;
	const markMovement = (batch: WriteBatch) => batch.update(doc(movementsRef(communityId), movement.id), { status: 'pending', match: deleteField(), updatedAt: serverTimestamp(), updatedBy: uid });
	if (!match) {
		return pending;
	}

	if (match.kind === 'remittance') {
		const snapshot = await getDoc(doc(db, 'communities', communityId, 'remittances', match.ids[0]));
		const remittance = snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } as Remittance : undefined;
		if (remittance?.status === 'collected') {
			await setRemittanceStatus(communityId, remittance, 'sent', null, markMovement);
			return pending;
		}
	} else if (match.kind === 'paymentOrder') {
		const snapshot = await getDoc(doc(db, 'communities', communityId, 'paymentOrders', match.ids[0]));
		const order = snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } as PaymentOrder : undefined;
		if (order?.status === 'executed') {
			await setPaymentOrderExecuted(communityId, order, null, markMovement);
			return pending;
		}
	}

	const batch = writeBatch(db);
	if (match.kind === 'charges' || match.kind === 'expenses' || match.kind === 'payout') {
		// Those deleted since can't be updated, and those paid otherwise since keep it
		const kind = match.kind;
		const documents = await Promise.all(match.ids.map(async id => getDoc(matchedRef(communityId, kind, id))));
		for (const document of documents) {
			if (document.exists() && document.data().bankMovementId === movement.id) {
				batch.update(document.ref, kind === 'payout'
					? { bankMovementId: deleteField() }
					: { paidAt: null, bankMovementId: deleteField(), updatedAt: serverTimestamp(), updatedBy: uid });
			}
		}
	}
	markMovement(batch);
	logActivity(batch, communityId, {
		area: 'finance',
		summary: `Deshizo la conciliación del movimiento «${movement.concept}» con ${match.label}`,
		link: link(communityId),
	});
	await batch.commit();
	return pending;
}

/**
 * Nothing to reconcile it with, e.g. a bank fee or a transfer between the community's accounts. A fee can be recorded
 * as a paid expense, in the same batch and with its id from the movement's, so trying again, from another tab too,
 * doesn't duplicate it
 */
export async function ignoreMovement(communityId: string, movement: BankMovement, note: string, expense?: ExpenseData) {
	const expenseId = `bank-${movement.id}`;
	const markMovement = (batch: WriteBatch) => {
		batch.update(doc(movementsRef(communityId), movement.id), {
			status: 'ignored',
			...(note ? { note } : {}),
			...(expense ? { expenseId } : {}),
			updatedAt: serverTimestamp(),
			updatedBy: signedUid(),
		});
		logActivity(batch, communityId, {
			area: 'finance',
			summary: `Marcó el movimiento «${movement.concept}» de ${formatCents(movement.amount)} como sin conciliar${expense ? ', registrado como gasto' : ''}`,
			link: link(communityId),
		});
	};
	if (expense) {
		await addExpense(communityId, expenseId, expense, markMovement);
	} else {
		const batch = writeBatch(db);
		markMovement(batch);
		await batch.commit();
	}
	return { ...movement, status: 'ignored', ...(note ? { note } : {}), ...(expense ? { expenseId } : {}) } as BankMovement;
}

// Undoes ignoreMovement, removing the expense recorded for it in the same batch
export async function unignoreMovement(communityId: string, movement: BankMovement) {
	const markMovement = (batch: WriteBatch) => {
		batch.update(doc(movementsRef(communityId), movement.id), { status: 'pending', note: deleteField(), expenseId: deleteField(), updatedAt: serverTimestamp(), updatedBy: signedUid() });
		logActivity(batch, communityId, {
			area: 'finance',
			summary: `Volvió a dejar pendiente el movimiento «${movement.concept}» de ${formatCents(movement.amount)}`,
			link: link(communityId),
		});
	};
	// The expense as stored: a page left open may not know one was recorded since
	const expenseId = (await getDoc(doc(movementsRef(communityId), movement.id))).data()?.expenseId as string | undefined;
	const snapshot = expenseId ? await getDoc(doc(db, 'communities', communityId, 'expenses', expenseId)) : undefined;
	if (snapshot?.exists()) {
		await deleteExpense(communityId, { ...snapshot.data(), id: snapshot.id } as Expense, markMovement);
	} else {
		const batch = writeBatch(db);
		markMovement(batch);
		await batch.commit();
	}
	const pending = { ...movement, status: 'pending' } as BankMovement;
	delete pending.note;
	delete pending.expenseId;
	return pending;
}

// null disconnects it. Only the test mode exists for now
export async function saveBankFeed(communityId: string, feed: Community['bankFeed'] | null, summary: string) {
	const batch = writeBatch(db);
	batch.update(doc(db, 'communities', communityId), { bankFeed: feed ?? deleteField(), updatedAt: serverTimestamp(), updatedBy: signedUid() });
	logActivity(batch, communityId, { area: 'finance', summary, link: link(communityId) });
	await batch.commit();
}
