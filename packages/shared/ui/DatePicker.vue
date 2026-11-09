<script setup lang="ts">
// LnxDatePicker in Spanish, holding the date as the 'YYYY-MM-DD' text the forms and Firestore keys already use
import type { Item } from 'lnxjs-components';
import { LnxDatePicker } from 'lnxjs-components';
import { computed } from 'vue';
import { toDateString } from '../domain/booking.ts';

const props = defineProps<{
	min?: string;
	max?: string;
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

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const WEEK_DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

// The library reads and emits days at 00:00 UTC
const date = computed({
	get: () => (model.value ? new Date(model.value) : undefined),
	set: (value?: Date) => {
		model.value = value ? value.toISOString().slice(0, 10) : '';
	},
});

// Only days are limited, months and years stay browsable
function isOutOfRange(item: Item) {
	if (!('weekDay' in item)) {
		return false;
	}
	const day = toDateString(new Date(item.year, item.month, item.number));
	return (!!props.min && day < props.min) || (!!props.max && day > props.max);
}
</script>

<template>
	<LnxDatePicker
		v-model="date"
		:months-names="MONTHS"
		:week-days-names="WEEK_DAYS"
		today-text="Hoy"
		:show-format="value => value?.toLocaleDateString('es', { timeZone: 'UTC' }) ?? ''"
		:is-item-disabled-fn="min || max ? isOutOfRange : undefined"
		:is-loading="isLoading"
		:has-error="hasError"
		:custom-validity="customValidity"
	>
		<template v-if="$slots.default" #default>
			<slot />
		</template>
		<template v-if="$slots.helper" #helper>
			<slot name="helper" />
		</template>
		<template v-if="$slots.error" #error>
			<slot name="error" />
		</template>
	</LnxDatePicker>
</template>
