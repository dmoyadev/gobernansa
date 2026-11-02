<script setup lang="ts">
import type { ErrorGroup } from '@gobernansa/shared/domain/errors.ts';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { errorApps, errorStatus, hasReturned, isUrgent, URGENT_CODES } from '@gobernansa/shared/domain/errors.ts';
import { db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { RELEASE, reportError } from '@gobernansa/shared/infrastructure/monitoring.ts';
import { timeAgo } from '@gobernansa/shared/utils/helpers.ts';
import { collection, collectionGroup, getDocs, limit, orderBy, query, startAfter, Timestamp, where, writeBatch } from 'firebase/firestore';
import { LnxButton, LnxIcon, LnxSelect } from 'lnxjs-components';
import { computed, ref, watch } from 'vue';
import BackButton from '@/app/ux/BackButton.vue';
import { onRevalidate } from '@/app/ux/navigation.ts';
import { toast } from '@/app/ux/toast.ts';
import ErrorGroupDetail from './ErrorGroupDetail.vue';

/*
 * Errores (MON-8, docs/fiabilidad.md): the failures the apps reported, for the team. 25 groups at a time and once, not
 * live, as each report changes its group. Those that need doing something now go first (MON-2)
 */

const PAGE_SIZE = 25;
// What a clean-up removes at most, so it doesn't take the day's quota of deletes
const CLEAN_ROUNDS = 10;
const CLEAN_BATCH = 500;
const STALE_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

const errorsRef = collection(db, 'errors');

// 'all' and not '', which the select doesn't show
const ALL = 'all';
const status = ref('new');
const app = ref(ALL);
const code = ref(ALL);
const release = ref(ALL);

const statusOptions = [
	{ value: 'new', label: 'Pendientes' },
	{ value: 'resolved', label: 'Resueltos' },
	{ value: 'ignored', label: 'Ignorados' },
	{ value: ALL, label: 'Todos' },
];
const appOptions = [
	{ value: ALL, label: 'Las dos' },
	...Object.entries(errorApps).map(([value, label]) => ({ value, label })),
];
const codeOptions = [
	{ value: ALL, label: 'Todos' },
	{ value: 'js', label: 'Errores de código' },
	{ value: 'carga', label: 'Pantallas que no cargan' },
	{ value: 'permission-denied', label: 'Reglas y código no coinciden (permission-denied)' },
	{ value: 'failed-precondition', label: 'Falta un índice (failed-precondition)' },
	{ value: 'resource-exhausted', label: 'Cuota agotada (resource-exhausted)' },
	{ value: 'invalid-argument', label: 'Dato no válido (invalid-argument)' },
	{ value: 'not-found', label: 'No existe (not-found)' },
	{ value: 'unauthenticated', label: 'Sin sesión (unauthenticated)' },
	{ value: 'internal', label: 'Fallo de Firebase (internal)' },
];

const groups = ref<ErrorGroup[]>([]);
// The resolved seen last, loaded with the pending ones to show those that came back, and the urgent ones, so they go first
// even when they're not on the first page
const resolved = ref<ErrorGroup[]>([]);
const urgent = ref<ErrorGroup[]>([]);
const last = ref<QueryDocumentSnapshot>();
const hasMore = ref(false);
const loading = ref(false);
const error = ref<string>();
// Changing a filter while a page loads only keeps the last one asked for
let latestLoad = 0;

// Each filter with the date needs its index (docs/firebase.md); Firestore merges them when there are several
function filters() {
	return [
		...(app.value !== ALL ? [where('app', '==', app.value)] : []),
		...(code.value !== ALL ? [where('code', '==', code.value)] : []),
		...(release.value !== ALL ? [where('firstRelease', '==', release.value)] : []),
	];
}

function toGroup(snapshot: QueryDocumentSnapshot) {
	return { ...snapshot.data(), id: snapshot.id } as ErrorGroup;
}

async function load(more = false) {
	const current = ++latestLoad;
	loading.value = true;
	error.value = undefined;
	try {
		const pending = !more && status.value === 'new';
		const [page, resolvedPage, urgentPage] = await Promise.all([
			getDocs(query(errorsRef, ...(status.value !== ALL ? [where('status', '==', status.value)] : []), ...filters(), orderBy('lastSeen', 'desc'), ...(more && last.value ? [startAfter(last.value)] : []), limit(PAGE_SIZE))),
			// Those that came back are among the resolved seen last
			pending ? getDocs(query(errorsRef, where('status', '==', 'resolved'), ...filters(), orderBy('lastSeen', 'desc'), limit(PAGE_SIZE))) : undefined,
			pending && code.value === ALL ? getDocs(query(errorsRef, where('status', '==', 'new'), where('code', 'in', URGENT_CODES), ...filters(), orderBy('lastSeen', 'desc'), limit(PAGE_SIZE))) : undefined,
		]);
		if (current !== latestLoad) {
			return;
		}
		groups.value = more ? [...groups.value, ...page.docs.map(toGroup)] : page.docs.map(toGroup);
		if (!more) {
			resolved.value = resolvedPage?.docs.map(toGroup) ?? [];
			urgent.value = urgentPage?.docs.map(toGroup) ?? [];
		}
		last.value = page.docs.at(-1) ?? (more ? last.value : undefined);
		hasMore.value = page.size === PAGE_SIZE;
	} catch (e) {
		if (current === latestLoad) {
			error.value = (e as Error).message;
		}
	} finally {
		if (current === latestLoad) {
			loading.value = false;
		}
	}
}
watch([status, app, code, release], () => load(), { immediate: true });
// Coming back reads the first page again
onRevalidate(() => load());

// A group shows with the ones merged into it when they're loaded too, as one: their counts added and the latest time
const shown = computed(() => {
	// A group can be in more than one of the lists
	const all = [...new Map([...resolved.value, ...urgent.value, ...groups.value].map(group => [group.id, group])).values()];
	const ids = new Set(all.map(group => group.id));
	return all
		.filter(group => !group.mergedInto || !ids.has(group.mergedInto))
		.map((group) => {
			const merged = all.filter(other => other.mergedInto === group.id);
			const family = [group, ...merged];
			return {
				...group,
				merged,
				count: family.reduce((total, item) => total + item.count, 0),
				sessions: family.reduce((total, item) => total + item.sessions, 0),
				lastSeen: family.map(item => item.lastSeen).reduce((latest, seen) => (seen?.toMillis() ?? 0) > (latest?.toMillis() ?? 0) ? seen : latest),
				releases: [...new Set(family.flatMap(item => item.releases))].sort(),
				routes: [...new Set(family.flatMap(item => item.routes))],
			};
		})
		// With the pending ones, only the resolved that came back
		.filter(group => status.value !== 'new' || group.status === 'new' || hasReturned(group))
		.sort((a, b) => Number(hasReturned(b)) - Number(hasReturned(a))
			|| Number(isUrgent(b)) - Number(isUrgent(a))
			|| (b.lastSeen?.toMillis() ?? 0) - (a.lastSeen?.toMillis() ?? 0));
});

// The release this admin runs is the last one deployed, and the ones of what's loaded
const releaseOptions = computed(() => [
	{ value: ALL, label: 'Todas' },
	...[...new Set([RELEASE, release.value, ...shown.value.map(group => group.firstRelease)])]
		.filter(value => value && value !== ALL)
		.sort()
		.reverse()
		.map(value => ({ value, label: `Nuevos en ${value}` })),
]);

// What an action changed, without reading them again
function patch(ids: string[], changes: Partial<ErrorGroup>) {
	for (const list of [groups, resolved, urgent]) {
		list.value = list.value.map(group => ids.includes(group.id) ? { ...group, ...changes } : group);
	}
}

const open = ref<string>();
const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });

