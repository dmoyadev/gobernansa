<script setup lang="ts">
import type { Booking } from '@gobernansa/shared/domain/booking.ts';
import type { Charge } from '@gobernansa/shared/domain/finance.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { bookingTotal } from '@gobernansa/shared/domain/booking.ts';
import { getBookableAreas } from '@gobernansa/shared/domain/community.ts';
import { chargeTypes, collectionMethods, outstanding } from '@gobernansa/shared/domain/finance.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { describePayment } from '@gobernansa/shared/domain/payment.ts';
import { computed } from 'vue';
import { useUserCommunity } from '@/modules/community/application/useUserCommunity.ts';

// The justificante of a paid or partly paid charge, or of a paid booking, as a page on screen and the same on paper.
// Without either, its skeleton
const props = defineProps<{ charge?: Charge; booking?: Booking }>();

const { user } = useAuth();
const { userCommunity } = useUserCommunity();

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'long' });

// What the last payment covered, after the entregas a cuenta
const rest = computed(() => props.charge ? outstanding({ ...props.charge, paidAt: null }) : 0);

const areaName = computed(() => getBookableAreas(userCommunity.value).find(area => area.id === props.booking?.areaId)?.name);
</script>

<template>
	<article v-if="!charge && !booking" class="sheet" aria-busy="true" aria-label="Cargando">
		<span class="skeleton-item skeleton-item--title" style="width: 60%" />
		<span v-for="width in [80, 70, 75, 50]" :key="width" class="skeleton-item" :style="{ width: `${width}%` }" />
	</article>
	<article v-else class="sheet">
		<header>
			<strong>{{ userCommunity?.name }}</strong>
			<span v-if="userCommunity?.cif">CIF {{ userCommunity.cif }}</span>
			<span v-if="userCommunity?.address">{{ userCommunity.address }}</span>
		</header>

		<h2>{{ charge && !charge.paidAt ? 'Justificante de entregas a cuenta' : 'Justificante de pago' }}</h2>
		<p v-if="(charge ?? booking)?.payment" class="test">
			Pago de prueba: tu comunidad está probando los pagos online y no se ha cobrado nada. Este justificante no acredita un pago real.
		</p>

		<dl v-if="booking">
			<div>
				<dt>Recibido de</dt>
				<dd>{{ booking.name || user?.name }}</dd>
			</div>
			<div>
				<dt>Zona común</dt>
				<dd>{{ areaName }}</dd>
			</div>
			<div>
				<dt>Reserva</dt>
				<dd>{{ dateFormat.format(new Date(`${booking.date}T00:00`)) }}, de {{ booking.from }} a {{ booking.to }}</dd>
			</div>
			<div v-if="booking.price">
				<dt>Precio</dt>
				<dd>{{ formatCents(booking.price) }}</dd>
			</div>
			<div v-if="booking.deposit">
				<dt>Fianza, se devuelve después</dt>
				<dd>{{ formatCents(booking.deposit) }}</dd>
			</div>
			<div v-if="booking.paidAt">
				<dt>Fecha de pago</dt>
				<dd>{{ dateFormat.format(booking.paidAt.toDate()) }}</dd>
			</div>
			<div v-if="booking.paidAt">
				<dt>Forma de pago</dt>
				<dd>{{ booking.payment ? `${describePayment(booking.payment)}, online` : 'Registrado por la administración' }}</dd>
			</div>
			<div>
				<dt>Referencia</dt>
				<dd class="ref">
					{{ booking.payment?.id ?? booking.id }}
				</dd>
			</div>
			<div class="total">
				<dt>Importe</dt>
				<dd>{{ formatCents(bookingTotal(booking)) }}</dd>
			</div>
		</dl>
		<dl v-else-if="charge">
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
			<div v-for="item in charge.collections ?? []" :key="item.id">
				<dt>Entrega a cuenta del {{ dateFormat.format(item.date.toDate()) }}</dt>
				<dd>{{ collectionMethods[item.method] }} · {{ formatCents(item.amount) }}</dd>
			</div>
			<template v-if="charge.paidAt">
				<div>
					<dt>Fecha de pago</dt>
					<dd>{{ dateFormat.format(charge.paidAt.toDate()) }}</dd>
				</div>
				<div v-if="rest">
					<dt>Forma de pago</dt>
					<dd>
						{{ charge.payment ? `${describePayment(charge.payment)}, online` : 'Registrado por la administración' }}<template v-if="charge.collections?.length">
							· {{ formatCents(rest) }}
						</template>
					</dd>
				</div>
			</template>
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
			<div v-if="!charge.paidAt" class="total">
				<dt>Pendiente</dt>
				<dd>{{ formatCents(rest) }}</dd>
			</div>
		</dl>
	</article>
</template>

<style lang="scss" scoped>
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

@media print {
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
	.notices {
		display: none !important;
	}
}
</style>
