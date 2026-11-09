<script setup lang="ts">
import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { Charge, ChargeCollection, CollectionMethod } from '@gobernansa/shared/domain/finance.ts';
import type { Property } from '@gobernansa/shared/domain/property.ts';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { chargeTypes, collectionMethods, isOverdue, outstanding } from '@gobernansa/shared/domain/finance.ts';
import { formatCents, toCents } from '@gobernansa/shared/domain/money.ts';
import { describePayment } from '@gobernansa/shared/domain/payment.ts';
import { formatCoefficient, splitByCoefficient, totalCoefficient } from '@gobernansa/shared/domain/property.ts';
import DatePicker from '@gobernansa/shared/ui/DatePicker.vue';
import { Timestamp } from 'firebase/firestore';
import { LnxButton, LnxIcon, LnxInput, LnxSelect } from 'lnxjs-components';
import { computed, ref, useTemplateRef } from 'vue';
import Kbd from '@/app/ux/Kbd.vue';
import { newId, onRevalidate } from '@/app/ux/navigation.ts';
import NewButton from '@/app/ux/NewButton.vue';
import { useNewForm } from '@/app/ux/newForm.ts';
import { useShortcut } from '@/app/ux/shortcuts.ts';
import { optimistic, toast } from '@/app/ux/toast.ts';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { addCollection, deleteCharge, issueCharges, loadBatch, loadPropertyCharges, removeCollection, restoreCharge, saveOnlinePayments, setChargePaid, toDueDate, useCommunityProperties, useUnpaidCharges } from '../application/useFinances.ts';

const props = defineProps<{ id: string }>();

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
	// eslint-disable-next-line no-alert
	if (!window.confirm(`${same ? `Ya hay ${same} ${same === 1 ? 'recibo' : 'recibos'} «${form.value.concept.trim()}» sin pagar con ese vencimiento. ` : ''}¿Emitir «${form.value.concept.trim()}» a ${shares.value.length} propiedades por ${formatCents(sharesTotal.value)} en total?`)) {
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
		formError.value = `No se han podido emitir: ${(e as Error).message}`;
	} finally {
		issuing.value = false;
	}
}

useShortcut('mod+enter', () => issueForm.value?.requestSubmit(), 'Emitir los recibos');

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
		};
	}).sort((a, b) => b.overdueAmount - a.overdueAmount || b.pendingAmount - a.pendingAmount
		|| a.property.name.localeCompare(b.property.name, 'es', { numeric: true }));
});
const totalOverdue = computed(() => rows.value.reduce((sum, row) => sum + row.overdueAmount, 0));
const totalPending = computed(() => rows.value.reduce((sum, row) => sum + row.pendingAmount, 0));
const debtors = computed(() => rows.value.filter(row => row.overdueCount).length);
const loading = computed(() => (propertiesPending.value || chargesPending.value) && !rows.value.length);

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
		actionError.value = `No se ha podido cargar el historial: ${(e as Error).message}`;
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
		collectError.value = `No se ha podido registrar: ${(e as Error).message}`;
	} finally {
		savingCollection.value = false;
	}
}

async function uncollect(charge: Charge, item: ChargeCollection) {
	// eslint-disable-next-line no-alert
	if (!window.confirm(`¿Deshacer la entrega a cuenta de ${formatCents(item.amount)} del ${dateFormat.format(item.date.toDate())}?`)) {
		return;
	}
	try {
		patchHistory(charge.id, await removeCollection(props.id, charge.id, item));
		toast('Entrega deshecha', { undo: async () => patchHistory(charge.id, await addCollection(props.id, charge.id, item)) });
	} catch (e) {
		toast(`No se ha podido deshacer: ${(e as Error).message}`, { tone: 'error' });
	}
}

// Online payments by the neighbours, read once with the community
const onlinePayments = ref<Community['onlinePayments'] | null>();
const paymentsOptions = [
	{ value: 'off', label: 'Desactivados' },
	{ value: 'test', label: 'Modo de prueba' },
];

function loadPaymentsMode() {
	return loadCommunity(props.id)
		.then(community => onlinePayments.value = community?.onlinePayments ?? null)
		.catch((e: Error) => actionError.value = `No se ha podido cargar la comunidad: ${e.message}`);
}

void loadPaymentsMode();
onRevalidate(loadPaymentsMode);

const paymentsMode = computed({
	get: () => onlinePayments.value ? 'test' : 'off',
	set: value => setPaymentsMode(value === 'test' ? 'test' : null),
});

function setPaymentsMode(next: 'test' | null) {
	const previous = onlinePayments.value;
	if (next === previous) {
		return;
	}
	onlinePayments.value = next;
	void optimistic(saveOnlinePayments(props.id, next), {
		done: next ? 'Pagos online en modo de prueba' : 'Pagos online desactivados',
		failed: 'No se ha podido cambiar',
		revert: async () => {
			onlinePayments.value = previous;
			await saveOnlinePayments(props.id, previous ?? null);
		},
		onError: () => onlinePayments.value = previous,
	});
}

