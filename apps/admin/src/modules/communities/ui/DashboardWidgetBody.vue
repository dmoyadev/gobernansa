<script setup lang="ts">
import type { Timestamp } from 'firebase/firestore';
import type { useDashboardFigures, Widget } from '../application/dashboardWidgets.ts';
import type { DashboardData } from '../application/useCommunityDashboard.ts';
import { meetingTypes } from '@gobernansa/shared/domain/meeting.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { useRoute } from 'vue-router';
import { formatDate, percent } from '../application/dashboardWidgets.ts';

// What a dashboard widget shows under its title: its figures and chart, or its skeleton while they load
const props = defineProps<{ widget: Widget; state: 'failed' | 'loading' | 'ready'; figures: ReturnType<typeof useDashboardFigures>; data: DashboardData }>();

const DAY = 86_400_000;

// Rows open their own issue, category or debtor, above the link the whole widget is
const community = `/communities/${useRoute().params.id as string}`;

const { monthLabels, openSummary, ageLegend, categories, oldest, voted, unassigned, claims, resolution, flow, registration, census, obligations, delinquency, debtors, balance, budget, meeting, week } = props.figures;

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

function count(total: number, one: string, many: string) {
	return `${total} ${total === 1 ? one : many}`;
}

function ago(date: Timestamp) {
	const days = Math.floor((Date.now() - date.toMillis()) / DAY);
	return days < 1 ? 'hoy' : days === 1 ? 'ayer' : days < 7 ? `hace ${days} días` : formatDate(date);
}
</script>

<template>
	<p v-if="state === 'failed'" class="muted">
		No se ha podido cargar
	</p>
	<!-- Shaped like the widget: a figure and its line, or rows for the lists and charts -->
	<div v-else-if="state === 'loading'" class="skeleton" aria-hidden="true">
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
				<RouterLink class="text" :to="`${community}/issues?category=${encodeURIComponent(category.id)}`">
					{{ category.name }}
				</RouterLink>
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
				<RouterLink class="text" :to="`${community}/issues/${issue.id}`">
					{{ issue.title }}
				</RouterLink>
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
				<RouterLink class="text" :to="`${community}/issues/${issue.id}`">
					{{ issue.title }}
				</RouterLink>
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
			<li v-for="debtor in debtors" :key="debtor.propertyId">
				<RouterLink class="text" :to="`${community}/statements/${debtor.propertyId}`">
					{{ debtor.name }}
				</RouterLink>
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
</template>

<style lang="scss" scoped>
.skeleton {
	display: flex;
	flex-direction: column;
	gap: 6px;
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

// Over the widget's stretched link, so a row opens its own page
a.text {
	position: relative;
	z-index: 2;
	border-radius: var(--lnx-radius-1);
	text-decoration: none;

	&:hover {
		color: var(--color-primary);
		text-decoration: underline;
	}

	&:focus-visible {
		// Inside: the list clips what overflows
		outline: 2px solid var(--color-primary);
		outline-offset: -2px;
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
