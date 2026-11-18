<script setup lang="ts">
import type { IssueCategory } from '@gobernansa/shared/domain/issue.ts';
import type { LayoutItem, Widget } from '../application/dashboardWidgets.ts';
import type { DashboardData, DashboardSource } from '../application/useCommunityDashboard.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { LnxIcon } from 'lnxjs-components';
import { computed, onActivated, ref, shallowReactive, watch } from 'vue';
import { onRevalidate, remember } from '@/app/ux/navigation.ts';
import { toLayout, useDashboardFigures, widgetsByKey } from '../application/dashboardWidgets.ts';
import { dashboardSources } from '../application/useCommunityDashboard.ts';
import DashboardCustomizer from './DashboardCustomizer.vue';
import DashboardWidgetBody from './DashboardWidgetBody.vue';

// The community's categories, the defaults until it has loaded
const props = defineProps<{ communityId: string; categories?: IssueCategory[] }>();

const { user } = useAuth();
const storageKey = computed(() => `gobernansa.admin.dashboard.${user.value?.id ?? ''}`);

// Per admin and the same for every community
// ponytail: per browser, move it to the user profile to follow the admin between devices
function loadLayout(): LayoutItem[] {
	let saved: unknown;
	try {
		saved = JSON.parse(localStorage.getItem(storageKey.value) ?? 'null');
	} catch {
		// Blocked storage or a broken value, the default layout then
	}
	return toLayout(saved);
}

const layout = ref(loadLayout());
// The profile may arrive after the page
watch(storageKey, () => layout.value = loadLayout());
// The same for every community, so another kept page may have changed it meanwhile
onActivated(() => layout.value = loadLayout());
watch(layout, (value) => {
	try {
		localStorage.setItem(storageKey.value, JSON.stringify(value));
	} catch {
		// The layout just won't be remembered
	}
}, { deep: true });

const widgets = computed(() => layout.value.filter(item => !item.hidden).map(item => widgetsByKey.get(item.key)!));

/* Data, read once and only for the widgets shown */
const sources = dashboardSources(props.communityId);
const data = shallowReactive<DashboardData>({});
const failed = shallowReactive(new Set<DashboardSource>());
const requested = new Set<DashboardSource>();

function load(source: DashboardSource) {
	// Kept a few minutes, so going into a section and back doesn't read every widget again
	remember(`dashboard:${props.communityId}:${source}`, sources[source] as () => Promise<unknown>).then(
		(value) => {
			(data as Record<DashboardSource, unknown>)[source] = value;
			failed.delete(source);
		},
		// Its widgets say so, the rest still show. A failed reread keeps what was shown
		() => {
			if (!data[source]) {
				failed.add(source);
			}
		},
	);
}

watch(widgets, (shown) => {
	for (const source of new Set(shown.flatMap(widget => widget.sources))) {
		if (!requested.has(source)) {
			requested.add(source);
			load(source);
		}
	}
}, { immediate: true });

// Coming back to the community, the figures are read again while the last ones stay
onRevalidate(() => requested.forEach(load));

function state(widget: Widget) {
	return widget.sources.some(source => failed.has(source)) ? 'failed' : widget.sources.every(source => data[source]) ? 'ready' : 'loading';
}

// Worked out once for all the widgets
const figures = useDashboardFigures(data, () => props.categories);

const customizer = ref<InstanceType<typeof DashboardCustomizer>>();
defineExpose({ customize: () => customizer.value?.open() });
</script>

<template>
	<TransitionGroup v-if="widgets.length" tag="ul" name="widget" class="dashboard" aria-label="Resumen de la comunidad">
		<li v-for="widget in widgets" :key="widget.key" :class="[`size-${widget.size}`, widget.key]" :aria-busy="state(widget) === 'loading'">
			<header>
				<LnxIcon :icon="widget.icon" :size="16" aria-hidden="true" />
				<h2>
					<RouterLink class="stretched" :to="`/communities/${communityId}/${widget.to}`">
						{{ widget.title }}
					</RouterLink>
				</h2>
			</header>

			<DashboardWidgetBody :widget :state="state(widget)" :figures :data />
		</li>
	</TransitionGroup>

	<DashboardCustomizer ref="customizer" v-model:layout="layout" />
</template>

<style lang="scss" scoped>
.dashboard {
	margin-bottom: var(--lnx-spacing-5);
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	grid-auto-rows: 132px;
	grid-auto-flow: dense;
	gap: var(--lnx-spacing-3);

	> li {
		position: relative;
		min-width: 0;
		overflow: hidden;
		padding: var(--lnx-spacing-3) var(--lnx-spacing-4);
		border: 1px solid var(--color-gray-3);
		border-radius: var(--lnx-radius-3);
		display: flex;
		flex-direction: column;
		gap: 4px;
		background: var(--color-gray-0);
		box-shadow: 0 1px 2px #0000000A;
		color: var(--color-gray-7);
		font-size: var(--lnx-font-size-small);
		// Figures in columns, so they don't jump as they change
		font-variant-numeric: tabular-nums;
		transition: border-color var(--duration) var(--ease-out), box-shadow var(--duration) var(--ease-out), translate var(--duration) var(--ease-spring), scale var(--duration-fast) var(--ease-out);

		&:has(.stretched:hover) {
			border-color: var(--color-primary-light);
			box-shadow: 0 2px 4px #0000000F, 0 8px 24px #0000000F;
			translate: 0 -2px;
		}

		&:has(.stretched:active) {
			translate: 0;
			scale: .99;
		}
	}

	> .size-2 {
		grid-column: span 2;
	}

	header {
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-2);
		color: var(--color-gray-6);
	}

	h2 {
		min-width: 0;
		overflow: hidden;
		color: var(--color-gray-7);
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
		white-space: nowrap;
		text-overflow: ellipsis;
	}
}

// Shown or added from "Personalizar dashboard": they fade in and the rest slide to make room
.widget-move {
	transition: transform .3s var(--ease-out);
}

.widget-enter-active {
	transition: opacity var(--duration) var(--ease-out), scale var(--duration) var(--ease-out);
}

.widget-enter-from {
	opacity: 0;
	scale: .96;
}

// The title's link covers the whole widget
.stretched {
	color: inherit;
	text-decoration: none;

	&::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 1;
		border-radius: var(--lnx-radius-3);
	}

	&:focus-visible {
		outline: none;

		&::after {
			outline: 2px solid var(--color-primary);
			outline-offset: -2px;
		}
	}
}
</style>
