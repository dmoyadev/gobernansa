<script setup lang="ts">
import type { CommunityStats } from '../application/usePortfolio.ts';
import { errorMessage } from '@gobernansa/shared/application/errors.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed, ref, watch } from 'vue';
import BackButton from '@/app/ux/BackButton.vue';
import { onRevalidate } from '@/app/ux/navigation.ts';
import { useCommunities } from '@/modules/communities/application/useCommunities.ts';
import { loadCommunityStats } from '../application/usePortfolio.ts';

const { communities, loading: communitiesLoading, error: communitiesError } = useCommunities();

const stats = ref<CommunityStats[]>([]);
const loading = ref(false);
const error = ref<Error>();

// Once on mount and on demand, a live view would read again with every change
async function load() {
	if (communitiesLoading.value) {
		return;
	}
	loading.value = true;
	error.value = undefined;
	try {
		// One community failing still shows the rest
		const results = await Promise.allSettled(communities.value.map(loadCommunityStats));
		stats.value = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
		const failed = results.find(result => result.status === 'rejected');
		error.value = failed && failed.reason as Error;
	} finally {
		loading.value = false;
	}
}
watch(communitiesLoading, load, { immediate: true });
// Coming back shows the last figures while they're read again
onRevalidate(load);

const pending = computed(() => (loading.value || communitiesLoading.value) && !stats.value.length);
const TILE_WIDTHS = [70, 55, 80, 65, 60];
const ROW_WIDTHS = [60, 45, 70, 50];

function averageDays(sum: number, count: number) {
	return count ? `${Math.round(sum / count)} días` : '—';
}

// Neighbours who signed up but don't own a home (tenants, relatives) could go over the homes
function registeredPercent(registered: number, homes: number) {
	return homes ? `${Math.min(100, Math.round(registered / homes * 100))} %` : '—';
}

// Sorted by any column, by name at first. Figures start from the highest, what needs attention; those without one (no
// resolved issues, no homes) go last either way
type SortKey = 'name' | 'openIssues' | 'resolution' | 'registered' | 'obligations' | 'arrears';
const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
	{ key: 'name', label: 'Comunidad' },
	{ key: 'openIssues', label: 'Abiertas', numeric: true },
	{ key: 'resolution', label: 'Resolución media', numeric: true },
	{ key: 'registered', label: 'Registrados', numeric: true },
	{ key: 'obligations', label: 'Obligaciones' },
	{ key: 'arrears', label: 'Morosidad', numeric: true },
];
const SORT_VALUES: Record<SortKey, (row: CommunityStats) => number | string | undefined> = {
	name: row => row.community.name ?? '',
	openIssues: row => row.openIssues,
	resolution: row => row.resolvedCount ? row.resolutionDaysSum / row.resolvedCount : undefined,
	registered: row => row.homes ? Math.min(1, row.registered / row.homes) : undefined,
	// Overdue ones first, then those due soon
	obligations: row => row.overdueObligations * 1000 + row.soonObligations,
	arrears: row => row.overdueAmount,
};
const sort = ref<{ key: SortKey; descending: boolean }>({ key: 'name', descending: false });
const sorted = computed(() => {
	const value = SORT_VALUES[sort.value.key];
	const direction = sort.value.descending ? -1 : 1;
	return [...stats.value].sort((a, b) => {
		const [x, y] = [value(a), value(b)];
		if (x === undefined || y === undefined) {
			return x === y ? 0 : x === undefined ? 1 : -1;
		}
		return direction * (typeof x === 'string' ? x.localeCompare(String(y), 'es') : x - Number(y));
	});
});

function sortBy(key: SortKey) {
	sort.value = { key, descending: sort.value.key === key ? !sort.value.descending : key !== 'name' };
}

function sortState(key: SortKey) {
	return sort.value.key === key ? (sort.value.descending ? 'descending' : 'ascending') : undefined;
}

