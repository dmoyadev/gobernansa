import type { CustomAccount, FiscalYearClosing, JournalLine, ManualEntry } from '@gobernansa/shared/domain/accounting.ts';
import type { Booking } from '@gobernansa/shared/domain/booking.ts';
import type { Budget, Charge, Expense } from '@gobernansa/shared/domain/finance.ts';
import type { Property } from '@gobernansa/shared/domain/property.ts';
import type { DocumentSnapshot, QuerySnapshot } from 'firebase/firestore';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { PAYOUT_DAYS } from '@gobernansa/shared/domain/bank.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, doc, getDoc, getDocs, query, serverTimestamp, Timestamp, where, writeBatch } from 'firebase/firestore';

function signedUid() {
	const uid = auth.currentUser?.uid;
	if (!uid) {
		throw new Error('The admin must be signed in to change the accounts');
	}
	return uid;
}

function entriesRef(communityId: string) {
	return collection(db, 'communities', communityId, 'journalEntries');
}

function closingRef(communityId: string, year: number) {
	return doc(db, 'communities', communityId, 'fiscalYears', String(year));
}

function chartRef(communityId: string) {
	return doc(db, 'communities', communityId, 'accounting', 'chart');
}

function link(communityId: string) {
	return `/communities/${communityId}/accounting`;
}

function docs<T>(snapshot: QuerySnapshot) {
	return snapshot.docs.map(item => ({ ...item.data(), id: item.id }) as T);
}

function data<T>(snapshot: DocumentSnapshot) {
	return snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } as T : undefined;
}

/**
 * Everything the year's books are made from, read once with one where() per query: the charges due, paid, with an
 * entrega a cuenta or still unpaid (a returned one may be from an earlier year), the invoices dated (not by their budget's year, which may be
 * another) or paid in the year, the manual entries, this year's closing and the previous one (its opening), the
 * budget, the census and the added accounts, and the bookings paid or whose fianza was returned in the year. Those
 * paid in the last days of the year before are read too, as the gateway pays in this one those paid online
 */
export async function loadLedgerData(communityId: string, year: number) {
	const from = Timestamp.fromDate(new Date(year, 0, 1));
	const to = Timestamp.fromDate(new Date(year + 1, 0, 1));
	const paidFrom = Timestamp.fromDate(new Date(year, 0, 1 - PAYOUT_DAYS));
	const charges = collection(db, 'communities', communityId, 'charges');
	const expenses = collection(db, 'communities', communityId, 'expenses');
	const bookings = collection(db, 'communities', communityId, 'bookings');
	// ponytail: charges due and paid in the year are read twice, a charge's year (or a ledger cache) would halve it
	const [due, paid, partly, unpaid, dated, settled, manual, closing, previous, budget, properties, chart, booked, returned] = await Promise.all([
		getDocs(query(charges, where('dueDate', '>=', from), where('dueDate', '<', to))),
		getDocs(query(charges, where('paidAt', '>=', paidFrom), where('paidAt', '<', to))),
		getDocs(query(charges, where('collectionYears', 'array-contains', year))),
		getDocs(query(charges, where('paidAt', '==', null))),
		getDocs(query(expenses, where('date', '>=', from), where('date', '<', to))),
		getDocs(query(expenses, where('paidAt', '>=', from), where('paidAt', '<', to))),
		getDocs(query(entriesRef(communityId), where('year', '==', year))),
		getDoc(closingRef(communityId, year)),
		getDoc(closingRef(communityId, year - 1)),
		getDoc(doc(db, 'communities', communityId, 'budgets', String(year))),
		getDocs(query(collection(db, 'properties'), where('communityId', '==', communityId))),
		getDoc(chartRef(communityId)),
		getDocs(query(bookings, where('paidAt', '>=', paidFrom), where('paidAt', '<', to))),
		getDocs(query(bookings, where('depositReturnedAt', '>=', from), where('depositReturnedAt', '<', to))),
	]);
	const unique = <T extends { id: string }>(lists: T[][]) => [...new Map(lists.flat().map(item => [item.id, item])).values()];
	return {
		charges: unique([docs<Charge>(due), docs<Charge>(paid), docs<Charge>(partly), docs<Charge>(unpaid)]),
		expenses: unique([docs<Expense>(dated), docs<Expense>(settled)]),
		bookings: unique([docs<Booking>(booked), docs<Booking>(returned)]),
		manual: docs<ManualEntry>(manual),
		closing: data<FiscalYearClosing>(closing),
		previous: data<FiscalYearClosing>(previous),
		budget: data<Budget>(budget),
		properties: docs<Property>(properties),
		custom: (chart.data()?.accounts ?? []) as CustomAccount[],
	};
}

