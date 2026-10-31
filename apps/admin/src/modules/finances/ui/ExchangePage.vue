<script setup lang="ts">
import type { ImportColumns, ImportRow } from '@gobernansa/shared/domain/exchange.ts';
import type { Charge } from '@gobernansa/shared/domain/finance.ts';
import type { Property } from '@gobernansa/shared/domain/property.ts';
import type { Timestamp } from 'firebase/firestore';
import { buildLedger, entryKinds, sortedAccounts, toCsv } from '@gobernansa/shared/domain/accounting.ts';
import { decodeText, parseCsv } from '@gobernansa/shared/domain/bank.ts';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { csvDate, guessImportColumns, importTemplate, readImport, xdiario } from '@gobernansa/shared/domain/exchange.ts';
import { chargeTypes, isOverdue, payableAmount, paymentMethods } from '@gobernansa/shared/domain/finance.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { propertyTypeLabels } from '@gobernansa/shared/domain/property.ts';
import DatePicker from '@gobernansa/shared/ui/DatePicker.vue';
import { LnxButton, LnxIcon, LnxSelect } from 'lnxjs-components';
import { computed, ref, useTemplateRef, watch } from 'vue';
import BackButton from '@/app/ux/BackButton.vue';
import Kbd from '@/app/ux/Kbd.vue';
import { useShortcut } from '@/app/ux/shortcuts.ts';
import { toast } from '@/app/ux/toast.ts';
import { loadLedgerData } from '../application/useAccounting.ts';
import { importCharges, loadBalances, loadImportedIds, loadInvoices, loadProperties, loadYearCharges } from '../application/useExchange.ts';
import { deleteCharges } from '../application/useFinances.ts';

const props = defineProps<{ id: string }>();

const currentYear = new Date().getFullYear();
const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear - i).map(value => ({ value, label: String(value) }));
const year = ref(currentYear);
const DAY_MS = 86_400_000;

function day(timestamp?: Timestamp | null) {
	return timestamp ? csvDate(toDateString(timestamp.toDate())) : '';
}

// As a deed writes it, without the % so a spreadsheet takes it as a number
function decimalText(value = 0) {
	return value.toLocaleString('es', { maximumFractionDigits: 4, useGrouping: false });
}

/* Exports: each one reads what it needs when it's asked for */

interface ExportFile {
	name: string;
	content: string | Uint8Array<ArrayBuffer>;
	type: string;
}

const exports: { key: string; group: 'sheets' | 'accounting'; title: string; description: string; yearly?: boolean; run: () => Promise<ExportFile> }[] = [
	{ key: 'charges', group: 'sheets', title: 'Recibos y derramas', description: 'Cada recibo que vence en el año, con su estado, fecha de pago y devoluciones.', yearly: true, run: exportCharges },
	{ key: 'balances', group: 'sheets', title: 'Saldos por propiedad', description: 'Lo vencido y lo pendiente de cada propiedad a hoy.', run: exportBalances },
	{ key: 'debtors', group: 'sheets', title: 'Morosos', description: 'Cada recibo vencido sin pagar a hoy, con los días de retraso y el email del propietario.', run: exportDebtors },
	{ key: 'invoices', group: 'sheets', title: 'Facturas de proveedores', description: 'Las facturas del año con base, IVA, retención, vencimiento y pago.', yearly: true, run: exportInvoices },
	{ key: 'journal', group: 'accounting', title: 'Libro diario (CSV)', description: 'Una fila por apunte: asiento, fecha, cuenta, concepto, debe y haber.', yearly: true, run: async () => exportJournal('csv') },
	{ key: 'chart', group: 'accounting', title: 'Plan de cuentas (CSV)', description: 'Las cuentas y subcuentas del año, para darlas de alta antes de importar el diario.', yearly: true, run: async () => exportJournal('chart') },
	{ key: 'xdiario', group: 'accounting', title: 'Diario para ContaPlus (XDiario.dbf)', description: 'La tabla de asientos de ContaPlus en dBase, con subcuentas de 8 dígitos e importes en euros.', yearly: true, run: async () => exportJournal('dbf') },
];
const exportGroups = [
	{ key: 'sheets', title: 'Para Excel', hint: 'CSV en UTF-8, separado por punto y coma y con coma decimal: se abre tal cual en Excel, Numbers o LibreOffice.' },
	{ key: 'accounting', title: 'Para otro programa de contabilidad', hint: 'El diario de la contabilidad. El CSV es genérico; el .dbf es la tabla XDiario de ContaPlus, que se importa desde sus utilidades y también leen A3 y otros programas. Da de alta antes las subcuentas del plan de cuentas.' },
];
const busy = ref<string>();

