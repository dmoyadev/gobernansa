<script setup lang="ts" generic="T">
// Not in lnxjs-components yet: same API and look as LnxInput, so it can move to the library unchanged.
// v-model takes a boolean, or an array to toggle `value` in it, like a native checkbox
import { LnxIcon } from 'lnxjs-components';
import { computed, ref, useAttrs, useId, watch } from 'vue';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
	isLoading?: boolean;
	hasError?: boolean;
	customValidity?: string;
}>();

defineSlots<{
	default?: () => unknown;
	helper?: () => unknown;
	error?: () => unknown;
}>();

const model = defineModel<boolean | T[]>();

const attrs = useAttrs();
const id = useId();
const isDisabled = computed(() => props.isLoading || ('disabled' in attrs && attrs.disabled !== false));

const $input = ref<HTMLInputElement>();
defineExpose({ $input });

watch(() => props.hasError, (hasError) => {
	$input.value?.setCustomValidity(hasError && props.customValidity ? props.customValidity : '');
});
</script>

<template>
	<div class="checkbox" :class="attrs.class" :style="attrs.style">
		<label :class="{ 'has-error': hasError }">
			<span class="box">
				<input
					v-bind="{ ...attrs, class: undefined, style: undefined }"
					:id="(attrs.id as string) || id"
					ref="$input"
					v-model="model"
					type="checkbox"
					:disabled="isDisabled"
				>
				<LnxIcon class="check" :icon="isLoading ? 'line-md:loading-loop' : 'lucide:check'" :size="12" />
			</span>
			<span v-if="$slots.default" class="label">
				<slot />
			</span>
		</label>
		<p v-if="$slots.helper" class="helper">
			<slot name="helper" />
		</p>
		<p v-if="!isLoading && hasError" class="error">
			<slot name="error">
				{{ customValidity }}
			</slot>
		</p>
	</div>
</template>

<style scoped>
.checkbox {
	display: flex;
	flex-direction: column;
	gap: 4px;

	label {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;

		&:has(input:disabled) {
			opacity: .5;
			cursor: default;
		}

		&.has-error {
			.label {
				color: var(--lnx-color-danger);
			}

			input {
				border-color: var(--lnx-color-danger);
			}
		}
	}

	.box {
		position: relative;
		display: inline-flex;
		flex-shrink: 0;
	}

	input {
		width: 18px;
		height: 18px;
		margin: 0;
		border: 1px solid var(--lnx-color-gray-5);
		border-radius: 4px;
		background: var(--lnx-color-gray-0);
		appearance: none;
		cursor: inherit;
		transition: background .15s, border-color .15s;

		&:checked {
			border-color: var(--lnx-color-primary);
			background: var(--lnx-color-primary);
		}

		&:focus-visible {
			outline: 2px solid var(--lnx-color-primary);
			outline-offset: 1px;
		}
	}

	.check {
		position: absolute;
		inset: 0;
		margin: auto;
		color: var(--lnx-color-primary-accent);
		opacity: 0;
		pointer-events: none;
	}

	input:checked + .check {
		opacity: 1;
	}

	.label {
		font-size: var(--lnx-font-size-body);
	}

	:is(.helper, .error) {
		font-size: var(--lnx-font-size-small);
		line-height: var(--lnx-font-size-small);
	}

	.helper {
		color: var(--lnx-color-primary);
	}

	.error {
		color: var(--lnx-color-danger);
	}
}
</style>
