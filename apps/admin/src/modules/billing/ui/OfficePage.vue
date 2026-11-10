<script setup lang="ts">
import type { VatRate } from '@gobernansa/shared/domain/finance.ts';
import { officeVatRates, officeWithholdings } from '@gobernansa/shared/domain/billing.ts';
import { isValidIban, isValidNif, normalizeIban, normalizeTaxId } from '@gobernansa/shared/domain/fiscal.ts';
import { LnxButton, LnxIcon, LnxInput, LnxKbd, LnxSelect, toast, useShortcut } from 'lnxjs-components';
import { ref, useTemplateRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import BackButton from '@/app/ux/BackButton.vue';
import { saveOffice, useOffice } from '../application/useBilling.ts';

const SERIES_REGEX = /^[A-Z0-9]{1,10}$/;

const router = useRouter();
const { data: office, pending, error } = useOffice();

const vatOptions = officeVatRates.map(rate => ({ value: rate, label: `${rate} %` }));
const withholdingOptions = officeWithholdings.map(({ rate, label }) => ({ value: rate, label }));

const form = ref({ nif: '', name: '', address: '', email: '', iban: '', vatRate: 21 as VatRate, withholdingRate: 15, series: 'A', rectSeries: 'R' });
// Filled once from the saved one, so a change elsewhere doesn't overwrite what's being typed
let filled = false;
watch(office, (saved) => {
	if (saved && !filled) {
		filled = true;
		form.value = {
			nif: saved.nif,
			name: saved.name,
			address: saved.address,
			email: saved.email ?? '',
			iban: saved.iban ?? '',
			vatRate: saved.vatRate,
			withholdingRate: saved.withholdingRate,
			series: saved.series,
			rectSeries: saved.rectSeries,
		};
	}
}, { immediate: true });

const saving = ref(false);
const formError = ref<string>();

function findError() {
	const { nif, name, address, iban, series, rectSeries } = form.value;
	if (!isValidNif(nif)) {
		return 'Revisa el NIF: la letra o el dígito de control no cuadran.';
	}
	if (!name.trim() || !address.trim()) {
		return 'Escribe el nombre o razón social y la dirección fiscal.';
	}
	if (iban.trim() && !isValidIban(iban)) {
		return 'Revisa el IBAN: no es válido, p. ej. ES91 2100 0418 4502 0005 1332.';
	}
	if (!SERIES_REGEX.test(series.trim().toUpperCase()) || !SERIES_REGEX.test(rectSeries.trim().toUpperCase())) {
		return 'Las series son de 1 a 10 letras o números, p. ej. A y R.';
	}
	if (series.trim().toUpperCase() === rectSeries.trim().toUpperCase()) {
		return 'Las rectificativas necesitan su propia serie.';
	}
}

async function save() {
	if (saving.value) {
		return;
	}
	formError.value = findError();
	if (formError.value) {
		return;
	}
	const { nif, name, address, email, iban, vatRate, withholdingRate, series, rectSeries } = form.value;
	saving.value = true;
	try {
		await saveOffice({
			nif: normalizeTaxId(nif),
			name: name.trim(),
			address: address.trim(),
			email: email.trim(),
			iban: normalizeIban(iban),
			vatRate,
			withholdingRate,
			series: series.trim().toUpperCase(),
			rectSeries: rectSeries.trim().toUpperCase(),
		}, !!office.value);
		toast('Datos fiscales guardados');
		void router.push('/billing');
	} catch (e) {
		formError.value = `No se han podido guardar: ${(e as Error).message}`;
	} finally {
		saving.value = false;
	}
}

const officeForm = useTemplateRef('officeForm');
useShortcut('mod+enter', () => officeForm.value?.requestSubmit(), { description: 'Guardar los datos fiscales' });
</script>

<template>
	<header class="page-header">
		<BackButton to="/billing" label="Volver a honorarios" />
		<h1>Datos fiscales del despacho</h1>
	</header>

	<p v-if="error" class="error" role="alert">
		No se han podido cargar: {{ error.message }}
	</p>
	<div v-else-if="pending && !office" class="card" aria-busy="true" aria-label="Cargando">
		<span v-for="width in [60, 80, 50]" :key="width" class="lnx-skeleton" :style="{ width: `${width}%` }" />
	</div>
	<form v-else ref="officeForm" class="card lnx-appear" @submit.prevent="save()">
		<p class="hint">
			Son los datos con los que el despacho factura sus honorarios a las comunidades.
		</p>
		<div class="fields">
			<LnxInput v-model="form.nif" required autocomplete="off">
				NIF
			</LnxInput>
			<LnxInput v-model="form.name" required>
				Nombre o razón social
			</LnxInput>
			<LnxInput v-model="form.address" required class="wide">
				Dirección fiscal
				<template #helper>
					Con el código postal y la población
				</template>
			</LnxInput>
			<LnxInput v-model="form.email" type="email">
				Email
			</LnxInput>
			<LnxInput v-model="form.iban" autocomplete="off">
				IBAN para el cobro
				<template #helper>
					Opcional, sale en las facturas
				</template>
			</LnxInput>
			<LnxSelect v-model.convert="form.vatRate" :options="vatOptions" :convert-fn="option => option.value">
				IVA
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ vatOptions.find(option => option.value === value)?.label }}
				</template>
			</LnxSelect>
			<LnxSelect v-model.convert="form.withholdingRate" :options="withholdingOptions" :convert-fn="option => option.value">
				Retención de IRPF
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ withholdingOptions.find(option => option.value === value)?.label }}
				</template>
			</LnxSelect>
			<LnxInput v-model="form.series" required>
				Serie de facturas
				<template #helper>
					Numera cada año desde 1, p. ej. A2027-0001
				</template>
			</LnxInput>
			<LnxInput v-model="form.rectSeries" required>
				Serie de rectificativas
			</LnxInput>
		</div>
		<p v-if="office && normalizeTaxId(form.nif) !== office.nif && isValidNif(form.nif)" class="hint">
			<LnxIcon icon="lucide:info" />
			Con otro NIF el registro Verifactu empieza una cadena nueva.
		</p>

		<footer class="form-actions">
			<p v-if="formError" class="error" role="alert">
				{{ formError }}
			</p>
			<LnxButton type="submit" :is-loading="saving">
				Guardar
				<LnxKbd combo="mod+enter" />
			</LnxButton>
		</footer>
	</form>
</template>

<style lang="scss" scoped>
.page-header {
	margin-bottom: var(--lnx-spacing-5);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);

	h1 {
		flex: 1;
		font-size: var(--lnx-font-size-title);
	}
}

.card {
	padding: var(--lnx-spacing-5);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-4);
}

.fields {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
	align-items: start;
	gap: var(--lnx-spacing-3) var(--lnx-spacing-4);

	.wide {
		grid-column: 1 / -1;
	}
}

.form-actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: flex-end;
	gap: var(--lnx-spacing-2);

	.error {
		flex: 1;
	}
}

.hint {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}
</style>