/*
 * Samples are kept 30 days and groups resolved or ignored are kept until they've gone 180 days without coming back, to
 * know when they do. Removed from here, as Firestore's TTL needs setting up in the console (docs/firebase.md)
 */
const cleaning = ref(false);
async function clean() {
	// eslint-disable-next-line no-alert
	if (!window.confirm(`¿Borrar las muestras de más de 30 días y los errores resueltos o ignorados que llevan ${STALE_DAYS} días sin repetirse? No se puede deshacer.`)) {
		return;
	}

	cleaning.value = true;
	try {
		let samples = 0;
		for (let round = 0; round < CLEAN_ROUNDS; round++) {
			const expired = await getDocs(query(collectionGroup(db, 'samples'), where('expiresAt', '<', Timestamp.now()), limit(CLEAN_BATCH)));
			if (expired.size) {
				const batch = writeBatch(db);
				expired.docs.forEach(sample => batch.delete(sample.ref));
				await batch.commit();
				samples += expired.size;
			}
			if (expired.size < CLEAN_BATCH) {
				break;
			}
		}

		// Their samples expired long before
		const stale = await getDocs(query(errorsRef, where('lastSeen', '<', Timestamp.fromMillis(Date.now() - STALE_DAYS * DAY_MS)), limit(CLEAN_BATCH)));
		const old = stale.docs.filter(group => (group.data() as ErrorGroup).status !== 'new');
		if (old.length) {
			const batch = writeBatch(db);
			old.forEach(group => batch.delete(group.ref));
			await batch.commit();
		}

		toast(samples || old.length ? `Borradas ${samples} ${samples === 1 ? 'muestra' : 'muestras'} y ${old.length} ${old.length === 1 ? 'error antiguo' : 'errores antiguos'}` : 'No había nada caducado');
		if (old.length) {
			void load();
		}
	} catch (e) {
		toast(`No se ha podido limpiar: ${(e as Error).message}`, { tone: 'error' });
		reportError(e, { source: 'action', action: 'No se ha podido limpiar' });
	} finally {
		cleaning.value = false;
	}
}
</script>

