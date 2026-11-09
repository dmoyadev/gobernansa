<script setup lang="ts">
import type { FeeInvoice } from '@gobernansa/shared/domain/billing.ts';
import type { BudgetItem } from '@gobernansa/shared/domain/finance.ts';
import type { VerifactuRecord } from '@gobernansa/shared/domain/verifactu.ts';
import { formatIban } from '@gobernansa/shared/domain/community.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { qrUrl, recordKinds, suministroXml } from '@gobernansa/shared/domain/verifactu.ts';
import { LnxButton, LnxIcon, LnxSelect } from 'lnxjs-components';
import { renderSVG } from 'uqr';
import { computed, onMounted, ref } from 'vue';
import BackButton from '@/app/ux/BackButton.vue';
import { downloadFile } from '@/app/ux/download.ts';
import { onRevalidate } from '@/app/ux/navigation.ts';
import { toast } from '@/app/ux/toast.ts';
import { annulInvoice, loadBudgetItems, loadInvoice, loadInvoiceRecords, recordInBooks, useOffice } from '../application/useBilling.ts';

const props = defineProps<{ invoiceId: string }>();

const ADMINISTRATION_REGEX = /administra/i;

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'long' });
const { data: office } = useOffice();

// Read once: an invoice only changes from here
const invoice = ref<FeeInvoice>();
const records = ref<VerifactuRecord[]>([]);
const loading = ref(true);
const error = ref<string>();

async function load() {
	try {
		[invoice.value, records.value] = await Promise.all([loadInvoice(props.invoiceId), loadInvoiceRecords(props.invoiceId)]);
		error.value = invoice.value ? undefined : 'No existe esta factura.';
	} catch (e) {
		if (invoice.value) {
			toast(`No se ha podido actualizar: ${(e as Error).message}`, { tone: 'error' });
		} else {
			error.value = `No se ha podido cargar: ${(e as Error).message}`;
		}
	} finally {
		loading.value = false;
	}
}

onMounted(load);
onRevalidate(load);

// ISO/IEC 18004 with error correction M, as the order asks
const qr = computed(() => invoice.value && renderSVG(qrUrl(invoice.value), { ecc: 'M', border: 2 }));

function print() {
	window.print();
}

function download(record: VerifactuRecord) {
	downloadFile(`${record.issuer.nif}-${record.number}-${record.kind}.xml`, suministroXml(record.issuer, [record]), 'application/xml');
}

const busy = ref(false);
const actionError = ref<string>();

async function annul() {
	// eslint-disable-next-line no-alert
	if (!invoice.value || !window.confirm(`¿Anular el registro de la ${invoice.value.number}? Solo si la factura no llegó a emitirse: si la comunidad ya la tiene, haz una rectificativa.`)) {
		return;
	}
	busy.value = true;
	actionError.value = undefined;
	try {
		await annulInvoice(invoice.value);
		toast('Registro de anulación generado');
		await load();
	} catch (e) {
		actionError.value = `No se ha podido anular: ${(e as Error).message}`;
	} finally {
		busy.value = false;
	}
}

/* In the community's books */

const items = ref<BudgetItem[]>();
const itemId = ref('');
const itemOptions = computed(() => (items.value ?? []).map(item => ({ value: item.id, label: item.name })));

async function startRecording() {
	actionError.value = undefined;
	try {
		items.value = await loadBudgetItems(invoice.value!.communityId, invoice.value!.year);
		// The administration partida if there's one
		itemId.value = items.value.find(item => ADMINISTRATION_REGEX.test(item.name))?.id ?? items.value[0]?.id ?? '';
	} catch (e) {
		actionError.value = `No se ha podido cargar su presupuesto: ${(e as Error).message}`;
	}
}

async function record() {
	if (!invoice.value || !office.value || !itemId.value || busy.value) {
		return;
	}
	busy.value = true;
	actionError.value = undefined;
	try {
		await recordInBooks(invoice.value, office.value, itemId.value);
		items.value = undefined;
		toast('Anotada como factura pendiente de pago en las cuentas de la comunidad');
		await load();
	} catch (e) {
		actionError.value = `No se ha podido anotar: ${(e as Error).message}`;
	} finally {
		busy.value = false;
	}
}
</script>

