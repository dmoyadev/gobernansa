import type { BankMovement } from '@gobernansa/shared/domain/bank.ts';
import type { ImportRow } from '@gobernansa/shared/domain/exchange.ts';
import type { Budget, Charge, Expense } from '@gobernansa/shared/domain/finance.ts';
import type { Property } from '@gobernansa/shared/domain/property.ts';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { IMPORT_BATCH_ID } from '@gobernansa/shared/domain/exchange.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, doc, getDoc, getDocs, query, serverTimestamp, Timestamp, where, writeBatch } from 'firebase/firestore';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { loadLedgerData } from './useAccounting.ts';
import { toDueDate } from './useFinances.ts';

// A batch takes up to 500 writes, one of them is the activity entry
const CHARGES_PER_BATCH = 499;
const STATEMENT_DAYS = 31;

function chargesRef(communityId: string) {
	return collection(db, 'communities', communityId, 'charges');
}

function docs<T>(snapshot: { docs: { id: string; data: () => unknown }[] }) {
	return snapshot.docs.map(item => ({ ...item.data() as object, id: item.id }) as T);
}

/**
 * What the year's liquidación needs, read once: the books (see loadLedgerData), the charges due by the end of the year
 * but paid after it (still owed then), next year's budget, and the bank's movements of the last month up to `cutoff`
 * ('YYYY-MM-DD'), whose last balance is the statement's
 */
export async function loadAnnualReportData(communityId: string, year: number, cutoff: string) {
	const end = Timestamp.fromDate(new Date(year + 1, 0, 1));
	const since = new Date(`${cutoff}T12:00`);
	since.setDate(since.getDate() - STATEMENT_DAYS);
	const [ledger, community, paidAfter, next, movements] = await Promise.all([
		loadLedgerData(communityId, year),
		loadCommunity(communityId),
		// Nothing is paid after the end of a year still running
		end.toMillis() > Date.now() ? undefined : getDocs(query(chargesRef(communityId), where('paidAt', '>=', end))),
		getDoc(doc(db, 'communities', communityId, 'budgets', String(year + 1))),
		getDocs(query(collection(db, 'communities', communityId, 'bankMovements'), where('date', '>=', toDateString(since)), where('date', '<=', cutoff))),
	]);
	return {
		...ledger,
		community,
		paidAfter: paidAfter ? docs<Charge>(paidAfter) : [],
		next: next.exists() ? { ...next.data(), id: next.id } as Budget : undefined,
		movements: docs<BankMovement>(movements),
	};
}

// The charges due in the year, paid or not, once
export async function loadYearCharges(communityId: string, year: number) {
	const snapshot = await getDocs(query(chargesRef(communityId), where('dueDate', '>=', Timestamp.fromDate(new Date(year, 0, 1))), where('dueDate', '<', Timestamp.fromDate(new Date(year + 1, 0, 1)))));
	return docs<Charge>(snapshot).sort((a, b) => a.dueDate.toMillis() - b.dueDate.toMillis() || a.propertyName.localeCompare(b.propertyName, 'es', { numeric: true }));
}

// The ids already imported, to add only what's missing
export async function loadImportedIds(communityId: string) {
	const snapshot = await getDocs(query(chargesRef(communityId), where('batchId', '==', IMPORT_BATCH_ID)));
	return new Set(snapshot.docs.map(charge => charge.id));
}

/**
 * The rows as charges of their properties, with their ids (see readImport): what's there is never overwritten, so a
 * charge imported and paid since stays paid. Resolves to those written, to undo it
 */
export async function importCharges(communityId: string, rows: ImportRow[], fileName: string) {
	const uid = auth.currentUser?.uid;
	if (!uid) {
		throw new Error('The admin must be signed in to change the accounts');
	}
	const existing = await loadImportedIds(communityId);
	const missing = rows.filter(row => !row.error && !existing.has(row.id));
	const now = serverTimestamp();
	const written: Charge[] = [];
	// ponytail: past 499 rows the import is split in several batches, a failure halfway leaves the first ones in; importing again adds the rest
	for (let start = 0; start < missing.length; start += CHARGES_PER_BATCH) {
		const slice = missing.slice(start, start + CHARGES_PER_BATCH);
		const batch = writeBatch(db);
		for (const row of slice) {
			const property = row.property!;
			const charge = {
				communityId,
				propertyId: property.id,
				propertyName: property.name,
				ownerUid: property.ownerUid ?? '',
				...(property.ownerName ? { ownerName: property.ownerName } : {}),
				type: row.type,
				concept: row.concept,
				amount: row.amount,
				dueDate: toDueDate(row.dueDate),
				paidAt: row.paidAt ? Timestamp.fromDate(new Date(`${row.paidAt}T12:00`)) : null,
				batchId: IMPORT_BATCH_ID,
			};
			batch.set(doc(chargesRef(communityId), row.id), { ...charge, createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid });
			written.push({ ...charge, id: row.id } as Charge);
		}
		logActivity(batch, communityId, {
			area: 'finance',
			summary: `Importó ${slice.length} recibos de ${fileName} por ${formatCents(slice.reduce((sum, row) => sum + row.amount, 0))}`,
			link: `/communities/${communityId}/charges`,
		});
		await batch.commit();
	}
	return written;
}

// The census, once
export async function loadProperties(communityId: string) {
	const snapshot = await getDocs(query(collection(db, 'properties'), where('communityId', '==', communityId)));
	return docs<Property>(snapshot).sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
}

// The census and what each property owes, once: only the unpaid charges are read
export async function loadBalances(communityId: string) {
	const [properties, unpaid] = await Promise.all([
		loadProperties(communityId),
		getDocs(query(chargesRef(communityId), where('paidAt', '==', null))),
	]);
	return { properties, unpaid: docs<Charge>(unpaid) };
}

// The invoices of the year's budget and its partidas, once
export async function loadInvoices(communityId: string, year: number) {
	const [expenses, budget] = await Promise.all([
		getDocs(query(collection(db, 'communities', communityId, 'expenses'), where('year', '==', year))),
		getDoc(doc(db, 'communities', communityId, 'budgets', String(year))),
	]);
	return {
		expenses: docs<Expense>(expenses).sort((a, b) => a.date.toMillis() - b.date.toMillis()),
		items: ((budget.data() as Budget | undefined)?.items ?? []),
	};
}
