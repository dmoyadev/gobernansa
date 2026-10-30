<script setup lang="ts">
import { computed } from 'vue';
import { shortcutKeys } from './shortcuts.ts';

// The keys of a shortcut, as a hint next to what it does. Hidden on touch screens, where there's no keyboard
const props = defineProps<{ combo: string }>();
const keys = computed(() => shortcutKeys(props.combo));
</script>

<template>
	<span class="kbd" aria-hidden="true">
		<kbd v-for="(key, index) in keys" :key="index">{{ key }}</kbd>
	</span>
</template>

<style lang="scss" scoped>
.kbd {
	display: inline-flex;
	gap: 2px;
	vertical-align: middle;
}

kbd {
	min-width: 1.6em;
	height: 1.6em;
	padding: 0 .35em;
	display: inline-grid;
	place-items: center;
	border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
	border-bottom-width: 2px;
	border-radius: var(--lnx-radius-2);
	background: color-mix(in srgb, currentColor 6%, transparent);
	font: 600 11px / 1 var(--font-family-body);
	font-variant-numeric: tabular-nums;
	opacity: .8;
}

@media (hover: none) {
	.kbd {
		display: none;
	}
}
</style>