<template>
	<header class="page-header">
		<BackButton to="/billing" label="Volver a honorarios" />
		<h1>{{ invoice?.number ?? 'Factura' }}</h1>
		<LnxButton :disabled="loading || !!error" @click="print()">
			<LnxIcon icon="lucide:printer" />
			Imprimir / Guardar PDF
		</LnxButton>
	</header>

	<p v-if="error" class="error" role="alert">
		{{ error }}
	</p>
	<article v-else-if="loading" class="sheet" aria-busy="true" aria-label="Cargando">
		<span class="skeleton-item" style="width: 55%" />
		<span class="skeleton-item skeleton-item--small" style="width: 40%" />
		<span v-for="width in [100, 96, 70]" :key="width" class="skeleton-item" :style="{ width: `${width}%` }" />
	</article>
	<template v-else-if="invoice">
		<section class="panel">
			<div class="actions">
				<span class="chip test">Modo de prueba</span>
				<span v-if="invoice.annulled" class="chip debt">Anulada</span>
				<span v-for="number in invoice.rectifiedBy ?? []" :key="number" class="chip">Rectificada por {{ number }}</span>
				<span class="spacer" />
				<LnxButton v-if="!invoice.annulled" :to="`/billing/${invoice.id}/rectify`" mode="clear" class="size-small">
					<LnxIcon icon="lucide:file-pen" />
					Rectificar
				</LnxButton>
				<LnxButton v-if="!invoice.annulled && !invoice.expenseId && !items" mode="clear" class="size-small" :disabled="!office" @click="startRecording()">
					<LnxIcon icon="lucide:book-plus" />
					Anotar en sus cuentas
				</LnxButton>
				<RouterLink v-if="invoice.expenseId" :to="`/communities/${invoice.communityId}/payables`" class="chip ok">
					En sus cuentas
				</RouterLink>
				<LnxButton v-if="!invoice.annulled && !invoice.rectifiedBy?.length && !invoice.expenseId" mode="clear" class="size-small" variant="danger" :is-loading="busy" @click="annul()">
					Anular registro
				</LnxButton>
			</div>

			<form v-if="items" class="record ux-appear" @submit.prevent="record()">
				<template v-if="items.length">
					<LnxSelect v-model.convert="itemId" :options="itemOptions" :convert-fn="option => option.value">
						Partida del presupuesto {{ invoice.year }}
						<template #option="{ option }">
							{{ option.label }}
						</template>
						<template #optionInput="{ value }">
							{{ itemOptions.find(option => option.value === value)?.label }}
						</template>
					</LnxSelect>
					<p class="hint">
						Queda como factura del despacho pendiente de pago, con su IVA y su retención, para los modelos 111 y 190.
					</p>
				</template>
				<p v-else class="hint">
					La comunidad no tiene presupuesto de {{ invoice.year }}.
					<RouterLink :to="`/communities/${invoice.communityId}/budget`">
						Crea antes sus partidas
					</RouterLink>
				</p>
				<footer class="form-actions">
					<LnxButton type="button" mode="clear" @click="items = undefined">
						Cancelar
					</LnxButton>
					<LnxButton type="submit" :is-loading="busy" :disabled="!itemId">
						Anotar
					</LnxButton>
				</footer>
			</form>
			<p v-if="actionError" class="error" role="alert">
				{{ actionError }}
			</p>
		</section>

		<article class="sheet ux-appear">
			<header class="parties">
				<div>
					<strong>{{ invoice.issuer.name }}</strong>
					<span>NIF {{ invoice.issuer.nif }}</span>
					<span>{{ invoice.issuer.address }}</span>
				</div>
				<div class="title">
					<h2>{{ invoice.type === 'R1' ? 'Factura rectificativa' : 'Factura' }}</h2>
					<span>Nº <strong class="tabular">{{ invoice.number }}</strong></span>
					<span>{{ dateFormat.format(new Date(`${invoice.date}T00:00`)) }}</span>
				</div>
			</header>

			<div class="recipient">
				<small>Cliente</small>
				<strong>{{ invoice.recipient.name }}</strong>
				<span>CIF {{ invoice.recipient.nif }}</span>
				<span>{{ invoice.recipient.address }}</span>
			</div>

			<p v-if="invoice.rectifies">
				Rectifica por diferencias la factura {{ invoice.rectifies.number }} del {{ dateFormat.format(new Date(`${invoice.rectifies.date}T00:00`)) }} (art. 80 LIVA).
			</p>

			<table>
				<thead>
					<tr>
						<th>Concepto</th>
						<th class="amount">
							Base
						</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="(line, index) in invoice.lines" :key="index">
						<td>{{ line.concept }}</td>
						<td class="amount tabular">
							{{ formatCents(line.base) }}
						</td>
					</tr>
				</tbody>
				<tfoot class="tabular">
					<tr>
						<th>Base imponible</th>
						<td class="amount">
							{{ formatCents(invoice.base) }}
						</td>
					</tr>
					<tr>
						<th>IVA {{ invoice.vatRate }} %</th>
						<td class="amount">
							{{ formatCents(invoice.vat) }}
						</td>
					</tr>
					<tr>
						<th>Total factura</th>
						<td class="amount">
							{{ formatCents(invoice.total) }}
						</td>
					</tr>
					<tr v-if="invoice.withholdingRate">
						<th>Retención IRPF {{ invoice.withholdingRate }} %</th>
						<td class="amount">
							{{ formatCents(-invoice.withholding) }}
						</td>
					</tr>
					<tr class="payable">
						<th>Total a pagar</th>
						<td class="amount">
							{{ formatCents(invoice.payable) }}
						</td>
					</tr>
				</tfoot>
			</table>

			<p v-if="invoice.issuer.iban && invoice.payable > 0">
				Forma de pago: transferencia a la cuenta <span class="tabular">{{ formatIban(invoice.issuer.iban) }}</span>.
			</p>

			<footer class="verifactu">
				<div class="qr">
					<small>QR tributario:</small>
					<!-- eslint-disable-next-line vue/no-v-html -- an SVG made here from the invoice's own data -->
					<div class="code" v-html="qr" />
					<strong>VERI*FACTU</strong>
				</div>
				<div>
					<p>Factura verificable en la sede electrónica de la AEAT</p>
					<small>Entorno de pruebas: la factura no se ha remitido a la AEAT.</small>
					<small v-if="invoice.annulled">Registro anulado.</small>
				</div>
			</footer>
		</article>

		<section class="panel registry">
			<h2>Registros Verifactu</h2>
			<ul>
				<li v-for="item in records" :key="item.id" class="entry">
					<div class="what">
						<span>{{ recordKinds[item.kind] }} · nº {{ item.seq }} de la cadena · {{ item.generatedAt }}</span>
						<small class="tabular huella" :title="item.huella">Huella {{ item.huella }}</small>
						<small class="tabular">
							{{ item.previous ? `Encadenado a ${item.previous.number} (${item.previous.huella.slice(0, 12)}…)` : 'Primer registro' }}
							· Enviado (simulado, entorno de pruebas), CSV {{ item.submission.csv }}
						</small>
					</div>
					<LnxButton mode="clear" class="size-small" shape="circle" aria-label="Descargar XML" title="Descargar XML" @click="download(item)">
						<LnxIcon icon="lucide:download" />
					</LnxButton>
				</li>
			</ul>
		</section>
	</template>
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

