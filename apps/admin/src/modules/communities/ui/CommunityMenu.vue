<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { LnxButton, LnxIcon, useEventListener } from 'lnxjs-components';
import { computed, onDeactivated, ref, useId } from 'vue';
import { workspaces } from '@/app/workspace/workspaces.ts';
import { WEBAPP_URL } from '@/modules/mail/application/mail.ts';

// The community page's "Más opciones" menu, with its "Ir a…" submenu
const props = defineProps<{
	communityId: string;
	// Once the community is loaded
	canEdit: boolean;
}>();
const emit = defineEmits<{ edit: []; customize: [] }>();

const { user } = useAuth();
const menuId = useId();

// The webapp as its neighbours see it, to give them support. The admin signs in there with the same account
const webappUrl = `${WEBAPP_URL}/?viewAs=${props.communityId}`;

const menu = ref<HTMLElement>();
const menuButton = ref<ComponentPublicInstance>();
const menuOpen = ref(false);
const menuPosition = ref<{ top: string; right: string }>();

function closeMenu() {
	if (menuOpen.value) {
		menu.value?.hidePopover();
	}
}

// A native popover: it closes when clicking outside or with Escape, and gives the focus back to its button.
// Placed once when it opens, so it closes on scroll or resize instead of drifting away from its button
useEventListener(document, 'scroll', closeMenu, { capture: true, passive: true });
useEventListener(window, 'resize', closeMenu);
// Leaving the page takes the popover out of the document without a toggle event
onDeactivated(() => {
	menuOpen.value = false;
	closeGo();
});

function onMenuToggle(event: Event) {
	menuOpen.value = (event as ToggleEvent).newState === 'open';
	if (!menuOpen.value) {
		closeGo();
		return;
	}

	const rect = (menuButton.value!.$el as HTMLElement).getBoundingClientRect();
	menuPosition.value = { top: `${rect.bottom + 4}px`, right: `${window.innerWidth - rect.right}px` };
	menu.value?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
}

function onMenuKeydown(event: KeyboardEvent) {
	if (event.key === 'Tab') {
		closeMenu();
		return;
	}

	// Its own items, not the submenu's
	focusSibling(event, [...menu.value!.querySelectorAll<HTMLElement>(':scope > [role="menuitem"], :scope > .go > [role="menuitem"]')], () => closeGo());
}

// Arrows, Home and End move the focus between the items of a menu
function focusSibling(event: KeyboardEvent, items: HTMLElement[], onMove?: () => void) {
	const index = items.indexOf(document.activeElement as HTMLElement);
	// With none focused, ArrowUp goes to the last one
	const next = { ArrowDown: index + 1, ArrowUp: (index < 0 ? 0 : index) - 1, Home: 0, End: items.length - 1 }[event.key];
	if (next === undefined) {
		return;
	}

	event.preventDefault();
	onMove?.();
	items[(next + items.length) % items.length]?.focus();
}

/* "Ir a…" submenu */
// A section of a workspace by the key of its first page, as the nav names it
function workspaceSection(workspace: string, key: string) {
	const { title, icon } = workspaces[workspace].sectionOf.get(key)!;
	return { key, label: title, icon };
}
const goSections = computed(() => [
	{ key: 'issues', label: 'Incidencias', icon: 'lucide:message-square-warning' },
	workspaceSection('neighbours', 'people'),
	workspaceSection('neighbours', 'properties'),
	{ key: 'meetings', label: 'Juntas', icon: 'lucide:gavel' },
	{ key: 'finances', label: workspaces.finances.title, icon: workspaces.finances.summary!.icon },
	workspaceSection('finances', 'charges'),
	workspaceSection('finances', 'budget'),
	{ key: 'obligations', label: 'Obligaciones', icon: 'lucide:calendar-check' },
	{ key: 'locations', label: 'Zonas comunes', icon: 'lucide:map-pin' },
	{ key: 'notifications', label: 'Avisos', icon: 'lucide:bell' },
	{ key: 'activity', label: 'Registro de actividad', icon: 'lucide:history' },
	workspaceSection('community', 'info'),
].map(section => ({ ...section, to: `/communities/${props.communityId}/${section.key}` })));

