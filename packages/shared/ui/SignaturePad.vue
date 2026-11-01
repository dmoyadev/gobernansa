<script setup lang="ts">
// A signature drawn with a finger, pen or mouse, kept as an SVG path of whole numbers in a 400×150 box: a few KB, sharp when
// printed, and the rules can check exactly what it holds. Readonly to show one already made
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { ref } from 'vue';

const props = defineProps<{ readonly?: boolean }>();
const path = defineModel<string>({ default: '' });

const WIDTH = 400;
const HEIGHT = 150;
// As firestore.rules allows
const MAX_LENGTH = 20_000;

const svg = ref<SVGSVGElement>();
let last: [number, number] | undefined;

function pointOf(event: PointerEvent): [number, number] {
	const box = svg.value!.getBoundingClientRect();
	const clamp = (value: number, max: number) => Math.min(max, Math.max(0, Math.round(value)));
	return [clamp((event.clientX - box.left) / box.width * WIDTH, WIDTH), clamp((event.clientY - box.top) / box.height * HEIGHT, HEIGHT)];
}

// Past the limit the stroke just stops
function add(segment: string) {
	const next = path.value ? `${path.value} ${segment}` : segment;
	if (next.length <= MAX_LENGTH) {
		path.value = next;
	}
}

function start(event: PointerEvent) {
	if (props.readonly) {
		return;
	}
	svg.value!.setPointerCapture(event.pointerId);
	last = pointOf(event);
	// Drawn to itself too, so a tap leaves a dot
	add(`M${last[0]} ${last[1]} L${last[0]} ${last[1]}`);
}

function move(event: PointerEvent) {
	if (!last) {
		return;
	}
	const next = pointOf(event);
	// Closer points add size and nothing visible
	if (Math.hypot(next[0] - last[0], next[1] - last[1]) >= 2) {
		last = next;
		add(`L${next[0]} ${next[1]}`);
	}
}

function end() {
	last = undefined;
}
</script>

<template>
	<div class="signature-pad" :class="{ editable: !readonly }">
		<svg
			ref="svg"
			:viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
			role="img"
			:aria-label="readonly ? 'Firma' : 'Espacio para firmar'"
			@pointerdown="start"
			@pointermove="move"
			@pointerup="end"
			@pointercancel="end"
		>
			<path :d="path" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
		</svg>
		<LnxButton v-if="!readonly && path" type="button" mode="clear" size="small" class="clear" @click="path = ''">
			<LnxIcon icon="lucide:eraser" />
			Borrar
		</LnxButton>
	</div>
</template>

<style lang="scss" scoped>
.signature-pad {
	position: relative;
	width: 100%;
	max-width: 400px;
	color: var(--color-gray-9);

	svg {
		width: 100%;
		aspect-ratio: 400 / 150;
		display: block;
	}

	&.editable svg {
		border: 1px dashed var(--color-gray-4);
		border-radius: var(--lnx-radius-2);
		background: var(--color-gray-1);
		cursor: crosshair;
		// The page doesn't scroll while signing with a finger
		touch-action: none;
	}
}

.clear {
	position: absolute;
	top: var(--lnx-spacing-1);
	right: var(--lnx-spacing-1);
}
</style>
