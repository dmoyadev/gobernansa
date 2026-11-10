<script setup lang="ts">
import type { ReportRow } from '@gobernansa/shared/domain/accounting.ts';
import { balances, beforeClosing, buildLedger, incomeStatement } from '@gobernansa/shared/domain/accounting.ts';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { outstanding } from '@gobernansa/shared/domain/finance.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { LnxButton, LnxIcon, LnxKbd, LnxSelect, toast, useShortcut } from 'lnxjs-components';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { onRevalidate } from '@/app/ux/navigation.ts';
import { loadAnnualReportData } from '../application/useExchange.ts';

const props = defineProps<{ id: string }>();

type ReportData = Awaited<ReturnType<typeof loadAnnualReportData>>;

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'long' });
const shortDate = new Intl.DateTimeFormat('es', { dateStyle: 'short' });
const percent = new Intl.NumberFormat('es', { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' });
const currentYear = new Date().getFullYear();
const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear - i).map(value => ({ value, label: String(value) }));
// The junta usually approves the year just ended; a link from a meeting says which
const route = useRoute();
const year = ref(currentYear - 1);
watch(() => route.query.year, (queried) => {
	if (yearOptions.some(option => option.value === Number(queried))) {
		year.value = Number(queried);
	}
}, { immediate: true });

// A year ended is shown at its last day, the running one up to today
const running = computed(() => year.value >= currentYear);
const cutoff = computed(() => running.value ? toDateString(new Date()) : `${year.value}-12-31`);
const cutoffLabel = computed(() => dateFormat.format(new Date(`${cutoff.value}T12:00`)));

/* Data: read once per year, read again when coming back */

const cache = reactive(new Map<number, ReportData>());
const loading = ref(true);
const error = ref<string>();

async function load(refresh = false) {
	const wanted = year.value;
	if (cache.has(wanted) && !refresh) {
		loading.value = false;
		error.value = undefined;
		return;
	}
	loading.value = !cache.has(wanted);
	try {
		const loaded = await loadAnnualReportData(props.id, wanted, cutoff.value);
		cache.set(wanted, loaded);
		error.value = loaded.community ? undefined : 'No existe esta comunidad.';
	} catch (e) {
		if (cache.has(wanted)) {
			toast(`No se ha podido actualizar: ${(e as Error).message}`, { variant: 'danger' });
		} else {
			error.value = `No se ha podido cargar la liquidación: ${(e as Error).message}`;
		}
	} finally {
		if (wanted === year.value) {
			loading.value = false;
		}
	}
}

onMounted(load);
onRevalidate(async () => {
	[...cache.keys()].filter(key => key !== year.value).forEach(key => cache.delete(key));
	await load(true);
});
watch(year, async () => load());

const data = computed(() => cache.get(year.value));
const community = computed(() => data.value?.community);
const ledger = computed(() => data.value && buildLedger({ ...data.value, year: year.value }));
const entries = computed(() => beforeClosing(ledger.value?.entries ?? []));

/* Ingresos y gastos, as the books have them (the fees when issued, the invoices when received) */

const statement = computed(() => ledger.value && incomeStatement(ledger.value.entries, ledger.value.accounts, data.value?.budget));
const sections = computed(() => statement.value
	? [
			{ title: 'Ingresos', rows: statement.value.income, total: statement.value.totalIncome, budgeted: statement.value.budgetedIncome },
			{ title: 'Gastos por partida', rows: statement.value.expenses, total: statement.value.totalExpenses, budgeted: statement.value.budgetedExpenses },
		]
	: []);
const result = computed(() => (statement.value?.totalIncome ?? 0) - (statement.value?.totalExpenses ?? 0));

function deviation(row: Pick<ReportRow, 'amount' | 'budgeted'>) {
	return row.budgeted ? percent.format((row.amount - row.budgeted) / row.budgeted) : '';
}

/* Fondo de reserva: its account, 113, by where each movement came from */

const reserve = computed(() => {
	const sum = (match: (kind: string) => boolean) => entries.value.filter(entry => match(entry.kind))
		.flatMap(entry => entry.lines)
		.filter(item => item.account === '1130')
		.reduce((total, item) => total + item.credit - item.debit, 0);
	const opening = sum(kind => kind === 'opening');
	const contributions = sum(kind => kind === 'charge');
	const used = -sum(kind => kind === 'invoice');
	const other = sum(kind => !['opening', 'charge', 'invoice'].includes(kind));
	return { opening, contributions, used, other, closing: opening + contributions - used + other };
});

/* Tesorería */

const treasury = computed(() => {
	const sums = balances(entries.value);
	const balance = (key: string) => (sums.get(key)?.debit ?? 0) - (sums.get(key)?.credit ?? 0);
	// gateway: paid online, still to be paid in by the gateway
	return { bank: balance('5720'), cash: balance('5700'), gateway: balance('5729') };
});
// The last balance the bank's statement gave, when the movements were imported. Not the test-mode connection's
const statementBalance = computed(() => (data.value?.movements ?? [])
	.filter(movement => movement.balance !== undefined && movement.source !== 'demo')
	.sort((a, b) => a.date.localeCompare(b.date) || a.position - b.position)
	.at(-1));

/* Deudas de los propietarios: due by the cutoff and not paid by then */

const debts = computed(() => {
	if (!data.value) {
		return [];
	}
	const end = running.value ? Date.now() : new Date(year.value + 1, 0, 1).getTime();
	const charges = new Map([...data.value.charges, ...data.value.paidAfter].map(charge => [charge.id, charge]));
	const owed = [...charges.values()].filter(charge => charge.dueDate.toMillis() < end && outstanding(charge, new Date(end)) > 0);
	const properties = new Map(data.value.properties.map(property => [property.id, property]));
	return Object.entries(Object.groupBy(owed, charge => charge.propertyId)).map(([propertyId, list = []]) => {
		const property = properties.get(propertyId);
		const oldest = list.reduce((first, charge) => charge.dueDate.toMillis() < first.dueDate.toMillis() ? charge : first);
		return {
			propertyId,
			name: property?.name ?? list[0].propertyName,
			owner: property?.ownerName ?? list[0].ownerName ?? '',
			count: list.length,
			levies: list.filter(charge => charge.type === 'levy').reduce((sum, charge) => sum + outstanding(charge, new Date(end)), 0),
			amount: list.reduce((sum, charge) => sum + outstanding(charge, new Date(end)), 0),
			oldest: oldest.dueDate.toDate(),
		};
	}).sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'es', { numeric: true }));
});
const debtTotal = computed(() => debts.value.reduce((sum, debt) => sum + debt.amount, 0));

