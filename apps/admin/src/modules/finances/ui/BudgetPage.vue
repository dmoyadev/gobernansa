<script setup lang="ts">
import type { Expense } from '@gobernansa/shared/domain/finance.ts';
import { formatCents, toCents } from '@gobernansa/shared/domain/money.ts';
import { formatCoefficient, splitByCoefficient } from '@gobernansa/shared/domain/property.ts';
import { Timestamp } from 'firebase/firestore';
import { LnxButton, LnxIcon, LnxInput, LnxSelect } from 'lnxjs-components';
import { computed, ref, watch } from 'vue';
import { useProviders } from '@/modules/providers/application/useProviders.ts';
import { addExpense, deleteExpense, saveBudget, useBudget, useCommunityProperties, useExpenses } from '../application/useFinances.ts';

const props = defineProps<{ id: string }>();

const currentYear = new Date().getFullYear();
const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear + 1 - i).map(year => ({ value: year, label: String(year) }));
const year = ref(currentYear);

const { data: budget, error: budgetLoadError } = useBudget(props.id, year);
const { data: expenses, pending: expensesPending, error: expensesError } = useExpenses(props.id, year);
const { data: properties } = useCommunityProperties(props.id);
const { providers } = useProviders(() => props.id);

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium' });

// The items being edited, amounts as typed. Reset whenever the saved budget or the year changes
const items = ref<{ id: string; name: string; amount: string }[]>([]);
watch(budget, (saved) => {
	items.value = (saved?.items ?? []).map(item => ({ id: item.id, name: item.name, amount: (item.amount / 100).toFixed(2).replace('.', ',') }));
}, { immediate: true });

function addItem() {
	// Its own id, so renaming an item keeps its expenses
	items.value.push({ id: crypto.randomUUID(), name: '', amount: '' });
}

const savingBudget = ref(false);
const budgetError = ref<string>();

