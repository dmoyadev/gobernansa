<script setup lang="ts">
import { LnxIcon } from 'lnxjs-components';
import { computed, useTemplateRef } from 'vue';
import Kbd from './Kbd.vue';
import { bindings, isTyping, useEventListener, useShortcut } from './shortcuts.ts';
import { dismiss, toasts, undo } from './toast.ts';

// ⌘Z undoes the newest that can be undone. In a field it's the field's own undo
useEventListener(window, 'keydown', (event) => {
	const mod = event.metaKey || event.ctrlKey;
	if (mod && !event.shiftKey && event.key.toLowerCase() === 'z' && !isTyping(event.target) && toasts.some(item => item.undo)) {
		event.preventDefault();
		void undo();
	}
});

// Every shortcut that applies right now, the page's and the layout's
const sheet = useTemplateRef('sheet');
// The one that wins for each combo, and the combos that do the same thing on one row
const described = computed(() => {
	const winners = new Map(bindings.filter(binding => binding.description && (binding.enabled?.() ?? true)).map(binding => [binding.combo, binding]));
	const rows = new Map<string, string[]>();
	for (const { combo, description } of [...winners.values()].reverse()) {
		rows.set(description!, [...(rows.get(description!) ?? []), combo]);
	}
	return Array.from(rows, ([description, combos]) => ({ description, combos }));
});
useShortcut('?', () => sheet.value?.open ? sheet.value.close() : sheet.value?.showModal(), 'Ver los atajos de teclado');
</script>

<template>
	<!-- Read out as they come, errors right away -->
	<TransitionGroup tag="ol" class="toasts" aria-live="polite">
		<li
			v-for="item in toasts"
			:key="item.id"
			class="toast"
			:class="item.tone"
			:role="item.tone === 'error' ? 'alert' : 'status'"
		>
			<LnxIcon :icon="item.tone === 'error' ? 'lucide:circle-alert' : 'lucide:circle-check'" :size="18" />
			<span class="message">{{ item.message }}</span>
			<button v-if="item.undo" type="button" class="undo" @click="undo(item.id)">
				Deshacer
				<Kbd combo="mod+z" />
			</button>
			<button type="button" class="close" aria-label="Cerrar" @click="dismiss(item.id)">
				<LnxIcon icon="lucide:x" :size="16" />
			</button>
			<!-- Its time runs out with this bar, which stops while pointed at or focused -->
			<span class="timer" :style="{ animationDuration: `${item.duration}ms` }" @animationend="dismiss(item.id)" />
		</li>
	</TransitionGroup>

	<dialog ref="sheet" class="sheet" aria-labelledby="shortcuts-title" @click.self="sheet?.close()">
		<header>
			<h2 id="shortcuts-title">
				Atajos de teclado
			</h2>
			<button type="button" class="close" aria-label="Cerrar" @click="sheet?.close()">
				<LnxIcon icon="lucide:x" :size="18" />
			</button>
		</header>
		<dl>
			<div v-for="row in described" :key="row.description">
				<dt>{{ row.description }}</dt>
				<dd><Kbd v-for="combo in row.combos" :key="combo" :combo="combo" /></dd>
			</div>
			<div>
				<dt>Deshacer lo último</dt>
				<dd><Kbd combo="mod+z" /></dd>
			</div>
		</dl>
	</dialog>
</template>

<style lang="scss" scoped>
.toasts {
	position: fixed;
	z-index: 100;
	bottom: var(--lnx-spacing-5);
	left: 50%;
	width: min(440px, calc(100vw - 2 * var(--lnx-spacing-4)));
	translate: -50% 0;
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);
	pointer-events: none;
}

.toast {
	position: relative;
	overflow: hidden;
	padding: var(--lnx-spacing-3) var(--lnx-spacing-3) var(--lnx-spacing-3) var(--lnx-spacing-4);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-3);
	border-radius: var(--lnx-radius-4);
	background: var(--color-gray-10);
	color: var(--color-gray-0);
	box-shadow: 0 8px 24px #0000002E, 0 2px 6px #0000001F;
	font-size: var(--lnx-font-size-small);
	pointer-events: auto;
	// Transitions, not keyframes: one that's leaving while it enters turns back from where it is
	transition: opacity .22s var(--ease-out), translate .32s var(--ease-spring), scale .32s var(--ease-spring);

	&.error {
		background: var(--color-secondary-accent);
	}

	&:hover .timer,
	&:focus-within .timer {
		animation-play-state: paused;
	}
}

.message {
	flex: 1;
	text-wrap: pretty;
}

.undo {
	padding: var(--lnx-spacing-1) var(--lnx-spacing-2);
	display: inline-flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
	border-radius: var(--lnx-radius-3);
	color: inherit;
	font-weight: var(--lnx-font-weight-bold);

	&:hover {
		background: #FFFFFF1F;
	}
}

.close {
	padding: var(--lnx-spacing-1);
	display: grid;
	border-radius: var(--lnx-radius-circle);
	color: inherit;
	opacity: .7;

	&:hover {
		opacity: 1;
		background: #FFFFFF1F;
	}
}

.timer {
	position: absolute;
	left: 0;
	bottom: 0;
	height: 2px;
	width: 100%;
	transform-origin: left;
	background: #FFFFFF59;
	animation: run-out linear forwards;
}

@keyframes run-out {
	to {
		transform: scaleX(0);
	}
}

.v-enter-from,
.v-leave-to {
	opacity: 0;
	translate: 0 16px;
	scale: .96;
}

.v-leave-active {
	position: absolute;
	width: 100%;
}

.v-move {
	transition: translate .32s var(--ease-spring);
}

.sheet {
	width: min(420px, calc(100vw - 2 * var(--lnx-spacing-4)));
	margin: auto;
	padding: var(--lnx-spacing-5);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-4);
	background: var(--color-gray-0);
	box-shadow: 0 16px 48px #00000033;
	opacity: 0;
	scale: .96;
	transition: opacity .2s var(--ease-out), scale .25s var(--ease-spring), overlay .2s allow-discrete, display .2s allow-discrete;

	&[open] {
		opacity: 1;
		scale: 1;

		@starting-style {
			opacity: 0;
			scale: .96;
		}
	}

	&::backdrop {
		background: #0F172A40;
		backdrop-filter: blur(2px);
	}

	header {
		margin-bottom: var(--lnx-spacing-4);
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	h2 {
		font-size: var(--lnx-font-size-big);
	}

	.close {
		color: var(--color-gray-7);

		&:hover {
			background: var(--color-gray-2);
		}
	}

	dl {
		display: flex;
		flex-direction: column;
		gap: var(--lnx-spacing-2);

		div {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: var(--lnx-spacing-3);
			font-size: var(--lnx-font-size-small);
			color: var(--color-gray-8);
		}

		dd {
			display: flex;
			gap: var(--lnx-spacing-2);
		}
	}
}
</style>
