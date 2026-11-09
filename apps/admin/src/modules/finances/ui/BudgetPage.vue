<script setup lang="ts">
import type { Expense, PaymentMethod, VatRate } from '@gobernansa/shared/domain/finance.ts';
import type { ExpenseData } from '../application/useFinances.ts';
import { invoiceAmounts, isOverdue, MIN_RESERVE_PERCENT, minReserve, paymentMethods, vatRates, withholdings } from '@gobernansa/shared/domain/finance.ts';
import { formatCents, toCents } from '@gobernansa/shared/domain/money.ts';
import { formatCoefficient, splitByCoefficient } from '@gobernansa/shared/domain/property.ts';
import DatePicker from '@gobernansa/shared/ui/DatePicker.vue';
import LnxCheckbox from '@gobernansa/shared/ui/LnxCheckbox.vue';
import { Timestamp } from 'firebase/firestore';
import { LnxButton, LnxIcon, LnxInput, LnxSelect } from 'lnxjs-components';
import { computed, ref, useTemplateRef, watch } from 'vue';
import Kbd from '@/app/ux/Kbd.vue';
import { newId } from '@/app/ux/navigation.ts';
import NewButton from '@/app/ux/NewButton.vue';
import { useNewForm } from '@/app/ux/newForm.ts';
import { useShortcut } from '@/app/ux/shortcuts.ts';
import { optimistic } from '@/app/ux/toast.ts';
import { useProviders } from '@/modules/providers/application/useProviders.ts';
import { addExpense, deleteExpense, restoreExpense, saveBudget, toDueDate, useBudget, useCommunityProperties, useExpenses } from '../application/useFinances.ts';

const props = defineProps<{ id: string }>();

const currentYear = new Date().getFullYear();
const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear + 1 - i).map(year => ({ value: year, label: String(year) }));
const year = ref(currentYear);

const { data: budget, pending: budgetPending, error: budgetLoadError } = useBudget(props.id, year);
const { data: expenses, pending: expensesPending, error: expensesError } = useExpenses(props.id, year);
const { data: properties } = useCommunityProperties(props.id);
const { providers } = useProviders(() => props.id);

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium' });

// The items being edited, amounts as typed. Reset whenever the saved budget or the year changes, except after a failed
// save: the budget going back to what it was would wipe what was typed
const items = ref<{ id: string; name: string; amount: string }[]>([]);
// The fondo de reserva, as typed
const reserve = ref({ contribution: '', opening: '' });
const unsaved = ref(false);
watch(year, () => {
	unsaved.value = false;
});
watch(budget, (saved) => {
	if (unsaved.value) {
		return;
	}
	items.value = (saved?.items ?? []).map(item => ({ id: item.id, name: item.name, amount: typedCents(item.amount) }));
	reserve.value = { contribution: saved?.reserve ? typedCents(saved.reserve) : '', opening: saved?.reserveOpening ? typedCents(saved.reserveOpening) : '' };
}, { immediate: true });

function typedCents(cents: number) {
	return (cents / 100).toFixed(2).replace('.', ',');
}

// What the items add up to as typed, for the reserve's minimum while editing
const typedOrdinary = computed(() => items.value.reduce((sum, item) => sum + (toCents(item.amount || '0') || 0), 0));
const typedReserve = computed(() => toCents(reserve.value.contribution || '0'));
const reservePercent = computed(() => typedOrdinary.value ? Math.round(typedReserve.value * 1000 / typedOrdinary.value) / 10 : 0);
const reserveShort = computed(() => typedOrdinary.value > 0 && !(typedReserve.value >= minReserve(typedOrdinary.value)));

function proposeReserve() {
	reserve.value.contribution = typedCents(minReserve(typedOrdinary.value));
}

function addItem() {
	// Its own id, so renaming an item keeps its expenses
	items.value.push({ id: crypto.randomUUID(), name: '', amount: '' });
}

const budgetError = ref<string>();

