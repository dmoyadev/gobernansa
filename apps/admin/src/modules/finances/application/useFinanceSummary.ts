import type { Budget, Charge, Expense } from '@gobernansa/shared/domain/finance.ts';
import type { Remittance } from '@gobernansa/shared/domain/sepa.ts';
import { taxDeadlines } from '@gobernansa/shared/domain/aeat.ts';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { feeBatchId, isOverdue, payableAmount, reserveUsed } from '@gobernansa/shared/domain/finance.ts';
import { db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, getAggregateFromServer, getCountFromServer, getDoc, getDocs, limit, orderBy, query, sum, where } from 'firebase/firestore';
import { computed, onMounted, ref, shallowRef } from 'vue';
import { onRevalidate } from '@/app/ux/navigation.ts';
import { total } from '@/modules/communities/application/useCommunityDashboard.ts';
import { budgetRef, loadExpenses } from './useFinances.ts';

const DAY = 86_400_000;

// The next return due, from today, and the whole days left until it. Static: the models the taxes page makes, whether the community has to file them or not
export function nextTaxDeadline(now = new Date()) {
	const today = toDateString(now);
	const year = now.getFullYear();
	const deadline = [...taxDeadlines(year - 1, false, true), ...taxDeadlines(year, false, true)]
		.filter(item => item.due >= today)
		.sort((a, b) => a.due.localeCompare(b.due))[0];
	return { ...deadline, daysLeft: Math.round((Date.parse(deadline.due) - Date.parse(today)) / DAY) };
}

/**
 * The community tile's, once per visit and single-field queries only: the sum of the unpaid charges (1 read per 1000),
 * the unpaid invoices the payables page keeps live (a read each, few) and a count of the movements to reconcile (1 read)
 */
export async function loadTileFigures(communityId: string) {
	const community = (name: string) => collection(db, 'communities', communityId, name);
	const [pending, invoices, unreconciled] = await Promise.all([
		total(query(community('charges'), where('paidAt', '==', null))),
		getDocs(query(community('expenses'), where('paidAt', '==', null))),
		getCountFromServer(query(community('bankMovements'), where('status', '==', 'pending'))),
	]);
	const overdue = invoices.docs.map(invoice => invoice.data() as Expense).filter(invoice => isOverdue(invoice));
	return {
		pending,
		overdueInvoices: overdue.length,
		overdueInvoicesAmount: overdue.reduce((all, invoice) => all + payableAmount(invoice), 0),
		unreconciled: unreconciled.data().count,
	};
}

/**
 * The summary's: the tile's, plus the unpaid charges (a read each, for the debtors and the fund), the budget (1 read),
 * a sum of the year's fees reserve (1 read), the year's expenses (a read each) and the latest remittance (1 read)
 */
export async function loadSummary(communityId: string) {
	const community = (name: string) => collection(db, 'communities', communityId, name);
	const year = new Date().getFullYear();
	const [tile, charges, budget, issued, expenses, remittances] = await Promise.all([
		loadTileFigures(communityId),
		getDocs(query(community('charges'), where('paidAt', '==', null))),
		getDoc(budgetRef(communityId, year)),
		getAggregateFromServer(query(community('charges'), where('batchId', '==', feeBatchId(year))), { reserve: sum('reserve') }),
		loadExpenses(communityId, year),
		getDocs(query(community('remittances'), orderBy('issuedAt', 'desc'), limit(1))),
	]);

	const unpaid = charges.docs.map(charge => charge.data() as Charge);
	// As the fees page: the opening, what the fees collected for the fund (issued minus those still unpaid) and what was paid from it
	const unpaidReserve = unpaid.reduce((all, charge) => all + (charge.batchId === feeBatchId(year) ? charge.reserve ?? 0 : 0), 0);
	const collected = (issued.data().reserve ?? 0) - unpaidReserve;
	const latest = remittances.docs[0]?.data() as Remittance | undefined;
	const returned = latest?.items.filter(item => item.returned) ?? [];
	return {
		...tile,
		// Properties with an overdue charge
		debtors: new Set(unpaid.filter(charge => isOverdue(charge)).map(charge => charge.propertyId)).size,
		reserve: ((budget.data() as Budget | undefined)?.reserveOpening ?? 0) + collected - reserveUsed(expenses),
		remittance: latest && { reference: latest.reference, returned: returned.length, returnedAmount: returned.reduce((all, item) => all + item.amount, 0) },
	};
}

// Read again each time the page comes back, showing the last figures meanwhile. A failed reread keeps them
export function useFinanceSummary<T>(load: () => Promise<T>) {
	const data = shallowRef<T>();
	const error = ref<string>();

	async function reload() {
		try {
			data.value = await load();
			error.value = undefined;
		} catch (e) {
			if (!data.value) {
				error.value = (e as Error).message;
			}
		}
	}
	onMounted(reload);
	onRevalidate(reload);

	return { data, error, loading: computed(() => !data.value && !error.value) };
}
