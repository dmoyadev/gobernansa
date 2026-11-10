<script setup lang="ts">
import type { Charge, Expense, FeeMonths, FeePlan } from '@gobernansa/shared/domain/finance.ts';
import { feeBatchId, feePeriodicities, MIN_RESERVE_PERCENT, minReserve, planFees, reserveUsed } from '@gobernansa/shared/domain/finance.ts';
import { formatCents, toCents } from '@gobernansa/shared/domain/money.ts';
import { formatCoefficient, totalCoefficient } from '@gobernansa/shared/domain/property.ts';
import { Timestamp } from 'firebase/firestore';
import { LnxButton, LnxDatePicker, LnxIcon, LnxInput, LnxKbd, LnxSelect, toast, useConfirm, useShortcut } from 'lnxjs-components';
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue';
import { onRevalidate } from '@/app/ux/navigation.ts';
import { optimistic } from '@/app/ux/toast.ts';
import { deleteCharges, issueFees, loadExpenses, loadFees, restoreCharges, useBudget, useCommunityProperties } from '../application/useFinances.ts';

const props = defineProps<{ id: string }>();

const ask = useConfirm();

const currentYear = new Date().getFullYear();
const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear + 1 - i).map(year => ({ value: year, label: String(year) }));
const year = ref(currentYear);
const monthsOptions = Object.entries(feePeriodicities).map(([value, label]) => ({ value: Number(value) as FeeMonths, label }));

const { data: budget, pending: budgetPending, error: budgetError } = useBudget(props.id, year);
const { data: properties, error: propertiesError } = useCommunityProperties(props.id);

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium' });

// The fees already issued and the expenses, read once per year: they only change here or on the budget page
const fees = ref<Charge[]>([]);
const expenses = ref<Expense[]>([]);
const loading = ref(true);
const loadError = ref<string>();

async function load() {
	const loadedYear = year.value;
	try {
		const [loadedFees, loadedExpenses] = await Promise.all([loadFees(props.id, loadedYear), loadExpenses(props.id, loadedYear)]);
		if (loadedYear === year.value) {
			fees.value = loadedFees;
			expenses.value = loadedExpenses;
			loadError.value = undefined;
		}
	} catch (e) {
		loadError.value = `No se han podido cargar las cuotas: ${(e as Error).message}`;
	} finally {
		loading.value = false;
	}
}

onMounted(load);
onRevalidate(load);
watch(year, () => {
	loading.value = true;
	fees.value = [];
	expenses.value = [];
	void load();
});

const ordinary = computed(() => (budget.value?.items ?? []).reduce((sum, item) => sum + item.amount, 0));
const reserve = computed(() => budget.value?.reserve ?? 0);

// The plan as typed, from the one issued if there's one
const form = ref({ months: 1 as FeeMonths, firstDue: '', overrides: {} as Record<string, string> });
watch(() => budget.value?.fees, (saved) => {
	form.value = saved
		? { months: saved.months, firstDue: saved.firstDue, overrides: Object.fromEntries(Object.entries(saved.overrides).map(([id, cents]) => [id, (cents / 100).toFixed(2).replace('.', ',')])) }
		: { months: 1, firstDue: '', overrides: {} };
}, { immediate: true });

const invalidOverride = computed(() => properties.value.find((property) => {
	const typed = form.value.overrides[property.id]?.trim();
	return typed && !(toCents(typed) >= 0);
}));

const plan = computed<FeePlan | undefined>(() => form.value.firstDue && !invalidOverride.value
	? {
			months: form.value.months,
			firstDue: form.value.firstDue,
			overrides: Object.fromEntries(Object.entries(form.value.overrides)
				.filter(([id, typed]) => typed.trim() && properties.value.some(property => property.id === id))
				.map(([id, typed]) => [id, toCents(typed)])),
		}
	: undefined);

const issuedIds = computed(() => new Set(fees.value.map(fee => fee.id)));
const periods = computed(() => plan.value && ordinary.value + reserve.value > 0
	? planFees(year.value, ordinary.value, reserve.value, properties.value, plan.value).map((period) => {
			const sharesTotal = period.shares.reduce((sum, share) => sum + share.cents, 0);
			return { ...period, sharesTotal, missing: period.shares.filter(share => !issuedIds.value.has(share.id)) };
		})
	: []);