function save() {
	const parsed = items.value.map(item => ({ id: item.id, name: item.name.trim(), amount: toCents(item.amount || '0') }));
	const invalid = parsed.find(item => !item.name || Number.isNaN(item.amount) || item.amount < 0);
	if (invalid) {
		budgetError.value = `Revisa la partida «${invalid.name || 'sin nombre'}»: necesita nombre e importe, p. ej. 1.250,00`;
		return;
	}
	const contribution = toCents(reserve.value.contribution || '0');
	const opening = toCents(reserve.value.opening || '0');
	if (Number.isNaN(contribution) || contribution < 0 || Number.isNaN(opening)) {
		budgetError.value = 'Revisa los importes del fondo de reserva, p. ej. 1.250,00';
		return;
	}

	const typed = items.value.map(item => ({ ...item }));
	const typedFund = { ...reserve.value };
	const savedYear = year.value;
	const saved = budget.value;
	const previous = saved ? { items: saved.items, reserve: saved.reserve ?? 0, reserveOpening: saved.reserveOpening ?? 0 } : undefined;
	unsaved.value = false;
	budgetError.value = undefined;
	void optimistic(saveBudget(props.id, savedYear, { items: parsed, reserve: contribution, reserveOpening: opening }, !!budget.value), {
		done: 'Presupuesto guardado',
		failed: 'No se ha podido guardar',
		// A new one has nothing to go back to
		revert: previous && (() => saveBudget(props.id, savedYear, previous, true)),
		onError: () => {
			unsaved.value = true;
			items.value = typed;
			reserve.value = typedFund;
		},
	});
}

const savedItems = computed(() => budget.value?.items ?? []);
const budgetTotal = computed(() => savedItems.value.reduce((sum, item) => sum + item.amount, 0));

// Budgeted against spent per item. Expenses of a removed item are shown apart
const NO_ITEM = '';
const comparison = computed(() => {
	const spent = new Map<string, number>();
	for (const expense of expenses.value) {
		const itemId = savedItems.value.some(item => item.id === expense.itemId) ? expense.itemId : NO_ITEM;
		spent.set(itemId, (spent.get(itemId) ?? 0) + expense.amount);
	}
	const rows = savedItems.value.map(item => ({ id: item.id, name: item.name, budgeted: item.amount, spent: spent.get(item.id) ?? 0 }));
	if (spent.has(NO_ITEM)) {
		rows.push({ id: NO_ITEM, name: 'Sin partida', budgeted: 0, spent: spent.get(NO_ITEM)! });
	}
	return rows;
});
const spentTotal = computed(() => expenses.value.reduce((sum, expense) => sum + expense.amount, 0));
const itemNames = computed(() => Object.fromEntries(savedItems.value.map(item => [item.id, item.name])));

// Each property's share of the budget, with the fondo de reserva
const yearTotal = computed(() => budgetTotal.value + (budget.value?.reserve ?? 0));
const shares = computed(() => splitByCoefficient(yearTotal.value, properties.value)
	.sort((a, b) => a.property.name.localeCompare(b.property.name, 'es', { numeric: true })));

// New expense, or supplier invoice: the base and its taxes give what it costs and what's paid to the provider
const itemOptions = computed(() => savedItems.value.map(item => ({ value: item.id, label: item.name })));
const providerOptions = computed(() => [{ value: '', label: 'Sin proveedor' }, ...providers.value.map(provider => ({ value: provider.id, label: provider.name }))]);
const vatOptions = vatRates.map(rate => ({ value: rate, label: `${rate} %` }));
const withholdingOptions = withholdings.map((withholding, index) => ({ value: index, label: withholding.label }));
const methodOptions = Object.entries(paymentMethods).map(([value, label]) => ({ value: value as PaymentMethod, label }));

function emptyExpense() {
	return {
		itemId: '',
		concept: '',
		providerId: '',
		invoiceNumber: '',
		base: '',
		vatRate: 21 as VatRate,
		withholding: 0,
		date: '',
		dueDate: '',
		paymentMethod: 'transfer' as PaymentMethod,
		paid: false,
		fromReserve: false,
	};
}

const expenseForm = ref(emptyExpense());
// Idempotency key: the new expense's id, made with the form
let expenseId = newId();
const expenseError = ref<string>();

