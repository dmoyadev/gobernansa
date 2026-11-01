<script setup lang="ts">
import type { FinanceSection } from '../sections.ts';
import { LnxIcon } from 'lnxjs-components';
import { computed, nextTick, ref, useId, useTemplateRef, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useEventListener } from '@/app/ux/shortcuts.ts';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { financeGroups, financeSectionOf } from '../sections.ts';

// Beside every finance page, kept mounted by the layout while moving between them
const route = useRoute();
const navId = useId();
const nav = useTemplateRef('nav');

const communityId = computed(() => route.params.id as string);
const current = computed(() => route.meta.finance as string);
const base = computed(() => `/communities/${communityId.value}`);

// A read when entering the finances of a community, the generic name until then or if it fails
const name = ref<string>();
watch(communityId, async (id) => {
	name.value = undefined;
	const community = await loadCommunity(id).catch(() => undefined);
	if (id === communityId.value) {
		name.value = community?.name;
	}
}, { immediate: true });

// The page itself, or its section when on another tab or a detail page of it
function ariaCurrent(to: string, section?: FinanceSection) {
	return route.path === to ? 'page' : section && financeSectionOf.get(current.value) === section ? 'true' : undefined;
}

// One background under the active one, gliding from the last to it rather than one going and another appearing.
// Placed from where it is in the nav, as a column or as the strip on phones; set at once the first time
const marker = ref<{ left: number; top: number; width: number; height: number }>();
const gliding = ref(false);
function placeMarker() {
	const active = nav.value?.querySelector<HTMLElement>('[aria-current]');
	if (!nav.value || !active) {
		marker.value = undefined;
		return;
	}
	const [box, link] = [nav.value.getBoundingClientRect(), active.getBoundingClientRect()];
	marker.value = { left: link.left - box.left + nav.value.scrollLeft, top: link.top - box.top + nav.value.scrollTop, width: link.width, height: link.height };
}
useEventListener(window, 'resize', placeMarker);

// As a strip on phones, the active one is centred in it. Only the strip scrolls: the window keeps the position going back restores
watch(current, async () => {
	await nextTick();
	const active = nav.value?.querySelector<HTMLElement>('[aria-current]');
	if (nav.value && active && nav.value.scrollWidth > nav.value.clientWidth) {
		nav.value.scrollLeft += active.getBoundingClientRect().left - nav.value.getBoundingClientRect().left - (nav.value.clientWidth - active.offsetWidth) / 2;
	}
	placeMarker();
	requestAnimationFrame(() => gliding.value = true);
}, { immediate: true });
// The community's name changes the first row's height
watch(name, async () => {
	await nextTick();
	placeMarker();
});
</script>

<template>
	<nav ref="nav" class="finance-nav" aria-label="Finanzas">
		<span
			v-if="marker"
			class="marker"
			:class="{ gliding }"
			:style="{ translate: `${marker.left}px ${marker.top}px`, width: `${marker.width}px`, height: `${marker.height}px` }"
			aria-hidden="true"
		/>
		<RouterLink class="community" :to="base">
			<LnxIcon icon="lucide:arrow-left" :size="16" aria-hidden="true" />
			<span>{{ name || 'Comunidad' }}</span>
		</RouterLink>
		<RouterLink :to="`${base}/finances`" :aria-current="ariaCurrent(`${base}/finances`)">
			<LnxIcon icon="lucide:layout-dashboard" :size="16" aria-hidden="true" />
			Resumen
		</RouterLink>
		<div v-for="(group, index) in financeGroups" :key="group.title" class="group">
			<span :id="`${navId}-${index}`" class="group-title">{{ group.title }}</span>
			<ul :aria-labelledby="`${navId}-${index}`">
				<li v-for="section in group.sections" :key="section.title">
					<RouterLink :to="`${base}/${section.pages[0].key}`" :aria-current="ariaCurrent(`${base}/${section.pages[0].key}`, section)">
						<LnxIcon :icon="section.icon" :size="16" aria-hidden="true" />
						{{ section.title }}
					</RouterLink>
				</li>
			</ul>
		</div>
	</nav>
</template>

<style lang="scss" scoped>
.finance-nav {
	position: sticky;
	top: calc(64px + var(--lnx-spacing-6));
	max-height: calc(100dvh - 64px - var(--lnx-spacing-6) * 2);
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-1);
	// Still while the page beside it changes
	view-transition-name: finance-nav;
}

.marker {
	position: absolute;
	top: 0;
	left: 0;
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-2);
	pointer-events: none;

	&.gliding {
		transition: translate .4s var(--ease-spring), width .4s var(--ease-spring), height .4s var(--ease-spring);
	}
}

a {
	padding: var(--lnx-spacing-2) var(--lnx-spacing-3);
	border-radius: var(--lnx-radius-3);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
	position: relative; // Over the marker
	color: var(--color-gray-7);
	font-size: var(--lnx-font-size-small);
	text-decoration: none;
	transition: color var(--duration) var(--ease-out);

	&:hover:not([aria-current]) {
		background: var(--color-gray-1);
		color: var(--color-gray-9);
	}

	&:active {
		scale: var(--press-scale);
	}

	&[aria-current] {
		color: var(--color-primary);
		font-weight: var(--lnx-font-weight-bold);
	}
}

.community {
	margin-bottom: var(--lnx-spacing-2);
	color: var(--color-gray-9);
	font-weight: var(--lnx-font-weight-bold);

	span {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
}

.group {
	margin-top: var(--lnx-spacing-3);

	.group-title {
		display: block;
		margin-bottom: var(--lnx-spacing-1);
		padding: 0 var(--lnx-spacing-3);
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: .04em;
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--lnx-spacing-1);
	}
}

@media print {
	.finance-nav {
		display: none;
	}
}

// A strip that scrolls sideways out to the screen's edges, fading at the end so it shows there's more. The groups' names stay for screen readers
@media (max-width: 900px) {
	.finance-nav {
		position: relative;
		top: 0;
		max-height: none;
		margin: 0 calc(var(--lnx-spacing-5) * -1);
		padding: 0 var(--lnx-spacing-5) var(--lnx-spacing-2);
		overflow-x: auto;
		flex-direction: row;
		scrollbar-width: none;
		box-shadow: inset 0 -1px 0 var(--color-gray-3);
		mask-image: linear-gradient(to right, #000 85%, transparent);
	}

	a {
		flex-shrink: 0;
		white-space: nowrap;
	}

	.community {
		margin-bottom: 0;
		max-width: 160px;
	}

	.group,
	.group ul,
	.group li {
		margin: 0;
		display: contents;
	}

	.group .group-title {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
}

// The page's side padding is smaller on phones
@media (max-width: 640px) {
	.finance-nav {
		margin: 0 calc(var(--lnx-spacing-4) * -1);
		padding: 0 var(--lnx-spacing-4) var(--lnx-spacing-2);
	}
}
</style>
