<script setup lang="ts">
import type { Charge, ChargeCollection, CollectionMethod } from '@gobernansa/shared/domain/finance.ts';
import type { Property } from '@gobernansa/shared/domain/property.ts';
import { failure } from '@gobernansa/shared/application/errors.ts';
import { toCsv } from '@gobernansa/shared/domain/accounting.ts';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { chargeTypes, collectionMethods, isOverdue, outstanding } from '@gobernansa/shared/domain/finance.ts';
import { formatCents, toCents } from '@gobernansa/shared/domain/money.ts';
import { describePayment } from '@gobernansa/shared/domain/payment.ts';
import { formatCoefficient, splitByCoefficient, totalCoefficient } from '@gobernansa/shared/domain/property.ts';
import { Timestamp } from 'firebase/firestore';
import { LnxButton, LnxCheckbox, LnxDatePicker, LnxIcon, LnxInput, LnxKbd, LnxSelect, toast, useConfirm } from 'lnxjs-components';
import { computed, ref, useTemplateRef } from 'vue';
import { downloadFile } from '@/app/ux/download.ts';
import FormCard from '@/app/ux/FormCard.vue';
import { newId, onRevalidate } from '@/app/ux/navigation.ts';
import NewButton from '@/app/ux/NewButton.vue';
import { useNewForm } from '@/app/ux/newForm.ts';
import { optimistic } from '@/app/ux/toast.ts';
import { closedYearWarning } from '../application/useAccounting.ts';
import { addCollection, deleteCharge, issueCharges, loadBatch, loadPropertyCharges, removeCollection, restoreCharge, setChargePaid, setChargesPaid, toDueDate, useCommunityProperties, useUnpaidCharges } from '../application/useFinances.ts';
import { useListSearch } from './listSearch.ts';
import OnlinePaymentsCard from './OnlinePaymentsCard.vue';

const props = defineProps<{ id: string }>();

const ask = useConfirm();

const { data: properties, pending: propertiesPending, error: propertiesError } = useCommunityProperties(props.id);
const { data: unpaid, pending: chargesPending, error: chargesError } = useUnpaidCharges(props.id);

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium' });

// Issuing fees or a derrama
type Split = 'coefficient' | 'fixed';
const typeOptions = Object.entries(chargeTypes).map(([value, label]) => ({ value: value as Charge['type'], label }));
const splitOptions: { value: Split; label: string }[] = [
	{ value: 'coefficient', label: 'Total repartido por coeficiente' },
	{ value: 'fixed', label: 'Mismo importe a cada propiedad' },
];

function emptyForm() {
	return { type: 'fee' as Charge['type'], concept: '', amount: '', split: 'coefficient' as Split, dueDate: '' };
}

const form = ref(emptyForm());
const cents = computed(() => toCents(form.value.amount));
// A derrama is always split by coefficient
const split = computed<Split>(() => form.value.type === 'levy' ? 'coefficient' : form.value.split);
const shares = computed(() => {
	if (!(cents.value > 0)) {
		return [];
	}
	const all = split.value === 'fixed'
		? properties.value.map(property => ({ property, cents: cents.value }))
		: splitByCoefficient(cents.value, properties.value);
	// Properties without a coefficient pay nothing in a split, so they get no charge
	return all.filter(share => share.cents > 0);
});
const sharesTotal = computed(() => shares.value.reduce((sum, share) => sum + share.cents, 0));
const coefficientSum = computed(() => totalCoefficient(properties.value));
const withoutCoefficient = computed(() => properties.value.filter(property => !property.coefficient).length);

const issuing = ref(false);
const formError = ref<string>();

// The ids of a confirmed emission, kept until it's issued: trying the same one again after a failure only issues those
// still missing instead of issuing them twice. Changing the form makes it another emission
let confirmed: { key: string; batchId: string; ids: string[] } | undefined;

const issueForm = useTemplateRef('issueForm');

// The emission confirmed is kept, so typing the same one again after a failure still only issues those missing
function reset() {
	form.value = emptyForm();
	formError.value = undefined;
}

const { open, show, close } = useNewForm(issueForm, reset);

