<script setup lang="ts">
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import type { Ref } from 'vue';
import type { Change, ChangeOp } from '../domain/history.ts';
import { errorApps } from '@gobernansa/shared/domain/errors.ts';
import { timeAgo } from '@gobernansa/shared/utils/helpers.ts';
import { LnxButton, LnxIcon, LnxSelect } from 'lnxjs-components';
import { computed, ref, shallowRef, watch } from 'vue';
import BackButton from '@/app/ux/BackButton.vue';
import { onRevalidate } from '@/app/ux/navigation.ts';
import { useCommunities } from '@/modules/communities/application/useCommunities.ts';
import { ALL, loadActions, loadChanges } from '../application/history.ts';
import { hasFunctions } from '../application/restoreVersion.ts';
import { actionTypes, changeAuthor, changeOps, changeTitle, collections } from '../domain/history.ts';
import ChangeDetail from './ChangeDetail.vue';

// Historial, for the team: every change to the data and everything each user did (application/history.ts)

const tab = ref<'changes' | 'actions'>('changes');
const community = ref(ALL);
const collectionId = ref(ALL);
const op = ref(ALL);
const type = ref(ALL);
const app = ref(ALL);
// Picked by clicking someone: both tabs show only theirs
const person = ref<{ id: string; name: string }>();
// Every change to one document, whatever the other filters say
const versionsOf = ref<string>();

const { communities, archived } = useCommunities();
const communityNames = computed(() => new Map([...communities.value, ...archived.value].map(item => [item.id, item.name])));

const communityOptions = computed(() => [
	{ value: ALL, label: 'Todas' },
	...[...communities.value, ...archived.value].map(item => ({ value: item.id, label: item.name || item.id })),
]);
const collectionOptions = [
	{ value: ALL, label: 'Todas' },
	...Object.entries(collections).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'es')),
];
const opOptions = [
	{ value: ALL, label: 'Todas' },
	...Object.entries(changeOps).map(([value, { filter }]) => ({ value, label: filter })),
];
const typeOptions = [
	{ value: ALL, label: 'Todas' },
	...Object.entries(actionTypes).map(([value, { label }]) => ({ value, label })),
];
const appOptions = [
	{ value: ALL, label: 'Las dos' },
	...Object.entries(errorApps).map(([value, label]) => ({ value, label })),
];

// A list read a page at a time; changing a filter while one loads only keeps the last one asked for
function pages<T>(read: (after?: QueryDocumentSnapshot) => Promise<{ items: T[]; last?: QueryDocumentSnapshot; more: boolean }>) {
	const items = ref([]) as Ref<T[]>;
	const last = shallowRef<QueryDocumentSnapshot>();
	const hasMore = ref(false);
	const loading = ref(false);
	const error = ref<string>();
	let latest = 0;

	async function load(more = false) {
		const current = ++latest;
		loading.value = true;
		error.value = undefined;
		try {
			const page = await read(more ? last.value : undefined);
			if (current !== latest) {
				return;
			}
			items.value = more ? [...items.value, ...page.items] : page.items;
			last.value = page.last ?? (more ? last.value : undefined);
			hasMore.value = page.more;
		} catch (e) {
			if (current === latest) {
				error.value = (e as Error).message;
			}
		} finally {
			if (current === latest) {
				loading.value = false;
			}
		}
	}

	return { items, hasMore, loading, error, load };
}

const changes = pages(async after => loadChanges({ community: community.value, collection: collectionId.value, op: op.value, person: person.value?.id, path: versionsOf.value }, after));
const actions = pages(async after => loadActions({ person: person.value?.id, type: type.value, app: app.value }, after));
const current = computed(() => tab.value === 'changes' ? changes : actions);

watch([tab, community, collectionId, op, type, app, person, versionsOf], () => current.value.load(), { immediate: true });
// Coming back reads the first page again
onRevalidate(() => current.value.load());

const open = ref<string>();

function filterBy(id: string | null | undefined, name: string) {
	if (id) {
		person.value = { id, name };
	}
}

function showVersions(path: string) {
	versionsOf.value = path;
	tab.value = 'changes';
	open.value = undefined;
}

function place(change: Change) {
	const name = change.communityId && communityNames.value.get(change.communityId);
	return [name, change.path].filter(Boolean).join(' · ');
}

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'full', timeStyle: 'short' });
</script>

