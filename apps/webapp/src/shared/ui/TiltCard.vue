<script setup lang="ts">
import { ref } from 'vue';

// Where the pointer is over the card, from 0 to 1, the card tilts towards it and the glare follows it
const pointer = ref<{ x: number; y: number }>();

function onPointerMove(event: PointerEvent) {
	const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
	pointer.value = {
		x: (event.clientX - rect.left) / rect.width,
		y: (event.clientY - rect.top) / rect.height,
	};
}
</script>

<template>
	<div
		class="tilt"
		@pointermove="onPointerMove"
		@pointerleave="pointer = undefined"
		@pointercancel="pointer = undefined"
	>
		<div
			class="card"
			:class="{ active: pointer }"
			:style="pointer && { '--x': pointer.x, '--y': pointer.y }"
		>
			<slot />
			<span class="glare" aria-hidden="true" />
		</div>
	</div>
</template>

<style scoped lang="scss">
.tilt {
	perspective: 900px;
	// Vertical swipes still scroll the page, horizontal ones tilt the card
	touch-action: pan-y;
}

.card {
	--x: .5;
	--y: .5;
	position: relative;
	border-radius: calc(var(--lnx-radius-3) * 2);
	transform: rotateX(calc((var(--y) - .5) * -14deg)) rotateY(calc((var(--x) - .5) * 18deg));
	// The shadow falls away from the raised side, as if lit from above
	box-shadow:
		calc((.5 - var(--x)) * 20px) calc((.5 - var(--y)) * 20px + 14px) 28px -8px #0000004D,
		0 2px 6px #0000001A;
	transition: transform .5s cubic-bezier(.2, 0, 0, 1), box-shadow .5s cubic-bezier(.2, 0, 0, 1);
	animation: intro 1.2s cubic-bezier(.2, 0, 0, 1) .2s backwards;

	&.active {
		transition-duration: .1s;
	}
}

.glare {
	position: absolute;
	inset: 0;
	border-radius: inherit;
	background: radial-gradient(circle at calc(var(--x) * 100%) calc(var(--y) * 100%), #ffffff4D, transparent 55%);
	mix-blend-mode: soft-light;
	pointer-events: none;
	opacity: 0;
	transition: opacity .3s;

	.active & {
		opacity: 1;
	}
}

// Touch screens have no hover, so the card shows once that it moves
@keyframes intro {
	from {
		transform: rotateX(18deg) rotateY(-24deg) translateY(16px);
	}
}

@media (prefers-reduced-motion: reduce) {
	.card {
		transform: none;
		animation: none;
	}
}
</style>
