<script setup lang="ts">
import type { Account, CustomAccount, FiscalYearClosing, JournalEntry, JournalLine, ManualEntry } from '@gobernansa/shared/domain/accounting.ts';
import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { Timestamp } from 'firebase/firestore';
import type { View } from '../application/accountingReports.ts';
import { failure } from '@gobernansa/shared/application/errors.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { buildLedger, closeYear, closingMatches, entryKinds, toCsv } from '@gobernansa/shared/domain/accounting.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { keepsBooks } from '@gobernansa/shared/domain/user.ts';
import { LnxButton, LnxIcon, LnxSelect, toast, useConfirm } from 'lnxjs-components';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { downloadFile } from '@/app/ux/download.ts';
import { onRevalidate } from '@/app/ux/navigation.ts';
import NewButton from '@/app/ux/NewButton.vue';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { useAccountingReports, views } from '../application/accountingReports.ts';
import { closeFiscalYear, deleteManualEntry, loadLedgerData, reopenFiscalYear, restoreFiscalYear, restoreManualEntry, saveManualEntry } from '../application/useAccounting.ts';
import ChartOfAccounts from './ChartOfAccounts.vue';
import ManualEntryForm from './ManualEntryForm.vue';
import YearStatements from './YearStatements.vue';

const props = defineProps<{ id: string }>();

const ask = useConfirm();
// Clerks keep the books day to day, but closing a year is for the office's owner and accountants (B3)
const { user } = useAuth();

type LedgerData = Awaited<ReturnType<typeof loadLedgerData>>;

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'short' });
const currentYear = new Date().getFullYear();
const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear + 1 - i).map(value => ({ value, label: String(value) }));
const year = ref(currentYear);

// The view in the address, so a search result opens the right one
const route = useRoute();
const router = useRouter();
const view = computed<View>({
	get: () => (Object.keys(views) as View[]).find(key => key === route.query.view) ?? 'journal',
	set: key => void router.replace({ query: { ...route.query, view: key } }),
});

/* Data: read once per year and kept while the page lives, read again when coming back */

const community = ref<Community>();
const cache = reactive(new Map<number, LedgerData>());
const loading = ref(true);
const error = ref<string>();

async function load(refresh = false) {
	const wanted = year.value;
	if (cache.has(wanted) && !refresh) {
		// Another year may still be loading or have failed
		loading.value = false;
		error.value = undefined;
		return;
	}
	loading.value = !cache.has(wanted);
	try {
		const [loadedCommunity, data] = await Promise.all([community.value && !refresh ? community.value : loadCommunity(props.id), loadLedgerData(props.id, wanted)]);
		community.value = loadedCommunity;
		cache.set(wanted, data);
		error.value = undefined;
	} catch (e) {
		if (cache.has(wanted)) {
			toast(failure('No se ha podido actualizar', e), { variant: 'danger' });
		} else {
			error.value = failure('No se ha podido cargar la contabilidad', e);
		}
	} finally {
		if (wanted === year.value) {
			loading.value = false;
		}
	}
}

const entryForm = ref<InstanceType<typeof ManualEntryForm>>();
const editingEntry = ref(false);

onMounted(load);
onRevalidate(async () => {
	// Other years are read again when they're chosen
	[...cache.keys()].filter(key => key !== year.value).forEach(key => cache.delete(key));
	await load(true);
});
watch(year, async () => {
	entryForm.value?.cancel();
	await load();
});

const data = computed(() => cache.get(year.value));
const ledger = computed(() => data.value && buildLedger({ ...data.value, year: year.value }));
const accounts = computed(() => ledger.value?.accounts ?? new Map<string, Account>());
const entries = computed(() => ledger.value?.entries ?? []);
const closing = computed(() => data.value?.closing);
const closed = computed(() => !!closing.value);
const proposedClosing = computed(() => closeYear(entries.value, accounts.value));
const changedSinceClosing = computed(() => !!closing.value && !closingMatches(closing.value, proposedClosing.value));

