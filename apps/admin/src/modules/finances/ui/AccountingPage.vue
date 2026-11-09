<script setup lang="ts">
import type { Account, CustomAccount, FiscalYearClosing, JournalEntry, JournalLine, ManualEntry } from '@gobernansa/shared/domain/accounting.ts';
import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { Timestamp } from 'firebase/firestore';
import { balances, balanceSheet, beforeClosing, buildLedger, closeYear, closingMatches, entryKinds, incomeStatement, isBalanced, isValidAccountCode, sortedAccounts, toCsv } from '@gobernansa/shared/domain/accounting.ts';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { formatCents, toCents } from '@gobernansa/shared/domain/money.ts';
import DatePicker from '@gobernansa/shared/ui/DatePicker.vue';
import { LnxButton, LnxIcon, LnxInput, LnxSelect } from 'lnxjs-components';
import { computed, nextTick, onMounted, reactive, ref, useTemplateRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { downloadFile } from '@/app/ux/download.ts';
import Kbd from '@/app/ux/Kbd.vue';
import { newId, onRevalidate } from '@/app/ux/navigation.ts';
import NewButton from '@/app/ux/NewButton.vue';
import { closeForm, openForm } from '@/app/ux/newForm.ts';
import { useShortcut } from '@/app/ux/shortcuts.ts';
import { toast } from '@/app/ux/toast.ts';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { closeFiscalYear, deleteManualEntry, loadLedgerData, reopenFiscalYear, restoreFiscalYear, restoreManualEntry, saveCustomAccounts, saveManualEntry } from '../application/useAccounting.ts';

const props = defineProps<{ id: string }>();

type LedgerData = Awaited<ReturnType<typeof loadLedgerData>>;

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'short' });
const currentYear = new Date().getFullYear();
const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear + 1 - i).map(value => ({ value, label: String(value) }));
const year = ref(currentYear);

const views = {
	journal: 'Libro diario',
	ledger: 'Libro mayor',
	trial: 'Sumas y saldos',
	sheet: 'Balance de situación',
	results: 'Cuenta de resultados',
	chart: 'Plan de cuentas',
} as const;
type View = keyof typeof views;
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
			toast(`No se ha podido actualizar: ${(e as Error).message}`, { tone: 'error' });
		} else {
			error.value = `No se ha podido cargar la contabilidad: ${(e as Error).message}`;
		}
	} finally {
		if (wanted === year.value) {
			loading.value = false;
		}
	}
}

