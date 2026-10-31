<script setup lang="ts">
import { isOverdue } from '@gobernansa/shared/domain/finance.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { formatCoefficient } from '@gobernansa/shared/domain/property.ts';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed } from 'vue';
import BackButton from '@/app/ux/BackButton.vue';
import { useCommunityProperties, useUnpaidCharges } from '../application/useFinances.ts';

const props = defineProps<{ id: string }>();

const { data: properties, pending: propertiesPending, error: propertiesError } = useCommunityProperties(props.id);
// The unpaid ones are all a balance needs, and they're few, so live
const { data: unpaid, pending: chargesPending, error: chargesError } = useUnpaidCharges(props.id);

const today = new Intl.DateTimeFormat('es', { dateStyle: 'long' }).format(new Date());

// The balance is what's overdue; what isn't due yet is shown apart
const rows = computed(() => {
	const byProperty = Object.groupBy(unpaid.value, charge => charge.propertyId);
	return properties.value.map((property) => {
		const charges = byProperty[property.id] ?? [];
		const balance = charges.filter(charge => isOverdue(charge)).reduce((sum, charge) => sum + charge.amount, 0);
		const pending = charges.reduce((sum, charge) => sum + charge.amount, 0) - balance;
		return { property, balance, pending };
	}).sort((a, b) => a.property.name.localeCompare(b.property.name, 'es', { numeric: true }));
});
const totalBalance = computed(() => rows.value.reduce((sum, row) => sum + row.balance, 0));
const totalPending = computed(() => rows.value.reduce((sum, row) => sum + row.pending, 0));
const debtors = computed(() => rows.value.filter(row => row.balance).length);
const loading = computed(() => (propertiesPending.value || chargesPending.value) && !rows.value.length);

function print() {
	window.print();
}
</script>

<template>
	<header class="page-header">
		<BackButton :to="`/communities/${id}`" label="Volver a la comunidad" />
		<h1>Estados de cuenta</h1>
		<LnxButton :disabled="loading" @click="print()">
			<LnxIcon icon="lucide:printer" />
			Imprimir saldos
		</LnxButton>
	</header>

	<section class="card">
		<p v-if="propertiesError || chargesError" class="error" role="alert">
			No se han podido cargar: {{ (propertiesError ?? chargesError)?.message }}
		</p>
		<p class="print-only">
			Saldos de los propietarios a {{ today }}
		</p>

		<div class="totals tabular" :aria-busy="loading">
			<div>
				<small>Saldo deudor</small>
				<span v-if="loading" class="skeleton-item skeleton-item--title" style="width: 110px" />
				<strong v-else :class="{ debt: totalBalance }">{{ formatCents(totalBalance) }}</strong>
			</div>
			<div>
				<small>Por vencer</small>
				<span v-if="loading" class="skeleton-item skeleton-item--title" style="width: 95px" />
				<strong v-else>{{ formatCents(totalPending) }}</strong>
			</div>
			<div>
				<small>Deudores</small>
				<span v-if="loading" class="skeleton-item skeleton-item--title" style="width: 40px" />
				<strong v-else>{{ debtors }} de {{ rows.length }}</strong>
			</div>
		</div>

		<div v-if="loading" class="lines" aria-busy="true" aria-label="Cargando">
			<span v-for="width in [90, 80, 95, 70]" :key="width" class="skeleton-item" :style="{ width: `${width}%` }" />
		</div>
		<table v-else-if="rows.length" class="ux-appear">
			<thead>
				<tr>
					<th>Propiedad</th>
					<th>Propietario</th>
					<th class="amount">
						Coeficiente
					</th>
					<th class="amount">
						Saldo
					</th>
					<th class="amount">
						Por vencer
					</th>
					<th>Estado</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="row in rows" :key="row.property.id">
					<td>
						<RouterLink :to="`/communities/${id}/statements/${row.property.id}`">
							{{ row.property.name }}
						</RouterLink>
					</td>
					<td>{{ row.property.ownerName || 'Sin propietario' }}</td>
					<td class="amount">
						{{ row.property.coefficient ? formatCoefficient(row.property.coefficient) : '' }}
					</td>
					<td class="amount" :class="{ debt: row.balance }">
						{{ formatCents(row.balance) }}
					</td>
					<td class="amount">
						{{ row.pending ? formatCents(row.pending) : '' }}
					</td>
					<td>
						<span class="chip" :class="row.balance ? 'debt' : 'ok'">{{ row.balance ? 'Deudor' : 'Al corriente' }}</span>
					</td>
				</tr>
			</tbody>
		</table>
		<p v-else class="hint">
			Aún no hay propiedades. Añádelas en el censo.
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

.lines {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
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
}

.chip {
	padding: 2px var(--lnx-spacing-2);
	border-radius: 999px;
	background: var(--color-gray-2);
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

.hint {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}

.print-only {
	display: none;
}

@media print {
	.page-header {
		display: none;
	}

	.print-only {
		display: block;
		font-weight: var(--lnx-font-weight-bold);
	}

	.card {
		padding: 0;
		border: none;
		box-shadow: none;
	}
}
</style>