const GO_CLOSE_MS = 300;
const VIEWPORT_MARGIN = 8;
const goTrigger = ref<HTMLElement>();
const submenu = ref<HTMLElement>();
const goOpen = ref(false);
// To the left when there's no room on the right, and moved up when it would go past the bottom
const goPlacement = ref({ left: false, top: 0 });
// The safe triangle, from the pointer to the submenu's near corners
const safeArea = ref<Record<string, string>>();
let closeTimer: ReturnType<typeof setTimeout> | undefined;
let restTimer: ReturnType<typeof setTimeout> | undefined;

function openGo(focusFirst = false) {
	clearTimeout(closeTimer);
	if (!goOpen.value) {
		const trigger = goTrigger.value!.getBoundingClientRect();
		const { offsetWidth: width, offsetHeight: height } = submenu.value!;
		goPlacement.value = {
			left: trigger.right + width + VIEWPORT_MARGIN > window.innerWidth && trigger.left - width > VIEWPORT_MARGIN,
			top: Math.min(0, window.innerHeight - VIEWPORT_MARGIN - trigger.top - height),
		};
		goOpen.value = true;
	}
	if (focusFirst) {
		submenu.value?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
	}
}

function closeGo() {
	clearTimeout(closeTimer);
	clearTimeout(restTimer);
	goOpen.value = false;
	safeArea.value = undefined;
}

// Unless the pointer comes back to the trigger or reaches the submenu meanwhile
function scheduleCloseGo() {
	clearTimeout(closeTimer);
	closeTimer = setTimeout(closeGo, GO_CLOSE_MS);
}

// While the pointer heads from "Ir a…" to the submenu it crosses the items below or above it. A triangle from the
// pointer to the submenu's near edge covers them, so they're neither hovered nor close it: the Amazon safe triangle.
// If the pointer rests a moment, the triangle goes and those items can be pointed at again
function onTriggerPointermove(event: PointerEvent) {
	if (event.pointerType === 'touch' || !goOpen.value) {
		return;
	}
	clearTimeout(closeTimer);
	const trigger = goTrigger.value!.getBoundingClientRect();
	const target = submenu.value!.getBoundingClientRect();
	const x = event.clientX - trigger.left;
	const y = event.clientY - trigger.top;
	const edge = (goPlacement.value.left ? target.right : target.left) - trigger.left;
	const top = Math.min(y, target.top - trigger.top);
	const bottom = Math.max(y, target.bottom - trigger.top);
	const left = Math.min(x, edge);
	const width = Math.max(1, Math.abs(edge - x));
	const point = (px: number, py: number) => `${px - left}px ${py - top}px`;
	safeArea.value = {
		left: `${left}px`,
		top: `${top}px`,
		width: `${width}px`,
		height: `${bottom - top}px`,
		clipPath: `polygon(${point(x, y)}, ${point(edge, target.top - trigger.top)}, ${point(edge, target.bottom - trigger.top)})`,
	};
	clearTimeout(restTimer);
	restTimer = setTimeout(() => safeArea.value = undefined, GO_CLOSE_MS);
}

function onTriggerKeydown(event: KeyboardEvent) {
	if (['ArrowRight', 'Enter', ' '].includes(event.key)) {
		event.preventDefault();
		event.stopPropagation();
		openGo(true);
	}
}

function onSubmenuKeydown(event: KeyboardEvent) {
	if (event.key === 'ArrowLeft' || event.key === 'Escape') {
		// Back to its item, without closing the whole menu
		event.preventDefault();
		event.stopPropagation();
		closeGo();
		goTrigger.value?.focus();
		return;
	}
	if (event.key !== 'Tab') {
		event.stopPropagation();
		focusSibling(event, [...submenu.value!.querySelectorAll<HTMLElement>('[role="menuitem"]')]);
	}
}

// Back to its button, as when the popover closes
defineExpose({ focus: () => (menuButton.value?.$el as HTMLElement | undefined)?.focus() });
</script>

