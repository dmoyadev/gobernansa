<script setup lang="ts">
import type { Charge } from '@gobernansa/shared/domain/finance.ts';
import type { Property } from '@gobernansa/shared/domain/property.ts';
import { chargeTypes, isOverdue } from '@gobernansa/shared/domain/finance.ts';
import { formatCents, toCents } from '@gobernansa/shared/domain/money.ts';
import { formatCoefficient, splitByCoefficient, totalCoefficient } from '@gobernansa/shared/domain/property.ts';
import DatePicker from '@gobernansa/shared/ui/DatePicker.vue';
import { Timestamp } from 'firebase/firestore';
import { LnxButton, LnxIcon, LnxInput, LnxSelect } from 'lnxjs-components';
import { computed, ref, useTemplateRef } from 'vue';
import BackButton from '@/app/ux/BackButton.vue';
import Kbd from '@/app/ux/Kbd.vue';
import { newId, onRevalidate } from '@/app/ux/navigation.ts';
import { useShortcut } from '@/app/ux/shortcuts.ts';
import { optimistic, toast } from '@/app/ux/toast.ts';
import { deleteCharge, issueCharges, loadPropertyCharges, restoreCharge, setChargePaid, toDueDate, useCommunityProperties, useUnpaidCharges } from '../application/useFinances.ts';

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

// The ids of a confirmed emission, kept until it's issued: trying the same one again after a failure rewrites those
// charges instead of issuing them twice. Changing the form makes it another emission
let confirmed: { key: string; batchId: string; ids: string[] } | undefined;

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
	// eslint-disable-next-line no-alert
	if (!window.confirm(`¿Emitir «${form.value.concept.trim()}» a ${shares.value.length} propiedades por ${formatCents(sharesTotal.value)} en total?`)) {
		return;
	}

	const key = JSON.stringify([form.value.type, form.value.concept.trim(), form.value.dueDate, shares.value.map(share => [share.property.id, share.cents])]);
	if (confirmed?.key !== key) {
		confirmed = { key, batchId: newId(), ids: shares.value.map(() => newId()) };
	}

	// Money: it waits for the server before telling it's done
	issuing.value = true;
	formError.value = undefined;
	try {
		await issueCharges(props.id, {
			type: form.value.type,
			concept: form.value.concept.trim(),
			dueDate: toDueDate(form.value.dueDate),
			shares: shares.value,
			batchId: confirmed.batchId,
			ids: confirmed.ids,
		});
		toast(shares.value.length === 1 ? 'Recibo emitido' : 'Recibos emitidos');
		form.value = emptyForm();
		confirmed = undefined;
	} catch (e) {
		formError.value = `No se han podido emitir: ${(e as Error).message}`;
	} finally {
		issuing.value = false;
	}
}

const issueForm = useTemplateRef('issueForm');
useShortcut('n', () => issueForm.value?.querySelector<HTMLElement>('input:not([type="hidden"])')?.focus(), 'Emitir recibos');
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
			overdueAmount: overdue.reduce((sum, charge) => sum + charge.amount, 0),
			pendingAmount: charges.reduce((sum, charge) => sum + charge.amount, 0),
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
function patchHistory(id: string, paidAt: Timestamp | null) {
	history.value = history.value?.map(charge => charge.id === id ? { ...charge, paidAt } : charge);
}

function setInHistory(charge: Charge, present: boolean) {
	if (!history.value) {
		return;
	}
	const others = history.value.filter(candidate => candidate.id !== charge.id);
	history.value = present ? [...others, charge].sort((a, b) => b.dueDate.toMillis() - a.dueDate.toMillis()) : others;
}

function togglePaid(charge: Charge) {
	const previous = charge.paidAt;
	const paidAt = previous ? null : Timestamp.now();
	patchHistory(charge.id, paidAt);
	void optimistic(setChargePaid(props.id, charge, paidAt), {
		done: paidAt ? 'Marcado como pagado' : 'Marcado como pendiente',
		failed: 'No se ha podido cambiar',
		revert: async () => {
			patchHistory(charge.id, previous);
			await setChargePaid(props.id, charge, previous);
		},
		onError: () => patchHistory(charge.id, previous),
	});
}

function remove(charge: Charge) {
	// eslint-disable-next-line no-alert
	if (!window.confirm(`¿Borrar «${charge.concept}» de ${charge.propertyName}?`)) {
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
		<BackButton :to="`/communities/${id}`" label="Volver a la comunidad" />
		<h1>Recibos y morosidad</h1>
	</header>

	<form ref="issueForm" class="card" @submit.prevent="issue()">
		<h2>Emitir recibos o derrama <Kbd combo="n" /></h2>
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
			<LnxButton type="submit" :is-loading="issuing" :disabled="!properties.length">
				<LnxIcon icon="lucide:receipt-euro" />
				Emitir
				<Kbd combo="mod+enter" />
			</LnxButton>
		</footer>
	</form>

	<section class="card">
		<h2>Morosidad</h2>
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
						:to="`/communities/${id}/charges/certificate/${row.property.id}`"
						mode="clear"
						size="small"
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
									<template v-else-if="isOverdue(charge)"> · <span class="debt">vencido</span></template>
								</small>
							</div>
							<strong class="tabular">{{ formatCents(charge.amount) }}</strong>
							<div class="item-actions">
								<LnxButton mode="clear" size="small" @click="togglePaid(charge)">
									{{ charge.paidAt ? 'Marcar pendiente' : 'Marcar pagado' }}
								</LnxButton>
								<LnxButton mode="clear" size="small" shape="circle" variant="danger" aria-label="Borrar" title="Borrar" @click="remove(charge)">
									<LnxIcon icon="lucide:trash-2" />
								</LnxButton>
							</div>
						</li>
					</TransitionGroup>
					<p v-else class="hint">
						{{ history ? 'No tiene recibos.' : 'No tiene nada pendiente.' }}
					</p>
					<LnxButton v-if="!history" mode="clear" size="small" :is-loading="historyLoading" @click="loadHistory(row.property.id)">
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
	grid-template-columns: minmax(0, 1fr) auto auto;
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
