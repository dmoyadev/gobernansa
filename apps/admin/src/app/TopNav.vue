<script setup lang="ts">
import { LnxIcon, shortcutTitle, useEventListener } from 'lnxjs-components';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch } from 'vue';
import { useRoute } from 'vue-router';
import { errorAlerts } from '@/modules/errors/application/useErrorAlerts.ts';

// The app's sections with their names, as many as fit; the rest in «Más», in the same order
const props = defineProps<{ sections: { to: string; label: string; icon: string; combo: string }[] }>();

const route = useRoute();
const menuId = useId();
const nav = useTemplateRef('nav');
const more = useTemplateRef('more');
const menu = useTemplateRef('menu');

const PHONE = '(max-width: 640px)';
const fitting = ref(Number.POSITIVE_INFINITY);
const overflowed = computed(() => props.sections.slice(fitting.value));
const isActive = (to: string) => to === '/' ? route.path === '/' : route.path === to || route.path.startsWith(`${to}/`);
const alertsHidden = computed(() => overflowed.value.some(section => section.to === '/errors') ? errorAlerts.value : 0);

// Measured with every link laid out, the overflowed ones too (absolute, so they don't take room). On phones the strip
// scrolls instead
function fit() {
	if (!nav.value || !more.value) {
		return;
	}
	const links = [...nav.value.querySelectorAll<HTMLElement>(':scope > a')];
	if (matchMedia(PHONE).matches) {
		fitting.value = links.length;
		return;
	}
	const gap = Number.parseFloat(getComputedStyle(nav.value).columnGap) || 0;
	const widths = links.map(link => link.offsetWidth + gap);
	const room = nav.value.clientWidth + gap;
	if (widths.reduce((sum, width) => sum + width, 0) <= room) {
		fitting.value = links.length;
		return;
	}
	let used = more.value.offsetWidth + gap;
	let count = 0;
	while (count < widths.length && used + widths[count] <= room) {
		used += widths[count];
		count++;
	}
	fitting.value = count;
}

// The nav's width follows the window and the user's name beside it, not its links
const observer = new ResizeObserver(fit);
onMounted(() => {
	observer.observe(nav.value!);
	void document.fonts.ready.then(fit);
});
onBeforeUnmount(() => observer.disconnect());
// Sections come with the profile, and the alerts badge widens Errores or «Más»
watch(() => [props.sections, errorAlerts.value, alertsHidden.value], async () => {
	await nextTick();
	fit();
});

// A native popover, as the community's menu: it closes clicking outside or with Escape and gives the focus back to its
// button. Placed once when it opens, so it closes on scroll or resize instead of drifting away from it
const menuOpen = ref(false);
const menuPosition = ref<{ top: string; right: string }>();
function closeMenu() {
	if (menuOpen.value) {
		menu.value?.hidePopover();
	}
}
useEventListener(document, 'scroll', closeMenu, { capture: true, passive: true });
useEventListener(window, 'resize', closeMenu);

function onToggle(event: Event) {
	menuOpen.value = (event as ToggleEvent).newState === 'open';
	if (menuOpen.value) {
		const rect = more.value!.getBoundingClientRect();
		menuPosition.value = { top: `${rect.bottom + 4}px`, right: `${window.innerWidth - rect.right}px` };
		menu.value?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
	}
}