<template>
	<header class="page-header">
		<BackButton to="/" label="Volver" />
		<h1>Errores</h1>
		<LnxButton mode="outline" size="small" :is-loading="cleaning" @click="clean()">
			<LnxIcon icon="lucide:eraser" />
			Limpiar caducadas
		</LnxButton>
	</header>

	<p class="hint">
		Los fallos que ven los usuarios de las dos apps, agrupados. Primero los que han vuelto tras resolverlos y los urgentes. Esta versión del admin es la {{ RELEASE }}.
	</p>

	<div class="filters">
		<LnxSelect v-model.convert="status" :options="statusOptions" :convert-fn="option => option.value" search-placeholder-text="Buscar...">
			Estado
			<template #option="{ option }">
				{{ option.label }}
			</template>
			<template #optionInput="{ value }">
				{{ statusOptions.find(option => option.value === value)?.label }}
			</template>
		</LnxSelect>
		<LnxSelect v-model.convert="app" :options="appOptions" :convert-fn="option => option.value" search-placeholder-text="Buscar...">
			App
			<template #option="{ option }">
				{{ option.label }}
			</template>
			<template #optionInput="{ value }">
				{{ appOptions.find(option => option.value === value)?.label }}
			</template>
		</LnxSelect>
		<LnxSelect v-model.convert="code" :options="codeOptions" :convert-fn="option => option.value" search-placeholder-text="Buscar...">
			Tipo
			<template #option="{ option }">
				{{ option.label }}
			</template>
			<template #optionInput="{ value }">
				{{ codeOptions.find(option => option.value === value)?.label }}
			</template>
		</LnxSelect>
		<LnxSelect v-model.convert="release" :options="releaseOptions" :convert-fn="option => option.value" search-placeholder-text="Buscar...">
			Versión
			<template #option="{ option }">
				{{ option.label }}
			</template>
			<template #optionInput="{ value }">
				{{ releaseOptions.find(option => option.value === value)?.label }}
			</template>
		</LnxSelect>
	</div>

	<section class="card" :aria-busy="loading && !shown.length">
		<p v-if="error" class="error" role="alert">
			No se ha podido cargar: {{ error }}
		</p>

		<ul v-if="loading && !shown.length" class="list">
			<li v-for="width in [70, 50, 80, 60]" :key="width" class="group">
				<div class="row">
					<span class="skeleton-item skeleton-item--icon" />
					<div class="what">
						<span class="skeleton-item" :style="{ width: `${width}%` }" />
						<span class="skeleton-item skeleton-item--small" style="width: 40%" />
					</div>
				</div>
			</li>
		</ul>
		<ul v-else-if="shown.length" class="list ux-appear">
			<li v-for="group in shown" :key="group.id" class="group">
				<button type="button" class="row" :aria-expanded="open === group.id" @click="open = open === group.id ? undefined : group.id">
					<span v-if="hasReturned(group)" class="status is-returned">
						<LnxIcon icon="lucide:rotate-ccw" :size="14" />
						Ha vuelto
					</span>
					<span v-else class="status" :class="`is-${group.status}`">
						<LnxIcon :icon="errorStatus[group.status].icon" :size="14" />
						{{ errorStatus[group.status].label }}
					</span>
					<span class="what">
						<strong>{{ group.message || 'Sin mensaje' }}</strong>
						<small>
							{{ errorApps[group.app] }} · {{ group.code }}<template v-if="group.file"> · {{ group.file }}</template>
							<template v-if="group.lastSeen">
								· <time :datetime="group.lastSeen.toDate().toISOString()" :title="dateFormat.format(group.lastSeen.toDate())">{{ timeAgo(group.lastSeen.toDate()) }}</time>
							</template>
							<template v-if="group.merged.length"> · {{ group.merged.length + 1 }} grupos fusionados</template>
						</small>
					</span>
					<span class="counts">
						<span v-if="isUrgent(group) && !hasReturned(group)" class="urgent">
							<LnxIcon icon="lucide:triangle-alert" :size="14" />
							Urgente
						</span>
						<span :title="`${group.sessions} ${group.sessions === 1 ? 'sesión afectada' : 'sesiones afectadas'}`">
							{{ group.count }} {{ group.count === 1 ? 'vez' : 'veces' }}
						</span>
					</span>
				</button>

				<ErrorGroupDetail
					v-if="open === group.id"
					:group="group"
					:candidates="shown.filter(other => other.id !== group.id)"
					:patch="patch"
				/>
			</li>
		</ul>
		<p v-else-if="!error" class="hint">
			{{ status === 'new' ? 'No hay errores pendientes.' : 'No hay errores con estos filtros.' }}
		</p>

		<LnxButton v-if="hasMore" mode="clear" :is-loading="loading" @click="load(true)">
			Cargar más
		</LnxButton>
	</section>