async function issue() {
	if (issuing.value) {
		return;
	}
	if (!shares.value.length) {
		formError.value = cents.value > 0
			? 'Ninguna propiedad tiene coeficiente. Añádelos en el censo de propiedades.'
			: 'Escribe un importe válido, p. ej. 1.250,00';
		return;
	}
	const key = JSON.stringify([form.value.type, form.value.concept.trim(), form.value.dueDate, shares.value.map(share => [share.property.id, share.cents])]);
	const retry = confirmed?.key === key;
	// Issued already, e.g. from another tab or before reloading: the live unpaid ones say so, with no reads
	const dueDate = toDueDate(form.value.dueDate).toMillis();
	const same = retry ? 0 : unpaid.value.filter(charge => charge.concept === form.value.concept.trim() && charge.dueDate.toMillis() === dueDate).length;
	if (!await ask({
		title: `¿Emitir «${form.value.concept.trim()}» a ${shares.value.length} propiedades por ${formatCents(sharesTotal.value)} en total?`,
		message: same ? `Ya hay ${same} ${same === 1 ? 'recibo' : 'recibos'} «${form.value.concept.trim()}» sin pagar con ese vencimiento.` : undefined,
		confirmText: 'Emitir',
	})) {
		return;
	}
	if (!retry) {
		confirmed = { key, batchId: newId(), ids: shares.value.map(() => newId()) };
	}
	const emission = confirmed!;

	// Money: it waits for the server before telling it's done
	issuing.value = true;
	formError.value = undefined;
	try {
		// After a failure halfway, the first batches are there and can't be written again
		const issued = new Set(retry ? (await loadBatch(props.id, emission.batchId, true)).map(charge => charge.id) : []);
		const missing = emission.ids.flatMap((id, index) => issued.has(id) ? [] : [{ id, share: shares.value[index] }]);
		await issueCharges(props.id, {
			type: form.value.type,
			concept: form.value.concept.trim(),
			dueDate: toDueDate(form.value.dueDate),
			shares: missing.map(({ share }) => share),
			batchId: emission.batchId,
			ids: missing.map(({ id }) => id),
		});
		toast(shares.value.length === 1 ? 'Recibo emitido' : 'Recibos emitidos');
		close();
		confirmed = undefined;
	} catch (e) {
		formError.value = failure('No se han podido emitir', e);
	} finally {
		issuing.value = false;
	}
}

// Arrears, from the live unpaid charges
const rows = computed(() => {
	const byProperty = Object.groupBy(unpaid.value, charge => charge.propertyId);
	return properties.value.map((property) => {
		const charges = [...(byProperty[property.id] ?? [])].sort((a, b) => a.dueDate.toMillis() - b.dueDate.toMillis());
		const overdue = charges.filter(charge => isOverdue(charge));
		return {
			property,
			charges,
			overdueCount: overdue.length,
			overdueAmount: overdue.reduce((sum, charge) => sum + outstanding(charge), 0),
			pendingAmount: charges.reduce((sum, charge) => sum + outstanding(charge), 0),
			// Those that can be marked paid together
			selectable: charges.filter(charge => !charge.remittanceId),
		};
	}).sort((a, b) => b.overdueAmount - a.overdueAmount || b.pendingAmount - a.pendingAmount
		|| a.property.name.localeCompare(b.property.name, 'es', { numeric: true }));
});
const totalOverdue = computed(() => rows.value.reduce((sum, row) => sum + row.overdueAmount, 0));
const totalPending = computed(() => rows.value.reduce((sum, row) => sum + row.pendingAmount, 0));
const debtors = computed(() => rows.value.filter(row => row.overdueCount).length);
const loading = computed(() => (propertiesPending.value || chargesPending.value) && !rows.value.length);

const { search, matches } = useListSearch('Buscar en la morosidad', useTemplateRef<HTMLElement>('searchBox'));
const shownRows = computed(() => rows.value.filter(row => matches(row.property.name, row.property.ownerName)));