/* Presupuesto propuesto para el año siguiente, next to this year's */

const proposal = computed(() => {
	const next = data.value?.next;
	if (!next) {
		return undefined;
	}
	const current = new Map((data.value?.budget?.items ?? []).map(item => [item.id, item.amount]));
	const rows = next.items.map(item => ({ id: item.id, name: item.name, amount: item.amount, budgeted: current.get(item.id) }));
	const ordinary = rows.reduce((sum, row) => sum + row.amount, 0);
	const currentOrdinary = [...current.values()].reduce((sum, amount) => sum + amount, 0);
	return {
		rows,
		ordinary,
		currentOrdinary,
		reserve: next.reserve ?? 0,
		currentReserve: data.value?.budget?.reserve ?? 0,
	};
});

function variation(amount: number, before?: number) {
	return before ? percent.format((amount - before) / before) : '';
}

function print() {
	window.print();
}

useShortcut('p', print, { description: 'Imprimir la liquidación', enabled: () => !loading.value && !error.value });
</script>

<template>
	<header class="page-header">
		<h1>Liquidación del ejercicio</h1>
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
		<LnxButton :disabled="loading || !!error" @click="print()">
			<LnxIcon icon="lucide:printer" />
			Imprimir / Guardar PDF
			<LnxKbd combo="p" />
		</LnxButton>
	</header>

	<p class="intro hint">
		<LnxIcon icon="lucide:info" />
		Cuentas del ejercicio para presentar en la junta ordinaria: guárdala en PDF y adjúntala a la convocatoria. Sale de la
		<RouterLink :to="`/communities/${id}/accounting`">
			contabilidad
		</RouterLink>,
		con los recibos al emitirse y las facturas al recibirse.
	</p>
	<p v-if="data && !running && !data.closing" class="intro hint">
		<LnxIcon icon="lucide:triangle-alert" />
		El ejercicio {{ year }} no está cerrado en contabilidad: las cifras pueden cambiar si se añaden recibos o facturas.
	</p>

	<p v-if="error" class="error" role="alert">
		{{ error }}
	</p>
	<article v-else-if="loading" class="sheet" aria-busy="true" aria-label="Cargando">
		<header>
			<span class="lnx-skeleton" style="width: 55%" />
			<span class="lnx-skeleton lnx-skeleton--small" style="width: 40%" />
		</header>
		<span class="lnx-skeleton lnx-skeleton--title" style="width: 60%; align-self: center" />
		<div class="lines">
			<span v-for="width in [100, 96, 100, 70, 88, 100, 64]" :key="width" class="lnx-skeleton" :style="{ width: `${width}%` }" />
		</div>
	</article>
	<article v-else-if="community && statement" class="sheet lnx-appear">
		<header>
			<strong>Comunidad de propietarios {{ community.name }}</strong>
			<span>{{ community.address }}</span>
			<span v-if="community.cif">CIF {{ community.cif }}</span>
		</header>

		<div class="title">
			<h2>Liquidación de cuentas del ejercicio {{ year }}</h2>
			<p>{{ running ? `Avance provisional a ${cutoffLabel}` : `Del 1 de enero al ${cutoffLabel}` }}</p>
		</div>

		<section>
			<h3>Resumen</h3>
			<dl class="summary">
				<div>
					<dt>Ingresos</dt>
					<dd>{{ formatCents(statement.totalIncome) }}</dd>
				</div>
				<div>
					<dt>Gastos</dt>
					<dd>{{ formatCents(statement.totalExpenses) }}</dd>
				</div>
				<div>
					<dt>{{ result >= 0 ? 'Superávit' : 'Déficit' }}</dt>
					<dd :class="{ negative: result < 0 }">
						{{ formatCents(result) }}
					</dd>
				</div>
				<div>
					<dt>Fondo de reserva</dt>
					<dd>{{ formatCents(reserve.closing) }}</dd>
				</div>
				<div>
					<dt>Saldo en bancos</dt>
					<dd>{{ formatCents(treasury.bank) }}</dd>
				</div>
				<div>
					<dt>Deuda de propietarios</dt>
					<dd :class="{ negative: debtTotal }">
						{{ formatCents(debtTotal) }}
					</dd>
				</div>
			</dl>
		</section>

		<section v-for="{ title, rows, total, budgeted } in sections" :key="title">
			<h3>{{ title }}</h3>
			<table v-if="rows.length">
				<thead>
					<tr>
						<th>Concepto</th>
						<th class="amount">
							Presupuesto
						</th>
						<th class="amount">
							Real
						</th>
						<th class="amount">
							Desviación
						</th>
						<th class="amount">
							%
						</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="row in rows" :key="row.account.key">
						<td>{{ row.account.name }}</td>
						<td class="amount">
							{{ row.budgeted === undefined ? '' : formatCents(row.budgeted) }}
						</td>
						<td class="amount">
							{{ formatCents(row.amount) }}
						</td>
						<td class="amount">
							{{ row.budgeted === undefined ? '' : formatCents(row.amount - row.budgeted) }}
						</td>
						<td class="amount">
							{{ deviation(row) }}
						</td>
					</tr>
				</tbody>
				<tfoot>
					<tr>
						<th>Total</th>
						<th class="amount">
							{{ budgeted ? formatCents(budgeted) : '' }}
						</th>
						<th class="amount">
							{{ formatCents(total) }}
						</th>
						<th class="amount">
							{{ budgeted ? formatCents(total - budgeted) : '' }}
						</th>
						<th class="amount">
							{{ deviation({ amount: total, budgeted }) }}
						</th>
					</tr>
				</tfoot>
			</table>
			<p v-else class="none">
				Sin movimientos en el ejercicio.
			</p>
		</section>

		<section>
			<h3>Resultado del ejercicio</h3>
			<p>
				Los ingresos menos los gastos dan un <strong>{{ result >= 0 ? 'superávit' : 'déficit' }} de {{ formatCents(Math.abs(result)) }}</strong>,
				que se {{ result >= 0 ? 'propone aplicar al ejercicio siguiente o al fondo de reserva' : 'propone cubrir con cargo al ejercicio siguiente' }}, según acuerde la junta.
			</p>
		</section>

		<section>
			<h3>Fondo de reserva</h3>
			<table>
				<tbody>
					<tr>
						<td>Saldo al inicio del ejercicio</td>
						<td class="amount">
							{{ formatCents(reserve.opening) }}
						</td>
					</tr>
					<tr>
						<td>Aportaciones con las cuotas</td>
						<td class="amount">
							{{ formatCents(reserve.contributions) }}
						</td>
					</tr>
					<tr>
						<td>Gastos pagados con el fondo</td>
						<td class="amount">
							{{ formatCents(-reserve.used) }}
						</td>
					</tr>
					<tr v-if="reserve.other">
						<td>Otros movimientos</td>
						<td class="amount">
							{{ formatCents(reserve.other) }}
						</td>
					</tr>
				</tbody>
				<tfoot>
					<tr>
						<th>Saldo {{ running ? 'a la fecha' : 'al cierre' }}</th>
						<th class="amount">
							{{ formatCents(reserve.closing) }}
						</th>
					</tr>
				</tfoot>
			</table>
		</section>

		<section>
			<h3>Tesorería</h3>
			<table>
				<tbody>
					<tr>
						<td>Bancos, según la contabilidad</td>
						<td class="amount">
							{{ formatCents(treasury.bank) }}
						</td>
					</tr>
					<tr v-if="treasury.cash">
						<td>Caja</td>
						<td class="amount">
							{{ formatCents(treasury.cash) }}
						</td>
					</tr>
					<tr v-if="treasury.gateway">
						<td>Pagos online que la pasarela aún no ha abonado</td>
						<td class="amount">
							{{ formatCents(treasury.gateway) }}
						</td>
					</tr>
					<tr v-if="statementBalance">
						<td>Saldo según el extracto del banco a {{ shortDate.format(new Date(`${statementBalance.date}T12:00`)) }}</td>
						<td class="amount">
							{{ formatCents(statementBalance.balance!) }}
						</td>
					</tr>
				</tbody>
			</table>
			<p v-if="statementBalance && statementBalance.balance !== treasury.bank" class="none">
				La diferencia de {{ formatCents(statementBalance.balance! - treasury.bank) }} entre el extracto y la contabilidad son movimientos aún sin conciliar o anotar.
			</p>
		</section>

		<section>
			<h3>Deudas de los propietarios a {{ cutoffLabel }}</h3>
			<table v-if="debts.length">
				<thead>
					<tr>
						<th>Propiedad</th>
						<th>Propietario</th>
						<th class="amount">
							Recibos
						</th>
						<th>Desde</th>
						<th class="amount">
							De derramas
						</th>
						<th class="amount">
							Importe
						</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="debt in debts" :key="debt.propertyId">
						<td>{{ debt.name }}</td>
						<td>{{ debt.owner }}</td>
						<td class="amount">
							{{ debt.count }}
						</td>
						<td>{{ shortDate.format(debt.oldest) }}</td>
						<td class="amount">
							{{ debt.levies ? formatCents(debt.levies) : '' }}
						</td>
						<td class="amount">
							{{ formatCents(debt.amount) }}
						</td>
					</tr>
				</tbody>
				<tfoot>
					<tr>
						<th colspan="5">
							Total adeudado
						</th>
						<th class="amount">
							{{ formatCents(debtTotal) }}
						</th>
					</tr>
				</tfoot>
			</table>
			<p v-else>
				Todos los propietarios están al corriente de pago.
			</p>
			<p v-if="debts.length" class="none">
				Según el art. 15.2 de la Ley de Propiedad Horizontal, los propietarios que en la fecha de la junta no estén al corriente de las deudas vencidas
				pueden participar en sus deliberaciones, pero no votar, salvo que las hayan impugnado judicialmente o consignado.
			</p>
		</section>

		<section v-if="proposal">
			<h3>Presupuesto propuesto para {{ year + 1 }}</h3>
			<table>
				<thead>
					<tr>
						<th>Partida</th>
						<th class="amount">
							{{ year }}
						</th>
						<th class="amount">
							Propuesta {{ year + 1 }}
						</th>
						<th class="amount">
							Variación
						</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="row in proposal.rows" :key="row.id">
						<td>{{ row.name }}</td>
						<td class="amount">
							{{ row.budgeted === undefined ? '' : formatCents(row.budgeted) }}
						</td>
						<td class="amount">
							{{ formatCents(row.amount) }}
						</td>
						<td class="amount">
							{{ variation(row.amount, row.budgeted) }}
						</td>
					</tr>
					<tr>
						<td>Fondo de reserva</td>
						<td class="amount">
							{{ formatCents(proposal.currentReserve) }}
						</td>
						<td class="amount">
							{{ formatCents(proposal.reserve) }}
						</td>
						<td class="amount">
							{{ variation(proposal.reserve, proposal.currentReserve) }}
						</td>
					</tr>
				</tbody>
				<tfoot>
					<tr>
						<th>Total</th>
						<th class="amount">
							{{ formatCents(proposal.currentOrdinary + proposal.currentReserve) }}
						</th>
						<th class="amount">
							{{ formatCents(proposal.ordinary + proposal.reserve) }}
						</th>
						<th class="amount">
							{{ variation(proposal.ordinary + proposal.reserve, proposal.currentOrdinary + proposal.currentReserve) }}
						</th>
					</tr>
				</tfoot>
			</table>
		</section>
		<p v-else class="hint screen-only">
			Aún no hay presupuesto de {{ year + 1 }}. Prepáralo en
			<RouterLink :to="`/communities/${id}/budget`">
				presupuesto
			</RouterLink>
			y saldrá aquí como propuesta para la junta.
		</p>

		<footer>
			<span>El administrador</span>
			<span>Vº Bº El presidente</span>
		</footer>
	</article>
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
		width: 110px;
	}
}

