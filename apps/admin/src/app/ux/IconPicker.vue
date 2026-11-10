<script setup lang="ts">
import { LnxIcon, useEventListener } from 'lnxjs-components';
import { ref, useId } from 'vue';

// The icon of something being edited (a common area, a category), picked from a list under its button
const props = defineProps<{ options: { icon: string; label: string }[] }>();
const icon = defineModel<string>({ required: true });

const id = useId();
const position = ref<{ top: string; left: string }>();

function popover() {
	return document.getElementById(id);
}

function close() {
	popover()?.hidePopover();
}

// A native popover, placed once under its button when it opens and closed on scroll or resize
function onToggle(event: Event) {
	if ((event as ToggleEvent).newState !== 'open') {
		return;
	}

	const rect = document.querySelector(`[popovertarget="${id}"]`)!.getBoundingClientRect();
	position.value = { top: `${rect.bottom + 4}px`, left: `${rect.left}px` };
	popover()?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
}

function pick(value: string) {
	icon.value = value;
	close();
}

// Esc inside the list only closes the list, the form it's in keeps editing
function onEscape(event: KeyboardEvent) {
	event.stopPropagation();
	close();
}

// Hiding a closed popover does nothing, so these can listen all along
useEventListener(document, 'scroll', close, { capture: true, passive: true });
useEventListener(window, 'resize', close);
</script>

<template>
	<button
		type="button"
		class="icon-picker"
		:popovertarget="id"
		:aria-label="`Icono: ${props.options.find(option => option.icon === icon)?.label ?? 'otro'}. Cambiar`"
		title="Cambiar icono"
	>
		<LnxIcon :icon :size="20" />
		<LnxIcon class="chevron" icon="lucide:chevron-down" :size="12" />
	</button>
	<div
		:id
		popover
		class="icons"
		role="group"
		aria-label="Iconos"
		:style="position"
		@toggle="onToggle"
		@keydown.esc="onEscape"
	>
		<button
			v-for="option in props.options"
			:key="option.icon"
			type="button"
			:aria-pressed="option.icon === icon"
			:aria-label="option.label"
			:title="option.label"
			@click="pick(option.icon)"
		>
			<LnxIcon :icon="option.icon" :size="20" />
		</button>
	</div>
</template>

<style lang="scss" scoped>
// With a small arrow saying it opens the list
.icon-picker {
	position: relative;
	flex-shrink: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 40px;
	height: 40px;
	border: none;
	border-radius: var(--lnx-radius-circle);
	background: var(--icon-bg, var(--color-gray-2));
	color: var(--icon-color, var(--color-primary));
	cursor: pointer;
	outline: 2px dashed var(--color-primary-light);
	outline-offset: 2px;

	&:hover {
		filter: brightness(.96);
	}

	&:focus-visible {
		outline: 2px solid var(--color-primary);
	}

	.chevron {
		position: absolute;
		right: -4px;
		bottom: -4px;
		border-radius: var(--lnx-radius-circle);
		background: var(--color-gray-0);
		color: var(--color-gray-7);
	}
}

// In the top layer, under the icon button
.icons {
	position: fixed;
	inset: auto;
	margin: 0;
	padding: var(--lnx-spacing-2);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 2px 4px #0000000F, 0 8px 24px #0000001A;
	transform-origin: top left;
	opacity: 0;
	scale: .96;
	translate: 0 -4px;
	// A transition, so closing it while it opens turns back from where it is
	transition:
		opacity var(--duration-fast) var(--ease-out),
		scale var(--duration) var(--ease-spring),
		translate var(--duration) var(--ease-spring),
		display var(--duration) allow-discrete,
		overlay var(--duration) allow-discrete;

	// The layout stays while it fades out, only display goes
	grid-template-columns: repeat(6, 40px);
	gap: var(--lnx-spacing-1);

	&:popover-open {
		display: grid;
		opacity: 1;
		scale: 1;
		translate: 0;

		@starting-style {
			opacity: 0;
			scale: .96;
			translate: 0 -4px;
		}
	}

	button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border: none;
		border-radius: var(--lnx-radius-2);
		background: none;
		color: var(--color-gray-8);
		cursor: pointer;

		&:hover,
		&:focus-visible {
			outline: none;
			background: var(--color-gray-2);
		}

		&:active {
			scale: .9;
		}

		&[aria-pressed='true'] {
			background: var(--color-primary);
			color: var(--color-primary-accent);
		}
	}
}
</style>
