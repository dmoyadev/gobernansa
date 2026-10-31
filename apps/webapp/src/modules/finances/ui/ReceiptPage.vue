<script setup lang="ts">
import type { Charge } from '@gobernansa/shared/domain/finance.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { chargeTypes } from '@gobernansa/shared/domain/finance.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { describePayment } from '@gobernansa/shared/domain/payment.ts';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { ref, watch } from 'vue';
import { useUserCommunity } from '@/modules/community/application/useUserCommunity.ts';
import TheToolbar from '@/shared/ui/TheToolbar.vue';
import { loadMyCharge } from '../application/useMyCharges.ts';

const props = defineProps<{ id: string }>();

const { user } = useAuth();
const { userCommunity } = useUserCommunity();

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'long' });

const charge = ref<Charge>();
const loading = ref(true);
const error = ref<string>();

// Read once, when the user's community is known
watch(() => user.value?.communityId, async (communityId) => {
	if (!communityId) {
		return;
	}
	try {
		charge.value = await loadMyCharge(communityId, props.id);
		error.value = charge.value?.paidAt ? undefined : 'Este recibo no existe o aún no está pagado.';
	} catch (e) {
		// eslint-disable-next-line no-console
		console.error(e);
		error.value = 'No se ha podido cargar el justificante.';
	} finally {
		loading.value = false;
	}
}, { immediate: true });

function print() {
	window.print();
}
</script>

<template>
	<TheToolbar title="Justificante de pago" back="/neighborhood/charges" />

	<main class="receipt">
		<LnxButton class="print" :disabled="loading || !!error" @click="print()">
			<LnxIcon icon="lucide:printer" />
			Imprimir o guardar en PDF
		</LnxButton>

		<p v-if="error" class="error" role="alert">
			{{ error }}
		</p>
		<article v-else-if="loading" class="sheet" aria-busy="true" aria-label="Cargando">
			<span class="skeleton-item skeleton-item--title" style="width: 60%" />
			<span v-for="width in [80, 70, 75, 50]" :key="width" class="skeleton-item" :style="{ width: `${width}%` }" />
		</article>
		<article v-else-if="charge?.paidAt" class="sheet">
			<header>
				<strong>{{ userCommunity?.name }}</strong>
				<span v-if="userCommunity?.cif">CIF {{ userCommunity.cif }}</span>
				<span v-if="userCommunity?.address">{{ userCommunity.address }}</span>
			</header>

			<h2>Justificante de pago</h2>
			<p v-if="charge.payment" class="test">
				Pago de prueba: tu comunidad está probando los pagos online y no se ha cobrado nada. Este justificante no acredita un pago real.
			</p>

			<dl>
				<div>
					<dt>Recibido de</dt>
					<dd>{{ charge.ownerName || user?.name }}</dd>
				</div>
				<div>
					<dt>Propiedad</dt>
					<dd>{{ charge.propertyName }}</dd>
				</div>
				<div>
					<dt>Concepto</dt>
					<dd>{{ chargeTypes[charge.type] }} · {{ charge.concept }}</dd>
				</div>
				<div>
					<dt>Vencimiento</dt>
					<dd>{{ dateFormat.format(charge.dueDate.toDate()) }}</dd>
				</div>
				<div>
					<dt>Fecha de pago</dt>
					<dd>{{ dateFormat.format(charge.paidAt.toDate()) }}</dd>
				</div>
				<div>
					<dt>Forma de pago</dt>
					<dd>{{ charge.payment ? `${describePayment(charge.payment)}, online` : 'Registrado por la administración' }}</dd>
				</div>
				<div>
					<dt>Referencia</dt>
					<dd class="ref">
						{{ charge.payment?.id ?? charge.id }}
					</dd>
				</div>
				<div class="total">
					<dt>Importe</dt>
					<dd>{{ formatCents(charge.amount) }}</dd>
				</div>
			</dl>
		</article>
	</main>
</template>

<style lang="scss" scoped>
.receipt {
	min-height: 100svh;
	padding: calc(var(--toolbar-height) + var(--lnx-spacing-4)) var(--lnx-spacing-4) calc(var(--lnx-spacing-4) + var(--tab-height));
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-4);

	.print {
		align-self: flex-end;
	}
}

// A page on screen, the same on paper
.sheet {
	width: 100%;
	max-width: 210mm;
	margin: 0 auto;
	padding: var(--lnx-spacing-5);
	background: #FFFFFF;
	color: #000000;
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000014;
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-4);
	line-height: 1.5;

	> header {
		display: flex;
		flex-direction: column;
		font-size: var(--lnx-font-size-small);
	}

	h2 {
		text-align: center;
		font-size: 1.2rem;
		text-transform: uppercase;
	}

	.test {
		padding: var(--lnx-spacing-2) var(--lnx-spacing-3);
		border: 1px dashed #7a5a00;
		color: #7a5a00;
		font-size: var(--lnx-font-size-small);
	}

	dl > div {
		padding: var(--lnx-spacing-2) 0;
		border-bottom: 1px solid #CCCCCC;
		display: flex;
		justify-content: space-between;
		gap: var(--lnx-spacing-3);
	}

	dt {
		color: #555555;
	}

	dd {
		text-align: right;
		overflow-wrap: anywhere;
	}

	.ref {
		font-family: monospace;
		font-size: var(--lnx-font-size-small);
	}

	.total {
		border-bottom: none;
		font-size: 1.1rem;
		font-weight: var(--lnx-font-weight-bold);
	}
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}

@media print {
	.receipt {
		min-height: auto;
		padding: 0;

		.print {
			display: none;
		}
	}

	.sheet {
		max-width: none;
		box-shadow: none;
	}
}
</style>

<!-- The app's chrome around the page isn't printed: the toolbar, the tab bar and the notices -->
<style>
@media print {
	.toolbar,
	nav,
	.notice {
		display: none !important;
	}
}
</style>