function accountLabel(key: string) {
	const account = accounts.value.get(key);
	return account ? `${account.code} ${account.name}` : key;
}

function formatDay(date: string) {
	return dateFormat.format(new Date(`${date}T12:00`));
}

const { journalTotal, ledgerAccount, movedAccounts, ledgerRows, trial, trialTotals, sheet, results, csvRows } = useAccountingReports(entries, accounts, () => data.value?.budget);

/* Asientos manuales */

function openEntry(existing?: ManualEntry) {
	if (!closed.value) {
		void entryForm.value?.open(existing);
	}
}

// The form's, which keeps the year's data in step and offers to undo it
async function saveEntry(id: string, entry: { date: string; concept: string; lines: JournalLine[] }, existing?: ManualEntry) {
	const target = data.value;
	if (!target) {
		throw new Error('la contabilidad aún no ha cargado');
	}
	await saveManualEntry(props.id, id, entry, existing);
	const saved = { ...existing, ...entry, id, year: year.value } as ManualEntry;
	target.manual = [...target.manual.filter(other => other.id !== id), saved];
	toast(existing ? 'Asiento guardado' : 'Asiento añadido', {
		undo: async () => {
			if (existing) {
				await restoreManualEntry(props.id, existing);
				target.manual = target.manual.map(other => other.id === existing.id ? existing : other);
			} else {
				await deleteManualEntry(props.id, saved);
				target.manual = target.manual.filter(other => other.id !== saved.id);
			}
		},
	});
}

function manualOf(entry: JournalEntry) {
	return data.value?.manual.find(other => other.id === entry.manualId);
}

async function removeEntry(entry: JournalEntry) {
	const manual = manualOf(entry);
	const target = data.value;
	if (!manual || !target || closed.value) {
		return;
	}
	try {
		await deleteManualEntry(props.id, manual);
		target.manual = target.manual.filter(other => other.id !== manual.id);
		toast('Asiento borrado', {
			undo: async () => {
				await restoreManualEntry(props.id, manual);
				target.manual = [...target.manual, manual];
			},
		});
	} catch (e) {
		toast(failure('No se ha podido borrar', e), { variant: 'danger' });
	}
}

/* Cierre */

const closingBusy = ref(false);

async function close() {
	const target = data.value;
	const closedYear = year.value;
	if (!target || closingBusy.value) {
		return;
	}
	const { result, regularization, closing: lines } = proposedClosing.value;
	if (!await ask({ title: `¿Cerrar el ejercicio ${closedYear}?`, message: `Se regularizan gastos e ingresos (${result >= 0 ? 'excedente' : 'déficit'} de ${formatCents(Math.abs(result))}), se cierra y se abre ${closedYear + 1} con sus saldos. No se podrán añadir asientos a ${closedYear} hasta reabrirlo.`, confirmText: 'Cerrar ejercicio' })) {
		return;
	}
	// The accounts' names, for when an owner, provider, partida or added account is gone
	const names = Object.fromEntries([...regularization, ...lines].map(item => [item.account, accounts.value.get(item.account)?.name ?? item.account]));
	const stored = { result, regularization, closing: lines, names };
	closingBusy.value = true;
	try {
		await closeFiscalYear(props.id, closedYear, stored);
		target.closing = { ...stored, id: String(closedYear), year: closedYear } as FiscalYearClosing;
		entryForm.value?.cancel();
		// The next year opens with it
		cache.delete(closedYear + 1);
		toast(`Ejercicio ${closedYear} cerrado`, {
			undo: async () => {
				await reopenFiscalYear(props.id, closedYear);
				target.closing = undefined;
				cache.delete(closedYear + 1);
			},
		});
	} catch (e) {
		toast(failure('No se ha podido cerrar', e), { variant: 'danger' });
	} finally {
		closingBusy.value = false;
	}
}

