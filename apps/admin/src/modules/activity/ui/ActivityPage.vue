<script setup lang="ts">
import type { Activity, ActivityArea } from '@gobernansa/shared/domain/activity.ts';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { activityAreas } from '@gobernansa/shared/domain/activity.ts';
import { db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { timeAgo } from '@gobernansa/shared/utils/helpers.ts';
import { collection, getDocs, limit, orderBy, query, startAfter } from 'firebase/firestore';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed, ref } from 'vue';

const props = defineProps<{ id: string }>();

const PAGE_SIZE = 30;

const activityRef = collection(db, 'communities', props.id, 'activity');

// Read a page at a time and once, not live: each page added later only reads its own entries
const entries = ref<Activity[]>([]);
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
		last.value = snapshot.docs.at(-1);
		hasMore.value = snapshot.size === PAGE_SIZE;
	} catch (e) {
		error.value = e as Error;
	} finally {
		loading.value = false;
	}
}
loadMore();

// Filtered here, among the loaded ones, so it needs no index
const areaFilter = ref<ActivityArea | ''>('');
const areaOptions = computed(() => (Object.keys(activityAreas) as ActivityArea[]).filter(area => entries.value.some(entry => entry.area === area)));
const visibleEntries = computed(() => entries.value.filter(entry => !areaFilter.value || entry.area === areaFilter.value));

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'full', timeStyle: 'short' });
</script>

<template>
	<header class="page-header">
		<LnxButton :to="`/communities/${id}`" mode="clear" shape="circle" aria-label="Volver a la comunidad">
			<LnxIcon icon="lucide:arrow-left" />
		</LnxButton>
		<h1>Registro de actividad</h1>
	</header>

	<section class="card">
		<fieldset v-if="areaOptions.length > 1" class="chips">
			<legend class="sr-only">
				Filtrar por área
			</legend>
			<label>
				<input v-model="areaFilter" type="radio" class="sr-only" value="">
				<span>Todo</span>
			</label>
			<label v-for="area in areaOptions" :key="area">
				<input v-model="areaFilter" type="radio" class="sr-only" :value="area">
				<span><LnxIcon :icon="activityAreas[area].icon" />{{ activityAreas[area].label }}</span>
			</label>
		</fieldset>

		<p v-if="error" class="error" role="alert">
			No se ha podido cargar: {{ error.message }}
		</p>

		<ul v-if="visibleEntries.length" class="list">
			<li v-for="entry in visibleEntries" :key="entry.id" class="entry">
				<LnxIcon :icon="activityAreas[entry.area]?.icon ?? 'lucide:history'" />
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
		</ul>
		<span v-else-if="loading" class="skeleton-item" />
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
	display: flex;
	flex-direction: column;
}

.entry {
	padding: var(--lnx-spacing-3) 0;
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
	}

	small {
		color: var(--color-gray-6);
	}
}

.chips {
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-1);

	span {
		display: inline-flex;
		align-items: center;
		gap: var(--lnx-spacing-1);
		min-height: 36px;
		padding: 0 var(--lnx-spacing-3);
		border: 1px solid var(--color-gray-4);
		border-radius: var(--lnx-radius-2);
		background: var(--color-gray-0);
		color: var(--color-gray-7);
		font-size: var(--lnx-font-size-small);
		cursor: pointer;
	}

	input:checked + span {
		border-color: var(--color-primary);
		background: var(--color-primary);
		color: var(--color-primary-accent);
	}

	input:focus-visible + span {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}
</style>
