<script setup lang="ts">
import type { balanceSheet, incomeStatement } from '@gobernansa/shared/domain/accounting.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';

// The year's balance sheet or income statement, on the page's A4 sheet
defineProps<{ view: 'sheet' | 'results'; sheet: ReturnType<typeof balanceSheet>; results: ReturnType<typeof incomeStatement> }>();
</script>

<template>
	<!-- Balance de situación -->
	<template v-if="view === 'sheet'">
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
	<template v-else>
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
</template>

<style lang="scss" scoped src="./accounting.scss" />
