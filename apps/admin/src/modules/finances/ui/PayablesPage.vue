<script setup lang="ts">
import type { Expense } from '@gobernansa/shared/domain/finance.ts';
import { isOverdue, payableAmount, paymentMethods } from '@gobernansa/shared/domain/finance.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { Timestamp } from 'firebase/firestore';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed } from 'vue';
import { optimistic } from '@/app/ux/toast.ts';
import { setExpensePaid, useUnpaidInvoices } from '../application/useFinances.ts';

const props = defineProps<{ id: string }>();

const { data: unpaid, pending, error } = useUnpaidInvoices(props.id);

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium' });

// The soonest due first; those without a due date last, by their date
const invoices = computed(() => [...unpaid.value].sort((a, b) => (a.dueDate?.toMillis() ?? Infinity) - (b.dueDate?.toMillis() ?? Infinity)
	|| a.date.toMillis() - b.date.toMillis()));
const overdue = computed(() => invoices.value.filter(invoice => isOverdue(invoice)));
const totalPending = computed(() => invoices.value.reduce((sum, invoice) => sum + payableAmount(invoice), 0));
const totalOverdue = computed(() => overdue.value.reduce((sum, invoice) => sum + payableAmount(invoice), 0));
const loading = computed(() => pending.value && !invoices.value.length);

function markPaid(invoice: Expense) {
	void optimistic(setExpensePaid(props.id, invoice, Timestamp.now()), {
		done: 'Factura marcada como pagada',
		failed: 'No se ha podido marcar',
		revert: async () => setExpensePaid(props.id, invoice, null),
	});
}
</script>

<template>
	<header class="page-header">
		<h1>Facturas pendientes</h1>
		<LnxButton :to="`/communities/${id}/payments`" mode="clear" size="small">
			<LnxIcon icon="lucide:send" />
			Pagar por transferencia
		</LnxButton>
		<LnxButton :to="`/communities/${id}/budget`" mode="clear" size="small">
			<LnxIcon icon="lucide:plus" />
			Añadir factura
		</LnxButton>
	</header>

	<section class="card">
		<p v-if="error" class="error" role="alert">
			No se han podido cargar: {{ error.message }}
		</p>

		<div class="totals tabular" :aria-busy="loading">
			<div>
				<small>Pendiente de pago</small>
				<span v-if="loading" class="skeleton-item skeleton-item--title" style="width: 110px" />
				<strong v-else>{{ formatCents(totalPending) }}</strong>
			</div>
			<div>
				<small>Vencido</small>
				<span v-if="loading" class="skeleton-item skeleton-item--title" style="width: 95px" />
				<strong v-else :class="{ overdue: totalOverdue }">{{ formatCents(totalOverdue) }}</strong>
			</div>
			<div>
				<small>Facturas</small>
				<span v-if="loading" class="skeleton-item skeleton-item--title" style="width: 40px" />
				<strong v-else>{{ invoices.length }}<template v-if="overdue.length"> · {{ overdue.length }} {{ overdue.length === 1 ? 'vencida' : 'vencidas' }}</template></strong>
			</div>
		</div>

		<ul v-if="loading" class="list" aria-busy="true" aria-label="Cargando">
			<li v-for="width in [55, 40, 65]" :key="width" class="item">
				<div class="what">
					<span class="skeleton-item" :style="{ width: `${width}%` }" />
					<span class="skeleton-item skeleton-item--small" :style="{ width: `${width - 15}%` }" />
				</div>
				<span class="skeleton-item" style="width: 80px" />
				<span class="skeleton-item skeleton-item--small" style="width: 110px" />
			</li>
		</ul>
		<TransitionGroup v-else-if="invoices.length" tag="ul" name="row" class="list ux-appear">
			<li v-for="invoice in invoices" :key="invoice.id" class="item" :class="{ late: isOverdue(invoice) }">
				<div class="what">
					<strong>{{ invoice.provider?.name ?? 'Sin proveedor' }} · {{ invoice.concept }}</strong>
					<small class="tabular">
						<template v-if="invoice.invoiceNumber">Fra. {{ invoice.invoiceNumber }} · </template>
						{{ dateFormat.format(invoice.date.toDate()) }}
						<template v-if="invoice.dueDate">
							· <span :class="{ overdue: isOverdue(invoice) }">{{ isOverdue(invoice) ? 'venció' : 'vence' }} el {{ dateFormat.format(invoice.dueDate.toDate()) }}</span>
						</template>
						<template v-if="invoice.paymentMethod"> · {{ paymentMethods[invoice.paymentMethod] }}</template>
						<template v-if="invoice.paymentOrderId"> · en una orden de pago</template>
					</small>
				</div>
				<div class="cost tabular">
					<strong>{{ formatCents(payableAmount(invoice)) }}</strong>
					<small v-if="invoice.withholding">total {{ formatCents(invoice.amount) }}, retención {{ formatCents(invoice.withholding) }}</small>
				</div>
				<LnxButton mode="clear" size="small" @click="markPaid(invoice)">
					<LnxIcon icon="lucide:check" />
					Marcar pagada
				</LnxButton>
			</li>
		</TransitionGroup>
		<p v-else class="hint">
			No hay facturas pendientes de pago.
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
	position: relative;
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

	// Overdue ones stand out with a mark on their edge
	&.late {
		padding-left: var(--lnx-spacing-3);
		box-shadow: inset 3px 0 0 var(--color-secondary-accent);
	}
}

.what,
.cost {
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

.what strong {
	text-wrap: balance;
}

.cost {
	align-items: flex-end;
}

.overdue {
	color: var(--color-secondary-accent);
}

// Paid ones leave, the rest slide into place
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

.hint {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}
</style>
