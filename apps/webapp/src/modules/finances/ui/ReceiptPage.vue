<script setup lang="ts">
import type { Booking } from '@gobernansa/shared/domain/booking.ts';
import type { Charge } from '@gobernansa/shared/domain/finance.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { reportError } from '@gobernansa/shared/infrastructure/monitoring.ts';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { ref, watch } from 'vue';
import { loadBooking } from '@/modules/bookings/application/useBookings.ts';
import TheToolbar from '@/shared/ui/TheToolbar.vue';
import { loadMyCharge } from '../application/useMyCharges.ts';
import ReceiptSheet from './ReceiptSheet.vue';

// Of a charge, or of a booking with isBooking
const props = defineProps<{ id: string; isBooking?: boolean }>();

const { user } = useAuth();

const charge = ref<Charge>();
const booking = ref<Booking>();
const loading = ref(true);
const error = ref<string>();

// Read once, when the user's community is known
watch(() => user.value?.communityId, async (communityId) => {
	if (!communityId) {
		return;
	}
	try {
		if (props.isBooking) {
			booking.value = await loadBooking(communityId, props.id);
			// Neighbours can read every booking, but only get the justificante of theirs
			error.value = booking.value?.paidAt && booking.value.uid === user.value?.id ? undefined : 'Esta reserva no existe o aún no está pagada.';
		} else {
			charge.value = await loadMyCharge(communityId, props.id);
			// One partly paid gets the justificante of its entregas a cuenta, with what's left
			error.value = charge.value?.paidAt || charge.value?.collections?.length ? undefined : 'Este recibo no existe o aún no está pagado.';
		}
	} catch (e) {
		reportError(e, { action: 'Cargar el justificante' });
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
	<TheToolbar title="Justificante de pago" :back="isBooking ? '/neighborhood/bookings' : '/neighborhood/charges'" />

	<main class="receipt">
		<LnxButton class="print" :disabled="loading || !!error" @click="print()">
			<LnxIcon icon="lucide:printer" />
			Imprimir o guardar en PDF
		</LnxButton>

		<p v-if="error" class="error" role="alert">
			{{ error }}
		</p>
		<ReceiptSheet v-else :charge="charge" :booking="booking" />
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
}
</style>