</template>

<style lang="scss" scoped>
.page-header {
	margin-bottom: var(--lnx-spacing-5);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);

	h1 {
		flex: 1;
		font-size: var(--lnx-font-size-title);
	}
}

.hint {
	margin-bottom: var(--lnx-spacing-4);
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.filters {
	margin-bottom: var(--lnx-spacing-4);
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-3);

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
}

.list {
	display: flex;
	flex-direction: column;
}

.group + .group {
	border-top: 1px solid var(--color-gray-3);
}

.row {
	width: calc(100% + 2 * var(--lnx-spacing-2));
	margin: 0 calc(-1 * var(--lnx-spacing-2));
	padding: var(--lnx-spacing-3) var(--lnx-spacing-2);
	border: 0;
	border-radius: var(--lnx-radius-2);
	background: none;
	color: inherit;
	font: inherit;
	text-align: left;
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto;
	align-items: center;
	gap: var(--lnx-spacing-3);
	cursor: pointer;

	&:hover {
		background: var(--color-gray-1);
	}

	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
}

.what {
	display: flex;
	flex-direction: column;
	min-width: 0;

	strong {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	small {
		color: var(--color-gray-6);
		overflow-wrap: anywhere;
	}
}

.counts {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
	color: var(--color-gray-7);
	font-size: var(--lnx-font-size-small);
	white-space: nowrap;
}

.status,
.urgent {
	padding: 2px var(--lnx-spacing-2);
	border-radius: 999px;
	font-size: var(--lnx-font-size-legal);
	font-weight: var(--lnx-font-weight-bold);
	white-space: nowrap;
	display: inline-flex;
	align-items: center;
	gap: var(--lnx-spacing-1);
}

.status {
	&.is-new {
		background: #fef3c7;
		color: #92400e;
	}

	&.is-resolved {
		background: #dcfce7;
		color: #166534;
	}

	&.is-ignored {
		background: var(--color-gray-2);
		color: var(--color-gray-7);
	}

	&.is-returned {
		background: #fee2e2;
		color: #991b1b;
	}
}

.urgent {
	background: #fee2e2;
	color: #991b1b;
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}

@media (max-width: 640px) {
	.row {
		grid-template-columns: auto minmax(0, 1fr);

		.counts {
			grid-column: 2;
			justify-self: start;
		}
	}
}
</style>