// What's shown, as a spreadsheet opens it
function exportCsv() {
	const lines = shownRows.value.map(row => [
		row.property.name,
		row.property.ownerName ?? '',
		String(row.overdueCount),
		row.overdueAmount,
		row.pendingAmount,
		row.overdueCount ? 'Con deuda' : row.pendingAmount ? 'Pendiente' : 'Al corriente',
	]);
	const content = toCsv([['Propiedad', 'Propietario', 'Recibos vencidos', 'Deuda vencida', 'Pendiente de cobro', 'Estado'], ...lines]);
	downloadFile(`recibos-pendientes-${toDateString(new Date())}.csv`, content, 'text/csv;charset=utf-8');
}

/* Several marked paid at once, e.g. paid in cash at the office. Those in a remittance are left out: the bank collects
them. Kept as ids and read from the live list, so one paid meanwhile drops out */
const selected = ref(new Set<string>());
const selectedCharges = computed(() => unpaid.value.filter(charge => selected.value.has(charge.id) && !charge.remittanceId));
const selectedTotal = computed(() => selectedCharges.value.reduce((sum, charge) => sum + outstanding(charge), 0));

function select(charges: Charge[], on: boolean) {
	const next = new Set(selected.value);
	for (const charge of charges) {
		if (on) {
			next.add(charge.id);
		} else {
			next.delete(charge.id);
		}
	}
	selected.value = next;
}

function markSelectedPaid() {
	const charges = selectedCharges.value;
	selected.value = new Set();
	void optimistic(setChargesPaid(props.id, charges, Timestamp.now()), {
		done: charges.length === 1 ? 'Recibo marcado como pagado' : `${charges.length} recibos marcados como pagados`,
		failed: 'No se han podido marcar',
		revert: async () => setChargesPaid(props.id, charges, null),
	});
}

// The property opened to see its charges, and its whole history once asked for
const openId = ref<string>();
const history = ref<Charge[]>();
const historyLoading = ref(false);
const actionError = ref<string>();

function toggle(property: Property) {
	openId.value = openId.value === property.id ? undefined : property.id;
	history.value = undefined;
}

async function loadHistory(propertyId: string) {
	historyLoading.value = true;
	actionError.value = undefined;
	try {
		history.value = await loadPropertyCharges(props.id, propertyId);
	} catch (e) {
		actionError.value = failure('No se ha podido cargar el historial', e);
	} finally {
		historyLoading.value = false;
	}
}

// The history is read once, so coming back reads it again, showing the last one meanwhile
onRevalidate(() => history.value && openId.value && loadHistory(openId.value));

// The unpaid ones are live, the history is updated by hand
function patchHistory(id: string, changes: Partial<Charge>) {
	history.value = history.value?.map(charge => charge.id === id ? { ...charge, ...changes } : charge);
}

function setInHistory(charge: Charge, present: boolean) {
	if (!history.value) {
		return;
	}
	const others = history.value.filter(candidate => candidate.id !== charge.id);
	history.value = present ? [...others, charge].sort((a, b) => b.dueDate.toMillis() - a.dueDate.toMillis()) : others;
}

// One change per charge at a time, so a double click doesn't toggle it back
const toggling = ref(new Set<string>());

function togglePaid(charge: Charge) {
	if (toggling.value.has(charge.id)) {
		return;
	}
	const previous = { paidAt: charge.paidAt, payment: charge.payment };
	const paidAt = previous.paidAt ? null : Timestamp.now();
	// Marked unpaid, a payment from the app is reverted
	patchHistory(charge.id, { paidAt, payment: paidAt ? charge.payment : undefined });
	toggling.value.add(charge.id);
	void optimistic(setChargePaid(props.id, charge, paidAt), {
		done: paidAt ? 'Marcado como pagado' : 'Marcado como pendiente',
		failed: 'No se ha podido cambiar',
		revert: async () => {
			patchHistory(charge.id, previous);
			await setChargePaid(props.id, charge, previous.paidAt);
		},
		onError: () => patchHistory(charge.id, previous),
	}).finally(() => toggling.value.delete(charge.id));
}

// Paid only by entregas a cuenta: it goes back to pending by undoing one of them
function paidByCollections(charge: Charge) {
	return !!charge.paidAt && (charge.collected ?? 0) >= charge.amount;
}

/* Entregas a cuenta, one charge's form open at a time. Money: it waits for the server */
const methodOptions = Object.entries(collectionMethods).map(([value, label]) => ({ value: value as CollectionMethod, label }));
const collecting = ref<{ chargeId: string; id: string; amount: string; date: string; method: CollectionMethod; note: string }>();
const collectError = ref<string>();
const savingCollection = ref(false);

