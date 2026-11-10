<script setup lang="ts">
import type { VitalMetric, VitalsDay } from '@gobernansa/shared/domain/vitals.ts';
import { errorApps } from '@gobernansa/shared/domain/errors.ts';
import { vitalMetrics } from '@gobernansa/shared/domain/vitals.ts';
import { db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import { LnxSelect } from 'lnxjs-components';
import { computed, ref, watch } from 'vue';

/*
 * Rendimiento real (MON-6, docs/fiabilidad.md): of the sampled sessions, the share of good loads, layout shifts and
 * interactions per screen, worst first. One read per app and day
 */

// The most an 'in' takes
const IN_LIMIT = 30;
// Google's: a screen is good when 75 % of its loads are
const GOOD_SHARE = 0.75;
const DAY_MS = 24 * 60 * 60 * 1000;

const days = ref(7);
const dayOptions = [
	{ value: 7, label: 'Últimos 7 días' },
	{ value: 30, label: 'Últimos 30 días' },
];

const loaded = ref<{ app: string; day: VitalsDay }[]>([]);
const loading = ref(false);
const error = ref<string>();

async function load() {
	loading.value = true;
	error.value = undefined;
	try {
		// The days in Spain, as the apps write them
		const ids = Array.from({ length: days.value }, (_, back) => new Date(Date.now() - back * DAY_MS).toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' }))
			.flatMap(day => Object.keys(errorApps).map(app => `${app}_${day}`));
		const chunks = Array.from({ length: Math.ceil(ids.length / IN_LIMIT) }, (_, index) => ids.slice(index * IN_LIMIT, (index + 1) * IN_LIMIT));
		const pages = await Promise.all(chunks.map(async chunk => getDocs(query(collection(db, 'vitals'), where(documentId(), 'in', chunk)))));
		loaded.value = pages.flatMap(page => page.docs.map(snapshot => ({ app: snapshot.id.split('_')[0], day: snapshot.data() as VitalsDay })));
	} catch (e) {
		error.value = (e as Error).message;
	} finally {
		loading.value = false;
	}
}
watch(days, () => load(), { immediate: true });

// Per app, each screen with its count and share of good ones per metric, the worst load first
const apps = computed(() => Object.entries(errorApps).map(([app, label]) => {
	const totals = new Map<string, Record<string, number>>();
	for (const { day } of loaded.value.filter(item => item.app === app)) {
		for (const [screen, bands] of Object.entries(day.screens ?? {})) {
			const total = totals.get(screen) ?? {};
			for (const [band, count] of Object.entries(bands)) {
				total[band] = (total[band] ?? 0) + (count ?? 0);
			}
			totals.set(screen, total);
		}
	}
	const screens = Array.from(totals, ([screen, total]) => ({
		screen,
		metrics: Object.fromEntries((Object.keys(vitalMetrics) as VitalMetric[]).map((metric) => {
			const { bands, good } = vitalMetrics[metric];
			const count = bands.reduce((sum, band) => sum + (total[band] ?? 0), 0);
			return [metric, { count, share: count ? good.reduce((sum, band) => sum + (total[band] ?? 0), 0) / count : undefined }];
		})) as Record<VitalMetric, { count: number; share?: number }>,
	}));
	return {
		app,
		label,
		screens: screens.sort((a, b) => (a.metrics.lcp.share ?? 2) - (b.metrics.lcp.share ?? 2) || b.metrics.lcp.count - a.metrics.lcp.count),
	};
}));

const percent = new Intl.NumberFormat('es', { style: 'percent' });
</script>

<template>
	<p class="hint">
		Medido en una de cada diez sesiones. Una carga es buena hasta 2,5 s, los saltos hasta 0,1 y la respuesta hasta 200 ms; una pantalla va bien si lo son el 75 % de las suyas. Primero las de carga más lenta.
	</p>

	<div class="filters">
		<LnxSelect v-model.convert="days" :options="dayOptions" :convert-fn="option => option.value">
			Periodo
			<template #option="{ option }">
				{{ option.label }}
			</template>
			<template #optionInput="{ value }">
				{{ dayOptions.find(option => option.value === value)?.label }}
			</template>
		</LnxSelect>
	</div>

	<section v-for="item in apps" :key="item.app" class="card" :aria-busy="loading">
		<h2>{{ item.label }}</h2>
		<p v-if="error" class="error" role="alert">
			No se ha podido cargar: {{ error }}
		</p>
		<div v-else-if="loading" class="skeleton-rows">
			<span v-for="width in [70, 50, 80]" :key="width" class="lnx-skeleton" :style="{ width: `${width}%` }" />
		</div>
		<div v-else-if="item.screens.length" class="table lnx-appear">
			<table>
				<thead>
					<tr>
						<th scope="col">
							Pantalla
						</th>
						<th v-for="(metric, key) in vitalMetrics" :key="key" scope="col">
							{{ metric.label }}
						</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="row in item.screens" :key="row.screen">
						<th scope="row">
							{{ row.screen }}
						</th>
						<td v-for="(metric, key) in row.metrics" :key="key">
							<template v-if="metric.share !== undefined">
								<span :class="metric.share >= GOOD_SHARE ? 'is-good' : 'is-poor'">{{ percent.format(metric.share) }}</span>
								<small> de {{ metric.count }}</small>
							</template>
							<small v-else>—</small>
						</td>
					</tr>
				</tbody>
			</table>
		</div>
		<p v-else class="hint">
			Aún no hay medidas en este periodo.
		</p>
	</section>
</template>

<style lang="scss" scoped>
.hint {
	margin-bottom: var(--lnx-spacing-4);
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.filters {
	margin-bottom: var(--lnx-spacing-4);

	> * {
		width: 200px;
		max-width: 100%;
	}
}

.card {
	margin-bottom: var(--lnx-spacing-5);
	padding: var(--lnx-spacing-5);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-4);

	h2 {
		font-size: var(--lnx-font-size-subtitle);
	}
}

.skeleton-rows {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
}

.table {
	overflow-x: auto;
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

	tbody th {
		font-weight: normal;
	}

	small {
		color: var(--color-gray-6);
	}
}

.is-good {
	color: #166534;
	font-weight: var(--lnx-font-weight-bold);
}

.is-poor {
	color: #991b1b;
	font-weight: var(--lnx-font-weight-bold);
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}
</style>