function download({ name, content, type }: ExportFile) {
	const url = URL.createObjectURL(new Blob([content], { type }));
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = name;
	anchor.click();
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function csvFile(name: string, rows: (string | number)[][]): ExportFile {
	return { name: `${name}.csv`, content: toCsv(rows), type: 'text/csv;charset=utf-8' };
}

async function runExport(item: typeof exports[number]) {
	if (busy.value) {
		return;
	}
	busy.value = item.key;
	try {
		download(await item.run());
	} catch (e) {
		toast(`No se ha podido exportar: ${(e as Error).message}`, { tone: 'error' });
	} finally {
		busy.value = undefined;
	}
}

function chargeStatus(charge: Charge) {
	return charge.paidAt ? 'Pagado' : charge.returns?.length ? 'Devuelto' : isOverdue(charge) ? 'Vencido' : 'Pendiente';
}

async function exportCharges() {
	const charges = await loadYearCharges(props.id, year.value);
	return csvFile(`recibos-${year.value}`, [
		['Propiedad', 'Propietario', 'Tipo', 'Concepto', 'Vencimiento', 'Importe', 'Fondo de reserva', 'Estado', 'Fecha de pago', 'Devoluciones', 'Identificador'],
		...charges.map(charge => [charge.propertyName, charge.ownerName ?? '', chargeTypes[charge.type], charge.concept, day(charge.dueDate), charge.amount, charge.reserve ?? 0, chargeStatus(charge), day(charge.paidAt), String(charge.returns?.length ?? 0), charge.id]),
	]);
}

const today = toDateString(new Date());

async function exportBalances() {
	const { properties, unpaid } = await loadBalances(props.id);
	const byProperty = Object.groupBy(unpaid, charge => charge.propertyId);
	return csvFile(`saldos-${today}`, [
		['Propiedad', 'Tipo', 'Propietario', 'Coeficiente', 'Vencido', 'Por vencer', 'Total pendiente', 'Estado'],
		...properties.map((property) => {
			const charges = byProperty[property.id] ?? [];
			const overdue = charges.filter(charge => isOverdue(charge)).reduce((sum, charge) => sum + charge.amount, 0);
			const total = charges.reduce((sum, charge) => sum + charge.amount, 0);
			return [property.name, propertyTypeLabels[property.type], property.ownerName ?? charges[0]?.ownerName ?? '', decimalText(property.coefficient), overdue, total - overdue, total, overdue ? 'Deudor' : 'Al corriente'];
		}),
	]);
}

async function exportDebtors() {
	const { properties, unpaid } = await loadBalances(props.id);
	const byId = new Map(properties.map(property => [property.id, property]));
	const now = Date.now();
	const overdue = unpaid.filter(charge => isOverdue(charge))
		.sort((a, b) => a.propertyName.localeCompare(b.propertyName, 'es', { numeric: true }) || a.dueDate.toMillis() - b.dueDate.toMillis());
	return csvFile(`morosos-${today}`, [
		['Propiedad', 'Propietario', 'Email', 'Tipo', 'Concepto', 'Vencimiento', 'Días de retraso', 'Importe'],
		...overdue.map((charge) => {
			const property = byId.get(charge.propertyId);
			return [charge.propertyName, property?.ownerName ?? charge.ownerName ?? '', property?.ownerEmail ?? '', chargeTypes[charge.type], charge.concept, day(charge.dueDate), String(Math.floor((now - charge.dueDate.toMillis()) / DAY_MS)), charge.amount];
		}),
	]);
}

async function exportInvoices() {
	const { expenses, items } = await loadInvoices(props.id, year.value);
	const names = new Map(items.map(item => [item.id, item.name]));
	return csvFile(`facturas-${year.value}`, [
		['Fecha', 'Número', 'Proveedor', 'NIF', 'Partida', 'Concepto', 'Base imponible', 'IVA %', 'IVA', 'Retención %', 'Retención', 'Total factura', 'A pagar', 'Vencimiento', 'Estado', 'Fecha de pago', 'Forma de pago', 'Con fondo de reserva'],
		...expenses.map(expense => [
			day(expense.date),
			expense.invoiceNumber ?? '',
			expense.provider?.name ?? '',
			expense.provider?.nif ?? '',
			names.get(expense.itemId) ?? '',
			expense.concept,
			expense.base ?? expense.amount,
			decimalText(expense.vatRate),
			expense.vat ?? 0,
			decimalText(expense.withholdingRate),
			expense.withholding ?? 0,
			expense.amount,
			payableAmount(expense),
			day(expense.dueDate),
			// Older ones have no paidAt and count as paid
			expense.paidAt === null ? 'Pendiente' : 'Pagada',
			day(expense.paidAt),
			expense.paymentMethod ? paymentMethods[expense.paymentMethod] : '',
			expense.fromReserve ? 'Sí' : 'No',
		]),
	]);
}

async function exportJournal(format: 'csv' | 'chart' | 'dbf'): Promise<ExportFile> {
	const ledger = buildLedger({ ...await loadLedgerData(props.id, year.value), year: year.value });
	const account = (key: string) => ledger.accounts.get(key);
	if (format === 'dbf') {
		return { name: `XDiario-${year.value}.dbf`, content: xdiario(ledger.entries, ledger.accounts), type: 'application/x-dbase' };
	}
	if (format === 'chart') {
		return csvFile(`plan-de-cuentas-${year.value}`, [['Cuenta', 'Nombre'], ...sortedAccounts(ledger.accounts).map(item => [item.code, item.name])]);
	}
	return csvFile(`libro-diario-${year.value}`, [
		['Asiento', 'Fecha', 'Tipo', 'Concepto', 'Cuenta', 'Nombre de la cuenta', 'Debe', 'Haber'],
		...ledger.entries.flatMap((entry, index) => entry.lines.map(item => [String(index + 1), csvDate(entry.date), entryKinds[entry.kind], entry.concept, account(item.account)?.code ?? item.account, account(item.account)?.name ?? '', item.debit, item.credit])),
	]);
}

/* Import of the debt and the history of each property */

const balanceDate = ref(`${currentYear - 1}-12-31`);
const fileInput = useTemplateRef('fileInput');
const draft = ref<{ name: string; rows: string[][]; columns: ImportColumns; properties: Property[]; existing: Set<string> }>();
const preview = ref<ImportRow[]>([]);
const reading = ref(false);
const importing = ref(false);
const importError = ref<string>();

useShortcut('i', () => fileInput.value?.click(), 'Importar saldos');

function downloadTemplate() {
	download(csvFile('plantilla-saldos', importTemplate));
}

async function readFile(event: Event) {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	input.value = '';
	if (!file) {
		return;
	}
	importError.value = undefined;
	reading.value = true;
	try {
		const rows = parseCsv(decodeText(await file.arrayBuffer()));
		const columns = guessImportColumns(rows[0] ?? []);
		if (rows.length < 2 || columns.property === -1 || columns.amount === -1) {
			draft.value = undefined;
			importError.value = rows.length < 2
				? 'El fichero está vacío o no se entiende.'
				: 'No se encuentran las columnas de la propiedad y del importe: la primera fila debe tener los títulos, como en la plantilla.';
			return;
		}
		const [properties, existing] = await Promise.all([loadProperties(props.id), loadImportedIds(props.id)]);
		draft.value = { name: file.name, rows, columns, properties, existing };
	} catch (e) {
		importError.value = `No se ha podido leer: ${(e as Error).message}`;
	} finally {
		reading.value = false;
	}
}

// Read again when the date of the balances changes, as rows without a due date or a concept take it
watch([draft, balanceDate], async () => {
	const current = draft.value;
	preview.value = current && balanceDate.value ? await readImport(current.rows, current.columns, current.properties, balanceDate.value) : [];
});

const newRows = computed(() => preview.value.filter(row => !row.error && !draft.value?.existing.has(row.id)));
const repeated = computed(() => preview.value.filter(row => !row.error && draft.value?.existing.has(row.id)).length);
const wrong = computed(() => preview.value.filter(row => row.error).length);
const pendingTotal = computed(() => newRows.value.reduce((sum, row) => sum + (row.paidAt ? 0 : row.amount), 0));

function rowStatus(row: ImportRow) {
	return row.error ?? (draft.value?.existing.has(row.id) ? 'Ya importado' : 'Nuevo');
}

async function importDraft() {
	if (!draft.value || importing.value || !newRows.value.length) {
		return;
	}
	const { name } = draft.value;
	importing.value = true;
	importError.value = undefined;
	try {
		const written = await importCharges(props.id, newRows.value, name);
		draft.value = undefined;
		const label = `los recibos importados de ${name}`;
		toast(`${written.length} ${written.length === 1 ? 'recibo importado' : 'recibos importados'}`, written.length
			? { undo: async () => deleteCharges(props.id, written, label) }
			: {});
	} catch (e) {
		importError.value = `No se ha podido importar: ${(e as Error).message}`;
	} finally {
		importing.value = false;
	}
}
</script>

<template>
	<header class="page-header">
		<BackButton :to="`/communities/${id}`" label="Volver a la comunidad" />
		<h1>Exportar e importar</h1>
		<LnxSelect
			v-model.convert="year"
			class="year"
			aria-label="Año"
			:options="yearOptions"
			:convert-fn="option => option.value"
			search-placeholder-text="Buscar..."
		>
			<template #option="{ option }">
				{{ option.label }}
			</template>
			<template #optionInput="{ value }">
				{{ value }}
			</template>
		</LnxSelect>
	</header>

	<section v-for="group in exportGroups" :key="group.key" class="card">
		<h2>{{ group.title }}</h2>
		<p class="hint">
			{{ group.hint }}
		</p>
		<ul class="exports">
			<li v-for="item in exports.filter(other => other.group === group.key)" :key="item.key">
				<div>
					<strong>{{ item.title }}{{ item.yearly ? ` ${year}` : '' }}</strong>
					<span class="hint">{{ item.description }}</span>
				</div>
				<LnxButton mode="outline" size="small" :disabled="!!busy" @click="runExport(item)">
					<LnxIcon :icon="busy === item.key ? 'lucide:loader-circle' : 'lucide:download'" :class="{ spin: busy === item.key }" />
					Descargar
				</LnxButton>
			</li>
		</ul>
	</section>

	<section class="card">
		<h2>Importar saldos e histórico de recibos</h2>
		<p class="hint">
			Para traer la morosidad desde otro programa: un CSV con una fila por recibo pendiente (o el saldo de cada propiedad) y, si quieres, también los ya pagados.
			Las propiedades se buscan por su nombre en el censo. Importar el mismo fichero otra vez solo añade lo que falte.
		</p>
		<div class="import-actions">
			<DatePicker v-model="balanceDate" required>
				Fecha de los saldos
				<template #helper>
					Para las filas sin vencimiento
				</template>
			</DatePicker>
			<LnxButton mode="clear" size="small" @click="downloadTemplate()">
				<LnxIcon icon="lucide:file-spreadsheet" />
				Descargar plantilla
			</LnxButton>
			<input ref="fileInput" type="file" accept=".csv,.txt,text/csv,text/plain" hidden @change="readFile">
			<LnxButton size="small" :disabled="reading || importing" @click="fileInput?.click()">
				<LnxIcon icon="lucide:upload" />
				Elegir fichero
				<Kbd combo="i" />
			</LnxButton>
		</div>

		<p v-if="importError" class="error" role="alert">
			{{ importError }}
		</p>
		<div v-if="reading" class="lines" aria-busy="true" aria-label="Leyendo">
			<span v-for="width in [90, 80, 95]" :key="width" class="skeleton-item" :style="{ width: `${width}%` }" />
		</div>

		<template v-else-if="draft">
			<p class="summary">
				<strong>{{ draft.name }}</strong>:
				{{ newRows.length }} {{ newRows.length === 1 ? 'recibo nuevo' : 'recibos nuevos' }}<template v-if="pendingTotal">
					({{ formatCents(pendingTotal) }} pendiente)
				</template><template v-if="repeated">
					· {{ repeated }} ya importados
				</template><template v-if="wrong">
					· <span class="debt">{{ wrong }} con errores, no se importan</span>
				</template>
			</p>
			<div class="table">
				<table class="ux-appear">
					<thead>
						<tr>
							<th>Fila</th>
							<th>Propiedad</th>
							<th>Concepto</th>
							<th>Tipo</th>
							<th>Vencimiento</th>
							<th>Pagado el</th>
							<th class="amount">
								Importe
							</th>
							<th>Resultado</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="row in preview" :key="row.line" :class="{ wrong: row.error, repeated: !row.error && draft.existing.has(row.id) }">
							<td class="tabular">
								{{ row.line }}
							</td>
							<td>{{ row.property?.name ?? row.text }}</td>
							<td>{{ row.concept }}</td>
							<td>{{ chargeTypes[row.type] }}</td>
							<td>{{ csvDate(row.dueDate) }}</td>
							<td>{{ csvDate(row.paidAt) }}</td>
							<td class="amount">
								{{ Number.isNaN(row.amount) ? '' : formatCents(row.amount) }}
							</td>
							<td :class="{ debt: row.error }">
								{{ rowStatus(row) }}
							</td>
						</tr>
					</tbody>
				</table>
			</div>
			<div class="import-actions">
				<LnxButton :disabled="importing || !newRows.length" @click="importDraft()">
					<LnxIcon icon="lucide:check" />
					{{ importing ? 'Importando…' : `Importar ${newRows.length} ${newRows.length === 1 ? 'recibo' : 'recibos'}` }}
				</LnxButton>
				<LnxButton mode="clear" :disabled="importing" @click="draft = undefined">
					Descartar
				</LnxButton>
			</div>
		</template>
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

	.year {
		width: 110px;
	}
}