<template>
	<header class="page-header">
		<BackButton to="/" label="Volver" />
		<h1>Historial</h1>
		<LnxButton mode="outline" class="lnx-size-small" :is-loading="current.loading.value" @click="current.load()">
			<LnxIcon icon="lucide:refresh-cw" />
			Actualizar
		</LnxButton>
	</header>

	<p class="hint">
		Cada cambio en los datos, con cómo estaba y cómo quedó, y lo que ha hecho cada usuario en las dos apps. Lo más reciente primero.
	</p>
	<p class="hint">
		Cada entrada se borra al cumplir su plazo, y con ella la versión que se podía restaurar: los cambios, a los 90 días, o al
		acabar el año siguiente los de recibos, cuentas, juntas y propiedades; las pantallas, a los 90 días, o a los 12 meses las
		de una persona o un inmueble; entradas, descargas y demás, a los 12 meses; lo del equipo, a los 3 años.
	</p>
	<p v-if="!hasFunctions" class="hint" role="status">
		En la demo local no corren las funciones de Firebase: los cambios no se registran ni se pueden restaurar. Las acciones sí.
	</p>

	<div class="tabs" role="tablist" aria-label="Vista">
		<button type="button" role="tab" :aria-selected="tab === 'changes'" @click="tab = 'changes'">
			Cambios
		</button>
		<button type="button" role="tab" :aria-selected="tab === 'actions'" @click="tab = 'actions'">
			Acciones
		</button>
	</div>

	<div v-if="person || (versionsOf && tab === 'changes')" class="chips">
		<!-- A document's versions are all of them, whoever made them -->
		<span v-if="person && !(versionsOf && tab === 'changes')" class="chip">
			Solo de {{ person.name }}
			<button type="button" :aria-label="`Quitar el filtro de ${person.name}`" title="Quitar el filtro" @click="person = undefined">
				<LnxIcon icon="lucide:x" :size="14" />
			</button>
		</span>
		<span v-if="versionsOf && tab === 'changes'" class="chip">
			Versiones de {{ versionsOf }}
			<button type="button" aria-label="Volver a todos los cambios" title="Volver a todos los cambios" @click="versionsOf = undefined">
				<LnxIcon icon="lucide:x" :size="14" />
			</button>
		</span>
	</div>

	<div v-if="tab === 'changes' && !versionsOf" class="filters">
		<LnxSelect v-model.convert="community" :options="communityOptions" :convert-fn="option => option.value">
			Comunidad
			<template #option="{ option }">
				{{ option.label }}
			</template>
			<template #optionInput="{ value }">
				{{ communityOptions.find(option => option.value === value)?.label }}
			</template>
		</LnxSelect>
		<LnxSelect v-model.convert="collectionId" :options="collectionOptions" :convert-fn="option => option.value">
			Qué
			<template #option="{ option }">
				{{ option.label }}
			</template>
			<template #optionInput="{ value }">
				{{ collectionOptions.find(option => option.value === value)?.label }}
			</template>
		</LnxSelect>
		<LnxSelect v-model.convert="op" :options="opOptions" :convert-fn="option => option.value">
			Operación
			<template #option="{ option }">
				{{ option.label }}
			</template>
			<template #optionInput="{ value }">
				{{ opOptions.find(option => option.value === value)?.label }}
			</template>
		</LnxSelect>
	</div>
	<div v-else-if="tab === 'actions'" class="filters">
		<LnxSelect v-model.convert="type" :options="typeOptions" :convert-fn="option => option.value">
			Acción
			<template #option="{ option }">
				{{ option.label }}
			</template>
			<template #optionInput="{ value }">
				{{ typeOptions.find(option => option.value === value)?.label }}
			</template>
		</LnxSelect>
		<LnxSelect v-model.convert="app" :options="appOptions" :convert-fn="option => option.value">
			App
			<template #option="{ option }">
				{{ option.label }}
			</template>
			<template #optionInput="{ value }">
				{{ appOptions.find(option => option.value === value)?.label }}
			</template>
		</LnxSelect>
	</div>

	<section class="card" :aria-busy="current.loading.value && !current.items.value.length">
		<p v-if="current.error.value" class="error" role="alert">
			No se ha podido cargar: {{ current.error.value }}
		</p>

		<ul v-if="current.loading.value && !current.items.value.length" class="list">
			<li v-for="width in [70, 50, 80, 60]" :key="width" class="entry">
				<span class="lnx-skeleton lnx-skeleton--circle" />
				<div class="what">
					<span class="lnx-skeleton" :style="{ width: `${width}%` }" />
					<span class="lnx-skeleton lnx-skeleton--small" style="width: 40%" />
				</div>
			</li>
		</ul>

		<ul v-else-if="tab === 'changes' && changes.items.value.length" class="list lnx-appear">
			<li v-for="change in changes.items.value" :key="change.id" class="entry">
				<span class="op" :class="`is-${change.op}`" :title="changeOps[change.op as ChangeOp].label">
					<LnxIcon :icon="changeOps[change.op as ChangeOp].icon" :size="16" />
					<span class="sr-only">{{ changeOps[change.op as ChangeOp].label }}</span>
				</span>
				<div class="what">
					<button type="button" class="toggle" :aria-expanded="open === change.id" @click="open = open === change.id ? undefined : change.id">
						<strong>{{ collections[change.collection] ?? change.collection }} · {{ changeTitle(change) }}</strong>
						<small v-if="change.op === 'update'">{{ change.changed.join(', ') }}</small>
					</button>
					<small>
						<button v-if="change.actorId" type="button" class="person" :title="`Ver solo lo de ${changeAuthor(change)}`" @click="filterBy(change.actorId, changeAuthor(change))">{{ changeAuthor(change) }}</button>
						<template v-else>{{ changeAuthor(change) }}</template>
						· <time :datetime="change.at.toDate().toISOString()" :title="dateFormat.format(change.at.toDate())">{{ timeAgo(change.at.toDate()) }}</time>
						· {{ place(change) }}
					</small>
					<ChangeDetail v-if="open === change.id" :change="change" @versions="showVersions" />
				</div>
			</li>
		</ul>

		<ul v-else-if="tab === 'actions' && actions.items.value.length" class="list lnx-appear">
			<li v-for="action in actions.items.value" :key="action.id" class="entry">
				<span class="op">
					<LnxIcon :icon="actionTypes[action.type]?.icon ?? 'lucide:mouse-pointer-click'" :size="16" />
				</span>
				<div class="what">
					<span class="title">
						<strong>{{ actionTypes[action.type]?.label ?? action.type }}</strong>
						<template v-if="action.detail || action.path"> · {{ action.detail || action.path }}</template>
					</span>
					<small>
						<button type="button" class="person" :title="`Ver solo lo de ${action.name || action.email || action.uid}`" @click="filterBy(action.uid, action.name || action.email || action.uid)">{{ action.name || action.email || action.uid }}</button>
						<template v-if="action.at">
							· <time :datetime="action.at.toDate().toISOString()" :title="dateFormat.format(action.at.toDate())">{{ timeAgo(action.at.toDate()) }}</time>
						</template>
						· {{ errorApps[action.app] ?? action.app }}
						<template v-if="action.communityId"> · {{ communityNames.get(action.communityId) || action.communityId }}</template>
						<template v-if="action.viewAs"> · viendo como vecino</template>
						<template v-if="action.detail && action.path"> · {{ action.path }}</template>
						<template v-if="action.device"> · {{ action.device }}</template>
					</small>
				</div>
			</li>
		</ul>

		<p v-else-if="!current.error.value" class="hint">
			{{ tab === 'changes' ? 'No hay cambios con estos filtros.' : 'No hay acciones con estos filtros.' }}
		</p>

		<LnxButton v-if="current.hasMore.value" mode="clear" :is-loading="current.loading.value" @click="current.load(true)">
			Cargar más
		</LnxButton>
	</section>
