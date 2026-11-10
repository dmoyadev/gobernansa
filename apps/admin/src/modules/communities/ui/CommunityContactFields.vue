<script setup lang="ts">
import type { CommunityContact, ContactType } from '@gobernansa/shared/domain/community.ts';
import { contactTypes, WEEKDAYS } from '@gobernansa/shared/domain/community.ts';
import { LnxButton, LnxIcon, LnxInput, LnxRadioGroup, LnxSelect } from 'lnxjs-components';

// A contact's fields and schedules, in the community's list and in the form that adds one (CommunityFormPage.vue)
const contact = defineModel<CommunityContact>({ required: true });

const typeOptions = Object.entries(contactTypes).map(([value, { label }]) => ({ value: value as ContactType, label }));
</script>

<template>
	<div class="fields">
		<LnxSelect
			v-model.convert="contact.type"
			:options="typeOptions"
			:convert-fn="option => option.value"
		>
			Tipo
			<template #option="{ option }">
				{{ option.label }}
			</template>
			<template #optionInput="{ value }">
				{{ contactTypes[value]?.label }}
			</template>
		</LnxSelect>
		<LnxInput v-model="contact.name" required>
			Nombre
		</LnxInput>
		<LnxInput v-model="contact.phone" type="tel">
			Teléfono
		</LnxInput>
		<LnxInput v-model="contact.whatsapp" type="tel">
			WhatsApp
		</LnxInput>
		<LnxInput v-model="contact.email" type="email" class="wide">
			Email
		</LnxInput>
	</div>

	<div v-for="(schedule, scheduleIndex) in contact.schedule" :key="scheduleIndex" class="schedule">
		<LnxRadioGroup v-model="schedule.days" class="days" :options="WEEKDAYS.map((day, index) => ({ value: index + 1, label: day }))" multiple>
			Horario
		</LnxRadioGroup>
		<LnxInput v-model="schedule.from" type="time" required>
			Desde
		</LnxInput>
		<LnxInput v-model="schedule.to" type="time" required>
			Hasta
		</LnxInput>
		<LnxButton
			mode="clear"
			shape="circle"
			:aria-label="`Quitar este horario de ${contact.name || 'el contacto'}`"
			:title="`Quitar este horario de ${contact.name || 'el contacto'}`"
			@click="contact.schedule!.splice(scheduleIndex, 1)"
		>
			<LnxIcon icon="lucide:x" />
		</LnxButton>
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

// Days on their own row, then from, to and the button to remove it
.schedule {
	display: grid;
	grid-template-columns: 1fr 1fr auto;
	align-items: end;
	gap: var(--lnx-spacing-2) var(--lnx-spacing-3);

	.days {
		grid-column: 1 / -1;
	}
}
</style>
