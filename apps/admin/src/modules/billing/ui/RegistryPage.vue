<script setup lang="ts">
import type { VerifactuRecord } from '@gobernansa/shared/domain/verifactu.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { brokenLink, recordKinds, suministroXml } from '@gobernansa/shared/domain/verifactu.ts';
import { LnxButton, LnxIcon, LnxSelect } from 'lnxjs-components';
import { onMounted, ref, watch } from 'vue';
import BackButton from '@/app/ux/BackButton.vue';
import { downloadFile } from '@/app/ux/download.ts';
import { onRevalidate } from '@/app/ux/navigation.ts';
import { loadRecords } from '../application/useBilling.ts';

// What one submission to AEAT takes
const RECORDS_PER_FILE = 1000;

const currentYear = new Date().getFullYear();
const year = ref(currentYear);
const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i).map(value => ({ value, label: String(value) }));

// The year's records, read once: they're only added, from the invoices
const records = ref<VerifactuRecord[]>([]);
const broken = ref<VerifactuRecord | null>();
const loading = ref(true);
const loadError = ref<string>();

async function load() {
	const loadedYear = year.value;
	try {
		const loaded = await loadRecords(loadedYear);
		if (loadedYear === year.value) {
			records.value = loaded;
			// Checked here, recomputing every huella: a record changed in the database wouldn't match
			broken.value = (await brokenLink(loaded)) ?? null;
			loadError.value = undefined;
		}
	} catch (e) {
		loadError.value = `No se ha podido cargar el registro: ${(e as Error).message}`;
	} finally {
		loading.value = false;
	}
}

onMounted(load);
onRevalidate(load);
watch(year, () => {
	loading.value = true;
	records.value = [];
	broken.value = undefined;
	void load();
});

// One file per issuer (the office's NIF may have changed) and per thousand records
function downloadYear() {
	const issuers = Map.groupBy(records.value, record => record.issuer.nif);
	for (const [nif, list] of issuers) {
		for (let start = 0; start < list.length; start += RECORDS_PER_FILE) {
			const part = list.length > RECORDS_PER_FILE ? `-${start / RECORDS_PER_FILE + 1}` : '';
			downloadFile(`verifactu-${nif}-${year.value}${part}.xml`, suministroXml(list[0].issuer, list.slice(start, start + RECORDS_PER_FILE)), 'application/xml');
		}
	}
}
</script>

<template>
	<header class="page-header">
		<BackButton to="/billing" label="Volver a honorarios" />
		<h1>Registro Verifactu</h1>
		<LnxButton mode="clear" class="lnx-size-small" :disabled="!records.length" @click="downloadYear()">
			<LnxIcon icon="lucide:file-code" />
			Descargar XML del año
		</LnxButton>
	</header>

	<p class="intro hint">
		<span class="chip test">Modo de prueba</span>
		Los registros se generan y encadenan como pide la AEAT, pero el envío se simula: remitirlos necesita el certificado del despacho y un servidor.
	</p>

	<section class="card">
		<div class="toolbar">
			<LnxSelect v-model.convert="year" :options="yearOptions" :convert-fn="option => option.value">
				Año
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ value }}
				</template>
			</LnxSelect>
			<p v-if="broken" class="error" role="alert">
				<LnxIcon icon="lucide:shield-alert" />
				La cadena se rompe en el registro nº {{ broken.seq }} ({{ broken.number }}): falta el anterior o su huella no cuadra.
			</p>
			<p v-else-if="broken === null && records.length" class="ok">
				<LnxIcon icon="lucide:shield-check" />
				Cadena íntegra: {{ records.length }} {{ records.length === 1 ? 'registro' : 'registros' }} comprobados
			</p>
		</div>
		<p v-if="loadError" class="error" role="alert">
			{{ loadError }}
		</p>

		<ul v-if="loading" class="list" aria-busy="true" aria-label="Cargando">
			<li v-for="width in [60, 45, 55]" :key="width" class="entry">
				<span class="what">
					<span class="lnx-skeleton" :style="{ width: `${width}%` }" />
					<span class="lnx-skeleton lnx-skeleton--small" :style="{ width: `${width + 20}%` }" />
				</span>
			</li>
		</ul>
		<ol v-else-if="records.length" class="list lnx-appear">
			<li v-for="record in records" :key="record.id" class="entry">
				<span class="seq tabular">{{ record.seq }}</span>
				<RouterLink :to="`/billing/${record.invoiceId}`" class="what">
					<span>
						<strong>{{ recordKinds[record.kind] }}</strong> · <span class="tabular">{{ record.number }}</span> del {{ record.date }}
						<template v-if="record.total !== undefined"> · {{ formatCents(record.total) }}</template>
					</span>
					<small class="tabular huella" :title="record.huella">{{ record.huella }}</small>
					<small class="tabular">{{ record.generatedAt }} · Enviado (simulado, entorno de pruebas) · CSV {{ record.submission.csv }}</small>
				</RouterLink>
			</li>
		</ol>
		<p v-else class="hint">
			No hay registros en {{ year }}.
		</p>
	</section>
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

.intro {
	margin-bottom: var(--lnx-spacing-4);
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--lnx-spacing-2);
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

.toolbar {
	display: grid;
	grid-template-columns: 160px minmax(0, 1fr);
	align-items: end;
	gap: var(--lnx-spacing-4);

	p {
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-2);
	}
}

.list {
	display: flex;
	flex-direction: column;
}

.entry {
	padding: var(--lnx-spacing-2) 0;
	display: grid;
	grid-template-columns: 3ch minmax(0, 1fr);
	align-items: start;
	gap: var(--lnx-spacing-3);

	& + & {
		border-top: 1px solid var(--color-gray-3);
	}
}

.seq {
	color: var(--color-gray-6);
	text-align: right;
}

.what {
	display: flex;
	flex-direction: column;
	min-width: 0;
	color: inherit;
	text-decoration: none;

	small {
		overflow: hidden;
		color: var(--color-gray-6);
		white-space: nowrap;
		text-overflow: ellipsis;
	}
}

.chip {
	padding: 2px var(--lnx-spacing-2);
	border-radius: 999px;
	background: var(--color-gray-2);
	color: var(--color-gray-7);
	font-size: var(--lnx-font-size-small);
	white-space: nowrap;
}

.ok {
	color: var(--color-primary);
	font-size: var(--lnx-font-size-small);
}

.hint {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}

@media (max-width: 640px) {
	.toolbar {
		grid-template-columns: 1fr;
	}
}
</style>