function openCollection(charge: Charge) {
	collectError.value = undefined;
	collecting.value = collecting.value?.chargeId === charge.id
		? undefined
		: { chargeId: charge.id, id: newId(), amount: '', date: toDateString(new Date()), method: 'transfer', note: '' };
}

async function collect(charge: Charge) {
	const form = collecting.value;
	const cents = toCents(form?.amount ?? '');
	if (!form || savingCollection.value) {
		return;
	}
	if (!(cents > 0) || cents > outstanding(charge)) {
		collectError.value = `Escribe un importe hasta ${formatCents(outstanding(charge))}, p. ej. 50,00`;
		return;
	}
	const item: ChargeCollection = {
		id: form.id,
		amount: cents,
		date: Timestamp.fromDate(new Date(`${form.date}T12:00`)),
		method: form.method,
		...(form.note.trim() ? { note: form.note.trim() } : {}),
	};
	savingCollection.value = true;
	collectError.value = undefined;
	try {
		const updated = await addCollection(props.id, charge.id, item);
		patchHistory(charge.id, updated);
		collecting.value = undefined;
		toast(updated.paidAt ? 'Entrega registrada, el recibo queda pagado' : `Entrega registrada, quedan ${formatCents(outstanding(updated))}`, {
			undo: async () => patchHistory(charge.id, await removeCollection(props.id, charge.id, item)),
		});
	} catch (e) {
		collectError.value = failure('No se ha podido registrar', e);
	} finally {
		savingCollection.value = false;
	}
}

async function uncollect(charge: Charge, item: ChargeCollection) {
	if (!await ask({ title: `¿Deshacer la entrega a cuenta de ${formatCents(item.amount)} del ${dateFormat.format(item.date.toDate())}?`, confirmText: 'Deshacer entrega', variant: 'danger' })) {
		return;
	}
	try {
		patchHistory(charge.id, await removeCollection(props.id, charge.id, item));
		toast('Entrega deshecha', { undo: async () => patchHistory(charge.id, await addCollection(props.id, charge.id, item)) });
	} catch (e) {
		toast(failure('No se ha podido deshacer', e), { variant: 'danger' });
	}
}

// Why deleting it reaches past this list, so it's asked first. Otherwise undoing it puts it back as it was
async function deleteWarning(charge: Charge) {
	if (charge.remittanceId) {
		return 'Está en una remesa: el banco lo cobrará igualmente.';
	}
	if (charge.bankMovementId) {
		return 'Está conciliado con un movimiento del banco.';
	}
	if (charge.payment) {
		return 'Tiene un pago hecho desde la app.';
	}
	return closedYearWarning(props.id, [charge.dueDate, charge.paidAt]);
}

async function remove(charge: Charge) {
	const warning = await deleteWarning(charge);
	if (warning && !await ask({ title: `¿Borrar «${charge.concept}» de ${charge.propertyName}${charge.collections?.length ? ' con sus entregas a cuenta' : ''}?`, message: warning, confirmText: 'Borrar', variant: 'danger' })) {
		return;
	}
	// What it had, to put it back as it was
	const deleted = { ...charge, id: charge.id };
	setInHistory(deleted, false);
	void optimistic(deleteCharge(props.id, deleted), {
		done: 'Recibo borrado',
		failed: 'No se ha podido borrar',
		revert: async () => {
			setInHistory(deleted, true);
			await restoreCharge(props.id, deleted);
		},
		onError: () => setInHistory(deleted, true),
	});
}
</script>

