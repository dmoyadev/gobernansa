<script setup lang="ts">
import type { CommunityStats } from '../application/usePortfolio.ts';
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
		No se ha podido cargar: {{ (error ?? communitiesError)?.message }}
	</p>

	<dl v-if="pending" class="totals" aria-busy="true">
		<div v-for="width in TILE_WIDTHS" :key="width">
			<dt><span class="skeleton-item skeleton-item--small" :style="{ width: `${width}%` }" /></dt>
			<dd><span class="skeleton-item skeleton-item--title" style="width: 40%" /></dd>
		</div>
	</dl>
	<dl v-else class="totals ux-appear">
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
				<span class="skeleton-item" :style="{ width: `${width}%` }" />
				<span v-for="column in 5" :key="column" class="skeleton-item skeleton-item--small" />
			</div>
		</div>
		<div v-else-if="stats.length" class="table ux-appear">
			<table>
				<thead>
					<tr>
						<th scope="col">
							Comunidad
						</th>
						<th scope="col">
							Abiertas
						</th>
						<th scope="col">
							Resolución media
						</th>
						<th scope="col">
							Registrados
						</th>
						<th scope="col">
							Obligaciones
						</th>
						<th scope="col">
							Morosidad
						</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="row in stats" :key="row.community.id">
						<th scope="row">
							<RouterLink :to="`/communities/${row.community.id}`" :style="{ viewTransitionName: `community-${row.community.id}` }">
								{{ row.community.name }}
							</RouterLink>
						</th>
						<td>
							<RouterLink :to="`/communities/${row.community.id}/issues`">
								{{ row.openIssues }}
							</RouterLink>
						</td>
						<td>{{ averageDays(row.resolutionDaysSum, row.resolvedCount) }}</td>
						<td>{{ registeredPercent(row.registered, row.homes) }}</td>
						<td>
							<span v-if="row.overdueObligations" class="warn">{{ row.overdueObligations }} vencidas</span>
							<template v-if="row.overdueObligations && row.soonObligations">
								·
							</template>
							<span v-if="row.soonObligations">{{ row.soonObligations }} pronto</span>
							<template v-if="!row.overdueObligations && !row.soonObligations">
								Al día
							</template>
						</td>
						<td :class="{ warn: row.overdueAmount }">
							{{ formatCents(row.overdueAmount) }}
							<small v-if="row.overdueCharges">({{ row.overdueCharges }})</small>
						</td>
					</tr>
				</tbody>
			</table>
		</div>
		<p v-else class="hint">
			No gestionas ninguna comunidad.
		</p>
	</section>
</template>

<style lang="scss" scoped>
.page-header {
	margin-bottom: var(--lnx-spacing-5);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);

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
	padding: var(--lnx-spacing-5);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;
	display: flex;
	flex-direction: column;
	align-items: stretch;
	gap: var(--lnx-spacing-4);
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

.hint {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.error {
	margin-bottom: var(--lnx-spacing-4);
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}
</style>