const missingCount = computed(() => periods.value.reduce((sum, period) => sum + period.missing.length, 0));
// What each property pays per fee and in the year
const perProperty = computed(() => {
	const totals = new Map<string, { fee: number; year: number }>();
	for (const period of periods.value) {
		for (const share of period.shares) {
			const total = totals.get(share.property.id) ?? { fee: share.cents, year: 0 };
			total.year += share.cents;
			totals.set(share.property.id, total);
		}
	}
	return totals;
});
const sortedProperties = computed(() => [...properties.value].sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true })));
const coefficientSum = computed(() => totalCoefficient(properties.value));

// Issued with another periodicity: issuing this plan too would charge the year twice
const foreign = computed(() => fees.value.filter(fee => !fee.id.startsWith(`${feeBatchId(year.value)}-${form.value.months}m-`)));
// The fixed fees take more than a period, or nobody has a coefficient to pay the rest
const unbalanced = computed(() => periods.value.find(period => period.sharesTotal !== period.total));

const issuing = ref(false);
const issueError = ref<string>();

async function issue() {
	if (issuing.value || !plan.value) {
		return;
	}
	if (invalidOverride.value) {
		issueError.value = `Revisa la cuota fija de ${invalidOverride.value.name}, p. ej. 25,00`;
		return;
	}
	if (unbalanced.value || foreign.value.length || !missingCount.value) {
		return;
	}
	if (!await ask({ title: `¿Emitir ${missingCount.value} recibos de cuotas de ${year.value}?`, confirmText: 'Emitir' })) {
		return;
	}

	// Money: it waits for the server before telling it's done
	issuing.value = true;
	issueError.value = undefined;
	try {
		await issueFees(props.id, year.value, plan.value, periods.value.map(period => ({
			concept: period.concept,
			dueDate: Timestamp.fromDate(period.dueDate),
			shares: period.missing,
			ids: period.missing.map(share => share.id),
		})));
		toast('Cuotas emitidas');
	} catch (e) {
		// Those issued before the failure are kept, issuing again issues the rest
		issueError.value = `No se han podido emitir todas: ${(e as Error).message}. Vuelve a emitir para completar las que faltan.`;
	} finally {
		issuing.value = false;
		await load();
	}
}

const issueForm = useTemplateRef('issueForm');
useShortcut('mod+enter', () => issueForm.value?.requestSubmit(), { description: 'Emitir las cuotas' });

const unpaidFees = computed(() => fees.value.filter(fee => !fee.paidAt));
// Those with entregas a cuenta stay too, what was collected would be lost with them, and those in a remittance, which
// the bank may be collecting already
const annullable = computed(() => unpaidFees.value.filter(fee => !fee.collections?.length && !fee.remittanceId));
const annulling = ref(false);

async function annul() {
	if (annulling.value || !await ask({ title: `¿Anular ${annullable.value.length} recibos de cuotas de ${year.value} sin pagar?`, message: 'Los pagados, los que tienen entregas a cuenta y los domiciliados en una remesa se quedan.', confirmText: 'Anular', variant: 'danger' })) {
		return;
	}
	annulling.value = true;
	// From the server, after confirming, so a fee paid or remitted since the page loaded (or while confirming) isn't deleted
	// with the rest. Offline, nothing is annulled
	try {
		fees.value = await loadFees(props.id, year.value, true);
	} catch (e) {
		toast(`No se han podido anular: ${(e as Error).message}`, { variant: 'danger' });
		return;
	} finally {
		annulling.value = false;
	}
	const annulled = annullable.value.map(fee => ({ ...fee, id: fee.id }));
	const label = `las cuotas pendientes de ${year.value}`;
	if (!annulled.length) {
		return;
	}
	const ids = new Set(annulled.map(fee => fee.id));
	fees.value = fees.value.filter(fee => !ids.has(fee.id));
	void optimistic(deleteCharges(props.id, annulled, label), {
		done: 'Cuotas anuladas',
		failed: 'No se han podido anular',
		revert: async () => {
			await restoreCharges(props.id, annulled, label);
			await load();
		},
		onError: () => void load(),
	});
}

// Fondo de reserva: the year's opening, what the fees collected for it and what was paid from it
const opening = computed(() => budget.value?.reserveOpening ?? 0);
const collected = computed(() => fees.value.reduce((sum, fee) => sum + (fee.paidAt ? fee.reserve ?? 0 : 0), 0));
const toCollect = computed(() => unpaidFees.value.reduce((sum, fee) => sum + (fee.reserve ?? 0), 0));
const used = computed(() => expenses.value.filter(expense => expense.fromReserve));
const usedTotal = computed(() => reserveUsed(used.value));
const balance = computed(() => opening.value + collected.value - usedTotal.value);
</script>

