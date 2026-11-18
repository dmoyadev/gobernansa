import type { IssueCategory } from '@gobernansa/shared/domain/issue.ts';
import type { Timestamp } from 'firebase/firestore';
import type { DashboardData, DashboardSource } from './useCommunityDashboard.ts';
import { isOverdue, outstanding } from '@gobernansa/shared/domain/finance.ts';
import { findIssueCategory, getIssueAge, getIssueCategories } from '@gobernansa/shared/domain/issue.ts';
import { obligationStatus } from '@gobernansa/shared/domain/obligation.ts';
import { propertyTypeLabels, totalCoefficient } from '@gobernansa/shared/domain/property.ts';
import { computed } from 'vue';
import { dashboardMonths } from './useCommunityDashboard.ts';

/*
 * The widgets of a community's dashboard: which there are, what each reads and the figures they show, worked out from
 * those reads with no reads of their own
 */

const DAY = 86_400_000;

export interface Widget {
	key: string;
	title: string;
	icon: string;
	// The page of the community it opens
	to: string;
	// 2 takes two cells, for a chart or a list
	size: 1 | 2;
	sources: DashboardSource[];
}

// In their default order. The first ones are shown, the rest are added from "Personalizar dashboard"
export const allWidgets: Widget[] = [
	{ key: 'openIssues', title: 'Incidencias sin resolver', icon: 'lucide:message-square-warning', to: 'issues', size: 1, sources: ['openIssues'] },
	{ key: 'balance', title: 'Balance económico del año', icon: 'lucide:scale', to: 'charges', size: 2, sources: ['balance'] },
	{ key: 'registration', title: 'Vecinos en la app', icon: 'lucide:smartphone', to: 'people', size: 1, sources: ['registration'] },
	{ key: 'obligations', title: 'Obligaciones', icon: 'lucide:calendar-check', to: 'obligations', size: 2, sources: ['obligations'] },
	{ key: 'resolution', title: 'Resolución media', icon: 'lucide:timer', to: 'issues', size: 1, sources: ['resolvedIssues'] },
	{ key: 'delinquency', title: 'Morosidad', icon: 'lucide:receipt-text', to: 'charges', size: 1, sources: ['unpaidCharges'] },
	{ key: 'flow', title: 'Incidencias nuevas y resueltas', icon: 'lucide:chart-column', to: 'issues', size: 2, sources: ['newIssues', 'resolvedIssues'] },
	{ key: 'budget', title: 'Ejecución del presupuesto', icon: 'lucide:chart-pie', to: 'budget', size: 2, sources: ['budget'] },
	{ key: 'categories', title: 'Incidencias por categoría', icon: 'lucide:tags', to: 'issues', size: 1, sources: ['openIssues'] },
	{ key: 'oldest', title: 'Las que más esperan', icon: 'lucide:hourglass', to: 'issues', size: 2, sources: ['openIssues'] },
	{ key: 'voted', title: 'Lo que más preocupa', icon: 'lucide:flame', to: 'issues', size: 1, sources: ['openIssues'] },
	{ key: 'unassigned', title: 'Sin proveedor asignado', icon: 'lucide:hard-hat', to: 'issues', size: 1, sources: ['openIssues'] },
	{ key: 'claims', title: 'Siniestros abiertos', icon: 'lucide:shield-alert', to: 'issues', size: 1, sources: ['openIssues'] },
	{ key: 'debtors', title: 'Mayores deudas', icon: 'lucide:user-round-x', to: 'charges', size: 1, sources: ['unpaidCharges'] },
	{ key: 'meeting', title: 'Próxima junta', icon: 'lucide:gavel', to: 'meetings', size: 1, sources: ['meetings'] },
	{ key: 'bookings', title: 'Reservas esta semana', icon: 'lucide:calendar-clock', to: 'locations', size: 1, sources: ['bookings'] },
	{ key: 'census', title: 'Censo', icon: 'lucide:house', to: 'properties', size: 1, sources: ['properties'] },
	{ key: 'activity', title: 'Últimos cambios', icon: 'lucide:history', to: 'activity', size: 2, sources: ['activity'] },
];
export const widgetsByKey = new Map(allWidgets.map(widget => [widget.key, widget]));
const DEFAULT_VISIBLE = 6;

export interface LayoutItem { key: string; hidden: boolean }

export const defaultLayout = allWidgets.map(({ key }, index) => ({ key, hidden: index >= DEFAULT_VISIBLE }));

