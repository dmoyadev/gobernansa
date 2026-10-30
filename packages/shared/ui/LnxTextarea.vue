<script setup lang="ts">
// Not in lnxjs-components yet: same API and look as LnxInput, so it can move to the library unchanged
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

const model = defineModel<string>();

const attrs = useAttrs();
const id = useId();
const isReadonly = computed(() => props.isLoading || ('readonly' in attrs && attrs.readonly !== false));
const isDisabled = computed(() => props.isLoading || ('disabled' in attrs && attrs.disabled !== false));

const $textarea = ref<HTMLTextAreaElement>();
defineExpose({ $textarea });

watch(() => props.hasError, (hasError) => {
	$textarea.value?.setCustomValidity(hasError && props.customValidity ? props.customValidity : '');
});
</script>

<template>
	<div class="textarea" :class="attrs.class" :style="attrs.style">
		<label :class="{ 'has-error': hasError }">
			<span v-if="$slots.default" class="label">
				<slot />
			</span>
			<textarea
				v-bind="{ ...attrs, class: undefined, style: undefined }"
				:id="(attrs.id as string) || id"
				ref="$textarea"
				v-model="model"
				:readonly="isReadonly"
				:disabled="isDisabled"
			/>
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
.textarea {
	width: 100%;
	display: flex;
	flex-direction: column;
	gap: 4px;

	label {
		display: flex;
		flex-direction: column;
		gap: 4px;

		&:has(textarea:read-only, textarea:disabled) {
			opacity: .5;
		}

		&.has-error {
			.label {
				color: var(--lnx-color-danger);
			}

			textarea {
				border-color: var(--lnx-color-danger);
			}
		}
	}

	.label {
		font-size: var(--lnx-font-size-small);
	}

	textarea {
		width: 100%;
		padding: 8px;
		border: 1px solid var(--lnx-color-gray-5);
		border-radius: 4px;
		background: var(--lnx-color-gray-0);
		font: inherit;
		font-size: var(--lnx-font-size-body);
		resize: vertical;

		&::placeholder {
			color: var(--lnx-color-gray-3);
		}

		&:focus-visible {
			outline: 2px solid var(--lnx-color-primary);
			outline-offset: 1px;
		}
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
