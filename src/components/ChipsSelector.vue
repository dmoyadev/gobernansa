<script setup lang="ts" generic="T extends { label: string; value: unknown}">
import { LnxIcon } from 'lnxjs-components';
import { ref, useTemplateRef, watch } from 'vue';

withDefaults(
	defineProps<{
		options?: T[];
		cssPrefix?: string;
	}>(),
	{
		options: () => [],
		cssPrefix: '',
	},
);

const modelValue = defineModel<T['value']>();

const $chips = useTemplateRef('$chips');
const maxScrollPercentage = ref(0);

watch(modelValue, () => {
	if (!$chips.value) {
		return;
	}
	$chips.value.scrollTo({ left: 0, behavior: 'smooth' });
});
</script>

<template>
	<label>
		<select
			v-bind="$attrs"
			v-model="modelValue"
			hidden
		>
			<option :value="undefined">
				Todas
			</option>
			<option
				v-for="option in options"
				:key="option.label"
				:value="option.value"
			>
				{{ option.label }}
			</option>
		</select>

		<span
			ref="$chips"
			class="chips"
			@scroll="maxScrollPercentage = $chips!.scrollLeft > 30 ? 15 : ($chips!.scrollLeft / 2)"
		>
			<span
				v-if="modelValue !== undefined"
				class="chip active"
				:style="{
					'--chip-color': `var(--color-${cssPrefix}-${modelValue}-accent)`,
					'--chip-color-bg': `var(--color-${cssPrefix}-${modelValue})`,
				}"
				@click="modelValue = undefined"
			>
				<LnxIcon icon="mdi:times" />
				{{ options?.find(option => option.value === modelValue)?.label }}
			</span>
			<span
				class="chip"
				:class="{ active: modelValue === undefined }"
				@click="modelValue = undefined"
			>
				Todas
			</span>
			<span
				v-for="option in options?.filter(option => option.value !== modelValue) || []"
				:key="option.label"
				class="chip"
				:class="{ active: option.value === modelValue }"
				@click="modelValue = option.value"
			>
				<span
					v-if="!!cssPrefix"
					class="dot"
					:style="{
						'--chip-color': `var(--color-${cssPrefix}-${option.value}-accent, var(--color-${cssPrefix}-${option.value}))`,
						'--chip-color-bg': `var(--color-${cssPrefix}-${option.value})`,
					}"
				/>
				{{ option.label }}
			</span>
		</span>
	</label>
</template>

<style scoped lang="scss">
.chips {
	display: flex;
	gap: var(--lnx-spacing-3);
	overflow-x: auto;
	padding-bottom: var(--lnx-spacing-2);
	mask-image: linear-gradient(
		to right,
		rgba(0,0,0,0), rgba(0,0,0,.2) calc(v-bind('`${maxScrollPercentage}%`') - 5%), rgba(0,0,0,1) v-bind('`${maxScrollPercentage}%`'),
		rgba(0,0,0,1) 85%, rgba(0,0,0,.2) 90%, rgba(0,0,0,0)
	);

	.chip {
		border-radius: var(--lnx-radius-4);
		color: var(--chip-color, var(--color-gray-6));
		background: var(--chip-color-bg, var(--color-gray-2));
		padding: var(--lnx-spacing-1) var(--lnx-spacing-3);
		font-size: vaR(--lnx-font-size-small);
		white-space: nowrap;
		display: flex;
		align-items: center;
		gap: 4px;

		&.active {
			color: var(--chip-color, var(--color-primary-accent));
			background: var(--chip-color-bg, var(--color-primary));
		}

		&:last-child {
			margin-right: var(--lnx-spacing-8);
		}

		.dot {
			background: var(--chip-color, var(--color-primary));
			width: 8px;
			height: 8px;
			border-radius: var(--lnx-radius-circle);
		}
	}
}
</style>