.card {
	margin-bottom: var(--lnx-spacing-5);
	padding: var(--lnx-spacing-5);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-4);

	h2 {
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
		color: var(--color-gray-6);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
}

.exports {
	display: flex;
	flex-direction: column;

	li {
		padding: var(--lnx-spacing-3) 0;
		border-top: 1px solid var(--color-gray-3);
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-3);

		div {
			flex: 1;
			display: flex;
			flex-direction: column;
		}
	}
}

.import-actions {
	display: flex;
	align-items: flex-end;
	gap: var(--lnx-spacing-3);
	flex-wrap: wrap;
}

.lines {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
}

.table {
	max-height: 420px;
	overflow: auto;
}

table {
	width: 100%;
	border-collapse: collapse;
	font-size: var(--lnx-font-size-small);

	th,
	td {
		padding: var(--lnx-spacing-2);
		border-bottom: 1px solid var(--color-gray-3);
		text-align: left;
		white-space: nowrap;
	}

	thead th {
		position: sticky;
		top: 0;
		background: var(--color-gray-0);
	}

	.amount {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.repeated td {
		color: var(--color-gray-6);
	}
}

.tabular {
	font-variant-numeric: tabular-nums;
}

.summary {
	font-size: var(--lnx-font-size-small);
}

.debt {
	color: var(--color-secondary-accent);
}

.hint {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}

.spin {
	animation: spin 1s linear infinite;
}

@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}
</style>