const totals = computed(() => stats.value.reduce((total, row) => ({
	openIssues: total.openIssues + row.openIssues,
	resolutionDaysSum: total.resolutionDaysSum + row.resolutionDaysSum,
	resolvedCount: total.resolvedCount + row.resolvedCount,
	registered: total.registered + Math.min(row.registered, row.homes),
	homes: total.homes + row.homes,
	overdueObligations: total.overdueObligations + row.overdueObligations,
	soonObligations: total.soonObligations + row.soonObligations,
	overdueAmount: total.overdueAmount + row.overdueAmount,
	overdueOld: total.overdueOld + row.overdueOld,
}), { openIssues: 0, resolutionDaysSum: 0, resolvedCount: 0, registered: 0, homes: 0, overdueObligations: 0, soonObligations: 0, overdueAmount: 0, overdueOld: 0 }));
</script>

<template>
	<header class="page-header">
		<BackButton to="/" label="Volver" />
		<h1>Panel de cartera</h1>
		<LnxButton class="reload" mode="outline" :is-loading="loading" @click="load">
			<LnxIcon icon="lucide:refresh-cw" />
			Recargar
		</LnxButton>
	</header>

	<p v-if="error || communitiesError" class="error" role="alert">
		No se ha podido cargar: {{ errorMessage(error ?? communitiesError) }}
	</p>

	<dl v-if="pending" class="totals" aria-busy="true">
		<div v-for="width in TILE_WIDTHS" :key="width">
			<dt><span class="lnx-skeleton lnx-skeleton--small" :style="{ width: `${width}%` }" /></dt>
			<dd><span class="lnx-skeleton lnx-skeleton--title" style="width: 40%" /></dd>
		</div>
	</dl>
	<dl v-else class="totals lnx-appear">
		<div>
			<dt>Incidencias abiertas</dt>
			<dd>{{ totals.openIssues }}</dd>
		</div>
		<div>
			<dt>Resolución media</dt>
			<dd>{{ averageDays(totals.resolutionDaysSum, totals.resolvedCount) }}</dd>
		</div>
		<div>
			<dt>Vecinos registrados</dt>
			<dd>{{ registeredPercent(totals.registered, totals.homes) }}</dd>
		</div>
		<div>
			<dt>Obligaciones vencidas</dt>
			<dd :class="{ warn: totals.overdueObligations }">
				{{ totals.overdueObligations }}
				<small v-if="totals.soonObligations">+{{ totals.soonObligations }} pronto</small>
			</dd>
		</div>
		<div>
			<dt>Recibos vencidos</dt>
			<dd :class="{ warn: totals.overdueAmount }">
				{{ formatCents(totals.overdueAmount) }}
				<small v-if="totals.overdueOld">{{ formatCents(totals.overdueOld) }} a más de 90 días</small>
			</dd>
		</div>
	</dl>

	<section class="card" :aria-busy="pending">
		<div v-if="pending" class="skeleton-rows">
			<div v-for="width in ROW_WIDTHS" :key="width">
				<span class="lnx-skeleton" :style="{ width: `${width}%` }" />
				<span v-for="column in 5" :key="column" class="lnx-skeleton lnx-skeleton--small" />
			</div>
		</div>
		<div v-else-if="stats.length" class="table lnx-appear">
			<table>
				<thead>
					<tr>
						<th v-for="column in COLUMNS" :key="column.key" scope="col" :class="{ numeric: column.numeric }" :aria-sort="sortState(column.key)">
							<button type="button" class="sort" :class="{ active: sortState(column.key) }" @click="sortBy(column.key)">
								{{ column.label }}
								<LnxIcon
									class="arrow"
									:icon="sortState(column.key) === 'ascending' ? 'lucide:arrow-up' : sortState(column.key) ? 'lucide:arrow-down' : 'lucide:arrow-up-down'"
									:size="14"
									aria-hidden="true"
								/>
							</button>
						</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="row in sorted" :key="row.community.id">
						<th scope="row">
							<RouterLink :to="`/communities/${row.community.id}`" :style="{ viewTransitionName: `community-${row.community.id}` }">
								{{ row.community.name }}
							</RouterLink>
						</th>
						<td class="numeric">
							<RouterLink :to="`/communities/${row.community.id}/issues`">
								{{ row.openIssues }}
							</RouterLink>
						</td>
						<td class="numeric">
							{{ averageDays(row.resolutionDaysSum, row.resolvedCount) }}
						</td>
						<td class="numeric">
							{{ registeredPercent(row.registered, row.homes) }}
						</td>
						<td>
							<RouterLink :to="`/communities/${row.community.id}/obligations`">
								<span v-if="row.overdueObligations" class="warn">{{ row.overdueObligations }} vencidas</span>
								<template v-if="row.overdueObligations && row.soonObligations">
									·
								</template>
								<span v-if="row.soonObligations">{{ row.soonObligations }} pronto</span>
								<template v-if="!row.overdueObligations && !row.soonObligations">
									Al día
								</template>
							</RouterLink>
						</td>
						<td class="numeric">
							<RouterLink :to="`/communities/${row.community.id}/arrears`" :class="{ warn: row.overdueAmount }">
								{{ formatCents(row.overdueAmount) }}
								<small v-if="row.overdueCharges">({{ row.overdueCharges }})</small>
							</RouterLink>
						</td>
					</tr>
				</tbody>
			</table>
		</div>
		<p v-else class="hint">
			Aún no tienes comunidades. <RouterLink to="/">
				Créalas o impórtalas desde Comunidades
			</RouterLink> y aquí verás sus cifras juntas.
		</p>
	</section>