export type ManualEntryData = Pick<ManualEntry, 'date' | 'concept' | 'lines' | 'income'>;

// id made when the form opens (or the entry's when editing), so sending it twice writes one entry
export async function saveManualEntry(communityId: string, id: string, entry: ManualEntryData, existing?: ManualEntry) {
	const uid = signedUid();
	const now = serverTimestamp();
	const total = entry.lines.reduce((sum, item) => sum + item.debit, 0);
	const batch = writeBatch(db);
	batch.set(doc(entriesRef(communityId), id), {
		...entry,
		// An income keeps who paid it when its lines are edited in the books
		...(existing?.income && !entry.income ? { income: existing.income } : {}),
		year: Number(entry.date.slice(0, 4)),
		createdAt: existing?.createdAt ?? now,
		createdBy: existing?.createdBy ?? uid,
		updatedAt: now,
		updatedBy: uid,
	});
	logActivity(batch, communityId, {
		area: 'finance',
		summary: `${existing ? 'Editó' : 'Añadió'} el asiento «${entry.concept}» de ${formatCents(total)}`,
		link: link(communityId),
	});
	await batch.commit();
}

export async function deleteManualEntry(communityId: string, entry: ManualEntry) {
	const batch = writeBatch(db);
	batch.delete(doc(entriesRef(communityId), entry.id));
	logActivity(batch, communityId, { area: 'finance', summary: `Borró el asiento «${entry.concept}»`, link: link(communityId) });
	await batch.commit();
}

// Undoes deleteManualEntry or an edit: the entry again as it was
export async function restoreManualEntry(communityId: string, { id, ...entry }: ManualEntry) {
	const batch = writeBatch(db);
	batch.set(doc(entriesRef(communityId), id), { ...entry, updatedAt: serverTimestamp(), updatedBy: signedUid() });
	logActivity(batch, communityId, { area: 'finance', summary: `Restauró el asiento «${entry.concept}»`, link: link(communityId) });
	await batch.commit();
}

export async function closeFiscalYear(communityId: string, year: number, closing: { result: number; regularization: JournalLine[]; closing: JournalLine[]; names: Record<string, string> }) {
	const uid = signedUid();
	const now = serverTimestamp();
	const batch = writeBatch(db);
	batch.set(closingRef(communityId, year), { ...closing, year, createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid });
	logActivity(batch, communityId, {
		area: 'finance',
		summary: `Cerró el ejercicio ${year} con un ${closing.result >= 0 ? 'excedente' : 'déficit'} de ${formatCents(Math.abs(closing.result))}`,
		link: link(communityId),
	});
	await batch.commit();
}

export async function reopenFiscalYear(communityId: string, year: number) {
	const batch = writeBatch(db);
	batch.delete(closingRef(communityId, year));
	logActivity(batch, communityId, { area: 'finance', summary: `Reabrió el ejercicio ${year}`, link: link(communityId) });
	await batch.commit();
}

// Undoes reopenFiscalYear: the same closing again
export async function restoreFiscalYear(communityId: string, { id, ...closing }: FiscalYearClosing) {
	const batch = writeBatch(db);
	batch.set(closingRef(communityId, Number(id)), { ...closing, updatedAt: serverTimestamp(), updatedBy: signedUid() });
	logActivity(batch, communityId, { area: 'finance', summary: `Volvió a cerrar el ejercicio ${id}`, link: link(communityId) });
	await batch.commit();
}

// The whole list each time: it's short and only changes here
export async function saveCustomAccounts(communityId: string, accounts: CustomAccount[], summary: string) {
	const batch = writeBatch(db);
	batch.set(chartRef(communityId), { accounts, updatedAt: serverTimestamp(), updatedBy: signedUid() });
	logActivity(batch, communityId, { area: 'finance', summary, link: link(communityId) });
	await batch.commit();
}