.intro {
	margin-bottom: var(--lnx-spacing-4);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
	flex-wrap: wrap;
}

.hint {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}

// A4 pages on screen, the same on paper
.sheet {
	max-width: 210mm;
	min-height: 297mm;
	margin: 0 auto;
	padding: 20mm;
	background: #FFFFFF;
	color: #000000;
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000014;
	display: flex;
	flex-direction: column;
	gap: 7mm;
	font-size: 10pt;
	line-height: 1.5;

	> header,
	.lines {
		display: flex;
		flex-direction: column;
	}

	.lines {
		gap: 2mm;
	}

	.title {
		text-align: center;

		h2 {
			font-size: 15pt;
			text-transform: uppercase;
		}
	}

	section {
		display: flex;
		flex-direction: column;
		gap: 2mm;
		break-inside: avoid;
	}

	h3 {
		font-size: 11pt;
		border-bottom: 2px solid #000000;
		padding-bottom: 1mm;
	}

	.none {
		color: #555555;
		font-size: 9pt;
	}

	.hint a {
		color: inherit;
	}

	> footer {
		margin-top: 15mm;
		display: flex;
		justify-content: space-between;

		span {
			padding-top: 2mm;
			width: 60mm;
			border-top: 1px solid #000000;
			text-align: center;
			font-size: 9pt;
		}
	}
}

.summary {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 3mm;

	div {
		padding: 2mm 3mm;
		border: 1px solid #CCCCCC;
	}

	dt {
		font-size: 8.5pt;
		color: #555555;
	}

	dd {
		font-size: 12pt;
		font-weight: bold;
		font-variant-numeric: tabular-nums;
	}
}

.negative {
	color: #B00020;
}

table {
	width: 100%;
	border-collapse: collapse;

	th,
	td {
		padding: 1.2mm 2mm;
		border-bottom: 1px solid #CCCCCC;
		text-align: left;
	}

	tfoot th {
		border-top: 1px solid #000000;
	}

	.amount {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
}

@page {
	size: A4;
	margin: 18mm;
}

@media print {
	.page-header,
	.intro,
	.screen-only {
		display: none;
	}

	.sheet {
		max-width: none;
		min-height: auto;
		padding: 0;
		box-shadow: none;
	}
}
</style>