async function save() {
	const parsed = items.value.map(item => ({ id: item.id, name: item.name.trim(), amount: toCents(item.amount || '0') }));
	const invalid = parsed.find(item => !item.name || Number.isNaN(item.amount) || item.amount < 0);
	if (invalid) {
		budgetError.value = `Revisa la partida «${invalid.name || 'sin nombre'}»: necesita nombre e importe, p. ej. 1.250,00`;
		return;
	}

	savingBudget.value = true;
	budgetError.value = undefined;
	try {
		await saveBudget(props.id, year.value, parsed, !!budget.value);
	} catch (e) {
		budgetError.value = `No se ha podido guardar: ${(e as Error).message}`;
	} finally {
		savingBudget.value = false;
	}
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
const addingExpense = ref(false);
const expenseError = ref<string>();

async function submitExpense() {
	const amount = toCents(expenseForm.value.amount);
	if (!(amount > 0) || !expenseForm.value.itemId) {
		expenseError.value = 'Elige la partida y escribe un importe válido, p. ej. 120,50';
		return;
	}

	const provider = providers.value.find(provider => provider.id === expenseForm.value.providerId);
	addingExpense.value = true;
	expenseError.value = undefined;
	try {
		await addExpense(props.id, {
			itemId: expenseForm.value.itemId,
			concept: expenseForm.value.concept.trim(),
			amount,
			date: Timestamp.fromDate(new Date(`${expenseForm.value.date}T00:00`)),
			...(provider ? { provider: { id: provider.id, name: provider.name } } : {}),
		});
		expenseForm.value = emptyExpense();
	} catch (e) {
		expenseError.value = `No se ha podido añadir: ${(e as Error).message}`;
	} finally {
		addingExpense.value = false;
	}
}

const sortedExpenses = computed(() => [...expenses.value].sort((a, b) => b.date.toMillis() - a.date.toMillis()));
const actionError = ref<string>();

async function remove(expense: Expense) {
	// eslint-disable-next-line no-alert
	if (!window.confirm(`¿Borrar el gasto «${expense.concept}»?`)) {
		return;
	}
	actionError.value = undefined;
	try {
		await deleteExpense(props.id, expense);
	} catch (e) {
		actionError.value = `No se ha podido borrar: ${(e as Error).message}`;
	}
}
</script>

<template>
	<header class="page-header">
		<LnxButton :to="`/communities/${id}`" mode="clear" shape="circle" aria-label="Volver a la comunidad">
			<LnxIcon icon="lucide:arrow-left" />
		</LnxButton>
		<h1>Presupuesto</h1>
		<!-- Native: the components' select leaves room for a label above, which a header has no space for -->
		<select v-model.number="year" class="year" aria-label="Año">
			<option v-for="option in yearOptions" :key="option.value" :value="option.value">
				{{ option.label }}
			</option>
		</select>
	</header>

	<form class="card" @submit.prevent="save()">
		<h2>Partidas de {{ year }}</h2>
		<p v-if="budgetLoadError" class="error" role="alert">
			No se ha podido cargar: {{ budgetLoadError.message }}
		</p>
		<ul v-if="items.length" class="items">
			<li v-for="(item, index) in items" :key="item.id" class="budget-item">
				<LnxInput v-model="item.name" placeholder="Limpieza, Ascensor…" required>
					Partida
				</LnxInput>
				<LnxInput v-model="item.amount" inputmode="decimal" placeholder="1.250,00">
					Importe anual (€)
				</LnxInput>
				<LnxButton mode="clear" size="small" shape="circle" variant="danger" aria-label="Quitar partida" @click="items.splice(index, 1)">
					<LnxIcon icon="lucide:trash-2" />
				</LnxButton>
			</li>
		</ul>
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
			<LnxButton type="submit" :is-loading="savingBudget">
				<LnxIcon icon="lucide:save" />
				Guardar presupuesto
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
		<p v-else class="hint">
			Guarda las partidas para comparar con los gastos.
		</p>
	</section>

	<form class="card" @submit.prevent="submitExpense()">
		<h2>Nuevo gasto</h2>
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
			<LnxInput v-model="expenseForm.date" type="date" :min="`${year}-01-01`" :max="`${year}-12-31`" required>
				Fecha
			</LnxInput>
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
			<LnxButton type="submit" :is-loading="addingExpense" :disabled="!itemOptions.length">
				<LnxIcon icon="lucide:plus" />
				Añadir gasto
			</LnxButton>
		</footer>
	</form>

	<section class="card">
		<h2>Gastos de {{ year }}</h2>
		<p v-if="expensesError" class="error" role="alert">
			No se han podido cargar: {{ expensesError.message }}
		</p>
		<p v-if="actionError" class="error" role="alert">
			{{ actionError }}
		</p>
		<span v-if="expensesPending" class="skeleton-item" />
		<ul v-else-if="sortedExpenses.length" class="list">
			<li v-for="expense in sortedExpenses" :key="expense.id" class="item">
				<div class="what">
					<strong>{{ expense.concept }}</strong>
					<small>
						{{ dateFormat.format(expense.date.toDate()) }} · {{ itemNames[expense.itemId] ?? 'Sin partida' }}<template v-if="expense.provider"> · {{ expense.provider.name }}</template>
					</small>
				</div>
				<strong>{{ formatCents(expense.amount) }}</strong>
				<LnxButton mode="clear" size="small" shape="circle" variant="danger" aria-label="Borrar" @click="remove(expense)">
					<LnxIcon icon="lucide:trash-2" />
				</LnxButton>
			</li>
		</ul>
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
		min-height: 36px;
		padding: 0 var(--lnx-spacing-3);
		border: 1px solid var(--color-gray-4);
		border-radius: var(--lnx-radius-2);
		background: var(--color-gray-0);
		color: var(--color-gray-9);
		cursor: pointer;
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
