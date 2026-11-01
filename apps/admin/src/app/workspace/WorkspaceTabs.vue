<script setup lang="ts">
import type { Workspace } from './workspaces.ts';
import { computed } from 'vue';
import { useRoute } from 'vue-router';

// The pages of a section with more than one, as tabs above the page. Not on detail pages, they go back to theirs
const props = defineProps<{ workspace: Workspace; page: string }>();
const route = useRoute();

const base = computed(() => `/communities/${route.params.id as string}`);
const section = computed(() => route.path === `${base.value}/${props.page}` ? props.workspace.sectionOf.get(props.page) : undefined);
</script>

<template>
	<nav v-if="section && section.pages.length > 1" class="workspace-tabs" :aria-label="section.title">
		<RouterLink v-for="item in section.pages" :key="item.key" :to="`${base}/${item.key}`" :aria-current="item.key === page ? 'page' : undefined">
			{{ item.title }}
		</RouterLink>
	</nav>
</template>

<style lang="scss" scoped>
.workspace-tabs {
	margin-bottom: var(--lnx-spacing-5);
	overflow-x: auto;
	display: flex;
	gap: var(--lnx-spacing-1);
	box-shadow: inset 0 -1px 0 var(--color-gray-3);
	scrollbar-width: none;
	// Fading at the end when it doesn't fit, so it shows there's more
	mask-image: linear-gradient(to right, #000 85%, transparent);
}

// Still while moving between its own tabs; between sections it goes with the page
:global(html[data-workspace-move="forward"]) .workspace-tabs,
:global(html[data-workspace-move="back"]) .workspace-tabs {
	view-transition-name: workspace-tabs;
}

a {
	flex-shrink: 0;
	padding: var(--lnx-spacing-2) var(--lnx-spacing-3);
	color: var(--color-gray-7);
	font-size: var(--lnx-font-size-small);
	white-space: nowrap;
	text-decoration: none;
	box-shadow: inset 0 -2px 0 transparent;

	&:hover {
		color: var(--color-gray-9);
	}

	&[aria-current] {
		color: var(--color-primary);
		font-weight: var(--lnx-font-weight-bold);
		box-shadow: inset 0 -2px 0 var(--color-primary);
	}
}

@media print {
	.workspace-tabs {
		display: none;
	}
}
</style>