function remove(charge: Charge) {
	// eslint-disable-next-line no-alert
	if (!window.confirm(`¿Borrar «${charge.concept}» de ${charge.propertyName}${charge.collections?.length ? ' con sus entregas a cuenta' : ''}?`)) {
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

	<form v-if="open" ref="issueForm" class="card ux-appear" @submit.prevent="issue()">
		<h2>Emitir recibos o derrama</h2>
		<div class="fields">
			<LnxSelect
				v-model.convert="form.type"
				:options="typeOptions"
				:convert-fn="option => option.value"
				search-placeholder-text="Buscar..."
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
				search-placeholder-text="Buscar..."
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
			<DatePicker v-model="form.dueDate" required>
				Vencimiento
			</DatePicker>
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

		<footer class="form-actions">
			<p v-if="formError" class="error" role="alert">
				{{ formError }}
			</p>
			<LnxButton type="button" mode="clear" @click="close()">
				Cancelar
				<Kbd combo="escape" />
			</LnxButton>
			<LnxButton type="submit" :is-loading="issuing" :disabled="!properties.length">
				<LnxIcon icon="lucide:receipt-euro" />
				Emitir
				<Kbd combo="mod+enter" />
			</LnxButton>
		</footer>
	</form>

	<section class="card">
		<div class="section-head">
			<h2>
				Pagos online de los vecinos
				<span v-if="onlinePayments" class="chip test">Modo de prueba</span>
			</h2>
		</div>
		<p class="hint">
			Los vecinos pagan sus recibos y las reservas de pago desde la app. En modo de prueba no se mueve dinero ni tiene coste: solo se aceptan las tarjetas de prueba (4242 4242 4242 4242) y un Bizum simulado. Para cobrar de verdad hará falta contratar una pasarela (Redsys, Stripe…).
		</p>
		<div class="fields">
			<span v-if="onlinePayments === undefined" class="skeleton-item" style="height: 40px" />
			<LnxSelect
				v-else
				v-model.convert="paymentsMode"
				:options="paymentsOptions"
				:convert-fn="option => option.value"
				search-placeholder-text="Buscar..."
			>
				Pagos online
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ paymentsOptions.find(option => option.value === value)?.label }}
				</template>
			</LnxSelect>
		</div>
	</section>

	<section class="card">
		<div class="section-head">
			<h2>Morosidad</h2>
			<LnxButton :to="`/communities/${id}/arrears`" mode="clear" class="size-small">
				<LnxIcon icon="lucide:mail-warning" />
				Antigüedad y reclamaciones
			</LnxButton>
		</div>
		<p v-if="propertiesError || chargesError" class="error" role="alert">
			No se han podido cargar: {{ (propertiesError ?? chargesError)?.message }}
		</p>
		<p v-if="actionError" class="error" role="alert">
			{{ actionError }}
		</p>

		<div class="totals tabular" :aria-busy="loading">
			<div>
				<small>Deuda vencida</small>
				<span v-if="loading" class="skeleton-item skeleton-item--title" style="width: 110px" />
				<strong v-else :class="{ debt: totalOverdue }">{{ formatCents(totalOverdue) }}</strong>
			</div>
			<div>
				<small>Pendiente de cobro</small>
				<span v-if="loading" class="skeleton-item skeleton-item--title" style="width: 95px" />
				<strong v-else>{{ formatCents(totalPending) }}</strong>
			</div>
			<div>
				<small>Propiedades con deuda</small>
				<span v-if="loading" class="skeleton-item skeleton-item--title" style="width: 40px" />
				<strong v-else>{{ debtors }}</strong>
			</div>
		</div>

		<ul v-if="loading" class="list" aria-busy="true" aria-label="Cargando">
			<li v-for="width in [55, 40, 65, 48]" :key="width" class="item">
				<div class="row">
					<div class="what">
						<span class="skeleton-item" :style="{ width: `${width}%` }" />
						<span class="skeleton-item skeleton-item--small" :style="{ width: `${width - 15}%` }" />
					</div>
					<span class="skeleton-item skeleton-item--small" style="width: 90px" />
					<span class="skeleton-item skeleton-item--icon" />
				</div>
			</li>
		</ul>
		<ul v-else-if="rows.length" class="list ux-appear">
			<li v-for="row in rows" :key="row.property.id" class="item">
				<div class="row">
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
						class="size-small"
						shape="circle"
						aria-label="Estado de cuenta"
						title="Estado de cuenta"
					>
						<LnxIcon icon="lucide:scroll-text" />
					</LnxButton>
					<LnxButton
						:to="`/communities/${id}/charges/certificate/${row.property.id}`"
						mode="clear"
						class="size-small"
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
								<LnxButton v-if="!charge.paidAt && !charge.remittanceId" mode="clear" class="size-small" :aria-expanded="collecting?.chargeId === charge.id" @click="openCollection(charge)">
									Entrega a cuenta
								</LnxButton>
								<LnxButton v-if="!paidByCollections(charge) && !(charge.remittanceId && !charge.paidAt)" mode="clear" class="size-small" :is-loading="toggling.has(charge.id)" @click="togglePaid(charge)">
									{{ charge.payment ? 'Anular pago de prueba' : charge.paidAt ? 'Marcar pendiente' : charge.collections?.length ? 'Marcar resto pagado' : 'Marcar pagado' }}
								</LnxButton>
								<LnxButton mode="clear" class="size-small" shape="circle" variant="danger" aria-label="Borrar" title="Borrar" @click="remove(charge)">
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
										class="size-small"
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
									<DatePicker v-model="collecting.date" :max="toDateString(new Date())" required>
										Fecha
									</DatePicker>
									<LnxSelect
										v-model.convert="collecting.method"
										:options="methodOptions"
										:convert-fn="option => option.value"
										search-placeholder-text="Buscar..."
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
									<LnxButton type="button" mode="clear" class="size-small" @click="collecting = undefined">
										Cancelar
									</LnxButton>
									<LnxButton type="submit" class="size-small" :is-loading="savingCollection">
										Registrar entrega
									</LnxButton>
								</footer>
							</form>
						</li>
					</TransitionGroup>
					<p v-else class="hint">
						{{ history ? 'No tiene recibos.' : 'No tiene nada pendiente.' }}
					</p>
					<LnxButton v-if="!history" mode="clear" class="size-small" :is-loading="historyLoading" @click="loadHistory(row.property.id)">
						Ver también pagados
					</LnxButton>
				</div>
			</li>
		</ul>
		<p v-else class="hint">
			Aún no hay propiedades. Añádelas en el censo para emitir recibos.
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
		font-size: var(--lnx-font-size-title);
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

