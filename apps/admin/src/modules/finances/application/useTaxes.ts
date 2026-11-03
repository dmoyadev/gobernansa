import type { IncomeSource, ManualEntry } from '@gobernansa/shared/domain/accounting.ts';
import type { TaxDeadline } from '@gobernansa/shared/domain/aeat.ts';
import type { Expense } from '@gobernansa/shared/domain/finance.ts';
import type { Property } from '@gobernansa/shared/domain/property.ts';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { incomeKinds } from '@gobernansa/shared/domain/accounting.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, doc, documentId, getDocs, query, serverTimestamp, Timestamp, where, writeBatch } from 'firebase/firestore';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { saveManualEntry } from './useAccounting.ts';

function docs<T>(snapshot: { docs: { id: string; data: () => unknown }[] }) {
	return snapshot.docs.map(item => ({ ...item.data() as object, id: item.id }) as T);
}

/**
 * What the year's tax returns need, read once with one where() per query: the invoices dated in the year (347) and
 * those paid in it (withholdings are declared when paid), the year's manual entries (the incomes are among them),
 * the census and the community
 */
export async function loadTaxData(communityId: string, year: number) {
	const from = Timestamp.fromDate(new Date(year, 0, 1));
	const to = Timestamp.fromDate(new Date(year + 1, 0, 1));
	const expenses = collection(db, 'communities', communityId, 'expenses');
	const [community, dated, paid, entries, properties] = await Promise.all([
		loadCommunity(communityId),
		getDocs(query(expenses, where('date', '>=', from), where('date', '<', to))),
		getDocs(query(expenses, where('paidAt', '>=', from), where('paidAt', '<', to))),
		getDocs(query(collection(db, 'communities', communityId, 'journalEntries'), where('year', '==', year))),
		getDocs(query(collection(db, 'properties'), where('communityId', '==', communityId))),
	]);
	return {
		community,
		expenses: [...new Map([...docs<Expense>(dated), ...docs<Expense>(paid)].map(expense => [expense.id, expense])).values()],
		incomes: docs<ManualEntry>(entries).filter(entry => entry.income).sort((a, b) => a.date.localeCompare(b.date)),
		properties: docs<Property>(properties),
	};
}

export interface IncomeData {
	date: string;
	concept: string;
	source: IncomeSource;
	gross: number;
	withholding: number;
}

// An income is a manual entry: bancos (what arrived) and the withholding the payer kept, to the kind's income account
export function incomeEntry({ date, concept, source, gross, withholding }: IncomeData) {
	const income: IncomeSource = { kind: source.kind, payer: source.payer, ...(source.payerNif ? { payerNif: source.payerNif } : {}) };
	return {
		date,
		concept,
		income,
		lines: [
			{ account: '5720', debit: gross - withholding, credit: 0 },
			...(withholding ? [{ account: '4730', debit: withholding, credit: 0 }] : []),
			{ account: incomeKinds[source.kind].account, debit: 0, credit: gross },
		],
	};
}

export async function addIncome(communityId: string, id: string, data: IncomeData) {
	await saveManualEntry(communityId, id, incomeEntry(data));
}

// Those of the year still missing in the obligations, so adding them again never duplicates nor moves one changed
export async function addTaxDeadlines(communityId: string, deadlines: TaxDeadline[]) {
	if (!deadlines.length) {
		return 0;
	}
	const uid = auth.currentUser!.uid;
	const obligations = collection(db, 'communities', communityId, 'obligations');
	// Only these (a few a year, 'in' takes up to 30), by id: the obligations grow every year
	const existing = new Set((await getDocs(query(obligations, where(documentId(), 'in', deadlines.map(deadline => deadline.id))))).docs.map(item => item.id));
	const missing = deadlines.filter(deadline => !existing.has(deadline.id));
	if (!missing.length) {
		return 0;
	}
	const now = serverTimestamp();
	const batch = writeBatch(db);
	for (const deadline of missing) {
		batch.set(doc(obligations, deadline.id), {
			communityId,
			type: 'other',
			title: deadline.title,
			dueAt: Timestamp.fromDate(new Date(`${deadline.due}T00:00`)),
			notes: 'Presentación en la Sede electrónica de la AEAT',
			createdAt: now,
			createdBy: uid,
			updatedAt: now,
			updatedBy: uid,
		});
	}
	logActivity(batch, communityId, {
		area: 'obligation',
		summary: `Añadió los plazos de ${missing.length} ${missing.length === 1 ? 'declaración' : 'declaraciones'} a la AEAT`,
		link: `/communities/${communityId}/obligations`,
	});
	await batch.commit();
	return missing.length;
}
