<script setup lang="ts">
import type { Workspace } from './workspaces.ts';
import { LnxTabs } from 'lnxjs-components';
import { computed } from 'vue';
import { useRoute } from 'vue-router';

// The pages of a section with more than one, as tabs above the page. Not on detail pages, they go back to theirs
const props = defineProps<{ workspace: Workspace; page: string }>();
const route = useRoute();

const base = computed(() => `/communities/${route.params.id as string}`);
const section = computed(() => route.path === `${base.value}/${props.page}` ? props.workspace.sectionOf.get(props.page) : undefined);
const tabs = computed(() => section.value?.pages.map(item => ({ value: item.key, label: item.title, to: `${base.value}/${item.key}` })) ?? []);
</script>

<template>
	<LnxTabs v-if="tabs.length > 1" class="workspace-tabs" :tabs="tabs" :aria-label="section!.title" />
</template>

<style lang="scss" scoped>
.workspace-tabs {
	margin-bottom: var(--lnx-spacing-5);
	// Fading at the end when it doesn't fit, so it shows there's more
	mask-image: linear-gradient(to right, #000 85%, transparent);
}

// Still while moving between its own tabs; between sections it goes with the page
:global(html[data-workspace-move="forward"]) .workspace-tabs,
:global(html[data-workspace-move="back"]) .workspace-tabs {
	view-transition-name: workspace-tabs;
}

@media print {
	.workspace-tabs {
		display: none;
	}
}
</style>
