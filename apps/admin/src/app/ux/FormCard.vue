<script setup lang="ts">
import { LnxButton, LnxIcon, LnxKbd, useShortcut } from 'lnxjs-components';
import { useTemplateRef } from 'vue';

// The form «Nuevo» opens (useNewForm), or the one editing an item, the same on every page: a card with its title, the
// fields in the slot, and Cancelar (Escape, from useNewForm) and the button that sends it (⌘+Enter) at the end. #status
// takes the place of the error by the buttons, #submit the button's label when it's more than text
const props = withDefaults(defineProps<{
	title: string;
	// Why it wasn't sent, by the buttons
	error?: string;
	submitLabel?: string;
	submitIcon?: string;
	saving?: boolean;
	disabled?: boolean;
	// What ⌘+Enter does, in the shortcuts sheet
	shortcut?: string;
}>(), { submitLabel: 'Guardar' });
const emit = defineEmits<{ submit: []; cancel: [] }>();
const form = useTemplateRef('form');

// Unless the focus is in another form of the page, which sends its own
useShortcut('mod+enter', () => form.value?.requestSubmit(), {
	description: props.shortcut ?? props.submitLabel,
	enabled: () => [null, undefined, form.value].includes(document.activeElement?.closest('form')),
});
</script>

<template>
	<form ref="form" class="card lnx-appear" @submit.prevent="emit('submit')">
		<h2>{{ title }}</h2>
		<slot />
		<footer class="form-actions">
			<slot name="status">
				<p v-if="error" class="error" role="alert">
					{{ error }}
				</p>
			</slot>
			<LnxButton mode="clear" @click="emit('cancel')">
				Cancelar
				<LnxKbd combo="escape" />
			</LnxButton>
			<LnxButton type="submit" :is-loading="saving" :disabled="disabled">
				<LnxIcon v-if="submitIcon" :icon="submitIcon" />
				<slot name="submit">
					{{ submitLabel }}
				</slot>
				<LnxKbd combo="mod+enter" />
			</LnxButton>
		</footer>
	</form>
</template>