<template>
	<header class="page-header">
		<h1>Recibos</h1>
		<NewButton v-if="!open" label="Emitir recibos" :disabled="!properties.length" @click="show()" />
	</header>

	<FormCard
		v-if="open"
		ref="issueForm"
		title="Emitir recibos o derrama"
		:error="formError"
		submit-label="Emitir"
		submit-icon="lucide:receipt-euro"
		:saving="issuing"
		:disabled="!properties.length"
		shortcut="Emitir los recibos"
		@submit="issue()"
		@cancel="close()"
	>
		<div class="fields">
			<LnxSelect
				v-model.convert="form.type"
				:options="typeOptions"
				:convert-fn="option => option.value"
			>
				Tipo
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ chargeTypes[value as Charge['type']] }}
				</template>
			</LnxSelect>
			<LnxInput v-model="form.concept" :placeholder="form.type === 'levy' ? 'Derrama fachada' : 'Cuota noviembre 2026'" required>
				Concepto
			</LnxInput>
			<LnxSelect
				v-if="form.type === 'fee'"
				v-model.convert="form.split"
				:options="splitOptions"
				:convert-fn="option => option.value"
			>
				Reparto
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ splitOptions.find(option => option.value === value)?.label }}
				</template>
			</LnxSelect>
			<LnxInput v-model="form.amount" inputmode="decimal" placeholder="1.250,00" required>
				{{ split === 'fixed' ? 'Importe por propiedad (€)' : 'Importe total (€)' }}
			</LnxInput>
			<LnxDatePicker v-model="form.dueDate" value-format="iso-date" required>
				Vencimiento
			</LnxDatePicker>
		</div>

		<p v-if="shares.length" class="hint tabular">
			{{ shares.length }} {{ shares.length === 1 ? 'propiedad' : 'propiedades' }} · {{ formatCents(sharesTotal) }} en total
		</p>
		<p v-if="split === 'coefficient' && properties.length && (coefficientSum !== 100 || withoutCoefficient)" class="warning">
			<LnxIcon icon="lucide:triangle-alert" />
			Los coeficientes suman {{ coefficientSum }} %<template v-if="withoutCoefficient">
				y {{ withoutCoefficient }} {{ withoutCoefficient === 1 ? 'propiedad no tiene' : 'propiedades no tienen' }} (no pagarán nada)
			</template>. Revísalo en el censo de propiedades.
		</p>
	</FormCard>

	<OnlinePaymentsCard :id @error="actionError = $event" />

	<section class="card">
		<div class="section-head">
			<h2>Morosidad</h2>
			<div class="item-actions">
				<LnxButton mode="clear" size="sm" :disabled="!shownRows.length" @click="exportCsv()">
					<LnxIcon icon="lucide:download" />
					Exportar CSV
				</LnxButton>
				<LnxButton :to="`/communities/${id}/arrears`" mode="clear" size="sm">
					<LnxIcon icon="lucide:mail-warning" />
					Antigüedad y reclamaciones
				</LnxButton>
			</div>
		</div>
		<p v-if="propertiesError || chargesError" class="error" role="alert">
			{{ failure('No se han podido cargar', propertiesError ?? chargesError) }}
		</p>
		<p v-if="actionError" class="error" role="alert">
			{{ actionError }}
		</p>

		<div class="totals tabular" :aria-busy="loading">
			<div>
				<small>Deuda vencida</small>
				<span v-if="loading" class="lnx-skeleton lnx-skeleton--title" style="width: 110px" />
				<strong v-else :class="{ debt: totalOverdue }">{{ formatCents(totalOverdue) }}</strong>
			</div>
			<div>
				<small>Pendiente de cobro</small>
				<span v-if="loading" class="lnx-skeleton lnx-skeleton--title" style="width: 95px" />
				<strong v-else>{{ formatCents(totalPending) }}</strong>
			</div>
			<div>
				<small>Propiedades con deuda</small>
				<span v-if="loading" class="lnx-skeleton lnx-skeleton--title" style="width: 40px" />
				<strong v-else>{{ debtors }}</strong>
			</div>
		</div>

		<div ref="searchBox" class="search">
			<LnxInput v-model="search" type="search" placeholder="Propiedad o propietario">
				Buscar <LnxKbd combo="/" />
			</LnxInput>
		</div>

		<ul v-if="loading" class="list" aria-busy="true" aria-label="Cargando">
			<li v-for="width in [55, 40, 65, 48]" :key="width" class="item">
				<div class="row">
					<span class="check unused"><LnxCheckbox disabled /></span>
					<div class="what">
						<span class="lnx-skeleton" :style="{ width: `${width}%` }" />
						<span class="lnx-skeleton lnx-skeleton--small" :style="{ width: `${width - 15}%` }" />
					</div>
					<span class="lnx-skeleton lnx-skeleton--small" style="width: 90px" />
					<span class="lnx-skeleton lnx-skeleton--circle" />
				</div>
			</li>
		</ul>
		<ul v-else-if="shownRows.length" class="list lnx-appear">
			<li v-for="row in shownRows" :key="row.property.id" class="item">
				<div class="row">
					<!-- Hidden when there's nothing to tick, keeping its room so the names line up -->
					<span class="check" :class="{ unused: !row.selectable.length }">
						<LnxCheckbox
							:model-value="!!row.selectable.length && row.selectable.every(charge => selected.has(charge.id))"
							:indeterminate="row.selectable.some(charge => selected.has(charge.id)) && !row.selectable.every(charge => selected.has(charge.id))"
							@update:model-value="value => select(row.selectable, !!value)"
						>
							<span class="sr-only">Seleccionar los recibos de {{ row.property.name }}</span>
						</LnxCheckbox>
					</span>
					<button type="button" class="what ux-row" :aria-expanded="openId === row.property.id" @click="toggle(row.property)">
						<strong>{{ row.property.name }}</strong>
						<small>{{ row.property.ownerName || 'Sin propietario' }}<template v-if="row.property.coefficient"> · {{ formatCoefficient(row.property.coefficient) }}</template></small>
					</button>
					<span v-if="row.overdueCount" class="chip debt tabular">
						{{ row.overdueCount }} {{ row.overdueCount === 1 ? 'vencido' : 'vencidos' }} · {{ formatCents(row.overdueAmount) }}
					</span>
					<span v-else-if="row.pendingAmount" class="chip tabular">
						Pendiente {{ formatCents(row.pendingAmount) }}
					</span>
					<span v-else class="chip ok">Al corriente</span>
					<LnxButton
						:to="`/communities/${id}/statements/${row.property.id}`"
						mode="clear"
						size="sm"
						shape="circle"
						aria-label="Estado de cuenta"
						title="Estado de cuenta"
					>
						<LnxIcon icon="lucide:scroll-text" />
					</LnxButton>
					<LnxButton
						:to="`/communities/${id}/charges/certificate/${row.property.id}`"
						mode="clear"
						size="sm"
						shape="circle"
						aria-label="Certificado de pagos"
						title="Certificado de pagos"
					>
						<LnxIcon icon="lucide:file-check" />
					</LnxButton>
				</div>

				<div v-if="openId === row.property.id" class="charges">
					<TransitionGroup v-if="(history ?? row.charges).length" tag="ul" name="charge">
						<li v-for="charge in history ?? row.charges" :key="charge.id" class="charge">
							<span class="check" :class="{ unused: charge.paidAt || charge.remittanceId }">
								<LnxCheckbox :model-value="selected.has(charge.id)" @update:model-value="value => select([charge], !!value)">
									<span class="sr-only">Seleccionar «{{ charge.concept }}»</span>
								</LnxCheckbox>
							</span>
							<div class="what">
								<span>{{ charge.concept }}</span>
								<small class="tabular">
									{{ chargeTypes[charge.type] }} · vence {{ dateFormat.format(charge.dueDate.toDate()) }}
									<template v-if="charge.paidAt"> · pagado el {{ dateFormat.format(charge.paidAt.toDate()) }}</template>
									<template v-if="charge.payment"> · <span class="chip test" :title="`${describePayment(charge.payment)} · ref. ${charge.payment.id}`">Pago de prueba</span></template>
									<template v-else-if="isOverdue(charge)"> · <span class="debt">vencido</span></template>
									<template v-if="charge.remittanceId"> · domiciliado</template>
									<template v-else-if="!charge.paidAt && charge.returns?.length"> · <span class="debt">devuelto ({{ charge.returns.at(-1)!.reason }})</span></template>
									<template v-if="!charge.paidAt && charge.collections?.length"> · quedan {{ formatCents(outstanding(charge)) }}</template>
								</small>
							</div>
							<strong class="tabular">{{ formatCents(charge.amount) }}</strong>
							<div class="item-actions">
								<LnxButton v-if="!charge.paidAt && !charge.remittanceId" mode="clear" size="sm" :aria-expanded="collecting?.chargeId === charge.id" @click="openCollection(charge)">
									Entrega a cuenta
								</LnxButton>
								<LnxButton v-if="!paidByCollections(charge) && !(charge.remittanceId && !charge.paidAt)" mode="clear" size="sm" :is-loading="toggling.has(charge.id)" @click="togglePaid(charge)">
									{{ charge.payment ? 'Anular pago de prueba' : charge.paidAt ? 'Marcar pendiente' : charge.collections?.length ? 'Marcar resto pagado' : 'Marcar pagado' }}
								</LnxButton>
								<LnxButton mode="clear" size="sm" shape="circle" variant="danger" aria-label="Borrar" title="Borrar" @click="remove(charge)">
									<LnxIcon icon="lucide:trash-2" />
								</LnxButton>
							</div>
							<ul v-if="charge.collections?.length" class="collections tabular">
								<li v-for="item in charge.collections" :key="item.id">
									<small>Entrega a cuenta · {{ dateFormat.format(item.date.toDate()) }} · {{ collectionMethods[item.method] }}<template v-if="item.note"> · {{ item.note }}</template></small>
									<small>{{ formatCents(item.amount) }}</small>
									<LnxButton
										v-if="!charge.remittanceId && (!charge.paidAt || paidByCollections(charge))"
										mode="clear"
										size="sm"
										shape="circle"
										aria-label="Deshacer entrega"
										title="Deshacer entrega"
										@click="uncollect(charge, item)"
									>
										<LnxIcon icon="lucide:undo-2" />
									</LnxButton>
								</li>
							</ul>
							<form v-if="collecting?.chargeId === charge.id" class="collect" @submit.prevent="collect(charge)">
								<div class="fields">
									<LnxInput v-model="collecting.amount" inputmode="decimal" :placeholder="(outstanding(charge) / 100).toFixed(2).replace('.', ',')" required>
										Importe (€)
									</LnxInput>
									<LnxDatePicker v-model="collecting.date" value-format="iso-date" :max="toDateString(new Date())" required>
										Fecha
									</LnxDatePicker>
									<LnxSelect
										v-model.convert="collecting.method"
										:options="methodOptions"
										:convert-fn="option => option.value"
									>
										Forma de pago
										<template #option="{ option }">
											{{ option.label }}
										</template>
										<template #optionInput="{ value }">
											{{ collectionMethods[value as CollectionMethod] }}
										</template>
									</LnxSelect>
									<LnxInput v-model="collecting.note" maxlength="200">
										Nota
									</LnxInput>
								</div>
								<footer class="form-actions">
									<p v-if="collectError" class="error" role="alert">
										{{ collectError }}
									</p>
									<LnxButton mode="clear" size="sm" @click="collecting = undefined">
										Cancelar
									</LnxButton>
									<LnxButton type="submit" size="sm" :is-loading="savingCollection">
										Registrar entrega
									</LnxButton>
								</footer>
							</form>
						</li>
					</TransitionGroup>
					<p v-else class="hint">
						{{ history ? 'No tiene recibos.' : 'No tiene nada pendiente.' }}
					</p>
					<LnxButton v-if="!history" mode="clear" size="sm" :is-loading="historyLoading" @click="loadHistory(row.property.id)">
						Ver también pagados
					</LnxButton>
				</div>
			</li>
		</ul>
		<p v-else-if="rows.length" class="hint">
			Ninguna propiedad coincide con «{{ search }}».
		</p>
		<p v-else class="hint">
			Aún no hay propiedades. Añádelas en el censo para emitir recibos.
		</p>

		<div v-if="selectedCharges.length" class="bulk lnx-appear">
			<span class="tabular">
				<strong>{{ selectedCharges.length }} {{ selectedCharges.length === 1 ? 'seleccionado' : 'seleccionados' }}</strong> · {{ formatCents(selectedTotal) }}
			</span>
			<LnxButton mode="clear" size="sm" @click="selected = new Set()">
				Quitar selección
			</LnxButton>
			<LnxButton size="sm" @click="markSelectedPaid()">
				<LnxIcon icon="lucide:check-check" />
				Marcar pagados
			</LnxButton>
		</div>
	</section>
</template>

<style lang="scss" scoped src="./charges.scss" />
