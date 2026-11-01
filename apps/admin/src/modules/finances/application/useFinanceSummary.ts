import type { Budget, Expense } from '@gobernansa/shared/domain/finance.ts';
import type { Remittance } from '@gobernansa/shared/domain/sepa.ts';
import type { Query } from 'firebase/firestore';
import { taxDeadlines } from '@gobernansa/shared/domain/aeat.ts';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { feeBatchId, isOverdue, payableAmount, reserveUsed } from '@gobernansa/shared/domain/finance.ts';
import { db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, getAggregateFromServer, getCountFromServer, getDoc, getDocs, limit, orderBy, query, sum, where } from 'firebase/firestore';
import { computed, onMounted, ref, shallowRef } from 'vue';
import { onRevalidate } from '@/app/ux/navigation.ts';
import { total } from '@/modules/communities/application/useCommunityDashboard.ts';
import { budgetRef } from './useFinances.ts';

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
 * The summary's: the tile's, plus the budget (1 read), sums of the year's fees reserve, issued and still unpaid (1 read
 * each), the expenses paid from the fund (a read each, few) and the latest remittance (1 read). Fixed, whatever the size
 * of the community: who owes is left to the arrears page, as counting debtors means reading every unpaid charge
 */
export async function loadSummary(communityId: string) {
	const community = (name: string) => collection(db, 'communities', communityId, name);
	const year = new Date().getFullYear();
	const fees = query(community('charges'), where('batchId', '==', feeBatchId(year)));
	const reserve = async (source: Query) => (await getAggregateFromServer(source, { reserve: sum('reserve') })).data().reserve ?? 0;
	const [tile, budget, issued, unpaid, fromReserve, remittances] = await Promise.all([
		loadTileFigures(communityId),
		getDoc(budgetRef(communityId, year)),
		reserve(fees),
		// Two equalities, merged from single-field indexes
		reserve(query(fees, where('paidAt', '==', null))),
		getDocs(query(community('expenses'), where('year', '==', year), where('fromReserve', '==', true))),
		getDocs(query(community('remittances'), orderBy('issuedAt', 'desc'), limit(1))),
	]);

	const latest = remittances.docs[0]?.data() as Remittance | undefined;
	const returned = latest?.items.filter(item => item.returned) ?? [];
	return {
		...tile,
		// As the fees page: the opening, what the fees collected for the fund (issued minus those still unpaid) and what was paid from it
		reserve: ((budget.data() as Budget | undefined)?.reserveOpening ?? 0) + issued - unpaid - reserveUsed(fromReserve.docs.map(expense => expense.data() as Expense)),
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
