<script setup lang="ts">
import type { CommunityDocument } from '@gobernansa/shared/domain/community.ts';
import type { CommunityForm } from '../domain/communityForm.ts';
import { documentTypes } from '@gobernansa/shared/domain/community.ts';
import { LnxDatePicker, LnxInput, LnxSelect } from 'lnxjs-components';

// A document's fields, in the community's list and in the form that adds one (CommunityFormPage.vue)
const communityDocument = defineModel<CommunityForm['documents'][number]>({ required: true });

const typeOptions = Object.entries(documentTypes).map(([value, { label }]) => ({ value: value as CommunityDocument['type'], label }));
</script>

<template>
	<div class="fields">
		<LnxSelect
			v-model.convert="communityDocument.type"
			:options="typeOptions"
			:convert-fn="option => option.value"
		>
			Tipo
			<template #option="{ option }">
				{{ option.label }}
			</template>
			<template #optionInput="{ value }">
				{{ documentTypes[value]?.label }}
			</template>
		</LnxSelect>
		<LnxDatePicker v-model="communityDocument.date" value-format="iso-date" required>
			Fecha
		</LnxDatePicker>
		<LnxInput v-model="communityDocument.title" class="wide" required>
			Título
		</LnxInput>
		<LnxInput v-model="communityDocument.url" type="url" class="wide" required>
			Enlace al PDF
		</LnxInput>
	</div>
</template>

<style lang="scss" scoped>
.fields {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
	align-items: start;
	gap: var(--lnx-spacing-3) var(--lnx-spacing-4);

	.wide {
		grid-column: 1 / -1;
	}
}
</style>