onMounted(load);
onRevalidate(async () => {
	// Other years are read again when they're chosen
	[...cache.keys()].filter(key => key !== year.value).forEach(key => cache.delete(key));
	await load(true);
});
watch(year, async () => {
	cancelEntry();
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

/* Libro diario */

const journalTotal = computed(() => entries.value.reduce((sum, entry) => sum + entry.lines.reduce((lines, item) => lines + item.debit, 0), 0));

/* Libro mayor */

const ledgerAccount = ref('');
const movedAccounts = computed(() => sortedAccounts(accounts.value).filter(account => entries.value.some(entry => entry.lines.some(item => item.account === account.key))));
watch(movedAccounts, (moved) => {
	if (!moved.some(account => account.key === ledgerAccount.value)) {
		ledgerAccount.value = moved[0]?.key ?? '';
	}
}, { immediate: true });
const ledgerRows = computed(() => {
	let balance = 0;
	return entries.value.flatMap((entry, index) => entry.lines.filter(item => item.account === ledgerAccount.value).map((item) => {
		balance += item.debit - item.credit;
		return { number: index + 1, entry, ...item, balance };
	}));
});

/* Sumas y saldos */

const trial = computed(() => Array.from(balances(beforeClosing(entries.value)), ([key, sum]) => ({ account: accounts.value.get(key) ?? { key, code: key, name: key }, ...sum }))
	.sort((a, b) => a.account.code.localeCompare(b.account.code)));
const trialTotals = computed(() => trial.value.reduce((sum, row) => ({
	debit: sum.debit + row.debit,
	credit: sum.credit + row.credit,
	debtor: sum.debtor + Math.max(row.debit - row.credit, 0),
	creditor: sum.creditor + Math.max(row.credit - row.debit, 0),
}), { debit: 0, credit: 0, debtor: 0, creditor: 0 }));

/* Balance de situación y cuenta de resultados */

const sheet = computed(() => balanceSheet(entries.value, accounts.value));
const results = computed(() => incomeStatement(entries.value, accounts.value, data.value?.budget));

/* Asientos manuales */

interface LineDraft { key: string; account: string; debit: string; credit: string }
const emptyLine = (): LineDraft => ({ key: newId(), account: '', debit: '', credit: '' });
const editor = ref<{ id: string; existing?: ManualEntry; date: string; concept: string; lines: LineDraft[] }>();
const saving = ref(false);
const formError = ref<string>();
const entryForm = useTemplateRef('entryForm');

// The parent accounts aren't used, each owner and provider has their own
const accountOptions = computed(() => sortedAccounts(accounts.value)
	.filter(account => account.key !== '4000' && account.key !== '4300')
	.map(account => ({ value: account.key, label: `${account.code} ${account.name}` })));

function defaultDate() {
	const today = toDateString(new Date());
	return today.startsWith(`${year.value}-`) ? today : `${year.value}-12-31`;
}

async function openEntry(existing?: ManualEntry) {
	if (closed.value) {
		return;
	}
	formError.value = undefined;
	await openForm(async () => {
		editor.value = existing
			? {
					id: existing.id,
					existing,
					date: existing.date,
					concept: existing.concept,
					lines: existing.lines.map(item => ({ key: newId(), account: item.account, debit: item.debit ? String(item.debit / 100).replace('.', ',') : '', credit: item.credit ? String(item.credit / 100).replace('.', ',') : '' })),
				}
			: { id: newId(), date: defaultDate(), concept: '', lines: [emptyLine(), emptyLine()] };
		view.value = 'journal';
		await nextTick();
		return entryForm.value;
	});
}

function cancelEntry() {
	formError.value = undefined;
	void closeForm(entryForm.value, () => editor.value = undefined);
}

const parsedLines = computed(() => (editor.value?.lines ?? []).map(item => ({
	account: item.account,
	debit: item.debit.trim() ? toCents(item.debit) : 0,
	credit: item.credit.trim() ? toCents(item.credit) : 0,
})));
const draftDebit = computed(() => parsedLines.value.reduce((sum, item) => sum + (Number.isNaN(item.debit) ? 0 : item.debit), 0));
const draftCredit = computed(() => parsedLines.value.reduce((sum, item) => sum + (Number.isNaN(item.credit) ? 0 : item.credit), 0));

async function submitEntry() {
	const draft = editor.value;
	if (!draft || saving.value || !data.value) {
		return;
	}
	const lines: JournalLine[] = parsedLines.value.filter(item => item.account || item.debit || item.credit);
	formError.value = !draft.concept.trim()
		? 'Escribe el concepto.'
		: !draft.date.startsWith(`${year.value}-`)
				? `La fecha tiene que ser de ${year.value}.`
				: lines.some(item => !item.account)
					? 'Falta la cuenta de alguna línea.'
					: lines.some(item => Number.isNaN(item.debit) || Number.isNaN(item.credit))
						? 'Algún importe no es válido.'
						: !isBalanced(lines)
								? 'Cada línea va al debe o al haber, y el debe tiene que sumar lo mismo que el haber.'
								: undefined;
	if (formError.value) {
		return;
	}

	const entry = { date: draft.date, concept: draft.concept.trim(), lines };
	saving.value = true;
	try {
		await saveManualEntry(props.id, draft.id, entry, draft.existing);
		const saved = { ...draft.existing, ...entry, id: draft.id, year: year.value } as ManualEntry;
		const target = data.value;
		target.manual = [...target.manual.filter(other => other.id !== draft.id), saved];
		const previous = draft.existing;
		void closeForm(entryForm.value, () => editor.value = undefined);
		toast(previous ? 'Asiento guardado' : 'Asiento añadido', {
			undo: async () => {
				if (previous) {
					await restoreManualEntry(props.id, previous);
					target.manual = target.manual.map(other => other.id === previous.id ? previous : other);
				} else {
					await deleteManualEntry(props.id, saved);
					target.manual = target.manual.filter(other => other.id !== saved.id);
				}
			},
		});
	} catch (e) {
		formError.value = `No se ha podido guardar: ${(e as Error).message}`;
	} finally {
		saving.value = false;
	}
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
		toast(`No se ha podido borrar: ${(e as Error).message}`, { tone: 'error' });
	}
}

useShortcut('mod+enter', () => entryForm.value?.requestSubmit(), 'Guardar el asiento', () => !!editor.value);
useShortcut('escape', cancelEntry, 'Cancelar el asiento', () => !!editor.value);

/* Cierre */

const closingBusy = ref(false);

async function close() {
	const target = data.value;
	const closedYear = year.value;
	if (!target || closingBusy.value) {
		return;
	}
	const { result, regularization, closing: lines } = proposedClosing.value;
	// eslint-disable-next-line no-alert
	if (!window.confirm(`¿Cerrar el ejercicio ${closedYear}? Se regularizan gastos e ingresos (${result >= 0 ? 'excedente' : 'déficit'} de ${formatCents(Math.abs(result))}), se cierra y se abre ${closedYear + 1} con sus saldos. No se podrán añadir asientos a ${closedYear} hasta reabrirlo.`)) {
		return;
	}
	// The accounts' names, for when an owner, provider, partida or added account is gone
	const names = Object.fromEntries([...regularization, ...lines].map(item => [item.account, accounts.value.get(item.account)?.name ?? item.account]));
	const stored = { result, regularization, closing: lines, names };
	closingBusy.value = true;
	try {
		await closeFiscalYear(props.id, closedYear, stored);
		target.closing = { ...stored, id: String(closedYear), year: closedYear } as FiscalYearClosing;
		cancelEntry();
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
		toast(`No se ha podido cerrar: ${(e as Error).message}`, { tone: 'error' });
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
	// eslint-disable-next-line no-alert
	if (!window.confirm(`¿Reabrir el ejercicio ${reopenedYear}? Se quitan su regularización y su cierre, y ${reopenedYear + 1} se queda sin asiento de apertura hasta volver a cerrarlo.`)) {
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
		toast(`No se ha podido reabrir: ${(e as Error).message}`, { tone: 'error' });
	} finally {
		closingBusy.value = false;
	}
}

/* Plan de cuentas: cuentas añadidas */

const newAccount = reactive({ code: '', name: '' });
const accountError = ref<string>();
const accountSaving = ref(false);

async function writeCustom(next: CustomAccount[], summary: string, previous: CustomAccount[]) {
	const target = data.value;
	if (!target) {
		return false;
	}
	accountSaving.value = true;
	try {
		await saveCustomAccounts(props.id, next, summary);
		// Every year's data shares them
		cache.forEach((other) => {
			other.custom = next;
		});
		toast(summary, {
			undo: async () => {
				await saveCustomAccounts(props.id, previous, 'Deshizo el cambio en el plan de cuentas');
				cache.forEach((other) => {
					other.custom = previous;
				});
			},
		});
		return true;
	} catch (e) {
		accountError.value = `No se ha podido guardar: ${(e as Error).message}`;
		return false;
	} finally {
		accountSaving.value = false;
	}
}

async function addAccount() {
	const code = newAccount.code.trim();
	const name = newAccount.name.trim();
	accountError.value = !isValidAccountCode(code)
		? 'El código son de 3 a 10 cifras y empieza por el grupo, del 1 al 7.'
		: sortedAccounts(accounts.value).some(account => account.code === code)
			? 'Ya hay una cuenta con ese código.'
			: !name ? 'Escribe el nombre de la cuenta.' : undefined;
	if (accountError.value || !data.value) {
		return;
	}
	const previous = data.value.custom;
	if (await writeCustom([...previous, { code, name }], `Añadió la cuenta ${code} ${name}`, previous)) {
		newAccount.code = '';
		newAccount.name = '';
	}
}

async function removeAccount(account: Account) {
	if (!data.value) {
		return;
	}
	if (movedAccounts.value.some(other => other.key === account.key)) {
		accountError.value = `La cuenta ${account.code} tiene apuntes en ${year.value}: quítalos antes de borrarla.`;
		return;
	}
	accountError.value = undefined;
	const previous = data.value.custom;
	await writeCustom(previous.filter(other => other.code !== account.key), `Borró la cuenta ${account.code} ${account.name}`, previous);
}

/* Imprimir y exportar */

function print() {
	window.print();
}

function exportCsv() {
	const rows: (string | number)[][] = [];
	if (view.value === 'journal') {
		rows.push(['Asiento', 'Fecha', 'Concepto', 'Cuenta', 'Nombre', 'Debe', 'Haber']);
		entries.value.forEach((entry, index) => entry.lines.forEach((item) => {
			const account = accounts.value.get(item.account);
			rows.push([String(index + 1), entry.date, entry.concept, account?.code ?? item.account, account?.name ?? '', item.debit, item.credit]);
		}));
	} else if (view.value === 'ledger') {
		rows.push(['Fecha', 'Asiento', 'Concepto', 'Debe', 'Haber', 'Saldo']);
		ledgerRows.value.forEach(row => rows.push([row.entry.date, String(row.number), row.entry.concept, row.debit, row.credit, row.balance]));
	} else if (view.value === 'trial') {
		rows.push(['Cuenta', 'Nombre', 'Debe', 'Haber', 'Saldo deudor', 'Saldo acreedor']);
		trial.value.forEach(row => rows.push([row.account.code, row.account.name, row.debit, row.credit, Math.max(row.debit - row.credit, 0), Math.max(row.credit - row.debit, 0)]));
	} else if (view.value === 'sheet') {
		rows.push(['Masa', 'Cuenta', 'Nombre', 'Importe']);
		sheet.value.sections.forEach(section => section.rows.forEach(row => rows.push([`${section.side === 'assets' ? 'Activo' : 'Patrimonio neto y pasivo'} · ${section.title}`, row.account.code, row.account.name, row.amount])));
	} else if (view.value === 'results') {
		rows.push(['Tipo', 'Cuenta', 'Nombre', 'Real', 'Presupuesto', 'Diferencia']);
		for (const [type, list] of [['Ingreso', results.value.income], ['Gasto', results.value.expenses]] as const) {
			list.forEach(row => rows.push([type, row.account.code, row.account.name, row.amount, row.budgeted ?? 0, row.amount - (row.budgeted ?? 0)]));
		}
	} else {
		rows.push(['Cuenta', 'Nombre']);
		sortedAccounts(accounts.value).forEach(account => rows.push([account.code, account.name]));
	}
	downloadFile(`${views[view.value].toLowerCase().replaceAll(' ', '-')}-${year.value}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
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
			search-placeholder-text="Buscar..."
		>
			<template #option="{ option }">
				{{ option.label }}
			</template>
			<template #optionInput="{ value }">
				{{ value }}
			</template>
		</LnxSelect>
		<LnxButton mode="outline" class="size-small" :disabled="!ledger" @click="exportCsv()">
			<LnxIcon icon="lucide:file-spreadsheet" />
			CSV
		</LnxButton>
		<LnxButton class="size-small" :disabled="!ledger" @click="print()">
			<LnxIcon icon="lucide:printer" />
			Imprimir
		</LnxButton>
		<NewButton v-if="!editor" label="Nuevo asiento" :disabled="closed || !ledger" @click="openEntry()" />
	</header>

	<p v-if="error" class="error" role="alert">
		{{ error }}
	</p>

	<template v-else>
		<section class="card status">
			<div v-if="loading || !ledger" class="status-row" aria-busy="true" aria-label="Cargando">
				<span class="skeleton-item" style="width: 40%" />
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
					<LnxButton v-if="closed" mode="clear" class="size-small" :is-loading="closingBusy" @click="reopen()">
						<LnxIcon icon="lucide:lock-open" />
						Reabrir
					</LnxButton>
					<LnxButton v-else class="size-small" :is-loading="closingBusy" :disabled="!entries.length" @click="close()">
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

		<form v-if="editor" ref="entryForm" class="card ux-appear" @submit.prevent="submitEntry()">
			<h2>{{ editor.existing ? 'Editar asiento' : 'Nuevo asiento' }}</h2>
			<div class="fields">
				<DatePicker v-model="editor.date" :min="`${year}-01-01`" :max="`${year}-12-31`" required>
					Fecha
				</DatePicker>
				<LnxInput v-model="editor.concept" placeholder="Pago de retenciones del 3T (modelo 111)" required>
					Concepto
				</LnxInput>
			</div>
			<ul class="entry-lines">
				<li v-for="(item, index) in editor.lines" :key="item.key" class="entry-line">
					<LnxSelect
						v-model.convert="item.account"
						:options="accountOptions"
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
					<LnxInput v-model="item.debit" inputmode="decimal" placeholder="0,00" :disabled="!!item.credit.trim()">
						Debe (€)
					</LnxInput>
					<LnxInput v-model="item.credit" inputmode="decimal" placeholder="0,00" :disabled="!!item.debit.trim()">
						Haber (€)
					</LnxInput>
					<LnxButton
						mode="clear"
						class="size-small"
						shape="circle"
						variant="danger"
						aria-label="Quitar línea"
						title="Quitar línea"
						:disabled="editor.lines.length <= 2"
						@click="editor.lines.splice(index, 1)"
					>
						<LnxIcon icon="lucide:trash-2" />
					</LnxButton>
				</li>
			</ul>
			<div>
				<LnxButton mode="clear" class="size-small" @click="editor.lines.push(emptyLine())">
					<LnxIcon icon="lucide:plus" />
					Añadir línea
				</LnxButton>
			</div>
			<footer class="form-actions">
				<p v-if="formError" class="error" role="alert">
					{{ formError }}
				</p>
				<span v-else class="hint tabular" :class="{ unbalanced: draftDebit !== draftCredit }">
					Debe {{ formatCents(draftDebit) }} · Haber {{ formatCents(draftCredit) }}<template v-if="draftDebit !== draftCredit"> · descuadre de {{ formatCents(Math.abs(draftDebit - draftCredit)) }}</template>
				</span>
				<LnxButton type="button" mode="clear" @click="cancelEntry()">
					Cancelar
					<Kbd combo="escape" />
				</LnxButton>
				<LnxButton type="submit" :is-loading="saving">
					Guardar
					<Kbd combo="mod+enter" />
				</LnxButton>
			</footer>
		</form>

		<div class="tabs" role="tablist" aria-label="Informe">
			<button v-for="(label, key) in views" :key="key" type="button" role="tab" :aria-selected="view === key" @click="view = key">
				{{ label }}
			</button>
		</div>

		<article v-if="loading || !ledger" class="sheet" aria-busy="true" aria-label="Cargando">
			<span v-for="width in [55, 100, 96, 100, 92, 100, 70]" :key="width" class="skeleton-item" :style="{ width: `${width}%` }" />
		</article>
		<article v-else class="sheet ux-appear">
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
									<LnxButton mode="clear" class="size-small" shape="circle" aria-label="Editar" title="Editar" @click="openEntry(manualOf(entry))">
										<LnxIcon icon="lucide:pencil" />
									</LnxButton>
									<LnxButton mode="clear" class="size-small" shape="circle" variant="danger" aria-label="Borrar" title="Borrar" @click="removeEntry(entry)">
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

			<!-- Balance de situación -->
			<template v-else-if="view === 'sheet'">
				<table v-for="side in (['assets', 'liabilities'] as const)" :key="side">
					<thead>
						<tr>
							<th>{{ side === 'assets' ? 'Activo' : 'Patrimonio neto y pasivo' }}</th>
							<th class="amount">
								Importe
							</th>
						</tr>
					</thead>
					<tbody v-for="section in sheet.sections.filter(other => other.side === side)" :key="section.title">
						<tr class="entry-head">
							<td>{{ section.title }}</td>
							<td class="amount">
								{{ formatCents(section.total) }}
							</td>
						</tr>
						<tr v-for="row in section.rows" :key="row.account.key">
							<td class="indent">
								{{ row.account.code }} {{ row.account.name }}
							</td>
							<td class="amount">
								{{ formatCents(row.amount) }}
							</td>
						</tr>
					</tbody>
					<tfoot>
						<tr>
							<th>Total {{ side === 'assets' ? 'activo' : 'patrimonio neto y pasivo' }}</th>
							<th class="amount">
								{{ formatCents(side === 'assets' ? sheet.assets : sheet.liabilities) }}
							</th>
						</tr>
					</tfoot>
				</table>
				<p v-if="sheet.assets !== sheet.liabilities" class="note">
					El activo y el pasivo no cuadran por {{ formatCents(Math.abs(sheet.assets - sheet.liabilities)) }}: revisa los asientos manuales.
				</p>
			</template>

			<!-- Cuenta de resultados -->
			<template v-else-if="view === 'results'">
				<table v-for="part in ([['Ingresos', results.income, results.totalIncome, results.budgetedIncome], ['Gastos', results.expenses, results.totalExpenses, results.budgetedExpenses]] as const)" :key="part[0]">
					<thead>
						<tr>
							<th>{{ part[0] }}</th>
							<th class="amount">
								Real
							</th>
							<th class="amount">
								Presupuesto
							</th>
							<th class="amount">
								Diferencia
							</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="row in part[1]" :key="row.account.key">
							<td>{{ row.account.code }} {{ row.account.name }}</td>
							<td class="amount">
								{{ formatCents(row.amount) }}
							</td>
							<td class="amount">
								{{ row.budgeted !== undefined ? formatCents(row.budgeted) : '' }}
							</td>
							<td class="amount">
								{{ row.budgeted !== undefined ? formatCents(row.amount - row.budgeted) : '' }}
							</td>
						</tr>
						<tr v-if="!part[1].length">
							<td colspan="4">
								Sin {{ part[0].toLowerCase() }}.
							</td>
						</tr>
					</tbody>
					<tfoot>
						<tr>
							<th>Total {{ part[0].toLowerCase() }}</th>
							<th class="amount">
								{{ formatCents(part[2]) }}
							</th>
							<th class="amount">
								{{ formatCents(part[3]) }}
							</th>
							<th class="amount">
								{{ formatCents(part[2] - part[3]) }}
							</th>
						</tr>
					</tfoot>
				</table>
				<p class="result tabular">
					{{ results.totalIncome >= results.totalExpenses ? 'Excedente' : 'Déficit' }} del ejercicio:
					<strong>{{ formatCents(Math.abs(results.totalIncome - results.totalExpenses)) }}</strong>
				</p>
				<p class="note">
					Las aportaciones al fondo de reserva y los gastos pagados con él van a la cuenta 1130, no a resultados.
				</p>
			</template>

			<!-- Plan de cuentas -->
			<template v-else>
				<table>
					<thead>
						<tr>
							<th>Cuenta</th>
							<th>Nombre</th>
							<th class="no-print" />
						</tr>
					</thead>
					<tbody>
						<tr v-for="account in sortedAccounts(accounts)" :key="account.key">
							<td class="tabular">
								{{ account.code }}
							</td>
							<td>
								{{ account.name }}
								<small v-if="account.custom">Añadida</small>
							</td>
							<td class="amount no-print">
								<LnxButton
									v-if="account.custom && !closed"
									mode="clear"
									class="size-small"
									shape="circle"
									variant="danger"
									aria-label="Borrar cuenta"
									title="Borrar cuenta"
									:disabled="accountSaving"
									@click="removeAccount(account)"
								>
									<LnxIcon icon="lucide:trash-2" />
								</LnxButton>
							</td>
						</tr>
					</tbody>
				</table>
				<form class="add-account no-print" @submit.prevent="addAccount()">
					<LnxInput v-model="newAccount.code" inputmode="numeric" placeholder="6230001">
						Código
					</LnxInput>
					<LnxInput v-model="newAccount.name" placeholder="Asesoría jurídica">
						Nombre
					</LnxInput>
					<LnxButton type="submit" mode="outline" :is-loading="accountSaving">
						<LnxIcon icon="lucide:plus" />
						Añadir cuenta
					</LnxButton>
				</form>
				<p v-if="accountError" class="error no-print" role="alert">
					{{ accountError }}
				</p>
				<p class="note">
					Cada propietario, proveedor y partida del presupuesto tiene su subcuenta (4300, 4000 y el grupo 6 que le corresponde), numeradas por orden de nombre.
				</p>
			</template>
		</article>
	</template>
</template>

<style lang="scss" scoped>
.page-header {
	margin-bottom: var(--lnx-spacing-5);
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--lnx-spacing-2);

	h1 {
		flex: 1;
		font-size: var(--lnx-font-size-title);
	}

	.year {
		width: 120px;
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
		letter-spacing: .04em;
	}
}

.status {
	gap: var(--lnx-spacing-2);
}

.status-row {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--lnx-spacing-2) var(--lnx-spacing-3);

	.hint {
		flex: 1;
	}
}

.fields {
	display: grid;
	grid-template-columns: minmax(0, 220px) minmax(0, 1fr);
	align-items: start;
	gap: var(--lnx-spacing-3) var(--lnx-spacing-4);

	@media (width <= 600px) {
		grid-template-columns: minmax(0, 1fr);
	}
}

.entry-lines {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);
}

.entry-line {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 130px 130px auto;
	align-items: center;
	gap: var(--lnx-spacing-3);

	@media (width <= 600px) {
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;

		> :first-child {
			grid-column: 1 / -1;
		}
	}
}

.form-actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: flex-end;
	gap: var(--lnx-spacing-2);

	.error,
	.hint {
		flex: 1;
	}

	.unbalanced {
		color: var(--color-secondary-accent);
	}
}

.tabs {
	margin-bottom: var(--lnx-spacing-4);
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-1);

	button {
		padding: var(--lnx-spacing-1) var(--lnx-spacing-3);
		border: 1px solid var(--color-gray-3);
		border-radius: 999px;
		background: var(--color-gray-0);
		font: inherit;
		font-size: var(--lnx-font-size-small);
		color: var(--color-gray-7);
		cursor: pointer;

		&[aria-selected='true'] {
			border-color: var(--color-primary);
			color: var(--color-primary);
			font-weight: var(--lnx-font-weight-bold);
		}
	}
}

.chip {
	padding: 2px var(--lnx-spacing-2);
	border-radius: 999px;
	background: var(--color-gray-2);
	font-size: var(--lnx-font-size-small);
	white-space: nowrap;
	display: inline-flex;
	align-items: center;
	gap: 4px;

	&.ok {
		color: var(--color-primary);
	}
}

// An A4 page on screen, the same on paper
.sheet {
	max-width: 210mm;
	margin: 0 auto;
	padding: 15mm;
	background: #FFFFFF;
	color: #000000;
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000014;
	display: flex;
	flex-direction: column;
	gap: 5mm;
	font-size: 9pt;
	line-height: 1.4;

	h2 {
		text-align: center;
		font-size: 14pt;
		text-transform: uppercase;
	}

	h3 {
		font-size: 11pt;
	}

	.note {
		font-size: 8pt;
		color: #555555;
	}

	.result {
		font-size: 11pt;
		text-align: right;
	}
}

.sheet-header {
	display: flex;
	flex-direction: column;
}

.add-account {
	display: grid;
	grid-template-columns: 140px minmax(0, 1fr) auto;
	align-items: center;
	gap: var(--lnx-spacing-3);

	@media (width <= 600px) {
		grid-template-columns: minmax(0, 1fr);
	}
}

table {
	width: 100%;
	border-collapse: collapse;
	font-variant-numeric: tabular-nums;

	th,
	td {
		padding: 1mm 2mm;
		border-bottom: 1px solid #DDDDDD;
		text-align: left;
		vertical-align: top;
	}

	small {
		color: #777777;
	}

	.amount {
		text-align: right;
		white-space: nowrap;
	}

	.indent {
		padding-left: 8mm;
	}

	.entry-head td {
		padding-top: 2.5mm;
		font-weight: 600;
		border-bottom: none;
	}

	tfoot th {
		border-bottom: none;
		border-top: 2px solid #000000;
	}
}

.entry {
	break-inside: avoid;
}

.entry-title {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--lnx-spacing-2);
}

.entry-actions {
	display: flex;
	margin: -4px 0;
}

.hint {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.warning {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--lnx-spacing-2);
	font-size: var(--lnx-font-size-small);
	color: var(--color-gray-7);
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}

@page {
	size: A4;
	margin: 15mm;
}

@media print {
	.page-header,
	.card,
	.tabs,
	.no-print {
		display: none;
	}

	.sheet {
		max-width: none;
		padding: 0;
		box-shadow: none;
	}
}
</style>
