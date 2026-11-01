<script setup lang="ts">
import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { Charge } from '@gobernansa/shared/domain/finance.ts';
import type { Property } from '@gobernansa/shared/domain/property.ts';
import { chargeTypes } from '@gobernansa/shared/domain/finance.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { formatCoefficient, propertyTypeLabels } from '@gobernansa/shared/domain/property.ts';
import { LnxButton, LnxIcon, LnxSelect } from 'lnxjs-components';
import { computed, onMounted, ref } from 'vue';
import BackButton from '@/app/ux/BackButton.vue';
import { onRevalidate } from '@/app/ux/navigation.ts';
import { toast } from '@/app/ux/toast.ts';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { loadPropertyAccount } from '../application/useFinances.ts';

const props = defineProps<{ id: string; propertyId: string }>();

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'short' });
const longDate = new Intl.DateTimeFormat('es', { dateStyle: 'long' });
const today = ref(new Date());

const community = ref<Community>();
const property = ref<Property>();
const charges = ref<Charge[]>([]);
const loading = ref(true);
const error = ref<string>();

// Read once, and again when coming back, showing the last one meanwhile
async function load() {
	try {
		const [loadedCommunity, account] = await Promise.all([loadCommunity(props.id), loadPropertyAccount(props.id, props.propertyId)]);
		community.value = loadedCommunity;
		property.value = account.property;
		charges.value = account.charges;
		today.value = new Date();
		error.value = !loadedCommunity || account.property?.communityId !== props.id ? 'No existe esta comunidad o propiedad.' : undefined;
	} catch (e) {
		if (community.value) {
			toast(`No se ha podido actualizar: ${(e as Error).message}`, { tone: 'error' });
		} else {
			error.value = `No se ha podido cargar: ${(e as Error).message}`;
		}
	} finally {
		loading.value = false;
	}
}

onMounted(load);
onRevalidate(load);

// Each charge is a cargo on its due date and its payment an abono on the day it was paid. Those not yet due and unpaid
// aren't owed yet, so they're left out (the year's fees are issued all at once)
const notDue = computed(() => charges.value.filter(charge => !charge.paidAt && charge.dueDate.toMillis() > today.value.getTime()));
const entries = computed(() => {
	const moves = charges.value.filter(charge => !notDue.value.includes(charge)).flatMap(charge => [
		{ key: `${charge.id}-c`, date: charge.dueDate.toDate(), concept: charge.concept, type: chargeTypes[charge.type], debit: charge.amount, credit: 0 },
		...(charge.paidAt ? [{ key: `${charge.id}-p`, date: charge.paidAt.toDate(), concept: `Pago ${charge.concept}`, type: 'Cobro', debit: 0, credit: charge.amount }] : []),
	]).sort((a, b) => a.date.getTime() - b.date.getTime() || b.debit - a.debit);
	let balance = 0;
	return moves.map((move) => {
		balance += move.debit - move.credit;
		return { ...move, balance };
	});
});

// The whole history or one year, which starts from the balance carried over
const ALL = 0;
const year = ref(ALL);
const yearOptions = computed(() => [
	{ value: ALL, label: 'Todo' },
	...[...new Set(entries.value.map(entry => entry.date.getFullYear()))].sort((a, b) => b - a).map(value => ({ value, label: String(value) })),
]);
const shown = computed(() => year.value === ALL ? entries.value : entries.value.filter(entry => entry.date.getFullYear() === year.value));
const carried = computed(() => year.value === ALL ? 0 : entries.value.findLast(entry => entry.date.getFullYear() < year.value)?.balance ?? 0);
const debits = computed(() => shown.value.reduce((sum, entry) => sum + entry.debit, 0));
const credits = computed(() => shown.value.reduce((sum, entry) => sum + entry.credit, 0));
const balance = computed(() => carried.value + debits.value - credits.value);
const notDueTotal = computed(() => notDue.value.reduce((sum, charge) => sum + charge.amount, 0));

function print() {
	window.print();
}
</script>