.section-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--lnx-spacing-2);
}

.fields {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
	align-items: start;
	gap: var(--lnx-spacing-3) var(--lnx-spacing-4);
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

.totals {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
	gap: var(--lnx-spacing-3);

	div {
		display: flex;
		flex-direction: column;
	}

	small {
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
	}

	strong {
		font-size: var(--lnx-font-size-title);
	}
}

.list {
	display: flex;
	flex-direction: column;
}

.item {
	padding: var(--lnx-spacing-3) 0;

	& + & {
		border-top: 1px solid var(--color-gray-3);
	}
}

.row {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto auto auto;
	align-items: center;
	gap: var(--lnx-spacing-3);
}

.what {
	display: flex;
	flex-direction: column;
	min-width: 0;
	text-align: left;

	small {
		overflow: hidden;
		color: var(--color-gray-6);
		white-space: nowrap;
		text-overflow: ellipsis;
	}
}

button.what {
	// Its hover reaches a bit past the text, without moving it
	margin: calc(-1 * var(--lnx-spacing-1)) calc(-1 * var(--lnx-spacing-2));
	padding: var(--lnx-spacing-1) var(--lnx-spacing-2);
	border: none;
	border-radius: var(--lnx-radius-2);
	background: none;
	font: inherit;
	color: inherit;
	cursor: pointer;

	strong {
		text-wrap: balance;
	}
}

.chip {
	padding: 2px var(--lnx-spacing-2);
	border-radius: 999px;
	background: var(--color-gray-2);
	font-size: var(--lnx-font-size-small);
	white-space: nowrap;

	&.ok {
		color: var(--color-primary);
	}

	&.test {
		color: var(--color-gray-7);
		font-weight: normal;
		text-transform: none;
		letter-spacing: normal;
	}

	&.debt {
		color: var(--color-gray-0);
		background: var(--color-secondary-accent);
	}
}

.debt {
	color: var(--color-secondary-accent);
}

.charges {
	margin-top: var(--lnx-spacing-3);
	padding-left: var(--lnx-spacing-4);
	border-left: 2px solid var(--color-gray-3);
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: var(--lnx-spacing-2);

	ul {
		position: relative;
		width: 100%;
	}
}

.charge {
	padding: var(--lnx-spacing-2) 0;
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto auto;
	align-items: center;
	gap: var(--lnx-spacing-3);
}

// Paid, pending or deleted: the rest slide into place
.charge-move,
.charge-enter-active,
.charge-leave-active {
	transition: opacity var(--duration) var(--ease-out), translate var(--duration) var(--ease-out);
}

.charge-enter-from,
.charge-leave-to {
	opacity: 0;
	translate: 0 -4px;
}

.charge-leave-active {
	position: absolute;
	width: 100%;
}

.item-actions {
	display: flex;
	gap: var(--lnx-spacing-1);
}

.collections,
.collect {
	grid-column: 1 / -1;
}

.collections li {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto auto;
	align-items: center;
	gap: var(--lnx-spacing-3);
	color: var(--color-gray-6);
}

.collect {
	padding: var(--lnx-spacing-3);
	border-radius: var(--lnx-radius-2);
	background: var(--color-gray-1);
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
}

.hint {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.warning {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
	font-size: var(--lnx-font-size-small);
	color: var(--color-gray-7);
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}
</style>