</template>

<style lang="scss" scoped>
.hint {
	margin-bottom: var(--lnx-spacing-4);
}

.tabs {
	margin-bottom: var(--lnx-spacing-4);
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-1);

	button {
		padding: var(--lnx-spacing-1) var(--lnx-spacing-3);
		border: 1px solid var(--color-gray-3);
		border-radius: 999px;
		background: var(--color-gray-0);
		font: inherit;
		font-size: var(--lnx-font-size-small);
		color: var(--color-gray-7);
		cursor: pointer;

		&[aria-selected='true'] {
			border-color: var(--color-primary);
			color: var(--color-primary);
			font-weight: var(--lnx-font-weight-bold);
		}
	}
}

.chips {
	margin-bottom: var(--lnx-spacing-4);
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-2);
}

.chip {
	padding: 2px 2px 2px var(--lnx-spacing-3);
	border-radius: 999px;
	background: var(--color-gray-2);
	font-size: var(--lnx-font-size-small);
	overflow-wrap: anywhere;
	display: inline-flex;
	align-items: center;
	gap: var(--lnx-spacing-1);

	button {
		padding: var(--lnx-spacing-1);
		border: 0;
		border-radius: 999px;
		background: none;
		color: inherit;
		display: inline-flex;
		cursor: pointer;

		&:hover {
			background: var(--color-gray-3);
		}
	}
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
}

.list {
	display: flex;
	flex-direction: column;
}

.entry {
	padding: var(--lnx-spacing-3) 0;
	display: grid;
	grid-template-columns: auto minmax(0, 1fr);
	align-items: start;
	gap: var(--lnx-spacing-3);

	+ .entry {
		border-top: 1px solid var(--color-gray-3);
	}
}

.op {
	width: 28px;
	height: 28px;
	border-radius: 999px;
	background: var(--color-gray-2);
	color: var(--color-gray-7);
	display: inline-flex;
	align-items: center;
	justify-content: center;

	&.is-create {
		background: #dcfce7;
		color: #166534;
	}

	&.is-update {
		background: #fef3c7;
		color: #92400e;
	}

	&.is-delete {
		background: #fee2e2;
		color: #991b1b;
	}
}

.what {
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 2px;

	> small {
		color: var(--color-gray-6);
		overflow-wrap: anywhere;
	}
}

.toggle {
	margin: 0 calc(-1 * var(--lnx-spacing-2));
	padding: var(--lnx-spacing-1) var(--lnx-spacing-2);
	border: 0;
	border-radius: var(--lnx-radius-2);
	background: none;
	color: inherit;
	font: inherit;
	text-align: left;
	display: flex;
	flex-direction: column;
	cursor: pointer;

	&:hover {
		background: var(--color-gray-1);
	}

	small {
		color: var(--color-gray-6);
		overflow-wrap: anywhere;
	}
}

.toggle,
.title {
	strong {
		overflow-wrap: anywhere;
	}
}

.person {
	padding: 0;
	border: 0;
	background: none;
	color: var(--color-primary);
	font: inherit;
	text-decoration: underline;
	cursor: pointer;
}

.toggle,
.person {
	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
}
</style>
