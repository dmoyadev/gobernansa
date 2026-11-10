<script setup lang="ts">
import type { Booking } from '@gobernansa/shared/domain/booking.ts';
import type { Checkout } from '@/modules/finances/application/useMyCharges.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { bookingTotal, getSlots, getWeek, parseBookingId } from '@gobernansa/shared/domain/booking.ts';
import { getBookableAreas } from '@gobernansa/shared/domain/community.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { remote } from '@gobernansa/shared/infrastructure/remoteConfig.ts';
import { Timestamp } from 'firebase/firestore';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed, ref } from 'vue';
import { useUserCommunity } from '@/modules/community/application/useUserCommunity.ts';
import PayWizard from '@/modules/finances/ui/PayWizard.vue';
import ReceiptSheet from '@/modules/finances/ui/ReceiptSheet.vue';
import { useBookings } from '../application/useBookings.ts';

// The id of the slot: a booking of the user still owed, or a free slot to book and pay at once
const props = defineProps<{ id: string }>();

const { user } = useAuth();
const { userCommunity } = useUserCommunity();

const { areaId: slotAreaId, date: slotDate, from } = parseBookingId(props.id);
const date = ref(slotDate);
const areaId = ref(slotAreaId);
const { dayBookings, myBookings, book, pay: payBooking } = useBookings(date, areaId);

const area = computed(() => getBookableAreas(userCommunity.value).find(({ id }) => id === areaId.value));
const slot = computed(() => area.value && getSlots(area.value, date.value).find(option => option.from === from));
// Live, so a slot someone else books meanwhile shows up as taken
const booking = computed(() => dayBookings.value.find(({ id }) => id === props.id));
const isNew = computed(() => !booking.value);
// What it cost when it was booked, or what it costs now
const fee = computed(() => booking.value
	? { price: booking.value.price ?? 0, deposit: booking.value.deposit ?? 0 }
	: { price: area.value?.price ?? 0, deposit: area.value?.deposit ?? 0 });
const amount = computed(() => bookingTotal(fee.value));

const loading = computed(() => !userCommunity.value || dayBookings.pending.value || myBookings.pending.value);

const weekFull = computed(() => {
	const week = getWeek(date.value);
	return !!area.value?.maxPerWeek && myBookings.value.filter(({ date: day }) => day >= week.from && day <= week.to).length >= area.value.maxPerWeek;
});

// Why it can't be paid here, the same checks as the bookings page
const unavailable = computed(() => {
	if (dayBookings.error.value || myBookings.error.value) {
		return 'No se han podido cargar las reservas. Recarga la página.';
	}
	if (loading.value) {
		return undefined;
	}
	if (!area.value || !slot.value) {
		return 'Esta reserva no existe.';
	}
	if (booking.value && booking.value.uid !== user.value?.id) {
		return 'Esa franja ya está reservada.';
	}
	if (booking.value?.paidAt) {
		return 'Esta reserva ya está pagada.';
	}
	if (!amount.value) {
		return 'Esta reserva no tiene nada que pagar.';
	}
	if (isNew.value && new Date(`${date.value}T${from}`) <= new Date()) {
		return 'Esa franja ya ha pasado.';
	}
	if (isNew.value && weekFull.value) {
		return `Ya has llegado al máximo de reservas semanales en ${area.value.name}.`;
	}
	// Online payments can be turned off from the console (ROB-5)
	if (userCommunity.value!.onlinePayments !== 'test' || !remote.payments) {
		return 'Los pagos online no están disponibles ahora mismo. Habla con la administración.';
	}
	// Blocked neighbours (and admins viewing as one) can look, not book nor pay
	if (user.value?.blocked) {
		return 'Tu cuenta no puede reservar ni pagar ahora mismo.';
	}
	return undefined;
});

function formatDay(day: string) {
	return new Date(`${day}T00:00`).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
}

const concept = computed(() => area.value && slot.value ? `${area.value.name}, ${formatDay(date.value)} de ${slot.value.from} a ${slot.value.to}` : '');

// The booking as it is once paid, for its justificante without reading it again
const paid = ref<Booking>();

async function pay(checkout: Checkout) {
	if (!user.value || !area.value || !slot.value) {
		throw new Error('The user must be signed in to pay');
	}
	// Taken by someone else meanwhile, booking it is turned down by the rules
	const owed = booking.value?.uid === user.value.id ? booking.value : undefined;
	const payment = owed
		? await payBooking(owed, checkout)
		: await book({ areaId: area.value.id, date: date.value, ...slot.value }, fee.value, checkout);
	paid.value = {
		...(owed ?? { id: props.id, communityId: userCommunity.value!.id, areaId: area.value.id, date: date.value, ...slot.value, uid: user.value.id, name: user.value.name || '', createdAt: Timestamp.now(), ...fee.value }),
		paidAt: Timestamp.now(),
		payment,
	};
}
</script>

<template>
	<PayWizard
		title="Pagar reserva"
		back="/neighborhood/bookings"
		back-label="Volver a reservas"
		:loading="loading"
		:unavailable="unavailable"
		:amount="amount"
		:concept="concept"
		:continue-label="isNew && area?.rules ? 'Acepto las normas y continúo' : undefined"
		:pay="pay"
	>
		<template v-if="booking?.paidAt && booking.uid === user?.id" #unavailable>
			<LnxButton :to="`/neighborhood/bookings/${booking.id}/receipt`" class="lnx-size-large" is-block>
				<template #prefix>
					<LnxIcon icon="lucide:file-check" />
				</template>
				Ver el justificante
			</LnxButton>
		</template>

		<template v-if="area && slot" #details>
			<div>
				<dt>Zona común</dt>
				<dd>{{ area.name }}</dd>
			</div>
			<div>
				<dt>Día</dt>
				<dd>{{ formatDay(date) }}</dd>
			</div>
			<div>
				<dt>Horario</dt>
				<dd class="tabular">
					{{ slot.from }}–{{ slot.to }}
				</dd>
			</div>
			<div v-if="fee.price">
				<dt>Precio</dt>
				<dd class="tabular">
					{{ formatCents(fee.price) }}
				</dd>
			</div>
			<div v-if="fee.deposit">
				<dt>Fianza, se devuelve después</dt>
				<dd class="tabular">
					{{ formatCents(fee.deposit) }}
				</dd>
			</div>
		</template>

		<p v-if="isNew" class="hint">
			La franja se reserva al pagar. Hasta entonces, otro vecino puede reservarla.
		</p>
		<div v-if="isNew && area?.rules" class="rules">
			<small>Normas</small>
			<p>{{ area.rules }}</p>
		</div>

		<template #receipt>
			<ReceiptSheet :booking="paid" />
		</template>
	</PayWizard>
</template>

<style lang="scss" scoped>
.hint {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.rules {
	padding: var(--lnx-spacing-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-1);
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-1);
	white-space: pre-line;

	small {
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
	}
}
</style>
