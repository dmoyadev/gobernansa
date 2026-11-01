<script setup lang="ts">
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { LnxIcon } from 'lnxjs-components';
import { computed } from 'vue';
import { loadSummary, nextTaxDeadline, useFinanceSummary } from '../application/useFinanceSummary.ts';

const props = defineProps<{ id: string }>();

const year = new Date().getFullYear();
const dateFormat = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long' });

const { data, error, loading } = useFinanceSummary(async () => loadSummary(props.id));

function plural(total: number, one: string, many: string) {
	return `${total} ${total === 1 ? one : many}`;
}

// Each figure opens the page where it's acted on. alert marks those that need doing. The deadline is worked out again with each reread
const figures = computed(() => {
	const summary = data.value;
	const deadline = nextTaxDeadline();
	const { daysLeft } = deadline;
	return [
		{
			key: 'pending',
			label: 'Pendiente de cobro',
			icon: 'lucide:receipt-text',
			to: 'arrears',
			value: summary && formatCents(summary.pending),
			detail: summary && (summary.pending ? 'Quién debe y desde cuándo, en Morosidad' : 'Todos los recibos están cobrados'),
			alert: false,
		},
		{
			key: 'invoices',
			label: 'Facturas vencidas',
			icon: 'lucide:file-clock',
			to: 'payables',
			value: summary && String(summary.overdueInvoices),
			detail: summary && (summary.overdueInvoices ? `${formatCents(summary.overdueInvoicesAmount)} por pagar a proveedores` : 'Ninguna factura pasada de plazo'),
			alert: !!summary?.overdueInvoices,
		},
		{
			key: 'bank',
			label: 'Movimientos por conciliar',
			icon: 'lucide:arrow-left-right',
			to: 'bank',
			value: summary && String(summary.unreconciled),
			detail: summary && (summary.unreconciled ? 'Del banco, sin recibo, factura o remesa' : 'El banco está al día'),
			alert: !!summary?.unreconciled,
		},
		{
			key: 'reserve',
			label: `Fondo de reserva ${year}`,
			icon: 'lucide:piggy-bank',
			to: 'fees',
			value: summary && formatCents(summary.reserve ?? 0),
			detail: summary && 'Saldo inicial, lo cobrado en cuotas y lo pagado del fondo',
			alert: (summary?.reserve ?? 0) < 0,
		},
		{
			key: 'taxes',
			label: 'Próximo modelo fiscal',
			icon: 'lucide:file-badge',
			to: 'taxes',
			value: deadline.title,
			detail: `Hasta el ${dateFormat.format(new Date(`${deadline.due}T12:00`))} (${daysLeft ? plural(daysLeft, 'día', 'días') : 'hoy'})`,
			alert: daysLeft <= 7,
		},
		{
			key: 'remittance',
			label: 'Devoluciones de la última remesa',
			icon: 'lucide:landmark',
			to: 'remittances',
			value: summary && String(summary.remittance?.returned ?? 0),
			detail: summary && (!summary.remittance
				? 'Aún no hay remesas'
				: summary.remittance.returned
					? `${formatCents(summary.remittance.returnedAmount)} devueltos de ${summary.remittance.reference}`
					: `Ninguna en ${summary.remittance.reference}`),
			alert: !!summary?.remittance?.returned,
		},
	];
});
</script>

<template>
	<header class="page-header">
		<h1>Finanzas</h1>
	</header>

	<p v-if="error" class="error" role="alert">
		No se han podido cargar las cifras: {{ error }}
	</p>

	<ul class="figures" :aria-busy="loading">
		<li v-for="figure in figures" :key="figure.key">
			<RouterLink class="figure" :class="{ alert: figure.alert }" :to="`/communities/${id}/${figure.to}`">
				<span class="label">
					<LnxIcon :icon="figure.icon" :size="16" aria-hidden="true" />
					{{ figure.label }}
				</span>
				<template v-if="figure.value">
					<strong class="value tabular ux-appear">{{ figure.value }}</strong>
					<small class="ux-appear">{{ figure.detail }}</small>
				</template>
				<template v-else-if="loading">
					<span class="skeleton-item skeleton-item--title" style="width: 45%" />
					<span class="skeleton-item skeleton-item--small" style="width: 75%" />
				</template>
				<small v-else>Sin datos</small>
			</RouterLink>
		</li>
	</ul>
</template>

<style lang="scss" scoped>
.page-header {
	margin-bottom: var(--lnx-spacing-5);

	h1 {
		font-size: var(--lnx-font-size-title);
	}
}

.figures {
	margin: 0;
	padding: 0;
	list-style: none;
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
	gap: var(--lnx-spacing-3);
}

.figure {
	position: relative;
	height: 100%;
	padding: var(--lnx-spacing-4);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);
	color: var(--color-gray-7);
	text-decoration: none;

	&:hover,
	&:focus-visible {
		border-color: var(--color-primary-light);
		box-shadow: 0 2px 4px #0000000F, 0 8px 24px #0000000F;
	}

	&:active {
		scale: var(--press-scale);
	}

	// What needs doing stands out with a bar inside it, rounded and clear of the edge
	&.alert {
		padding-left: calc(var(--lnx-spacing-4) + 4px + var(--lnx-spacing-3));

		&::before {
			content: '';
			position: absolute;
			top: var(--lnx-spacing-4);
			bottom: var(--lnx-spacing-4);
			left: var(--lnx-spacing-4);
			width: 4px;
			border-radius: 2px;
			background: var(--color-secondary-accent);
		}

		.value {
			color: var(--color-secondary-accent);
		}
	}
}

.label {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.value {
	color: var(--color-gray-9);
	font-size: var(--lnx-font-size-title);
}

small {
	font-size: var(--lnx-font-size-small);
}

.error {
	margin-bottom: var(--lnx-spacing-4);
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}
</style>