</template>

<style lang="scss" scoped>
.page-header {
	h1 {
		font-size: var(--lnx-font-size-title);
	}

	.reload {
		margin-left: auto;
	}
}

.totals {
	margin-bottom: var(--lnx-spacing-4);
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
	gap: var(--lnx-spacing-3);

	div {
		padding: var(--lnx-spacing-4);
		border: 1px solid var(--color-gray-3);
		border-radius: var(--lnx-radius-3);
		background: var(--color-gray-0);
	}

	dt {
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
	}

	dd {
		font-size: var(--lnx-font-size-title);
		font-weight: var(--lnx-font-weight-bold);
		font-variant-numeric: tabular-nums;

		small {
			color: var(--color-gray-6);
			font-size: var(--lnx-font-size-small);
			font-weight: normal;
		}
	}
}

.card {
	align-items: stretch;
}

.table {
	overflow-x: auto;
}

.skeleton-rows {
	display: flex;
	flex-direction: column;

	> div {
		padding: var(--lnx-spacing-3) var(--lnx-spacing-2);
		display: grid;
		grid-template-columns: 2fr repeat(5, 1fr);
		align-items: center;
		gap: var(--lnx-spacing-4);
	}

	> div + div {
		border-top: 1px solid var(--color-gray-3);
	}
}

table {
	width: 100%;
	border-collapse: collapse;
	font-size: var(--lnx-font-size-small);

	th,
	td {
		padding: var(--lnx-spacing-2);
		border-bottom: 1px solid var(--color-gray-3);
		text-align: left;
		white-space: nowrap;
	}

	thead th {
		color: var(--color-gray-6);
		font-weight: normal;
	}

	.numeric {
		text-align: right;
	}

	// The whole header is the button, its arrow brighter on the column sorted by
	.sort {
		display: inline-flex;
		align-items: center;
		gap: var(--lnx-spacing-1);
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		cursor: pointer;

		.arrow {
			color: var(--color-gray-4);
		}

		&:hover,
		&.active {
			color: var(--color-gray-9);

			.arrow {
				color: var(--color-primary);
			}
		}
	}

	tbody tr {
		transition: background-color var(--duration) var(--ease-out);

		&:hover {
			background-color: var(--color-gray-1);
		}
	}

	a {
		color: var(--color-gray-9);

		&:hover {
			color: var(--color-primary);
		}
	}

	small {
		color: var(--color-gray-6);
	}
}

.warn {
	color: var(--color-secondary-accent);
}

.error {
	margin-bottom: var(--lnx-spacing-4);
}
</style>