const formProvider = computed(() => providers.value.find(provider => provider.id === expenseForm.value.providerId));
const formAmounts = computed(() => {
	const base = toCents(expenseForm.value.base);
	return base > 0 ? invoiceAmounts(base, expenseForm.value.vatRate, withholdings[expenseForm.value.withholding].rate) : undefined;
});

const expenseFormElement = useTemplateRef('expenseFormElement');

function resetExpense() {
	expenseForm.value = emptyExpense();
	expenseError.value = undefined;
}

const { open, show, close } = useNewForm(expenseFormElement, resetExpense, () => !budgetPending.value && !expensesPending.value);

function submitExpense() {
	const typed = expenseForm.value;
	const amounts = formAmounts.value;
	if (!amounts || !typed.itemId) {
		expenseError.value = 'Elige la partida y escribe una base imponible válida, p. ej. 120,50';
		return;
	}
	if (typed.dueDate && typed.date && typed.dueDate < typed.date) {
		expenseError.value = 'El vencimiento no puede ser anterior a la fecha de la factura.';
		return;
	}

	const provider = formProvider.value;
	const withholding = withholdings[typed.withholding];
	const id = expenseId;
	const expense: ExpenseData = {
		itemId: typed.itemId,
		concept: typed.concept.trim(),
		amount: amounts.amount,
		date: Timestamp.fromDate(new Date(`${typed.date}T00:00`)),
		provider: provider && { id: provider.id, name: provider.name, ...(provider.cif ? { nif: provider.cif } : {}) },
		invoiceNumber: typed.invoiceNumber.trim() || undefined,
		base: toCents(typed.base),
		vatRate: typed.vatRate,
		vat: amounts.vat,
		withholdingRate: withholding.rate,
		withholding: amounts.withholding,
		withholdingType: withholding.type,
		dueDate: typed.dueDate ? toDueDate(typed.dueDate) : undefined,
		paidAt: typed.paid ? Timestamp.now() : null,
		paymentMethod: typed.paymentMethod,
		fromReserve: typed.fromReserve || undefined,
	};
	// Closed and emptied at once. If it fails it's back open as typed, with the same id
	close();
	expenseId = newId();
	void optimistic(addExpense(props.id, id, expense), {
		done: typed.paid ? 'Gasto añadido' : 'Factura añadida, pendiente de pago',
		failed: 'No se ha podido añadir',
		onError: () => {
			expenseForm.value = typed;
			expenseId = id;
			open.value = true;
		},
	});
}

// The form being filled in
useShortcut('mod+enter', () => document.activeElement?.closest('form')?.requestSubmit(), 'Guardar el formulario');

const sortedExpenses = computed(() => [...expenses.value].sort((a, b) => b.date.toMillis() - a.date.toMillis()));

function remove(expense: Expense) {
	// eslint-disable-next-line no-alert
	if (!window.confirm(`¿Borrar ${expense.invoiceNumber ? `la factura ${expense.invoiceNumber}` : 'el gasto'} «${expense.concept}»?`)) {
		return;
	}
	// What it had, to put it back as it was
	const deleted = { ...expense, id: expense.id };
	void optimistic(deleteExpense(props.id, deleted), {
		done: 'Gasto borrado',
		failed: 'No se ha podido borrar',
		revert: () => restoreExpense(props.id, deleted),
	});
}
</script>