<template>
	<header class="page-header">
		<h1>Cuotas y fondo de reserva</h1>
		<LnxSelect
			v-model.convert="year"
			class="year"
			aria-label="Año"
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
	</header>

	<p v-if="budgetError || propertiesError || loadError" class="error" role="alert">
		{{ loadError ?? `No se ha podido cargar: ${(budgetError ?? propertiesError)?.message}` }}
	</p>

	<form ref="issueForm" class="card" @submit.prevent="issue()">
		<h2>Cuotas de {{ year }}</h2>
		<div v-if="budgetPending && !budget" class="lines" aria-busy="true" aria-label="Cargando">
			<span class="lnx-skeleton lnx-skeleton--title" style="width: 60%" />
			<span class="lnx-skeleton" style="width: 40%" />
		</div>
		<p v-else-if="!ordinary && !reserve" class="hint">
			Guarda el <RouterLink :to="`/communities/${id}/budget`">
				presupuesto de {{ year }}
			</RouterLink> para generar sus cuotas.
		</p>
		<template v-else>
			<p class="tabular">
				Presupuesto ordinario {{ formatCents(ordinary) }} + fondo de reserva {{ formatCents(reserve) }} = <strong>{{ formatCents(ordinary + reserve) }} al año</strong>
			</p>
			<p v-if="reserve < minReserve(ordinary)" class="warning">
				<LnxIcon icon="lucide:triangle-alert" />
				El fondo de reserva no llega al {{ MIN_RESERVE_PERCENT }} % del presupuesto ordinario ({{ formatCents(minReserve(ordinary)) }}).
				<RouterLink :to="`/communities/${id}/budget`">
					Cambiarlo
				</RouterLink>
			</p>

			<div class="fields">
				<LnxSelect
					v-model.convert="form.months"
					:options="monthsOptions"
					:convert-fn="option => option.value"
				>
					Periodicidad
					<template #option="{ option }">
						{{ option.label }}
					</template>
					<template #optionInput="{ value }">
						{{ feePeriodicities[value as FeeMonths] }}
					</template>
				</LnxSelect>
				<LnxDatePicker v-model="form.firstDue" value-format="iso-date" :min="`${year}-01-01`" :max="`${year}-12-31`" required>
					Primer vencimiento
				</LnxDatePicker>
			</div>

			<table v-if="sortedProperties.length">
				<thead>
					<tr>
						<th>Propiedad</th>
						<th class="amount">
							Coeficiente
						</th>
						<th>Cuota fija (€)</th>
						<th class="amount">
							Por recibo
						</th>
						<th class="amount">
							Al año
						</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="property in sortedProperties" :key="property.id">
						<td>{{ property.name }}</td>
						<td class="amount">
							{{ formatCoefficient(property.coefficient) }}
						</td>
						<td class="override">
							<LnxInput v-model="form.overrides[property.id]" inputmode="decimal" placeholder="Por coeficiente" :aria-label="`Cuota fija de ${property.name}`" />
						</td>
						<td class="amount">
							{{ perProperty.has(property.id) ? formatCents(perProperty.get(property.id)!.fee) : '—' }}
						</td>
						<td class="amount">
							{{ perProperty.has(property.id) ? formatCents(perProperty.get(property.id)!.year) : '—' }}
						</td>
					</tr>
				</tbody>
			</table>
			<p v-else class="hint">
				Aún no hay propiedades. Añádelas en el censo con su coeficiente.
			</p>
			<p v-if="properties.length && coefficientSum !== 100" class="warning">
				<LnxIcon icon="lucide:triangle-alert" />
				Los coeficientes suman {{ coefficientSum }} %. Revísalo en el censo de propiedades.
			</p>

			<ul v-if="periods.length" class="periods tabular">
				<li v-for="period in periods" :key="period.concept">
					<span>{{ period.concept }}</span>
					<small>vence {{ dateFormat.format(period.dueDate) }}</small>
					<strong>{{ formatCents(period.total) }}</strong>
					<span v-if="loading" class="lnx-skeleton lnx-skeleton--small" style="width: 70px" />
					<span v-else-if="!period.missing.length" class="chip ok">Emitida</span>
					<span v-else-if="period.missing.length < period.shares.length" class="chip">Faltan {{ period.missing.length }}</span>
					<span v-else class="chip">Por emitir</span>
				</li>
			</ul>
			<p v-else-if="!form.firstDue" class="hint">
				Elige el primer vencimiento para ver los recibos.
			</p>

			<p v-if="unbalanced" class="error">
				{{ unbalanced.sharesTotal > unbalanced.total
					? `Las cuotas fijas suman ${formatCents(unbalanced.sharesTotal)}, más que lo que hay que cobrar en cada recibo (${formatCents(unbalanced.total)}).`
					: 'Ninguna propiedad sin cuota fija tiene coeficiente para pagar el resto. Revisa el censo.' }}
			</p>
			<p v-if="foreign.length" class="warning">
				<LnxIcon icon="lucide:triangle-alert" />
				Ya hay {{ foreign.length }} recibos de cuotas de {{ year }} emitidos con otra periodicidad. Anula los pendientes para generarlas de nuevo.
			</p>

			<footer class="form-actions">
				<p v-if="issueError" class="error" role="alert">
					{{ issueError }}
				</p>
				<LnxButton v-if="annullable.length" mode="clear" variant="danger" :is-loading="annulling" @click="void annul()">
					Anular las pendientes ({{ annullable.length }})
				</LnxButton>
				<LnxButton type="submit" :is-loading="issuing" :disabled="loading || !missingCount || !!unbalanced || !!foreign.length">
					<LnxIcon icon="lucide:receipt-euro" />
					{{ missingCount ? `Emitir ${missingCount} recibos` : 'Todo emitido' }}
					<LnxKbd combo="mod+enter" />
				</LnxButton>
			</footer>
		</template>
	</form>

	<section class="card">
		<h2>Fondo de reserva en {{ year }}</h2>
		<div class="totals tabular" :aria-busy="loading">
			<div>
				<small>Saldo a 1 de enero</small>
				<strong>{{ formatCents(opening) }}</strong>
			</div>
			<div>
				<small>Cobrado con las cuotas</small>
				<span v-if="loading" class="lnx-skeleton lnx-skeleton--title" style="width: 90px" />
				<strong v-else>+{{ formatCents(collected) }}</strong>
			</div>
			<div>
				<small>Pagado del fondo</small>
				<span v-if="loading" class="lnx-skeleton lnx-skeleton--title" style="width: 90px" />
				<strong v-else>−{{ formatCents(usedTotal) }}</strong>
			</div>
			<div>
				<small>Saldo</small>
				<span v-if="loading" class="lnx-skeleton lnx-skeleton--title" style="width: 110px" />
				<strong v-else :class="{ debt: balance < 0 }">{{ formatCents(balance) }}</strong>
			</div>
		</div>
		<p v-if="toCollect" class="hint tabular">
			Quedan {{ formatCents(toCollect) }} por cobrar para el fondo en los recibos pendientes.
		</p>
		<ul v-if="used.length" class="periods tabular">
			<li v-for="expense in used" :key="expense.id">
				<span>{{ expense.concept }}</span>
				<small>{{ dateFormat.format(expense.date.toDate()) }}<template v-if="expense.provider"> · {{ expense.provider.name }}</template><template v-if="expense.paidAt === null"> · pendiente de pago</template></small>
				<strong>{{ formatCents(expense.amount) }}</strong>
			</li>
		</ul>
		<p class="hint">
			El saldo inicial y la aportación se cambian en el <RouterLink :to="`/communities/${id}/budget`">
				presupuesto
			</RouterLink>. Los gastos marcados «Se paga del fondo de reserva» se descuentan.
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
	overflow-x: auto;

	h2 {
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
		color: var(--color-gray-6);
		text-transform: uppercase;
		letter-spacing: .04em;
	}
}

.lines {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);
}

.fields {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
	align-items: start;
	gap: var(--lnx-spacing-3) var(--lnx-spacing-4);
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

	.amount {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.override {
		width: 160px;
		padding-block: var(--lnx-spacing-1);
	}
}

.periods {
	display: flex;
	flex-direction: column;

	li {
		padding: var(--lnx-spacing-2) 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto auto;
		align-items: center;
		gap: var(--lnx-spacing-3);

		& + li {
			border-top: 1px solid var(--color-gray-3);
		}
	}

	small {
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
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

.chip {
	padding: 2px var(--lnx-spacing-2);
	border-radius: 999px;
	background: var(--color-gray-2);
	font-size: var(--lnx-font-size-small);
	white-space: nowrap;

	&.ok {
		color: var(--color-primary);
	}
}

.debt {
	color: var(--color-secondary-accent);
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
</style>