<template>
	<LnxButton
		ref="menuButton"
		mode="clear"
		shape="circle"
		aria-label="Más opciones"
		title="Más opciones"
		aria-haspopup="menu"
		:aria-expanded="menuOpen"
		:aria-controls="menuId"
		:popovertarget="menuId"
	>
		<LnxIcon icon="lucide:ellipsis-vertical" />
	</LnxButton>
	<div
		:id="menuId"
		ref="menu"
		popover
		class="menu"
		role="menu"
		aria-label="Más opciones"
		:style="menuPosition"
		@toggle="onMenuToggle"
		@keydown="onMenuKeydown"
	>
		<a role="menuitem" tabindex="-1" :href="webappUrl" target="_blank" rel="noopener" @click="menu?.hidePopover()">
			<LnxIcon icon="lucide:eye" />
			Ver como un vecino
		</a>
		<RouterLink
			v-if="user?.role === 'superadmin'"
			role="menuitem"
			tabindex="-1"
			:to="`/communities/new?from=${communityId}`"
			@click="menu?.hidePopover()"
		>
			<LnxIcon icon="lucide:copy" />
			Duplicar esta comunidad
		</RouterLink>
		<div class="go" @pointerenter="openGo()" @pointerleave="scheduleCloseGo()">
			<button
				ref="goTrigger"
				type="button"
				role="menuitem"
				tabindex="-1"
				aria-haspopup="menu"
				:aria-expanded="goOpen"
				:aria-controls="`${menuId}-go`"
				:class="{ open: goOpen }"
				@click="openGo()"
				@pointermove="onTriggerPointermove"
				@keydown="onTriggerKeydown"
			>
				<LnxIcon icon="lucide:compass" />
				Ir a…
				<LnxIcon class="chevron" icon="lucide:chevron-right" />
				<span v-if="safeArea" class="safe-area" :style="safeArea" aria-hidden="true" />
			</button>
			<div
				:id="`${menuId}-go`"
				ref="submenu"
				class="submenu"
				:class="{ open: goOpen, left: goPlacement.left }"
				:style="{ '--offset': `${goPlacement.top}px` }"
				role="menu"
				aria-label="Ir a"
				@keydown="onSubmenuKeydown"
			>
				<RouterLink v-for="section in goSections" :key="section.key" role="menuitem" tabindex="-1" :to="section.to" @click="closeMenu()">
					<LnxIcon :icon="section.icon" />
					{{ section.label }}
				</RouterLink>
			</div>
		</div>
		<button v-if="canEdit" type="button" role="menuitem" tabindex="-1" @click="closeMenu(); emit('edit')">
			<LnxIcon icon="lucide:layout-dashboard" />
			Editar vista
		</button>
		<button type="button" role="menuitem" tabindex="-1" @click="closeMenu(); emit('customize')">
			<LnxIcon icon="lucide:chart-no-axes-combined" />
			Personalizar dashboard
		</button>
	</div>
</template>

<style lang="scss" scoped>
// In the top layer, under its button and aligned to its right edge
.menu {
	position: fixed;
	inset: auto;
	margin: 0;
	min-width: 220px;
	padding: var(--lnx-spacing-1);
	// The submenu sticks out of it
	overflow: visible;
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 2px 4px #0000000F, 0 8px 24px #0000001A;
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
		cursor: pointer;

		&:hover,
		&:focus-visible,
		&.open {
			outline: none;
			background: var(--color-gray-2);
		}

		&:active {
			scale: var(--press-scale);
		}
	}

	.chevron {
		margin-left: auto;
		color: var(--color-gray-6);
		transition: translate var(--duration) var(--ease-spring);
	}

	.open .chevron {
		translate: 2px 0;
	}
}

.go {
	position: relative;

	> [role='menuitem'] {
		position: relative;
		width: 100%;
	}
}

// Over the items it crosses, invisible, so they aren't hovered on the way to the submenu
.safe-area {
	position: absolute;
	z-index: 3;
}

// Beside its item, on the right or on the left when there's no room
.submenu {
	position: absolute;
	top: calc(var(--offset, 0px) - var(--lnx-spacing-1) - 1px);
	left: calc(100% + var(--lnx-spacing-1) + 1px);
	z-index: 4;
	min-width: 220px;
	padding: var(--lnx-spacing-1);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	display: flex;
	flex-direction: column;
	background: var(--color-gray-0);
	box-shadow: 0 2px 4px #0000000F, 0 8px 24px #0000001A;
	visibility: hidden;
	opacity: 0;
	translate: -4px 0;
	pointer-events: none;
	transition:
		opacity var(--duration) var(--ease-out),
		translate var(--duration) var(--ease-out),
		visibility var(--duration);

	&.left {
		left: auto;
		right: calc(100% + var(--lnx-spacing-1) + 1px);
		translate: 4px 0;
	}

	&.open {
		visibility: visible;
		opacity: 1;
		translate: 0;
		pointer-events: auto;
	}
}

@media (prefers-reduced-motion: reduce) {
	// Only fading, without sliding or scaling
	.menu,
	.submenu {
		translate: none !important;
		scale: none !important;
		transition-property: opacity, visibility, overlay, display;
	}
}
</style>
