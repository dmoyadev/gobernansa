<script setup lang="ts">
import type { Expense } from '@gobernansa/shared/domain/finance.ts';
import { formatCents, toCents } from '@gobernansa/shared/domain/money.ts';
import { formatCoefficient, splitByCoefficient } from '@gobernansa/shared/domain/property.ts';
import DatePicker from '@gobernansa/shared/ui/DatePicker.vue';
import { Timestamp } from 'firebase/firestore';
import { LnxButton, LnxIcon, LnxInput, LnxSelect } from 'lnxjs-components';
import { computed, ref, useTemplateRef, watch } from 'vue';
import BackButton from '@/app/ux/BackButton.vue';
import Kbd from '@/app/ux/Kbd.vue';
import { newId } from '@/app/ux/navigation.ts';
import { useShortcut } from '@/app/ux/shortcuts.ts';
import { optimistic } from '@/app/ux/toast.ts';
import { useProviders } from '@/modules/providers/application/useProviders.ts';
import { addExpense, deleteExpense, restoreExpense, saveBudget, useBudget, useCommunityProperties, useExpenses } from '../application/useFinances.ts';

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
const unsaved = ref(false);
watch(year, () => {
	unsaved.value = false;
});
watch(budget, (saved) => {
	if (unsaved.value) {
		return;
	}
	items.value = (saved?.items ?? []).map(item => ({ id: item.id, name: item.name, amount: (item.amount / 100).toFixed(2).replace('.', ',') }));
}, { immediate: true });

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

	const typed = items.value.map(item => ({ ...item }));
	const savedYear = year.value;
	const previous = budget.value?.items;
	unsaved.value = false;
	budgetError.value = undefined;
	void optimistic(saveBudget(props.id, savedYear, parsed, !!budget.value), {
		done: 'Presupuesto guardado',
		failed: 'No se ha podido guardar',
		// A new one has nothing to go back to
		revert: previous && (() => saveBudget(props.id, savedYear, previous, true)),
		onError: () => {
			unsaved.value = true;
			items.value = typed;
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

// Each property's share of the budget
const shares = computed(() => splitByCoefficient(budgetTotal.value, properties.value)
	.sort((a, b) => a.property.name.localeCompare(b.property.name, 'es', { numeric: true })));

// New expense
const itemOptions = computed(() => savedItems.value.map(item => ({ value: item.id, label: item.name })));
const providerOptions = computed(() => [{ value: '', label: 'Sin proveedor' }, ...providers.value.map(provider => ({ value: provider.id, label: provider.name }))]);

function emptyExpense() {
	return { itemId: '', concept: '', amount: '', date: '', providerId: '' };
}

const expenseForm = ref(emptyExpense());
// Idempotency key: the new expense's id, made with the form
let expenseId = newId();
const expenseError = ref<string>();

function submitExpense() {
	const amount = toCents(expenseForm.value.amount);
	if (!(amount > 0) || !expenseForm.value.itemId) {
		expenseError.value = 'Elige la partida y escribe un importe válido, p. ej. 120,50';
		return;
	}

	const provider = providers.value.find(provider => provider.id === expenseForm.value.providerId);
	const typed = expenseForm.value;
	const id = expenseId;
	const expense = {
		itemId: typed.itemId,
		concept: typed.concept.trim(),
		amount,
		date: Timestamp.fromDate(new Date(`${typed.date}T00:00`)),
		...(provider ? { provider: { id: provider.id, name: provider.name } } : {}),
	};
	// Cleared at once, ready for the next one. If it fails it's back as typed, with the same id
	expenseForm.value = emptyExpense();
	expenseId = newId();
	expenseError.value = undefined;
	void optimistic(addExpense(props.id, id, expense), {
		done: 'Gasto añadido',
		failed: 'No se ha podido añadir',
		onError: () => {
			expenseForm.value = typed;
			expenseId = id;
		},
	});
}

const expenseFormElement = useTemplateRef('expenseFormElement');
useShortcut('n', () => expenseFormElement.value?.querySelector<HTMLElement>('input:not([type="hidden"])')?.focus(), 'Nuevo gasto');
// The form being filled in
useShortcut('mod+enter', () => document.activeElement?.closest('form')?.requestSubmit(), 'Guardar el formulario');

const sortedExpenses = computed(() => [...expenses.value].sort((a, b) => b.date.toMillis() - a.date.toMillis()));

function remove(expense: Expense) {
	// eslint-disable-next-line no-alert
	if (!window.confirm(`¿Borrar el gasto «${expense.concept}»?`)) {
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
		<BackButton :to="`/communities/${id}`" label="Volver a la comunidad" />
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
				<LnxButton mode="clear" size="small" shape="circle" variant="danger" aria-label="Quitar partida" title="Quitar partida" @click="items.splice(index, 1)">
					<LnxIcon icon="lucide:trash-2" />
				</LnxButton>
			</li>
		</TransitionGroup>
		<p v-else class="hint">
			Aún no hay presupuesto para {{ year }}.
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

	<form ref="expenseFormElement" class="card" @submit.prevent="submitExpense()">
		<h2>Nuevo gasto <Kbd combo="n" /></h2>
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
			<LnxInput v-model="expenseForm.concept" placeholder="Factura limpieza octubre" required>
				Concepto
			</LnxInput>
			<LnxInput v-model="expenseForm.amount" inputmode="decimal" placeholder="120,50" required>
				Importe (€)
			</LnxInput>
			<DatePicker v-model="expenseForm.date" :min="`${year}-01-01`" :max="`${year}-12-31`" required>
				Fecha
			</DatePicker>
			<LnxSelect
				v-model.convert="expenseForm.providerId"
				:options="providerOptions"
				:convert-fn="option => option.value"
				search-placeholder-text="Buscar..."
			>
				Proveedor
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ providerOptions.find(option => option.value === value)?.label }}
				</template>
			</LnxSelect>
		</div>
		<footer class="form-actions">
			<p v-if="expenseError" class="error" role="alert">
				{{ expenseError }}
			</p>
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
					</small>
				</div>
				<strong class="tabular">{{ formatCents(expense.amount) }}</strong>
				<LnxButton mode="clear" size="small" shape="circle" variant="danger" aria-label="Borrar" title="Borrar" @click="remove(expense)">
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
		<table v-if="shares.length && budgetTotal">
			<thead>
				<tr>
					<th>Propiedad</th>
					<th class="amount">
						Coeficiente
					</th>
					<th class="amount">
						Anual
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

		/* The selected value sits below a label, and this one has none */
		:deep(.input-content) {
			inset: 0;
			display: flex;
			align-items: center;
		}
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