<template>
	<header class="page-header">
		<BackButton :to="`/communities/${id}/statements`" label="Volver a estados de cuenta" />
		<h1>Estado de cuenta</h1>
		<LnxSelect
			v-model.convert="year"
			class="year"
			aria-label="Periodo"
			:options="yearOptions"
			:convert-fn="option => option.value"
			search-placeholder-text="Buscar..."
		>
			<template #option="{ option }">
				{{ option.label }}
			</template>
			<template #optionInput="{ value }">
				{{ value || 'Todo' }}
			</template>
		</LnxSelect>
		<LnxButton :disabled="loading || !!error" @click="print()">
			<LnxIcon icon="lucide:printer" />
			Imprimir / Guardar PDF
		</LnxButton>
	</header>

	<p v-if="error" class="error" role="alert">
		{{ error }}
	</p>
	<article v-else-if="loading" class="sheet" aria-busy="true" aria-label="Cargando">
		<header>
			<span class="skeleton-item" style="width: 55%" />
			<span class="skeleton-item skeleton-item--small" style="width: 40%" />
		</header>
		<div class="lines">
			<span v-for="width in [100, 96, 100, 92, 100, 70]" :key="width" class="skeleton-item" :style="{ width: `${width}%` }" />
		</div>
	</article>
	<article v-else-if="community && property" class="sheet ux-appear">
		<header>
			<strong>Comunidad de propietarios {{ community.name }}</strong>
			<span>{{ community.address }}</span>
			<span v-if="community.cif">CIF {{ community.cif }}</span>
		</header>

		<h2>Estado de cuenta{{ year ? ` ${year}` : '' }}</h2>
		<p>
			<strong>{{ property.name }}</strong> ({{ propertyTypeLabels[property.type].toLowerCase() }}<template v-if="property.coefficient">
				, coeficiente {{ formatCoefficient(property.coefficient) }}
			</template>)<template v-if="property.ownerName">
				· titular <strong>{{ property.ownerName }}</strong>
			</template>
			<br>
			A {{ longDate.format(today) }}
		</p>

		<table>
			<thead>
				<tr>
					<th>Fecha</th>
					<th>Concepto</th>
					<th class="amount">
						Cargos
					</th>
					<th class="amount">
						Abonos
					</th>
					<th class="amount">
						Saldo
					</th>
				</tr>
			</thead>
			<tbody>
				<tr v-if="year">
					<td />
					<td>Saldo anterior</td>
					<td />
					<td />
					<td class="amount">
						{{ formatCents(carried) }}
					</td>
				</tr>
				<tr v-for="entry in shown" :key="entry.key">
					<td>{{ dateFormat.format(entry.date) }}</td>
					<td>{{ entry.concept }} <small>{{ entry.type }}</small></td>
					<td class="amount">
						{{ entry.debit ? formatCents(entry.debit) : '' }}
					</td>
					<td class="amount">
						{{ entry.credit ? formatCents(entry.credit) : '' }}
					</td>
					<td class="amount">
						{{ formatCents(entry.balance) }}
					</td>
				</tr>
				<tr v-if="!shown.length">
					<td colspan="5">
						Sin movimientos.
					</td>
				</tr>
			</tbody>
			<tfoot>
				<tr>
					<th colspan="2">
						{{ balance > 0 ? 'Saldo deudor' : balance < 0 ? 'Saldo a favor' : 'Al corriente' }}
					</th>
					<th class="amount">
						{{ formatCents(debits) }}
					</th>
					<th class="amount">
						{{ formatCents(credits) }}
					</th>
					<th class="amount">
						{{ formatCents(balance) }}
					</th>
				</tr>
			</tfoot>
		</table>

		<p v-if="notDue.length" class="note">
			Además hay {{ notDue.length }} {{ notDue.length === 1 ? 'recibo emitido que aún no ha vencido' : 'recibos emitidos que aún no han vencido' }}, por {{ formatCents(notDueTotal) }}, que no se incluyen.
		</p>
	</article>
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

// An A4 page on screen, the same on paper
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
	gap: 6mm;
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

	h2 {
		text-align: center;
		font-size: 15pt;
		text-transform: uppercase;
	}

	.note {
		font-size: 9pt;
		color: #555555;
	}
}

table {
	width: 100%;
	border-collapse: collapse;
	font-variant-numeric: tabular-nums;

	th,
	td {
		padding: 1.2mm 2mm;
		border-bottom: 1px solid #CCCCCC;
		text-align: left;
	}

	small {
		color: #777777;
	}

	.amount {
		text-align: right;
		white-space: nowrap;
	}

	tfoot th {
		border-bottom: none;
		border-top: 2px solid #000000;
	}
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}

@page {
	size: A4;
	margin: 20mm;
}

@media print {
	.page-header {
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