<template>
	<header class="page-header">
		<h1>Presupuesto</h1>
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
		<NewButton v-if="!open" label="Nuevo gasto o factura" :disabled="!itemOptions.length" @click="show()" />
	</header>

	<form class="card" @submit.prevent="save()">
		<h2>Partidas de {{ year }}</h2>
		<p v-if="budgetLoadError" class="error" role="alert">
			No se ha podido cargar: {{ budgetLoadError.message }}
		</p>
		<ul v-if="budgetPending && !items.length" class="items" aria-busy="true" aria-label="Cargando">
			<li v-for="width in [70, 55, 62]" :key="width" class="budget-item">
				<span class="skeleton-item skeleton-item--title" :style="{ width: `${width}%` }" />
				<span class="skeleton-item skeleton-item--title" />
				<span class="skeleton-item skeleton-item--icon" />
			</li>
		</ul>
		<TransitionGroup v-else-if="items.length" tag="ul" name="row" class="items">
			<li v-for="(item, index) in items" :key="item.id" class="budget-item">
				<LnxInput v-model="item.name" placeholder="Limpieza, Ascensor…" required>
					Partida
				</LnxInput>
				<LnxInput v-model="item.amount" inputmode="decimal" placeholder="1.250,00">
					Importe anual (€)
				</LnxInput>
				<LnxButton mode="clear" class="size-small" shape="circle" variant="danger" aria-label="Quitar partida" title="Quitar partida" @click="items.splice(index, 1)">
					<LnxIcon icon="lucide:trash-2" />
				</LnxButton>
			</li>
		</TransitionGroup>
		<p v-else class="hint">
			Aún no hay presupuesto para {{ year }}.
		</p>

		<h2>Fondo de reserva</h2>
		<div class="fields">
			<LnxInput v-model="reserve.contribution" inputmode="decimal" placeholder="600,00">
				Aportación anual (€)
			</LnxInput>
			<LnxInput v-model="reserve.opening" inputmode="decimal" placeholder="3.500,00">
				Saldo a 1 de enero (€)
			</LnxInput>
		</div>
		<p v-if="reserveShort" class="warning">
			<LnxIcon icon="lucide:triangle-alert" />
			Es el {{ reservePercent.toLocaleString('es') }} % del presupuesto ordinario. La ley exige al menos el {{ MIN_RESERVE_PERCENT }} % ({{ formatCents(minReserve(typedOrdinary)) }}).
			<LnxButton mode="clear" class="size-small" @click="proposeReserve()">
				Poner el mínimo
			</LnxButton>
		</p>
		<p v-else-if="typedReserve > 0" class="hint tabular">
			{{ reservePercent.toLocaleString('es') }} % del presupuesto ordinario. Se cobra con las cuotas: <RouterLink :to="`/communities/${id}/fees`">ver saldo y cuotas</RouterLink>.
		</p>

		<footer class="form-actions">
			<p v-if="budgetError" class="error" role="alert">
				{{ budgetError }}
			</p>
			<LnxButton mode="clear" @click="addItem()">
				<LnxIcon icon="lucide:plus" />
				Añadir partida
			</LnxButton>
			<LnxButton type="submit">
				<LnxIcon icon="lucide:save" />
				Guardar presupuesto
				<Kbd combo="mod+enter" />
			</LnxButton>
		</footer>
	</form>

	<section class="card">
		<h2>Presupuestado y gastado</h2>
		<table v-if="comparison.length">
			<thead>
				<tr>
					<th>Partida</th>
					<th class="amount">
						Presupuesto
					</th>
					<th class="amount">
						Gastado
					</th>
					<th class="amount">
						Desviación
					</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="row in comparison" :key="row.id">
					<td>{{ row.name }}</td>
					<td class="amount">
						{{ formatCents(row.budgeted) }}
					</td>
					<td class="amount">
						{{ formatCents(row.spent) }}
					</td>
					<td class="amount" :class="{ over: row.spent > row.budgeted }">
						{{ formatCents(row.spent - row.budgeted) }}
					</td>
				</tr>
			</tbody>
			<tfoot>
				<tr>
					<th>Total</th>
					<th class="amount">
						{{ formatCents(budgetTotal) }}
					</th>
					<th class="amount">
						{{ formatCents(spentTotal) }}
					</th>
					<th class="amount" :class="{ over: spentTotal > budgetTotal }">
						{{ formatCents(spentTotal - budgetTotal) }}
					</th>
				</tr>
			</tfoot>
		</table>
		<p v-else-if="!budgetPending" class="hint">
			Guarda las partidas para comparar con los gastos.
		</p>
	</section>

	<form v-if="open" ref="expenseFormElement" class="card ux-appear" @submit.prevent="submitExpense()">
		<h2>Nuevo gasto o factura</h2>
		<div class="fields">
			<LnxSelect
				v-model.convert="expenseForm.itemId"
				:options="itemOptions"
				:convert-fn="option => option.value"
				search-placeholder-text="Buscar..."
			>
				Partida
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ itemNames[value] }}
				</template>
			</LnxSelect>
			<LnxSelect
				v-model.convert="expenseForm.providerId"
				:options="providerOptions"
				:convert-fn="option => option.value"
				search-placeholder-text="Buscar..."
				placeholder="Sin proveedor"
			>
				Proveedor
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ providerOptions.find(option => option.value === value)?.label }}
				</template>
			</LnxSelect>
			<LnxInput v-model="expenseForm.concept" placeholder="Limpieza octubre" required>
				Concepto
			</LnxInput>
			<LnxInput v-model="expenseForm.invoiceNumber" placeholder="2026/0142">
				Nº de factura
			</LnxInput>
			<DatePicker v-model="expenseForm.date" :min="`${year}-01-01`" :max="`${year}-12-31`" required>
				Fecha de la factura
			</DatePicker>
			<LnxInput v-model="expenseForm.base" inputmode="decimal" placeholder="120,50" required>
				Base imponible (€)
			</LnxInput>
			<LnxSelect
				v-model.convert="expenseForm.vatRate"
				:options="vatOptions"
				:convert-fn="option => option.value"
				search-placeholder-text="Buscar..."
				placeholder="0 %"
			>
				IVA
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ value }} %
				</template>
			</LnxSelect>
			<LnxSelect
				v-model.convert="expenseForm.withholding"
				:options="withholdingOptions"
				:convert-fn="option => option.value"
				search-placeholder-text="Buscar..."
				placeholder="Sin retención"
			>
				Retención IRPF
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ withholdings[value as number]?.label }}
				</template>
			</LnxSelect>
			<DatePicker v-model="expenseForm.dueDate" :min="expenseForm.date || undefined">
				Vencimiento
			</DatePicker>
			<LnxSelect
				v-model.convert="expenseForm.paymentMethod"
				:options="methodOptions"
				:convert-fn="option => option.value"
				search-placeholder-text="Buscar..."
			>
				Forma de pago
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ paymentMethods[value as PaymentMethod] }}
				</template>
			</LnxSelect>
			<LnxCheckbox v-model="expenseForm.paid" class="paid">
				Ya está pagada
			</LnxCheckbox>
			<LnxCheckbox v-model="expenseForm.fromReserve" class="paid">
				Se paga del fondo de reserva
			</LnxCheckbox>
		</div>
		<p v-if="formAmounts" class="hint tabular">
			IVA {{ formatCents(formAmounts.vat) }}<template v-if="formAmounts.withholding">
				· retención −{{ formatCents(formAmounts.withholding) }}
			</template> · total factura {{ formatCents(formAmounts.amount) }} · <strong>a pagar {{ formatCents(formAmounts.payable) }}</strong>
		</p>
		<p v-if="formProvider && !formProvider.cif" class="warning">
			<LnxIcon icon="lucide:triangle-alert" />
			{{ formProvider.name }} no tiene NIF en el directorio de proveedores. Hace falta para los modelos 347, 111 y 190.
		</p>
		<footer class="form-actions">
			<p v-if="expenseError" class="error" role="alert">
				{{ expenseError }}
			</p>
			<LnxButton mode="clear" @click="close()">
				Cancelar
				<Kbd combo="escape" />
			</LnxButton>
			<LnxButton type="submit" :disabled="!itemOptions.length">
				<LnxIcon icon="lucide:plus" />
				Añadir gasto
				<Kbd combo="mod+enter" />
			</LnxButton>
		</footer>
	</form>

	<section class="card">
		<h2>Gastos de {{ year }}</h2>
		<p v-if="expensesError" class="error" role="alert">
			No se han podido cargar: {{ expensesError.message }}
		</p>
		<ul v-if="expensesPending && !sortedExpenses.length" class="list" aria-busy="true" aria-label="Cargando">
			<li v-for="width in [60, 45, 70, 50]" :key="width" class="item">
				<div class="what">
					<span class="skeleton-item" :style="{ width: `${width}%` }" />
					<span class="skeleton-item skeleton-item--small" :style="{ width: `${width - 10}%` }" />
				</div>
				<span class="skeleton-item" style="width: 70px" />
				<span class="skeleton-item skeleton-item--icon" />
			</li>
		</ul>
		<TransitionGroup v-else-if="sortedExpenses.length" tag="ul" name="row" class="list">
			<li v-for="expense in sortedExpenses" :key="expense.id" class="item">
				<div class="what">
					<strong>{{ expense.concept }}</strong>
					<small class="tabular">
						{{ dateFormat.format(expense.date.toDate()) }} · {{ itemNames[expense.itemId] ?? 'Sin partida' }}<template v-if="expense.provider"> · {{ expense.provider.name }}</template>
						<template v-if="expense.invoiceNumber"> · Fra. {{ expense.invoiceNumber }}</template>
						<template v-if="expense.base !== undefined"> · base {{ formatCents(expense.base) }} + IVA {{ expense.vatRate }} %</template>
						<template v-if="expense.withholding"> · retención {{ expense.withholdingRate }} %</template>
						<template v-if="expense.fromReserve"> · fondo de reserva</template>
					</small>
				</div>
				<div class="cost">
					<strong class="tabular">{{ formatCents(expense.amount) }}</strong>
					<RouterLink v-if="expense.paidAt === null" :to="`/communities/${id}/payables`" class="pending" :class="{ overdue: isOverdue(expense) }">
						{{ isOverdue(expense) ? 'Vencida' : 'Pendiente de pago' }}
					</RouterLink>
				</div>
				<LnxButton mode="clear" class="size-small" shape="circle" variant="danger" aria-label="Borrar" title="Borrar" @click="remove(expense)">
					<LnxIcon icon="lucide:trash-2" />
				</LnxButton>
			</li>
		</TransitionGroup>
		<p v-else class="hint">
			Aún no hay gastos en {{ year }}.
		</p>
	</section>

	<section class="card">
		<h2>Reparto por coeficiente</h2>
		<table v-if="shares.length && yearTotal">
			<thead>
				<tr>
					<th>Propiedad</th>
					<th class="amount">
						Coeficiente
					</th>
					<th class="amount">
						Anual{{ budget?.reserve ? ', con fondo' : '' }}
					</th>
					<th class="amount">
						Mensual
					</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="share in shares" :key="share.property.id">
					<td>{{ share.property.name }}</td>
					<td class="amount">
						{{ formatCoefficient(share.property.coefficient) }}
					</td>
					<td class="amount">
						{{ formatCents(share.cents) }}
					</td>
					<td class="amount">
						{{ formatCents(Math.round(share.cents / 12)) }}
					</td>
				</tr>
			</tbody>
		</table>
		<p v-else class="hint">
			Hace falta un presupuesto guardado y propiedades con coeficiente.
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