async function reopen() {
	const target = data.value;
	const stored = closing.value;
	const reopenedYear = year.value;
	if (!target || !stored || closingBusy.value) {
		return;
	}
	if (!await ask({ title: `¿Reabrir el ejercicio ${reopenedYear}?`, message: `Se quitan su regularización y su cierre, y ${reopenedYear + 1} se queda sin asiento de apertura hasta volver a cerrarlo.`, confirmText: 'Reabrir ejercicio' })) {
		return;
	}
	closingBusy.value = true;
	try {
		await reopenFiscalYear(props.id, reopenedYear);
		target.closing = undefined;
		cache.delete(reopenedYear + 1);
		toast(`Ejercicio ${reopenedYear} reabierto`, {
			undo: async () => {
				await restoreFiscalYear(props.id, stored);
				target.closing = stored;
				cache.delete(reopenedYear + 1);
			},
		});
	} catch (e) {
		toast(failure('No se ha podido reabrir', e), { variant: 'danger' });
	} finally {
		closingBusy.value = false;
	}
}

/* Plan de cuentas: cuentas añadidas, que comparten todos los años */

function setCustom(custom: CustomAccount[]) {
	cache.forEach((other) => {
		other.custom = custom;
	});
}

/* Imprimir y exportar */

function print() {
	window.print();
}

function exportCsv() {
	downloadFile(`${views[view.value].toLowerCase().replaceAll(' ', '-')}-${year.value}.csv`, toCsv(csvRows(view.value)), 'text/csv;charset=utf-8');
}

const closedAt = computed(() => (closing.value?.createdAt as Timestamp | undefined)?.toDate?.());
</script>

