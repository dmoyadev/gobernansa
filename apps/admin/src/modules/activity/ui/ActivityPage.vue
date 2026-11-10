<script setup lang="ts">
import type { Activity, ActivityArea } from '@gobernansa/shared/domain/activity.ts';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { activityAreas } from '@gobernansa/shared/domain/activity.ts';
import { db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { timeAgo } from '@gobernansa/shared/utils/helpers.ts';
import { collection, endBefore, getDocs, limit, orderBy, query, startAfter } from 'firebase/firestore';
import { LnxButton, LnxIcon, LnxRadioGroup } from 'lnxjs-components';
import { computed, ref } from 'vue';
import BackButton from '@/app/ux/BackButton.vue';
import { onRevalidate } from '@/app/ux/navigation.ts';

const props = defineProps<{ id: string }>();

const PAGE_SIZE = 30;

const activityRef = collection(db, 'communities', props.id, 'activity');

// Read a page at a time and once, not live: each page added later only reads its own entries
const entries = ref<Activity[]>([]);
const first = ref<QueryDocumentSnapshot>();
const last = ref<QueryDocumentSnapshot>();
const hasMore = ref(false);
const loading = ref(false);
const error = ref<Error>();

async function loadMore() {
	loading.value = true;
	error.value = undefined;
	try {
		const snapshot = await getDocs(query(activityRef, orderBy('at', 'desc'), ...(last.value ? [startAfter(last.value)] : []), limit(PAGE_SIZE)));
		entries.value.push(...snapshot.docs.map(entry => ({ ...entry.data(), id: entry.id }) as Activity));
		first.value ??= snapshot.docs[0];
		last.value = snapshot.docs.at(-1);
		hasMore.value = snapshot.size === PAGE_SIZE;
	} catch (e) {
		error.value = e as Error;
	} finally {
		loading.value = false;
	}
}
loadMore();

// Coming back keeps what was loaded and only reads what happened since, on top. A page at most: after a long
// while away it starts over from the newest instead of reading everything in between
async function loadNewer() {
	if (loading.value) {
		return;
	}
	if (!first.value) {
		return loadMore();
	}
	try {
		const snapshot = await getDocs(query(activityRef, orderBy('at', 'desc'), endBefore(first.value), limit(PAGE_SIZE)));
		if (snapshot.size === PAGE_SIZE) {
			entries.value = [];
			first.value = undefined;
			last.value = undefined;
			return await loadMore();
		}
		if (snapshot.size) {
			entries.value.unshift(...snapshot.docs.map(entry => ({ ...entry.data(), id: entry.id }) as Activity));
			first.value = snapshot.docs[0];
		}
	} catch (e) {
		error.value = e as Error;
	}
}
onRevalidate(loadNewer);
const ROW_WIDTHS = [70, 50, 80, 60, 45];

// Filtered here, among the loaded ones, so it needs no index
const areaFilter = ref<ActivityArea | ''>('');
const areaOptions = computed(() => (Object.keys(activityAreas) as ActivityArea[]).filter(area => entries.value.some(entry => entry.area === area)).map(area => ({ value: area, ...activityAreas[area] })));
const visibleEntries = computed(() => entries.value.filter(entry => !areaFilter.value || entry.area === areaFilter.value));

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'full', timeStyle: 'short' });
</script>

<template>
	<header class="page-header">
		<BackButton :to="`/communities/${id}`" label="Volver a la comunidad" />
		<h1>Registro de actividad</h1>
	</header>

	<section class="card" :aria-busy="loading && !entries.length">
		<LnxRadioGroup
			v-if="areaOptions.length > 1"
			v-model="areaFilter"
			:options="[{ value: '', label: 'Todo' }, ...areaOptions]"
			hide-legend
		>
			Filtrar por área
		</LnxRadioGroup>

		<p v-if="error" class="error" role="alert">
			No se ha podido cargar: {{ error.message }}
		</p>

		<ul v-if="loading && !entries.length" class="list">
			<li v-for="width in ROW_WIDTHS" :key="width" class="entry">
				<span class="lnx-skeleton lnx-skeleton--circle" />
				<div class="what">
					<span class="lnx-skeleton" :style="{ width: `${width}%` }" />
					<span class="lnx-skeleton lnx-skeleton--small" style="width: 30%" />
				</div>
			</li>
		</ul>
		<TransitionGroup v-else-if="visibleEntries.length" tag="ul" name="row" class="list lnx-appear">
			<li v-for="entry in visibleEntries" :key="entry.id" class="entry" :class="{ 'ux-row': entry.link }">
				<LnxIcon :icon="activityAreas[entry.area]?.icon ?? 'lucide:history'" :title="activityAreas[entry.area]?.label" />
				<div class="what">
					<RouterLink v-if="entry.link" :to="entry.link">
						{{ entry.summary }}
					</RouterLink>
					<span v-else>{{ entry.summary }}</span>
					<small>
						{{ entry.byName }}
						<!-- Pending writes have no server date yet -->
						<template v-if="entry.at">
							· <time :datetime="entry.at.toDate().toISOString()" :title="dateFormat.format(entry.at.toDate())">{{ timeAgo(entry.at.toDate()) }}</time>
						</template>
					</small>
				</div>
			</li>
		</TransitionGroup>
		<p v-else class="hint">
			{{ entries.length ? 'Nada de esa área entre lo cargado.' : 'Aún no hay actividad.' }}
		</p>

		<LnxButton v-if="hasMore" mode="clear" :is-loading="loading" @click="loadMore()">
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
		font-size: var(--lnx-font-size-title);
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

.hint {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.list {
	position: relative;
	display: flex;
	flex-direction: column;
}

.row-move,
.row-enter-active,
.row-leave-active {
	transition: opacity var(--duration) var(--ease-out), translate var(--duration) var(--ease-out);
}

.row-enter-from,
.row-leave-to {
	opacity: 0;
	translate: 0 4px;
}

// Out of the flow while it leaves, so the rest move up at once
.row-leave-active {
	position: absolute;
	width: 100%;
}

.entry {
	margin: 0 calc(-1 * var(--lnx-spacing-2));
	padding: var(--lnx-spacing-3) var(--lnx-spacing-2);
	border-radius: var(--lnx-radius-2);
	position: relative;
	display: grid;
	grid-template-columns: auto minmax(0, 1fr);
	align-items: start;
	gap: var(--lnx-spacing-3);

	& + & {
		border-top: 1px solid var(--color-gray-3);
	}
}

.what {
	display: flex;
	flex-direction: column;
	min-width: 0;

	a {
		color: inherit;

		// The whole row opens it
		&::after {
			content: '';
			position: absolute;
			inset: 0;
			border-radius: inherit;
		}
	}

	small {
		color: var(--color-gray-6);
	}
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}
</style>
