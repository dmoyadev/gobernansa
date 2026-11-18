<script setup lang="ts">
import type { LayoutItem } from '../application/dashboardWidgets.ts';
import { LnxButton, LnxCheckbox, LnxIcon, toast } from 'lnxjs-components';
import { ref } from 'vue';
import { defaultLayout, widgetsByKey } from '../application/dashboardWidgets.ts';

// "Personalizar dashboard": which widgets the dashboard shows and in what order
const layout = defineModel<LayoutItem[]>('layout', { required: true });

const dialog = ref<HTMLDialogElement>();
const draggedIndex = ref<number>();
const announcement = ref('');

defineExpose({ open: () => dialog.value?.showModal() });

function toggle(item: LayoutItem) {
	item.hidden = !item.hidden;
}

function move(from: number, to: number) {
	if (to < 0 || to >= layout.value.length) {
		return;
	}
	const [item] = layout.value.splice(from, 1);
	layout.value.splice(to, 0, item);
	announcement.value = `${widgetsByKey.get(item.key)!.title} movido a la posición ${to + 1}`;
}

function onDrop(to: number) {
	if (draggedIndex.value !== undefined) {
		move(draggedIndex.value, to);
	}
	draggedIndex.value = undefined;
}

function reset() {
	const previous = layout.value;
	layout.value = structuredClone(defaultLayout);
	announcement.value = 'Dashboard restablecido';
	toast('Dashboard restablecido', {
		undo: async () => {
			layout.value = previous;
		},
	});
}
</script>

<template>
	<dialog ref="dialog" class="customize" aria-labelledby="customize-title" @close="draggedIndex = undefined">
		<header>
			<h2 id="customize-title">
				Personalizar dashboard
			</h2>
			<LnxButton mode="clear" shape="circle" aria-label="Cerrar" title="Cerrar" @click="dialog?.close()">
				<LnxIcon icon="lucide:x" />
			</LnxButton>
		</header>
		<p id="customize-help" class="muted">
			Elige qué ver y en qué orden. Arrastra cada fila o muévela con sus flechas.
		</p>
		<TransitionGroup tag="ul" name="widget-row" class="widget-list">
			<li
				v-for="(item, index) in layout"
				:key="item.key"
				:class="{ hidden: item.hidden, dragging: draggedIndex === index }"
				draggable="true"
				@dragstart="draggedIndex = index"
				@dragover.prevent
				@drop.prevent="onDrop(index)"
				@dragend="draggedIndex = undefined"
			>
				<LnxIcon class="grip" icon="lucide:grip-vertical" :size="16" aria-hidden="true" />
				<LnxCheckbox :model-value="!item.hidden" @update:model-value="toggle(item)">
					<LnxIcon :icon="widgetsByKey.get(item.key)!.icon" :size="16" aria-hidden="true" />
					{{ widgetsByKey.get(item.key)!.title }}
					<small v-if="widgetsByKey.get(item.key)!.size === 2" class="muted">ancho</small>
				</LnxCheckbox>
				<LnxButton
					mode="clear"
					shape="circle"
					class="lnx-size-small"
					:disabled="index === 0"
					:aria-label="`Subir ${widgetsByKey.get(item.key)!.title}`"
					aria-describedby="customize-help"
					@click="move(index, index - 1)"
				>
					<LnxIcon icon="lucide:chevron-up" />
				</LnxButton>
				<LnxButton
					mode="clear"
					shape="circle"
					class="lnx-size-small"
					:disabled="index === layout.length - 1"
					:aria-label="`Bajar ${widgetsByKey.get(item.key)!.title}`"
					aria-describedby="customize-help"
					@click="move(index, index + 1)"
				>
					<LnxIcon icon="lucide:chevron-down" />
				</LnxButton>
			</li>
		</TransitionGroup>
		<p class="sr-only" aria-live="polite">
			{{ announcement }}
		</p>
		<footer>
			<LnxButton mode="clear" class="lnx-size-small" @click="reset()">
				<LnxIcon icon="lucide:rotate-ccw" />
				Restablecer
			</LnxButton>
			<LnxButton class="lnx-size-small" @click="dialog?.close()">
				<LnxIcon icon="lucide:check" />
				Listo
			</LnxButton>
		</footer>
	</dialog>
</template>

<style lang="scss" scoped>
// The rest slide to make room for the one moved
.widget-row-move {
	transition: transform .3s var(--ease-out);
}

.muted {
	color: var(--color-gray-6);
}

.customize {
	margin: auto;
	width: min(480px, calc(100vw - 32px));
	max-height: min(640px, calc(100vh - 32px));
	padding: var(--lnx-spacing-4);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 8px 32px #00000026;
	color: var(--color-gray-8);
	opacity: 0;
	scale: .96;
	// Transitions, so closing while it opens turns back from where it is
	transition:
		opacity var(--duration) var(--ease-out),
		scale var(--duration) var(--ease-out),
		overlay var(--duration) allow-discrete,
		display var(--duration) allow-discrete;

	// The layout stays while it fades out, only display goes
	flex-direction: column;
	gap: var(--lnx-spacing-3);

	&[open] {
		display: flex;
		opacity: 1;
		scale: 1;

		@starting-style {
			opacity: 0;
			scale: .96;
		}
	}

	&::backdrop {
		background: #0000004D;
		opacity: 0;
		transition: opacity var(--duration) var(--ease-out), overlay var(--duration) allow-discrete, display var(--duration) allow-discrete;
	}

	&[open]::backdrop {
		opacity: 1;

		@starting-style {
			opacity: 0;
		}
	}

	header,
	footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--lnx-spacing-2);
	}

	h2 {
		font-size: var(--lnx-font-size-body);
		font-weight: var(--lnx-font-weight-bold);
	}

	> .muted {
		font-size: var(--lnx-font-size-small);
	}
}

.widget-list {
	min-height: 0;
	overflow-y: auto;
	display: flex;
	flex-direction: column;

	li {
		padding: 2px var(--lnx-spacing-1);
		border-radius: var(--lnx-radius-2);
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-1);
		font-size: var(--lnx-font-size-small);

		+ li {
			border-top: 1px solid var(--color-gray-2);
		}

		&:hover {
			background: var(--color-gray-1);
		}

		&.hidden .lnx-checkbox {
			color: var(--color-gray-6);
		}

		&.dragging {
			opacity: .4;
		}
	}

	.grip {
		flex-shrink: 0;
		color: var(--color-gray-5);
		cursor: grab;
	}

	.lnx-checkbox {
		flex: 1;
		min-width: 0;
		padding: var(--lnx-spacing-1) 0;
	}
}
</style>