<template>
	<header class="page-header">
		<h1>Contabilidad</h1>
		<LnxSelect
			v-model.convert="year"
			class="year"
			aria-label="Ejercicio"
			:options="yearOptions"
			:convert-fn="option => option.value"
		>
			<template #option="{ option }">
				{{ option.label }}
			</template>
			<template #optionInput="{ value }">
				{{ value }}
			</template>
		</LnxSelect>
		<LnxButton mode="outline" size="sm" :disabled="!ledger" @click="exportCsv()">
			<LnxIcon icon="lucide:file-spreadsheet" />
			CSV
		</LnxButton>
		<LnxButton size="sm" :disabled="!ledger" @click="print()">
			<LnxIcon icon="lucide:printer" />
			Imprimir
		</LnxButton>
		<NewButton v-if="!editingEntry" label="Nuevo asiento" :disabled="closed || !ledger" @click="openEntry()" />
	</header>

	<p v-if="error" class="error" role="alert">
		{{ error }}
		<LnxButton mode="clear" size="sm" @click="error = undefined; loading = true; load()">
			Reintentar
		</LnxButton>
	</p>

	<template v-else>
		<section class="card status">
			<div v-if="loading || !ledger" class="status-row" aria-busy="true" aria-label="Cargando">
				<span class="lnx-skeleton" style="width: 40%" />
			</div>
			<template v-else>
				<div class="status-row">
					<span class="chip" :class="{ ok: closed }">
						<LnxIcon :icon="closed ? 'lucide:lock' : 'lucide:lock-open'" :size="14" />
						{{ closed ? 'Cerrado' : 'Abierto' }}
					</span>
					<span class="hint tabular">
						{{ entries.length }} asientos · {{ formatCents(journalTotal) }}
						<template v-if="closed && closedAt"> · cerrado el {{ dateFormat.format(closedAt) }}</template>
						· {{ (closed ? closing!.result : proposedClosing.result) >= 0 ? 'excedente' : 'déficit' }} de {{ formatCents(Math.abs(closed ? closing!.result : proposedClosing.result)) }}
					</span>
					<LnxButton v-if="closed && keepsBooks(user)" mode="clear" size="sm" :is-loading="closingBusy" @click="reopen()">
						<LnxIcon icon="lucide:lock-open" />
						Reabrir
					</LnxButton>
					<LnxButton v-else-if="!closed && keepsBooks(user)" size="sm" :is-loading="closingBusy" :disabled="!entries.length" @click="close()">
						<LnxIcon icon="lucide:lock" />
						Cerrar el ejercicio
					</LnxButton>
				</div>
				<p v-if="changedSinceClosing" class="warning" role="alert">
					<LnxIcon icon="lucide:triangle-alert" />
					Han cambiado recibos o facturas de {{ year }} después del cierre, y el cierre guardado ya no cuadra con ellos. Reabre el ejercicio y vuelve a cerrarlo para actualizarlo.
				</p>
				<p v-else-if="closed" class="hint">
					Ejercicio cerrado: no admite asientos nuevos, y sus saldos abren {{ year + 1 }}. Si cambias recibos o facturas de {{ year }}, te avisaremos aquí.
				</p>
				<p v-if="!data?.previous" class="hint">
					{{ year - 1 }} no está cerrado, así que {{ year }} no tiene asiento de apertura{{ data?.budget?.reserveOpening ? ' salvo el saldo inicial del fondo de reserva del presupuesto' : '' }}. Cierra antes {{ year - 1 }} para arrastrar sus saldos.
				</p>
			</template>
		</section>

		<ManualEntryForm ref="entryForm" v-model:editing="editingEntry" :year :accounts :save="saveEntry" @opening="view = 'journal'" />

		<div class="tabs" role="tablist" aria-label="Informe">
			<button v-for="(label, key) in views" :key="key" type="button" role="tab" :aria-selected="view === key" @click="view = key">
				{{ label }}
			</button>
		</div>

		<article v-if="loading || !ledger" class="sheet" aria-busy="true" aria-label="Cargando">
			<span v-for="width in [55, 100, 96, 100, 92, 100, 70]" :key="width" class="lnx-skeleton" :style="{ width: `${width}%` }" />
		</article>
		<article v-else class="sheet lnx-appear">
			<header class="sheet-header">
				<strong>Comunidad de propietarios {{ community?.name }}</strong>
				<span v-if="community?.cif">CIF {{ community.cif }}</span>
				<h2>{{ views[view] }} {{ year }}</h2>
			</header>

			<!-- Libro diario -->
			<table v-if="view === 'journal'">
				<thead>
					<tr>
						<th>Nº</th>
						<th>Fecha</th>
						<th>Cuenta</th>
						<th class="amount">
							Debe
						</th>
						<th class="amount">
							Haber
						</th>
					</tr>
				</thead>
				<tbody v-for="(entry, index) in entries" :key="entry.id" class="entry">
					<tr class="entry-head">
						<td class="tabular">
							{{ index + 1 }}
						</td>
						<td class="tabular">
							{{ formatDay(entry.date) }}
						</td>
						<td colspan="3">
							<div class="entry-title">
								<span>{{ entry.concept }} <small>{{ entryKinds[entry.kind] }}</small></span>
								<span v-if="entry.manualId && !closed" class="entry-actions no-print">
									<LnxButton mode="clear" size="sm" shape="circle" aria-label="Editar" title="Editar" @click="openEntry(manualOf(entry))">
										<LnxIcon icon="lucide:pencil" />
									</LnxButton>
									<LnxButton mode="clear" size="sm" shape="circle" variant="danger" aria-label="Borrar" title="Borrar" @click="removeEntry(entry)">
										<LnxIcon icon="lucide:trash-2" />
									</LnxButton>
								</span>
							</div>
						</td>
					</tr>
					<tr v-for="(item, lineIndex) in entry.lines" :key="lineIndex">
						<td />
						<td />
						<td :class="{ indent: item.credit }">
							{{ accountLabel(item.account) }}
						</td>
						<td class="amount">
							{{ item.debit ? formatCents(item.debit) : '' }}
						</td>
						<td class="amount">
							{{ item.credit ? formatCents(item.credit) : '' }}
						</td>
					</tr>
				</tbody>
				<tbody v-if="!entries.length">
					<tr>
						<td colspan="5">
							Sin asientos en {{ year }}.
						</td>
					</tr>
				</tbody>
				<tfoot>
					<tr>
						<th colspan="3">
							Total
						</th>
						<th class="amount">
							{{ formatCents(journalTotal) }}
						</th>
						<th class="amount">
							{{ formatCents(journalTotal) }}
						</th>
					</tr>
				</tfoot>
			</table>

			<!-- Libro mayor -->
			<template v-else-if="view === 'ledger'">
				<LnxSelect
					v-model.convert="ledgerAccount"
					class="no-print"
					:options="movedAccounts.map(account => ({ value: account.key, label: `${account.code} ${account.name}` }))"
					:convert-fn="option => option.value"
					search-placeholder-text="Buscar cuenta..."
				>
					Cuenta
					<template #option="{ option }">
						{{ option.label }}
					</template>
					<template #optionInput="{ value }">
						{{ value ? accountLabel(value) : '' }}
					</template>
				</LnxSelect>
				<h3 v-if="ledgerAccount">
					{{ accountLabel(ledgerAccount) }}
				</h3>
				<table>
					<thead>
						<tr>
							<th>Fecha</th>
							<th>Nº</th>
							<th>Concepto</th>
							<th class="amount">
								Debe
							</th>
							<th class="amount">
								Haber
							</th>
							<th class="amount">
								Saldo
							</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="(row, index) in ledgerRows" :key="index">
							<td class="tabular">
								{{ formatDay(row.entry.date) }}
							</td>
							<td class="tabular">
								{{ row.number }}
							</td>
							<td>{{ row.entry.concept }}</td>
							<td class="amount">
								{{ row.debit ? formatCents(row.debit) : '' }}
							</td>
							<td class="amount">
								{{ row.credit ? formatCents(row.credit) : '' }}
							</td>
							<td class="amount">
								{{ formatCents(row.balance) }}
							</td>
						</tr>
						<tr v-if="!ledgerRows.length">
							<td colspan="6">
								Sin movimientos.
							</td>
						</tr>
					</tbody>
				</table>
			</template>

			<!-- Balance de sumas y saldos -->
			<table v-else-if="view === 'trial'">
				<thead>
					<tr>
						<th>Cuenta</th>
						<th class="amount">
							Debe
						</th>
						<th class="amount">
							Haber
						</th>
						<th class="amount">
							Saldo deudor
						</th>
						<th class="amount">
							Saldo acreedor
						</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="row in trial" :key="row.account.key">
						<td>{{ row.account.code }} {{ row.account.name }}</td>
						<td class="amount">
							{{ formatCents(row.debit) }}
						</td>
						<td class="amount">
							{{ formatCents(row.credit) }}
						</td>
						<td class="amount">
							{{ row.debit > row.credit ? formatCents(row.debit - row.credit) : '' }}
						</td>
						<td class="amount">
							{{ row.credit > row.debit ? formatCents(row.credit - row.debit) : '' }}
						</td>
					</tr>
					<tr v-if="!trial.length">
						<td colspan="5">
							Sin movimientos.
						</td>
					</tr>
				</tbody>
				<tfoot>
					<tr>
						<th>Total</th>
						<th class="amount">
							{{ formatCents(trialTotals.debit) }}
						</th>
						<th class="amount">
							{{ formatCents(trialTotals.credit) }}
						</th>
						<th class="amount">
							{{ formatCents(trialTotals.debtor) }}
						</th>
						<th class="amount">
							{{ formatCents(trialTotals.creditor) }}
						</th>
					</tr>
				</tfoot>
			</table>

			<YearStatements v-else-if="view === 'sheet' || view === 'results'" :view :sheet :results />
			<ChartOfAccounts v-else :id :accounts :custom="data?.custom ?? []" :moved="movedAccounts" :year :closed :update="setCustom" />
		</article>
	</template>
</template>

<style lang="scss" scoped src="./accounting.scss" />
