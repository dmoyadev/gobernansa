<script setup lang="ts">
import { onMounted, onUnmounted, useTemplateRef } from 'vue';

import ChipsSelector from '../components/ChipsSelector.vue';
import IssueItem from '../components/IssueItem.vue';
import TheHeader from '../components/TheHeader.vue';

import {
	issuesCategories,
	issueStatus,
	useIssues,
} from '../composables/useIssues.ts';

import MainLayout from '../layouts/MainLayout.vue';

const {
	issues,
	filters,
	sortingField,
	loading,
	hasMore,
	fetchIssues,
} = useIssues();

const $loadMoreTrigger = useTemplateRef('$loadMoreTrigger');

const observer = new IntersectionObserver(async (entries: IntersectionObserverEntry[]) => {
	const entry = entries[0];
	if (!entry?.isIntersecting || !hasMore.value || loading.value) {
		return;
	}

	await fetchIssues();
}, { rootMargin: '300px' });

onMounted(() => {
	if ($loadMoreTrigger.value) {
		observer.observe($loadMoreTrigger.value);
	}
});

onUnmounted(() => {
	observer.disconnect();
});
</script>

<template>
	<TheHeader>
		<h1>Incidencias</h1>
		<p>Informa de problemas en la comunidad.</p>
	</TheHeader>

	<MainLayout>
		<ChipsSelector
			v-model="filters.status"
			:options="issueStatus"
			css-prefix="issue-status"
			name="status"
		/>

		<ChipsSelector
			v-model="filters.category"
			:options="issuesCategories"
			css-prefix="issue-cat"
			name="category"
		/>

		<ul class="issues">
			<li
				v-for="issue in issues"
				:key="issue.id"
				class="issue"
			>
				<IssueItem :issue />
			</li>

			<li
				v-if="!issues.length && !loading"
				class="empty"
			>
				No hay incidencias que mostrar.
			</li>

			<li
				v-if="loading"
				class="loading"
			>
				Cargando...
			</li>

			<li
				v-if="hasMore"
				ref="$loadMoreTrigger"
				class="load-more-trigger"
				aria-hidden="true"
			/>
		</ul>
	</MainLayout>
</template>

<style lang="scss" scoped>
.issues {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);

	.load-more-trigger {
		height: 1px;
	}

	.loading,
	.empty {
		padding: 1rem;
		text-align: center;
	}
}
</style>