// Arrows, Home and End move between its items; Tab leaves it
function onMenuKeydown(event: KeyboardEvent) {
	if (event.key === 'Tab') {
		closeMenu();
		return;
	}
	const items = [...menu.value!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
	const index = items.indexOf(document.activeElement as HTMLElement);
	const next = { ArrowDown: index + 1, ArrowUp: (index < 0 ? 0 : index) - 1, Home: 0, End: items.length - 1 }[event.key];
	if (next !== undefined) {
		event.preventDefault();
		items[(next + items.length) % items.length]?.focus();
	}
}
</script>

<template>
	<nav ref="nav" aria-label="Principal">
		<RouterLink
			v-for="(section, index) in sections"
			:key="section.to"
			:to="section.to"
			:title="shortcutTitle(section.label, section.combo)"
			:class="{ overflowed: index >= fitting }"
		>
			<LnxIcon :icon="section.icon" :size="18" />
			{{ section.label }}
			<span v-if="section.to === '/errors' && errorAlerts" class="alerts">{{ errorAlerts }}<span class="sr-only"> por revisar</span></span>
		</RouterLink>
		<button
			ref="more"
			type="button"
			class="more"
			:class="{ unused: !overflowed.length, active: overflowed.some(section => isActive(section.to)) }"
			aria-haspopup="menu"
			:aria-expanded="menuOpen"
			:aria-controls="menuId"
			:popovertarget="menuId"
		>
			<LnxIcon icon="lucide:ellipsis" :size="18" />
			Más
			<span v-if="alertsHidden" class="alerts">{{ alertsHidden }}<span class="sr-only"> errores por revisar</span></span>
		</button>
		<div :id="menuId" ref="menu" popover class="menu" role="menu" aria-label="Más secciones" :style="menuPosition" @toggle="onToggle" @keydown="onMenuKeydown">
			<RouterLink
				v-for="section in overflowed"
				:key="section.to"
				role="menuitem"
				tabindex="-1"
				:to="section.to"
				:title="shortcutTitle(section.label, section.combo)"
				@click="closeMenu()"
			>
				<LnxIcon :icon="section.icon" :size="18" />
				{{ section.label }}
				<span v-if="section.to === '/errors' && errorAlerts" class="alerts">{{ errorAlerts }}<span class="sr-only"> por revisar</span></span>
			</RouterLink>
		</div>
	</nav>
</template>

<style lang="scss" scoped>
nav {
	position: relative;
	flex: 1;
	min-width: 0;
	display: flex;
	gap: var(--lnx-spacing-2);
}

nav > a,
.more {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
	padding: var(--lnx-spacing-2) var(--lnx-spacing-3);
	border: 0;
	border-radius: var(--lnx-radius-3);
	background: none;
	color: var(--color-gray-7);
	font: inherit;
	font-size: var(--lnx-font-size-small);
	font-weight: var(--lnx-font-weight-bold);
	white-space: nowrap;
	text-decoration: none;
	cursor: pointer;

	&:hover {
		background: var(--color-gray-1);
		color: var(--color-gray-9);
	}

	&:active {
		scale: var(--press-scale);
	}

	&.router-link-exact-active,
	&.router-link-active:not([href="/"]),
	&.active,
	&[aria-expanded="true"] {
		background: var(--color-gray-2);
		color: var(--color-primary);
	}
}

// Still measured, out of the way and out of reach, and not past the window's edge
nav > a.overflowed,
.more.unused {
	position: absolute;
	top: 0;
	left: 0;
	visibility: hidden;
	pointer-events: none;
}

.alerts {
	min-width: 18px;
	padding: 0 var(--lnx-spacing-1);
	border-radius: 9px;
	background: var(--color-secondary-accent);
	color: var(--color-primary-accent);
	font-size: var(--lnx-font-size-legal);
	line-height: 18px;
	text-align: center;
}

// In the top layer, under its button and aligned to its right edge
.menu {
	position: fixed;
	inset: auto;
	margin: 0;
	min-width: 220px;
	padding: var(--lnx-spacing-1);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: var(--lnx-elevation-3);
	opacity: 0;
	scale: .96;
	transform-origin: top right;
	// Transitions, so closing while it opens turns back from where it is
	transition:
		opacity var(--duration) var(--ease-out),
		scale var(--duration) var(--ease-out),
		overlay var(--duration) allow-discrete,
		display var(--duration) allow-discrete;

	// The layout stays while it fades out, only display goes
	flex-direction: column;

	&:popover-open {
		display: flex;
		opacity: 1;
		scale: 1;

		@starting-style {
			opacity: 0;
			scale: .96;
		}
	}

	[role='menuitem'] {
		padding: var(--lnx-spacing-2) var(--lnx-spacing-3);
		border-radius: var(--lnx-radius-2);
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-2);
		color: var(--color-gray-9);
		font-size: var(--lnx-font-size-small);
		text-decoration: none;

		&:hover,
		&:focus-visible {
			outline: none;
			background: var(--color-gray-2);
		}

		&.router-link-active {
			color: var(--color-primary);
			font-weight: var(--lnx-font-weight-bold);
		}

		.alerts {
			margin-left: auto;
		}
	}
}

@media (prefers-reduced-motion: reduce) {
	.menu {
		scale: none !important;
	}
}

// The team's icons don't fit beside the logo on a phone: they scroll, not the page, without «Más»
@media (max-width: 640px) {
	nav {
		overflow-x: auto;
		scrollbar-width: none;
	}

	nav > a {
		padding: var(--lnx-spacing-2);
		font-size: 0; // Icon only, the label stays for screen readers through the link's text
	}

	.more {
		display: none;
	}
}
</style>
