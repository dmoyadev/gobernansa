<script setup lang="ts">
import type { IssueCategory } from '@gobernansa/shared/domain/issue.ts';
import type { Timestamp } from 'firebase/firestore';
import type { DashboardData, DashboardSource } from '../application/useCommunityDashboard.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { isOverdue, outstanding } from '@gobernansa/shared/domain/finance.ts';
import { findIssueCategory, getIssueAge, getIssueCategories } from '@gobernansa/shared/domain/issue.ts';
import { meetingTypes } from '@gobernansa/shared/domain/meeting.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { obligationStatus } from '@gobernansa/shared/domain/obligation.ts';
import { propertyTypeLabels, totalCoefficient } from '@gobernansa/shared/domain/property.ts';
import { LnxButton, LnxCheckbox, LnxIcon, toast } from 'lnxjs-components';
import { computed, onActivated, ref, shallowReactive, watch } from 'vue';
import { onRevalidate, remember } from '@/app/ux/navigation.ts';
import { dashboardMonths, dashboardSources } from '../application/useCommunityDashboard.ts';

// The community's categories, the defaults until it has loaded
const props = defineProps<{ communityId: string; categories?: IssueCategory[] }>();

const DAY = 86_400_000;

interface Widget {
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
const allWidgets: Widget[] = [
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
const widgetsByKey = new Map(allWidgets.map(widget => [widget.key, widget]));
const DEFAULT_VISIBLE = 6;

const { user } = useAuth();

/* Layout, per admin and the same for every community */
interface LayoutItem { key: string; hidden: boolean }

const defaultLayout = allWidgets.map(({ key }, index) => ({ key, hidden: index >= DEFAULT_VISIBLE }));
const storageKey = computed(() => `gobernansa.admin.dashboard.${user.value?.id ?? ''}`);

// Unknown widgets are dropped and new ones are added at the end, hidden
// ponytail: per browser, move it to the user profile to follow the admin between devices
function loadLayout(): LayoutItem[] {
	let saved: unknown;
	try {
		saved = JSON.parse(localStorage.getItem(storageKey.value) ?? 'null');
	} catch {
		// Blocked storage or a broken value, the default layout then
	}
	if (!Array.isArray(saved)) {
		return structuredClone(defaultLayout);
	}

	const items = (saved as LayoutItem[]).filter((item, index, all) => widgetsByKey.has(item?.key) && all.findIndex(other => other.key === item.key) === index);
	return [...items, ...allWidgets.filter(({ key }) => !items.some(item => item.key === key)).map(({ key }) => ({ key, hidden: true }))];
}

const layout = ref(loadLayout());
// The profile may arrive after the page
watch(storageKey, () => layout.value = loadLayout());
// The same for every community, so another kept page may have changed it meanwhile
onActivated(() => layout.value = loadLayout());
watch(layout, (value) => {
	try {
		localStorage.setItem(storageKey.value, JSON.stringify(value));
	} catch {
		// The layout just won't be remembered
	}
}, { deep: true });

const widgets = computed(() => layout.value.filter(item => !item.hidden).map(item => widgetsByKey.get(item.key)!));

/* Data, read once and only for the widgets shown */
const sources = dashboardSources(props.communityId);
const data = shallowReactive<DashboardData>({});
const failed = shallowReactive(new Set<DashboardSource>());
const requested = new Set<DashboardSource>();

function load(source: DashboardSource) {
	// Kept a few minutes, so going into a section and back doesn't read every widget again
	remember(`dashboard:${props.communityId}:${source}`, sources[source] as () => Promise<unknown>).then(
		(value) => {
			(data as Record<DashboardSource, unknown>)[source] = value;
			failed.delete(source);
		},
		// Its widgets say so, the rest still show. A failed reread keeps what was shown
		() => {
			if (!data[source]) {
				failed.add(source);
			}
		},
	);
}

watch(widgets, (shown) => {
	for (const source of new Set(shown.flatMap(widget => widget.sources))) {
		if (!requested.has(source)) {
			requested.add(source);
			load(source);
		}
	}
}, { immediate: true });

// Coming back to the community, the figures are read again while the last ones stay
onRevalidate(() => requested.forEach(load));

function state(widget: Widget) {
	return widget.sources.some(source => failed.has(source)) ? 'failed' : widget.sources.every(source => data[source]) ? 'ready' : 'loading';
}

/* Formatting */
function count(total: number, one: string, many: string) {
	return `${total} ${total === 1 ? one : many}`;
}

function formatDate(date: Timestamp | Date, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) {
	return ('toDate' in date ? date.toDate() : date).toLocaleDateString('es', options);
}

function percent(part: number, whole: number) {
	return whole ? Math.min(100, Math.round(part / whole * 100)) : 0;
}

/* Charts */
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

// Bar height as a % of the tallest, with a sliver for zero so the month is still seen
function height(value: number, max: number) {
	return `${max ? Math.max(2, value / max * 100) : 2}%`;
}

// An SVG polyline over a 100×32 box, null months skipped
function sparkline(values: (number | null)[]) {
	const known = values.filter((value): value is number => value !== null);
	const max = Math.max(...known, 1);
	return values
		.map((value, index) => value === null ? '' : `${(index / (values.length - 1)) * 100},${30 - (value / max) * 28}`)
		.filter(Boolean)
		.join(' ');
}

/* Issues */
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
const categories = computed(() => Array.from(new Set(open.value.map(issue => issue.category)), id => ({ ...findIssueCategory(props.categories ?? getIssueCategories(), id), total: open.value.filter(issue => issue.category === id).length }))
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

/* People and census */
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

/* Obligations */
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

/* Money */
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

/* Agenda */
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

function ago(date: Timestamp) {
	const days = Math.floor((Date.now() - date.toMillis()) / DAY);
	return days < 1 ? 'hoy' : days === 1 ? 'ayer' : days < 7 ? `hace ${days} días` : formatDate(date);
}

/* Customizing */
const dialog = ref<HTMLDialogElement>();
const draggedIndex = ref<number>();
const announcement = ref('');

function customize() {
	dialog.value?.showModal();
}
defineExpose({ customize });

function toggle(item: LayoutItem) {
	item.hidden = !item.hidden;
}

function move(from: number, to: number) {
	if (to < 0 || to >= layout.value.length) {
		return;
	}
	const [item] = layout.value.splice(from, 1);
	layout.value.splice(to, 0, item);
	announcement.value = `${widgetsByKey.get(item.key)!.title} movido a la posición ${to + 1}`;
}

function onDrop(to: number) {
	if (draggedIndex.value !== undefined) {
		move(draggedIndex.value, to);
	}
	draggedIndex.value = undefined;
}

function reset() {
	const previous = layout.value;
	layout.value = structuredClone(defaultLayout);
	announcement.value = 'Dashboard restablecido';
	toast('Dashboard restablecido', {
		undo: async () => {
			layout.value = previous;
		},
	});
}
</script>

<template>
	<TransitionGroup v-if="widgets.length" tag="ul" name="widget" class="dashboard" aria-label="Resumen de la comunidad">
		<li v-for="widget in widgets" :key="widget.key" :class="[`size-${widget.size}`, widget.key]" :aria-busy="state(widget) === 'loading'">
			<header>
				<LnxIcon :icon="widget.icon" :size="16" aria-hidden="true" />
				<h2>
					<RouterLink class="stretched" :to="`/communities/${communityId}/${widget.to}`">
						{{ widget.title }}
					</RouterLink>
				</h2>
			</header>

			<p v-if="state(widget) === 'failed'" class="muted">
				No se ha podido cargar
			</p>
			<!-- Shaped like the widget: a figure and its line, or rows for the lists and charts -->
			<div v-else-if="state(widget) === 'loading'" class="skeleton" aria-hidden="true">
				<template v-if="widget.size === 1">
					<span class="lnx-skeleton lnx-skeleton--title" style="width: 38%" />
					<span class="lnx-skeleton lnx-skeleton--small" style="width: 70%" />
				</template>
				<template v-else>
					<span class="lnx-skeleton lnx-skeleton--title" style="width: 24%" />
					<span class="lnx-skeleton lnx-skeleton--small" style="width: 62%" />
					<span class="lnx-skeleton lnx-skeleton--small" style="width: 48%" />
				</template>
			</div>

			<!-- Unresolved issues, by how long they've waited -->
			<template v-else-if="widget.key === 'openIssues'">
				<p class="figure" :class="{ warn: openSummary.ages[3] }">
					{{ openSummary.total }}
				</p>
				<p class="muted">
					{{ openSummary.notified }} sin atender · {{ openSummary.total - openSummary.notified }} en curso
				</p>
				<div v-if="openSummary.total" class="stack" role="img" :aria-label="ageLegend.map((label, index) => `${label}: ${openSummary.ages[index]}`).join(', ')">
					<span
						v-for="(total, index) in openSummary.ages"
						:key="index"
						:class="`age-${index}`"
						:style="{ flexGrow: total }"
						:title="`${ageLegend[index]}: ${total}`"
					/>
				</div>
			</template>

			<!-- Collected vs spent this year, and month by month -->
			<div v-else-if="widget.key === 'balance'" class="split">
				<dl class="facts">
					<div>
						<dt>Saldo</dt>
						<dd class="figure" :class="balance.result < 0 ? 'warn' : 'good'">
							{{ formatCents(balance.result) }}
						</dd>
					</div>
					<div>
						<dt>Por cobrar</dt>
						<dd :class="{ warn: balance.pending }">
							{{ formatCents(balance.pending) }}
						</dd>
					</div>
					<div>
						<dt>Cobrado</dt>
						<dd>{{ formatCents(balance.collected) }}</dd>
					</div>
					<div>
						<dt>Gastado</dt>
						<dd>{{ formatCents(balance.spent) }}</dd>
					</div>
				</dl>
				<div class="chart">
					<div class="bars" role="img" :aria-label="balance.months.map((month, index) => `${monthLabels[index]}: cobrado ${formatCents(month.income)}, gastado ${formatCents(month.expenses)}`).join('; ')">
						<div v-for="(month, index) in balance.months" :key="index" class="group">
							<span class="bar income" :style="{ height: height(month.income, balance.max) }" :title="`Cobrado: ${formatCents(month.income)}`" />
							<span class="bar expense" :style="{ height: height(month.expenses, balance.max) }" :title="`Gastado: ${formatCents(month.expenses)}`" />
						</div>
					</div>
					<div class="axis" aria-hidden="true">
						<span v-for="label in monthLabels" :key="label">{{ label }}</span>
					</div>
					<p class="legend" aria-hidden="true">
						<span class="income">Cobrado</span>
						<span class="expense">Gastado</span>
					</p>
				</div>
			</div>

			<!-- Neighbours signed up, out of the homes -->
			<div v-else-if="widget.key === 'registration'" class="ring-row">
				<span class="ring" :style="{ '--percent': registration.percent }" role="img" :aria-label="`${registration.percent} % de las viviendas`">
					{{ registration.percent }}%
				</span>
				<p class="muted">
					{{ count(registration.registered, 'vecino registrado', 'vecinos registrados') }} de {{ count(registration.homes, 'vivienda', 'viviendas') }}
				</p>
			</div>

			<!-- Overdue and coming soon, the next ones by date -->
			<template v-else-if="widget.key === 'obligations'">
				<p class="counts">
					<span :class="{ warn: obligations.overdue }"><strong>{{ obligations.overdue }}</strong> vencidas</span>
					<span :class="{ soon: obligations.soon }"><strong>{{ obligations.soon }}</strong> vencen en 30 días</span>
				</p>
				<ul v-if="obligations.next.length" class="rows">
					<li v-for="obligation in obligations.next" :key="obligation.id">
						<span class="dot" :class="obligation.status" aria-hidden="true" />
						<span class="text">{{ obligation.title }}</span>
						<span class="muted">{{ formatDate(obligation.dueAt, { day: 'numeric', month: 'short', year: 'numeric' }) }}</span>
					</li>
				</ul>
				<p v-else class="muted">
					Aún no hay obligaciones registradas
				</p>
			</template>

			<!-- Average days to resolve, month by month -->
			<template v-else-if="widget.key === 'resolution'">
				<p class="figure">
					{{ resolution.average === null ? '—' : `${Math.round(resolution.average)} días` }}
				</p>
				<p class="muted">
					<template v-if="resolution.trend !== null && resolution.trend !== 0">
						<span :class="resolution.trend < 0 ? 'good' : 'warn'">
							{{ resolution.trend < 0 ? '↓' : '↑' }} {{ Math.abs(resolution.trend) }} días
						</span>
						vs. el mes anterior
					</template>
					<template v-else>
						{{ count(resolution.total, 'resuelta', 'resueltas') }} en {{ monthLabels.length }} meses
					</template>
				</p>
				<svg v-if="resolution.total" class="sparkline" viewBox="0 0 100 32" preserveAspectRatio="none" role="img" :aria-label="resolution.perMonth.map((value, index) => `${monthLabels[index]}: ${value === null ? 'sin datos' : `${Math.round(value)} días`}`).join(', ')">
					<polyline :points="sparkline(resolution.perMonth)" />
				</svg>
			</template>

			<!-- Overdue charges -->
			<template v-else-if="widget.key === 'delinquency'">
				<p class="figure" :class="{ warn: delinquency.amount }">
					{{ formatCents(delinquency.amount) }}
				</p>
				<p class="muted">
					<template v-if="delinquency.charges">
						{{ count(delinquency.charges, 'recibo vencido', 'recibos vencidos') }} de {{ count(delinquency.properties, 'propiedad', 'propiedades') }}
					</template>
					<template v-else>
						Todos los recibos al día
					</template>
				</p>
			</template>

			<!-- New vs resolved issues per month -->
			<div v-else-if="widget.key === 'flow'" class="split">
				<dl class="facts">
					<div>
						<dt>Nuevas</dt>
						<dd class="figure">
							{{ flow.createdTotal }}
						</dd>
					</div>
					<div>
						<dt>Resueltas</dt>
						<dd class="figure">
							{{ flow.resolvedTotal }}
						</dd>
					</div>
				</dl>
				<div class="chart">
					<div class="bars" role="img" :aria-label="monthLabels.map((label, index) => `${label}: ${flow.created[index]} nuevas, ${flow.resolved[index]} resueltas`).join('; ')">
						<div v-for="(label, index) in monthLabels" :key="label" class="group">
							<span class="bar created" :style="{ height: height(flow.created[index], flow.max) }" :title="`Nuevas: ${flow.created[index]}`" />
							<span class="bar resolved" :style="{ height: height(flow.resolved[index], flow.max) }" :title="`Resueltas: ${flow.resolved[index]}`" />
						</div>
					</div>
					<div class="axis" aria-hidden="true">
						<span v-for="label in monthLabels" :key="label">{{ label }}</span>
					</div>
					<p class="legend" aria-hidden="true">
						<span class="created">Nuevas</span>
						<span class="resolved">Resueltas</span>
					</p>
				</div>
			</div>

			<!-- Spent vs planned this year, by item -->
			<template v-else-if="widget.key === 'budget'">
				<p v-if="!budget.exists" class="muted">
					Aún no hay presupuesto para este año
				</p>
				<template v-else>
					<p class="counts">
						<span :class="{ warn: budget.percent > budget.expected + 10 }"><strong>{{ budget.percent }}%</strong> gastado</span>
						<span class="muted">{{ formatCents(budget.spent) }} de {{ formatCents(budget.planned) }} · {{ budget.expected }}% del año</span>
					</p>
					<ul class="meters">
						<li v-for="item in budget.items" :key="item.id">
							<span class="text">{{ item.name }}</span>
							<span class="meter" :title="`${formatCents(item.spent)} de ${formatCents(item.amount)}`">
								<span :class="{ over: item.spent > item.amount }" :style="{ width: `${percent(item.spent, item.amount)}%` }" />
							</span>
							<span class="muted">{{ percent(item.spent, item.amount) }}%</span>
						</li>
					</ul>
				</template>
			</template>

			<!-- Open issues by category -->
			<template v-else-if="widget.key === 'categories'">
				<ul v-if="categories.length" class="meters">
					<li v-for="category in categories" :key="category.id" :style="{ '--bar': `var(--color-issue-cat-${category.color}-accent)` }">
						<span class="text">{{ category.name }}</span>
						<span class="meter">
							<span :style="{ width: `${percent(category.total, categories[0].total)}%` }" />
						</span>
						<span class="muted">{{ category.total }}</span>
					</li>
				</ul>
				<p v-else class="muted">
					Ninguna abierta
				</p>
			</template>

			<!-- The longest waiting -->
			<template v-else-if="widget.key === 'oldest'">
				<ul v-if="oldest.length" class="rows">
					<li v-for="issue in oldest" :key="issue.id">
						<span class="text">{{ issue.title }}</span>
						<span class="age" :class="{ warn: issue.days >= 14 }">{{ issue.days }} días</span>
					</li>
				</ul>
				<p v-else class="muted">
					Ninguna esperando
				</p>
			</template>

			<!-- The most voted open issues -->
			<template v-else-if="widget.key === 'voted'">
				<ol v-if="voted.length" class="rows">
					<li v-for="issue in voted" :key="issue.id">
						<span class="text">{{ issue.title }}</span>
						<span class="muted">{{ issue.votesScore }}</span>
					</li>
				</ol>
				<p v-else class="muted">
					Sin votos en las abiertas
				</p>
			</template>

			<!-- Open issues nobody has been sent to -->
			<template v-else-if="widget.key === 'unassigned'">
				<p class="figure" :class="{ warn: unassigned.total }">
					{{ unassigned.total }}
				</p>
				<p class="muted">
					{{ unassigned.noDate ? `${count(unassigned.noDate, 'en curso', 'en curso')} sin fecha prevista` : 'abiertas sin proveedor' }}
				</p>
			</template>

			<!-- Open issues with an insurance claim -->
			<template v-else-if="widget.key === 'claims'">
				<p class="figure">
					{{ claims.length }}
				</p>
				<p class="muted line">
					{{ claims.length ? claims.map(issue => issue.title).join(', ') : 'Ningún parte abierto' }}
				</p>
			</template>

			<!-- The properties owing the most -->
			<template v-else-if="widget.key === 'debtors'">
				<ol v-if="debtors.length" class="rows">
					<li v-for="debtor in debtors" :key="debtor.name">
						<span class="text">{{ debtor.name }}</span>
						<span class="warn">{{ formatCents(debtor.amount) }}</span>
					</li>
				</ol>
				<p v-else class="muted">
					Nadie debe nada
				</p>
			</template>

			<!-- The next convened meeting, or the last one held -->
			<template v-else-if="widget.key === 'meeting'">
				<template v-if="meeting.next">
					<p class="figure">
						{{ meeting.days === 0 ? 'Hoy' : meeting.days === 1 ? 'Mañana' : `En ${meeting.days} días` }}
					</p>
					<p class="muted line">
						{{ meetingTypes[meeting.next.type] }} · {{ formatDate(meeting.next.date, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }}
					</p>
				</template>
				<template v-else>
					<p class="figure muted">
						Ninguna
					</p>
					<p class="muted line">
						{{ meeting.last ? `Última celebrada el ${formatDate(meeting.last.date, { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Aún no se ha celebrado ninguna' }}
					</p>
				</template>
			</template>

			<!-- Bookings of the next 7 days -->
			<div v-else-if="widget.key === 'bookings'" class="ring-row">
				<p class="figure">
					{{ week.total }}
				</p>
				<div class="chart">
					<div class="bars small" role="img" :aria-label="week.days.map(day => `${day.label}: ${day.total}`).join(', ')">
						<span v-for="(day, index) in week.days" :key="index" class="bar" :style="{ height: height(day.total, week.max) }" :title="`${day.total}`" />
					</div>
					<div class="axis" aria-hidden="true">
						<span v-for="(day, index) in week.days" :key="index">{{ day.label }}</span>
					</div>
				</div>
			</div>

			<!-- Properties by type and whether the coefficients add up -->
			<template v-else-if="widget.key === 'census'">
				<p class="counts">
					<span><strong>{{ census.total }}</strong> propiedades</span>
					<span class="muted">{{ count(census.tenants, 'alquilada', 'alquiladas') }}</span>
				</p>
				<p class="muted line">
					{{ census.types.map(type => `${type.total} ${type.label.toLowerCase()}`).join(' · ') || 'Sin propiedades' }}
				</p>
				<p v-if="census.total" :class="census.coefficient === 100 ? 'good' : 'warn'">
					Coeficientes: {{ census.coefficient.toLocaleString('es') }} %
				</p>
			</template>

			<!-- Who changed what lately -->
			<template v-else-if="widget.key === 'activity'">
				<ul v-if="data.activity?.length" class="rows">
					<li v-for="entry in data.activity.slice(0, 4)" :key="entry.id">
						<span class="text">{{ entry.summary }}</span>
						<span class="muted">{{ entry.byName }} · {{ ago(entry.at) }}</span>
					</li>
				</ul>
				<p v-else class="muted">
					Sin cambios registrados
				</p>
			</template>
		</li>
	</TransitionGroup>

	<dialog ref="dialog" class="customize" aria-labelledby="customize-title" @close="draggedIndex = undefined">
		<header>
			<h2 id="customize-title">
				Personalizar dashboard
			</h2>
			<LnxButton mode="clear" shape="circle" aria-label="Cerrar" title="Cerrar" @click="dialog?.close()">
				<LnxIcon icon="lucide:x" />
			</LnxButton>
		</header>
		<p id="customize-help" class="muted">
			Elige qué ver y en qué orden. Arrastra cada fila o muévela con sus flechas.
		</p>
		<TransitionGroup tag="ul" name="widget-row" class="widget-list">
			<li
				v-for="(item, index) in layout"
				:key="item.key"
				:class="{ hidden: item.hidden, dragging: draggedIndex === index }"
				draggable="true"
				@dragstart="draggedIndex = index"
				@dragover.prevent
				@drop.prevent="onDrop(index)"
				@dragend="draggedIndex = undefined"
			>
				<LnxIcon class="grip" icon="lucide:grip-vertical" :size="16" aria-hidden="true" />
				<LnxCheckbox :model-value="!item.hidden" @update:model-value="toggle(item)">
					<LnxIcon :icon="widgetsByKey.get(item.key)!.icon" :size="16" aria-hidden="true" />
					{{ widgetsByKey.get(item.key)!.title }}
					<small v-if="widgetsByKey.get(item.key)!.size === 2" class="muted">ancho</small>
				</LnxCheckbox>
				<LnxButton
					mode="clear"
					shape="circle"
					class="lnx-size-small"
					:disabled="index === 0"
					:aria-label="`Subir ${widgetsByKey.get(item.key)!.title}`"
					aria-describedby="customize-help"
					@click="move(index, index - 1)"
				>
					<LnxIcon icon="lucide:chevron-up" />
				</LnxButton>
				<LnxButton
					mode="clear"
					shape="circle"
					class="lnx-size-small"
					:disabled="index === layout.length - 1"
					:aria-label="`Bajar ${widgetsByKey.get(item.key)!.title}`"
					aria-describedby="customize-help"
					@click="move(index, index + 1)"
				>
					<LnxIcon icon="lucide:chevron-down" />
				</LnxButton>
			</li>
		</TransitionGroup>
		<p class="sr-only" aria-live="polite">
			{{ announcement }}
		</p>
		<footer>
			<LnxButton mode="clear" class="lnx-size-small" @click="reset()">
				<LnxIcon icon="lucide:rotate-ccw" />
				Restablecer
			</LnxButton>
			<LnxButton class="lnx-size-small" @click="dialog?.close()">
				<LnxIcon icon="lucide:check" />
				Listo
			</LnxButton>
		</footer>
	</dialog>
</template>

<style lang="scss" scoped>
.dashboard {
	margin-bottom: var(--lnx-spacing-5);
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	grid-auto-rows: 132px;
	grid-auto-flow: dense;
	gap: var(--lnx-spacing-3);

	> li {
		position: relative;
		min-width: 0;
		overflow: hidden;
		padding: var(--lnx-spacing-3) var(--lnx-spacing-4);
		border: 1px solid var(--color-gray-3);
		border-radius: var(--lnx-radius-3);
		display: flex;
		flex-direction: column;
		gap: 4px;
		background: var(--color-gray-0);
		box-shadow: 0 1px 2px #0000000A;
		color: var(--color-gray-7);
		font-size: var(--lnx-font-size-small);
		// Figures in columns, so they don't jump as they change
		font-variant-numeric: tabular-nums;
		transition: border-color var(--duration) var(--ease-out), box-shadow var(--duration) var(--ease-out), translate var(--duration) var(--ease-spring), scale var(--duration-fast) var(--ease-out);

		&:has(.stretched:hover) {
			border-color: var(--color-primary-light);
			box-shadow: 0 2px 4px #0000000F, 0 8px 24px #0000000F;
			translate: 0 -2px;
		}

		&:has(.stretched:active) {
			translate: 0;
			scale: .99;
		}
	}

	> .size-2 {
		grid-column: span 2;
	}

	header {
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-2);
		color: var(--color-gray-6);
	}

	h2 {
		min-width: 0;
		overflow: hidden;
		color: var(--color-gray-7);
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
		white-space: nowrap;
		text-overflow: ellipsis;
	}
}

// Shown or added from "Personalizar dashboard": they fade in and the rest slide to make room
.widget-move,
.widget-row-move {
	transition: transform .3s var(--ease-out);
}

.widget-enter-active {
	transition: opacity var(--duration) var(--ease-out), scale var(--duration) var(--ease-out);
}

.widget-enter-from {
	opacity: 0;
	scale: .96;
}

.skeleton {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

// The title's link covers the whole widget
.stretched {
	color: inherit;
	text-decoration: none;

	&::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 1;
		border-radius: var(--lnx-radius-3);
	}

	&:focus-visible {
		outline: none;

		&::after {
			outline: 2px solid var(--color-primary);
			outline-offset: -2px;
		}
	}
}

.figure {
	color: var(--color-gray-9);
	font-size: var(--lnx-font-size-title);
	font-weight: var(--lnx-font-weight-bold);
	line-height: 1.1;
	white-space: nowrap;
}

.muted {
	color: var(--color-gray-6);
}

.warn {
	color: var(--color-secondary-accent);
}

.good {
	color: var(--color-issue-status-resolved);
}

.soon {
	color: var(--color-issue-cat-amber-accent);
}

// One line, cut with an ellipsis
.line {
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.counts {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 0 var(--lnx-spacing-3);

	strong {
		font-size: var(--lnx-font-size-body);
	}
}

// Ages of the unresolved issues, from new to long waiting
.stack {
	margin-top: auto;
	height: 8px;
	border-radius: var(--lnx-radius-4);
	overflow: hidden;
	display: flex;
	gap: 2px;

	.age-0 { background: var(--color-gray-4); }
	.age-1 { background: var(--color-issue-status-open); }
	.age-2 { background: var(--color-issue-cat-amber-accent); }
	.age-3 { background: var(--color-secondary-accent); }
}

// Figures on the left as wide as they need, chart in the rest
.split {
	flex: 1;
	min-height: 0;
	display: grid;
	grid-template-columns: auto minmax(0, 1fr);
	gap: var(--lnx-spacing-3);
}

.facts {
	display: grid;
	grid-template-columns: auto auto;
	align-content: start;
	gap: 2px var(--lnx-spacing-2);

	dt {
		color: var(--color-gray-6);
		font-size: 11px;
	}

	dd {
		color: var(--color-gray-9);
		white-space: nowrap;
	}

	.figure {
		font-size: var(--lnx-font-size-body);
	}

	> :first-child .figure {
		font-size: var(--lnx-font-size-title);
	}
}

.chart {
	min-width: 0;
	min-height: 0;
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.bars {
	flex: 1;
	min-height: 40px;
	display: flex;
	align-items: flex-end;
	gap: 6px;
	border-bottom: 1px solid var(--color-gray-3);

	.group {
		flex: 1;
		height: 100%;
		display: flex;
		align-items: flex-end;
		gap: 2px;
	}

	.bar {
		flex: 1;
		border-radius: 2px 2px 0 0;
		background: var(--color-primary);
	}

	&.small .bar {
		background: var(--color-issue-status-open);
	}
}

.income,
.resolved {
	--swatch: var(--color-issue-status-resolved);
}

.expense {
	--swatch: var(--color-secondary-accent);
}

.created {
	--swatch: var(--color-issue-status-open);
}

.bars .bar:is(.income, .expense, .created, .resolved) {
	background: var(--swatch);
}

.axis {
	display: flex;
	gap: 6px;
	color: var(--color-gray-6);
	font-size: 10px;
	text-align: center;

	span {
		flex: 1;
	}
}

.legend {
	display: flex;
	gap: var(--lnx-spacing-3);
	color: var(--color-gray-6);
	font-size: 11px;

	span::before {
		content: '';
		margin-right: 4px;
		width: 8px;
		height: 8px;
		border-radius: 2px;
		display: inline-block;
		background: var(--swatch);
	}
}

.sparkline {
	margin-top: auto;
	width: 100%;
	height: 32px;
	overflow: visible;

	polyline {
		fill: none;
		stroke: var(--color-primary);
		stroke-width: 2;
		stroke-linejoin: round;
		vector-effect: non-scaling-stroke;
	}
}

.ring-row {
	flex: 1;
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-3);

	.chart {
		flex: 1;
		height: 100%;
	}
}

.ring {
	--percent: 0;
	flex-shrink: 0;
	width: 64px;
	height: 64px;
	border-radius: var(--lnx-radius-circle);
	display: grid;
	place-items: center;
	background:
		radial-gradient(closest-side, var(--color-gray-0) 76%, transparent 78%),
		conic-gradient(var(--color-primary) calc(var(--percent) * 1%), var(--color-gray-2) 0);
	color: var(--color-gray-9);
	font-weight: var(--lnx-font-weight-bold);
}

.rows {
	min-height: 0;
	overflow: hidden;

	li {
		padding: 2px 0;
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-2);

		+ li {
			border-top: 1px solid var(--color-gray-2);
		}

		> * {
			flex-shrink: 0;
			white-space: nowrap;
		}
	}

	.text {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		color: var(--color-gray-8);
		text-overflow: ellipsis;
	}
}

.dot {
	width: 8px;
	height: 8px;
	border-radius: var(--lnx-radius-circle);
	background: var(--color-issue-status-resolved);

	&.overdue { background: var(--color-secondary-accent); }
	&.soon { background: var(--color-issue-cat-amber-accent); }
}

.meters {
	display: flex;
	flex-direction: column;
	gap: 4px;

	li {
		display: grid;
		grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) 4ch;
		align-items: center;
		gap: var(--lnx-spacing-2);
	}

	.text {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.muted {
		text-align: right;
	}
}

.meter {
	height: 6px;
	border-radius: var(--lnx-radius-4);
	overflow: hidden;
	background: var(--color-gray-2);

	span {
		height: 100%;
		display: block;
		border-radius: inherit;
		background: var(--bar, var(--color-primary));

		&.over {
			background: var(--color-secondary-accent);
		}
	}
}

.customize {
	margin: auto;
	width: min(480px, calc(100vw - 32px));
	max-height: min(640px, calc(100vh - 32px));
	padding: var(--lnx-spacing-4);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 8px 32px #00000026;
	color: var(--color-gray-8);
	opacity: 0;
	scale: .96;
	// Transitions, so closing while it opens turns back from where it is
	transition:
		opacity var(--duration) var(--ease-out),
		scale var(--duration) var(--ease-out),
		overlay var(--duration) allow-discrete,
		display var(--duration) allow-discrete;

	// The layout stays while it fades out, only display goes
	flex-direction: column;
	gap: var(--lnx-spacing-3);

	&[open] {
		display: flex;
		opacity: 1;
		scale: 1;

		@starting-style {
			opacity: 0;
			scale: .96;
		}
	}

	&::backdrop {
		background: #0000004D;
		opacity: 0;
		transition: opacity var(--duration) var(--ease-out), overlay var(--duration) allow-discrete, display var(--duration) allow-discrete;
	}

	&[open]::backdrop {
		opacity: 1;

		@starting-style {
			opacity: 0;
		}
	}

	header,
	footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--lnx-spacing-2);
	}

	h2 {
		font-size: var(--lnx-font-size-body);
		font-weight: var(--lnx-font-weight-bold);
	}

	> .muted {
		font-size: var(--lnx-font-size-small);
	}
}

.widget-list {
	min-height: 0;
	overflow-y: auto;
	display: flex;
	flex-direction: column;

	li {
		padding: 2px var(--lnx-spacing-1);
		border-radius: var(--lnx-radius-2);
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-1);
		font-size: var(--lnx-font-size-small);

		+ li {
			border-top: 1px solid var(--color-gray-2);
		}

		&:hover {
			background: var(--color-gray-1);
		}

		&.hidden .lnx-checkbox {
			color: var(--color-gray-6);
		}

		&.dragging {
			opacity: .4;
		}
	}

	.grip {
		flex-shrink: 0;
		color: var(--color-gray-5);
		cursor: grab;
	}

	.lnx-checkbox {
		flex: 1;
		min-width: 0;
		padding: var(--lnx-spacing-1) 0;
	}
}

@media (max-width: 640px) {
	.dashboard {
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--lnx-spacing-2);

		// Figures over the chart, twice as tall
		> :has(.split) {
			grid-row: span 2;
		}
	}

	.split {
		grid-template-columns: minmax(0, 1fr);
	}
}
</style>
