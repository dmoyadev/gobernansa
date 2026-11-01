import type { Activity } from '@gobernansa/shared/domain/activity.ts';
import type { Booking } from '@gobernansa/shared/domain/booking.ts';
import type { Budget, Charge, Expense } from '@gobernansa/shared/domain/finance.ts';
import type { Issue } from '@gobernansa/shared/domain/issue.ts';
import type { Meeting } from '@gobernansa/shared/domain/meeting.ts';
import type { Obligation } from '@gobernansa/shared/domain/obligation.ts';
import type { Property } from '@gobernansa/shared/domain/property.ts';
import type { Query } from 'firebase/firestore';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, doc, getAggregateFromServer, getCountFromServer, getDoc, getDocs, limit, orderBy, query, sum, Timestamp, where } from 'firebase/firestore';

const DAY = 86_400_000;
// The charts go back this many months, the current one included
export const DASHBOARD_MONTHS = 6;
// ponytail: caps so a big community doesn't read hundreds of docs on every visit; counts with aggregations if they're hit
const MAX_ISSUES = 300;
const MAX_DOCS = 500;

// The first day of each charted month, oldest first, and the day after the current one ends
export function dashboardMonths(now = new Date()) {
	return Array.from({ length: DASHBOARD_MONTHS + 1 }, (_, index) => new Date(now.getFullYear(), now.getMonth() - DASHBOARD_MONTHS + 1 + index, 1));
}

async function docs<T>(source: Query) {
	const snapshot = await getDocs(source);
	return snapshot.docs.map(item => ({ ...item.data(), id: item.id }) as T);
}

// Sum of amount, 1 read per 1000 summed instead of a read per doc
export async function total(source: Query) {
	const snapshot = await getAggregateFromServer(source, { amount: sum('amount') });
	return snapshot.data().amount ?? 0;
}

// What's left of the charges: their sum minus what was collected on account
export async function outstandingTotal(source: Query) {
	const snapshot = await getAggregateFromServer(source, { amount: sum('amount'), collected: sum('collected') });
	return (snapshot.data().amount ?? 0) - (snapshot.data().collected ?? 0);
}

// Shared while in flight: the widget and the Vecinos tile ask for it at once on the same visit
const registrations = new Map<string, Promise<{ registered: number; homes: number }>>();
async function registration(communityId: string) {
	let counts = registrations.get(communityId);
	if (!counts) {
		counts = Promise.all([
			getCountFromServer(query(collection(db, 'users'), where('communityId', '==', communityId), where('role', '==', 'user'))),
			getCountFromServer(query(collection(db, 'properties'), where('communityId', '==', communityId), where('type', '==', 'home'))),
		]).then(([registered, homes]) => ({ registered: registered.data().count, homes: homes.data().count })).finally(() => registrations.delete(communityId));
		registrations.set(communityId, counts);
	}
	return counts;
}

// What the widgets read, each once per visit and only when a visible widget needs it.
// No composite indexes: equality filters only, or a single range filter
export function dashboardSources(communityId: string) {
	const community = (name: string) => collection(db, 'communities', communityId, name);
	const now = new Date();
	const months = dashboardMonths(now);
	const since = Timestamp.fromDate(months[0]);
	const year = now.getFullYear();
	const yearStart = Timestamp.fromDate(new Date(year, 0, 1));

	return {
		openIssues: async () => docs<Issue>(query(community('issues'), where('deletedAt', '==', null), where('status', 'in', ['open', 'in_progress']), limit(MAX_ISSUES))),
		// Reopened ones keep resolvedAt, so the status is checked by the widgets
		resolvedIssues: async () => (await docs<Issue>(query(community('issues'), where('resolvedAt', '>=', since), limit(MAX_DOCS))))
			.filter(issue => !issue.deletedAt && (issue.status === 'resolved' || issue.status === 'closed') && issue.createdAt),
		newIssues: async () => (await docs<Issue>(query(community('issues'), where('createdAt', '>=', since), limit(MAX_DOCS)))).filter(issue => !issue.deletedAt),
		registration: async () => registration(communityId),
		properties: async () => docs<Property>(query(collection(db, 'properties'), where('communityId', '==', communityId), limit(MAX_DOCS))),
		obligations: async () => docs<Obligation>(community('obligations')),
		unpaidCharges: async () => docs<Charge>(query(community('charges'), where('paidAt', '==', null))),
		// Collected and spent this year and per month, as sums
		balance: async () => {
			const [collected, spent, pending, perMonth] = await Promise.all([
				total(query(community('charges'), where('paidAt', '>=', yearStart))),
				total(query(community('expenses'), where('year', '==', year))),
				outstandingTotal(query(community('charges'), where('paidAt', '==', null))),
				Promise.all(months.slice(0, -1).map(async (start, index) => {
					const [from, to] = [Timestamp.fromDate(start), Timestamp.fromDate(months[index + 1])];
					const [income, expenses] = await Promise.all([
						total(query(community('charges'), where('paidAt', '>=', from), where('paidAt', '<', to))),
						total(query(community('expenses'), where('date', '>=', from), where('date', '<', to))),
					]);
					return { start, income, expenses };
				})),
			]);
			return { collected, spent, pending, perMonth };
		},
		budget: async () => {
			const [budget, expenses] = await Promise.all([
				getDoc(doc(community('budgets'), String(year))),
				docs<Expense>(query(community('expenses'), where('year', '==', year), limit(MAX_DOCS))),
			]);
			return { budget: budget.exists() ? budget.data() as Budget : undefined, expenses };
		},
		meetings: async () => docs<Meeting>(query(community('meetings'), orderBy('date', 'desc'), limit(10))),
		// Today and the next 6 days
		bookings: async () => docs<Booking>(query(community('bookings'), where('date', 'in', Array.from({ length: 7 }, (_, index) => toDateString(new Date(now.getTime() + index * DAY)))))),
		activity: async () => docs<Activity>(query(community('activity'), orderBy('at', 'desc'), limit(5))),
	};
}

export type DashboardSources = ReturnType<typeof dashboardSources>;
export type DashboardSource = keyof DashboardSources;
export type DashboardData = { [K in DashboardSource]?: Awaited<ReturnType<DashboardSources[K]>> };

// The Vecinos tile's: the registration widget's counts, shared with it, plus the properties and the pending invitations
export async function loadNeighbourFigures(communityId: string) {
	const count = async (source: Query) => (await getCountFromServer(source)).data().count;
	const [counts, properties, invitations] = await Promise.all([
		registration(communityId),
		count(query(collection(db, 'properties'), where('communityId', '==', communityId))),
		count(query(collection(db, 'invitations'), where('communityId', '==', communityId))),
	]);
	return { ...counts, properties, invitations };
}