// A saved layout made valid: unknown widgets are dropped and new ones are added at the end, hidden
export function toLayout(saved: unknown): LayoutItem[] {
	if (!Array.isArray(saved)) {
		return structuredClone(defaultLayout);
	}

	const items = (saved as LayoutItem[]).filter((item, index, all) => widgetsByKey.has(item?.key) && all.findIndex(other => other.key === item.key) === index);
	return [...items, ...allWidgets.filter(({ key }) => !items.some(item => item.key === key)).map(({ key }) => ({ key, hidden: true }))];
}

export function formatDate(date: Timestamp | Date, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) {
	return ('toDate' in date ? date.toDate() : date).toLocaleDateString('es', options);
}

export function percent(part: number, whole: number) {
	return whole ? Math.min(100, Math.round(part / whole * 100)) : 0;
}

// What the widgets show, from the data read so far. The categories are the community's, the defaults until it's loaded
export function useDashboardFigures(data: DashboardData, issueCategories: () => IssueCategory[] | undefined) {
	// Charts
	const months = dashboardMonths();
	const monthLabels = months.slice(0, -1).map(month => formatDate(month, { month: 'short' }).replace('.', ''));

	// The index of the charted month a date falls in, -1 when outside
	function monthOf(date?: Timestamp) {
		const millis = date?.toMillis() ?? 0;
		return months.findIndex((start, index) => index < months.length - 1 && millis >= start.getTime() && millis < months[index + 1].getTime());
	}

	function perMonth<T>(items: T[], date: (item: T) => Timestamp | undefined) {
		const totals = monthLabels.map(() => 0);
		for (const item of items) {
			const index = monthOf(date(item));
			if (index >= 0) {
				totals[index]++;
			}
		}
		return totals;
	}

	// Issues
	const open = computed(() => data.openIssues ?? []);

	const openSummary = computed(() => {
		const now = Date.now();
		// Waiting under 2 days, under a week, under 2 weeks and longer, the same steps as the issues list
		const ages = [0, 0, 0, 0];
		for (const issue of open.value) {
			const { days } = getIssueAge(issue, now);
			ages[days < 2 ? 0 : days < 7 ? 1 : days < 14 ? 2 : 3]++;
		}
		return {
			total: open.value.length,
			notified: open.value.filter(issue => issue.status === 'open').length,
			ages,
		};
	});
	const ageLegend = ['< 2 días', '< 1 semana', '< 2 semanas', 'Más'];

	// Also those of removed categories, as findIssueCategory names them
	const categories = computed(() => Array.from(new Set(open.value.map(issue => issue.category)), id => ({ ...findIssueCategory(issueCategories() ?? getIssueCategories(), id), total: open.value.filter(issue => issue.category === id).length }))
		.sort((a, b) => b.total - a.total)
		.slice(0, 4));

	const oldest = computed(() => [...open.value]
		.sort((a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0))
		.slice(0, 4)
		.map(issue => ({ ...issue, days: getIssueAge(issue).days })));

	const voted = computed(() => open.value
		.filter(issue => issue.votesScore > 0)
		.sort((a, b) => b.votesScore - a.votesScore)
		.slice(0, 3));

	const unassigned = computed(() => ({
		total: open.value.filter(issue => !issue.provider).length,
		noDate: open.value.filter(issue => issue.status === 'in_progress' && !issue.expectedAt).length,
	}));

	const claims = computed(() => open.value.filter(issue => issue.insuranceClaim));

	const resolution = computed(() => {
		const issues = data.resolvedIssues ?? [];
		const days = (issue: typeof issues[number]) => (issue.resolvedAt!.toMillis() - issue.createdAt.toMillis()) / DAY;
		const byMonth = monthLabels.map((_, index) => issues.filter(issue => monthOf(issue.resolvedAt) === index));
		const average = (list: typeof issues) => list.length ? list.reduce((total, issue) => total + days(issue), 0) / list.length : null;
		const perMonthAverage = byMonth.map(average);
		const [previous, current] = perMonthAverage.filter((value): value is number => value !== null).slice(-2);
		return {
			average: average(issues),
			total: issues.length,
			perMonth: perMonthAverage,
			// Faster or slower than the month before, in days
			trend: current !== undefined && previous !== undefined ? Math.round(current - previous) : null,
		};
	});

	const flow = computed(() => {
		const created = perMonth(data.newIssues ?? [], issue => issue.createdAt);
		const resolved = perMonth(data.resolvedIssues ?? [], issue => issue.resolvedAt);
		return {
			created,
			resolved,
			max: Math.max(...created, ...resolved),
			createdTotal: created.reduce((a, b) => a + b, 0),
			resolvedTotal: resolved.reduce((a, b) => a + b, 0),
		};
	});

	// People and census
	const registration = computed(() => {
		const { registered = 0, homes = 0 } = data.registration ?? {};
		return { registered, homes, percent: percent(registered, homes) };
	});

	const census = computed(() => {
		const properties = data.properties ?? [];
		const types = (Object.keys(propertyTypeLabels) as (keyof typeof propertyTypeLabels)[])
			.map(type => ({ type, label: propertyTypeLabels[type], total: properties.filter(property => property.type === type).length }))
			.filter(type => type.total);
		return {
			total: properties.length,
			types,
			tenants: properties.filter(property => property.tenantName || property.tenantEmail).length,
			coefficient: totalCoefficient(properties),
		};
	});

	// Obligations
	const obligations = computed(() => {
		const now = new Date();
		const list = (data.obligations ?? [])
			.map(obligation => ({ ...obligation, status: obligationStatus(obligation, now) }))
			.sort((a, b) => a.dueAt.toMillis() - b.dueAt.toMillis());
		return {
			overdue: list.filter(obligation => obligation.status === 'overdue').length,
			soon: list.filter(obligation => obligation.status === 'soon').length,
			next: list.slice(0, 3),
			total: list.length,
		};
	});

	// Money
	const overdueCharges = computed(() => (data.unpaidCharges ?? []).filter(charge => isOverdue(charge)));

	const delinquency = computed(() => ({
		amount: overdueCharges.value.reduce((total, charge) => total + outstanding(charge), 0),
		charges: overdueCharges.value.length,
		properties: new Set(overdueCharges.value.map(charge => charge.propertyId)).size,
	}));

	const debtors = computed(() => {
		const byProperty = new Map<string, { name: string; amount: number; charges: number }>();
		for (const charge of overdueCharges.value) {
			const debtor = byProperty.get(charge.propertyId) ?? { name: charge.propertyName, amount: 0, charges: 0 };
			debtor.amount += outstanding(charge);
			debtor.charges++;
			byProperty.set(charge.propertyId, debtor);
		}
		return [...byProperty.values()].sort((a, b) => b.amount - a.amount).slice(0, 3);
	});

	const balance = computed(() => {
		const { collected = 0, spent = 0, pending = 0, perMonth: months = [] } = data.balance ?? {};
		return {
			collected,
			spent,
			pending,
			result: collected - spent,
			months,
			max: Math.max(...months.flatMap(month => [month.income, month.expenses])),
		};
	});

	const budget = computed(() => {
		const { budget: current, expenses = [] } = data.budget ?? {};
		const spentBy = (itemId: string) => expenses.filter(expense => expense.itemId === itemId).reduce((total, expense) => total + expense.amount, 0);
		const items = (current?.items ?? [])
			.map(item => ({ ...item, spent: spentBy(item.id) }))
			.sort((a, b) => b.amount - a.amount);
		const planned = items.reduce((total, item) => total + item.amount, 0);
		const spent = expenses.reduce((total, expense) => total + expense.amount, 0);
		// How far into the year we are, to tell if spending is ahead
		const now = new Date();
		const yearElapsed = (now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / (365 * DAY);
		return { exists: !!current, items: items.slice(0, 3), planned, spent, percent: percent(spent, planned), expected: Math.round(yearElapsed * 100) };
	});

	// Agenda
	const meeting = computed(() => {
		const meetings = data.meetings ?? [];
		const now = Date.now();
		const next = meetings.filter(item => item.status === 'convened' && item.date.toMillis() >= now).at(-1);
		const last = meetings.find(item => item.status === 'held');
		return { next, last, days: next ? Math.ceil((next.date.toMillis() - now) / DAY) : 0 };
	});

	const week = computed(() => {
		const bookings = data.bookings ?? [];
		const days = Array.from({ length: 7 }, (_, index) => {
			const date = new Date(Date.now() + index * DAY);
			const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
			return { label: formatDate(date, { weekday: 'narrow' }), total: bookings.filter(booking => booking.date === key).length };
		});
		return { days, total: bookings.length, max: Math.max(...days.map(day => day.total)) };
	});

	return { monthLabels, openSummary, ageLegend, categories, oldest, voted, unassigned, claims, resolution, flow, registration, census, obligations, delinquency, debtors, balance, budget, meeting, week };
}