.fields {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
	align-items: start;
	gap: var(--lnx-spacing-3) var(--lnx-spacing-4);
}

.items {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
}

.budget-item {
	display: grid;
	grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) auto;
	align-items: end;
	gap: var(--lnx-spacing-3);
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

	.over {
		color: var(--color-secondary-accent);
	}
}

.items,
.list {
	position: relative;
}

// Items and expenses added or removed: the rest slide into place
.row-move,
.row-enter-active,
.row-leave-active {
	transition: opacity var(--duration) var(--ease-out), translate var(--duration) var(--ease-out);
}

.row-enter-from,
.row-leave-to {
	opacity: 0;
	translate: 0 -4px;
}

.row-leave-active {
	position: absolute;
	width: 100%;
}

.list {
	display: flex;
	flex-direction: column;
}

.item {
	padding: var(--lnx-spacing-3) 0;
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto auto;
	align-items: center;
	gap: var(--lnx-spacing-3);

	& + & {
		border-top: 1px solid var(--color-gray-3);
	}
}

.cost {
	display: flex;
	flex-direction: column;
	align-items: flex-end;

	.pending {
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
	}

	.overdue {
		color: var(--color-secondary-accent);
	}
}

.paid {
	align-self: center;
}

.warning {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
	font-size: var(--lnx-font-size-small);
	color: var(--color-gray-7);
}

.what {
	display: flex;
	flex-direction: column;
	min-width: 0;

	strong {
		text-wrap: balance;
	}

	small {
		overflow: hidden;
		color: var(--color-gray-6);
		white-space: nowrap;
		text-overflow: ellipsis;
	}
}

.hint {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}
</style>