.panel {
	max-width: 210mm;
	margin: 0 auto var(--lnx-spacing-5);
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);

	h2 {
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
		color: var(--color-gray-6);
		text-transform: uppercase;
		letter-spacing: .04em;
	}
}

.registry {
	margin-top: var(--lnx-spacing-5);
}

.actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--lnx-spacing-2);

	.spacer {
		flex: 1;
	}
}

.record {
	padding: var(--lnx-spacing-4);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
}

.form-actions {
	display: flex;
	justify-content: flex-end;
	gap: var(--lnx-spacing-2);
}

.entry {
	padding: var(--lnx-spacing-2) 0;
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	align-items: center;
	gap: var(--lnx-spacing-3);

	& + & {
		border-top: 1px solid var(--color-gray-3);
	}
}

.what {
	display: flex;
	flex-direction: column;
	min-width: 0;

	small {
		color: var(--color-gray-6);
	}

	.huella {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
}

.chip {
	padding: 2px var(--lnx-spacing-2);
	border-radius: 999px;
	background: var(--color-gray-2);
	font-size: var(--lnx-font-size-small);
	white-space: nowrap;
	text-decoration: none;

	&.ok {
		color: var(--color-primary);
	}

	&.debt {
		color: var(--color-secondary-accent);
	}

	&.test {
		color: var(--color-gray-7);
	}
}

// An A4 page on screen, the same on paper
.sheet {
	max-width: 210mm;
	min-height: 297mm;
	margin: 0 auto;
	padding: 20mm;
	background: #FFFFFF;
	color: #000000;
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000014;
	display: flex;
	flex-direction: column;
	gap: 8mm;
	font-size: 10pt;
	line-height: 1.5;
}

.parties {
	display: flex;
	justify-content: space-between;
	gap: 10mm;

	div {
		display: flex;
		flex-direction: column;
	}

	.title {
		align-items: flex-end;
		text-align: right;
	}

	h2 {
		font-size: 15pt;
		text-transform: uppercase;
	}
}

.recipient {
	padding: 4mm;
	border: 1px solid #CCCCCC;
	display: flex;
	flex-direction: column;

	small {
		color: #555555;
		text-transform: uppercase;
		font-size: 8pt;
	}
}

table {
	width: 100%;
	border-collapse: collapse;

	th,
	td {
		padding: 1.5mm 2mm;
		border-bottom: 1px solid #CCCCCC;
		text-align: left;
	}

	tfoot th {
		font-weight: normal;
		text-align: right;
	}

	.amount {
		width: 35mm;
		text-align: right;
	}

	.payable {
		font-weight: bold;

		th {
			font-weight: bold;
		}
	}
}

.verifactu {
	margin-top: auto;
	display: flex;
	align-items: center;
	gap: 6mm;

	.qr {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1mm;
	}

	// Between 30 and 40 mm, as the order asks
	.code {
		width: 35mm;
		height: 35mm;

		:deep(svg) {
			width: 100%;
			height: 100%;
		}
	}

	div {
		display: flex;
		flex-direction: column;
	}

	small {
		color: #555555;
	}
}

.hint {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);

	a {
		color: var(--color-primary);
	}
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}

@page {
	size: A4;
	margin: 20mm;
}

@media print {
	.page-header,
	.panel {
		display: none;
	}

	.sheet {
		max-width: none;
		min-height: calc(297mm - 40mm);
		padding: 0;
		box-shadow: none;
	}
}
</style>
