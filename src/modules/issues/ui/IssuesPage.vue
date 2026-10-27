<script setup lang="ts">
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed, onMounted, onUnmounted, useTemplateRef } from 'vue';

import MainLayout from '@/shared/ui/MainLayout.vue';
import TheHeader from '@/shared/ui/TheHeader.vue';

import { useIssues } from '../application/useIssues.ts';
import IssueItem from './IssueItem.vue';
import IssuesFilters from './IssuesFilters.vue';

const {
	issues,
	filters,
	loading,
	hasMore,
	fetchIssues,
} = useIssues();

const hasFilters = computed(() => !!(filters.value.status || filters.value.category));

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
		<IssuesFilters
			v-model:status="filters.status"
			v-model:category="filters.category"
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
				<LnxIcon :icon="hasFilters ? 'lucide:search-x' : 'lucide:party-popper'" :size="32" />
				<h3>{{ hasFilters ? 'Nada por aquí' : 'Todo en orden' }}</h3>
				<p>
					{{ hasFilters
						? 'No hay incidencias con estos filtros.'
						: 'No hay incidencias en tu comunidad. Si ves algo que no va bien, avísanos.' }}
				</p>
				<LnxButton
					v-if="hasFilters"
					mode="clear"
					@click="filters = {}"
				>
					Quitar filtros
				</LnxButton>
				<LnxButton
					v-else
					variant="danger"
					to="/issues/new"
				>
					<LnxIcon icon="lucide:circle-alert" />
					Dar aviso
				</LnxButton>
			</li>

			<template v-if="loading">
				<li
					v-for="n in (issues.length ? 1 : 3)"
					:key="`skeleton-${n}`"
					class="skeleton"
					aria-hidden="true"
				>
					<span class="row">
						<span class="skeleton-item thumb" />
						<span class="skeleton-item skeleton-item--title" />
					</span>
					<span class="skeleton-item skeleton-item--small" />
				</li>
			</template>

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

	.skeleton {
		border: 1px solid var(--color-gray-3);
		border-radius: var(--lnx-radius-3);
		background: var(--color-gray-0);
		padding: var(--lnx-spacing-3);
		display: flex;
		flex-direction: column;
		gap: var(--lnx-spacing-3);

		.row {
			display: flex;
			align-items: center;
			gap: var(--lnx-spacing-3);
		}

		.thumb {
			width: 64px;
			height: 64px;
			flex-shrink: 0;
			border-radius: var(--lnx-radius-3);
		}
	}

	.empty {
		padding: var(--lnx-spacing-8) var(--lnx-spacing-4);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--lnx-spacing-2);
		text-align: center;
		color: var(--color-gray-6);

		h3 {
			color: var(--color-gray-8);
		}
	}
}
</style>
