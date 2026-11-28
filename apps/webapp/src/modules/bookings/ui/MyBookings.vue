<script setup lang="ts">
import type { Booking } from '@gobernansa/shared/domain/booking.ts';
import type { BookableArea } from '@gobernansa/shared/domain/community.ts';
import { bookingTotal } from '@gobernansa/shared/domain/booking.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { dateParts, formatDay } from '../domain/days.ts';

// «Mis reservas»: the next ones as tickets, to pay, see the receipt or cancel, and the last ones below
const props = defineProps<{ upcoming: Booking[]; past: Booking[]; areas: BookableArea[]; blocked: boolean; canPayOnline: boolean }>();
const emit = defineEmits<{ remove: [booking: Booking]; book: [] }>();

// A booking of an area the office has since removed keeps a plain name
function areaOf(id: string) {
	return props.areas.find(option => option.id === id) ?? { name: 'Zona común', icon: 'lucide:map-pin' };
}
</script>

<template>
	<template v-if="upcoming.length">
		<p v-if="upcoming.some(booking => booking.paidAt)" class="hint">
			Para anular una reserva ya pagada, habla con la administración.
		</p>
		<ul class="tickets">
			<li v-for="booking in upcoming" :key="booking.id">
				<article class="ticket">
					<p class="stub" :aria-label="formatDay(booking.date)">
						<small aria-hidden="true">{{ dateParts(booking.date).weekday }}</small>
						<strong aria-hidden="true">{{ dateParts(booking.date).number }}</strong>
						<small aria-hidden="true">{{ dateParts(booking.date).month }}</small>
					</p>
					<div class="ticket-body">
						<h2>
							<LnxIcon :icon="areaOf(booking.areaId).icon" :size="16" />
							{{ areaOf(booking.areaId).name }}
						</h2>
						<p class="tabular">
							{{ booking.from }}–{{ booking.to }}
						</p>
						<span
							class="status tabular"
							:class="!bookingTotal(booking) ? 'free' : booking.paidAt ? 'paid' : 'owed'"
						>
							<template v-if="!bookingTotal(booking)">Gratis</template>
							<template v-else>
								{{ formatCents(bookingTotal(booking)) }} · {{ booking.paidAt ? (booking.payment ? 'Pagada (prueba)' : 'Pagada') : 'Pendiente' }}
								<template v-if="booking.deposit && booking.depositReturnedAt"> · fianza devuelta</template>
							</template>
						</span>
					</div>
					<div class="ticket-actions">
						<LnxButton
							v-if="!blocked && canPayOnline && booking.paidAt === null"
							size="sm"
							:to="`/neighborhood/bookings/${booking.id}/pay`"
						>
							Pagar
						</LnxButton>
						<LnxButton
							v-if="booking.paidAt"
							mode="clear"
							shape="circle"
							:to="`/neighborhood/bookings/${booking.id}/receipt`"
							:aria-label="`Justificante de la reserva del ${formatDay(booking.date)} a las ${booking.from}`"
						>
							<LnxIcon icon="lucide:file-check" />
						</LnxButton>
						<LnxButton
							v-if="!blocked && !booking.paidAt"
							mode="clear"
							shape="circle"
							variant="danger"
							:aria-label="`Anular la reserva del ${formatDay(booking.date)} a las ${booking.from}`"
							@click="emit('remove', booking)"
						>
							<LnxIcon icon="lucide:x" />
						</LnxButton>
					</div>
				</article>
			</li>
		</ul>
	</template>

	<div v-else class="nothing">
		<span class="nothing-icon"><LnxIcon icon="lucide:calendar-plus" :size="28" /></span>
		<p>No tienes reservas próximas.</p>
		<LnxButton v-if="areas.length" @click="emit('book')">
			Reservar una zona
		</LnxButton>
	</div>

	<section v-if="past.length" class="past">
		<h2>Anteriores</h2>
		<ul>
			<li v-for="booking in past" :key="booking.id">
				<span class="tabular">{{ dateParts(booking.date).number }} {{ dateParts(booking.date).month }}</span>
				<span>{{ areaOf(booking.areaId).name }}</span>
				<span class="tabular">{{ booking.from }}</span>
				<LnxButton
					v-if="booking.paidAt"
					mode="clear"
					shape="circle"
					size="sm"
					:to="`/neighborhood/bookings/${booking.id}/receipt`"
					:aria-label="`Justificante de la reserva del ${formatDay(booking.date)}`"
				>
					<LnxIcon icon="lucide:file-check" :size="16" />
				</LnxButton>
			</li>
		</ul>
	</section>
</template>

<style lang="scss" scoped>
// A soft wash of the brand colour, for picked and own things
$tint: color-mix(in srgb, var(--color-primary) 8%, var(--color-gray-0));

.tickets {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);

	// The shadow on the li, the ticket's notches would clip it
	li {
		filter: drop-shadow(0 1px 1px #0000000F) drop-shadow(0 3px 8px #0000000F);
	}
}

// A ticket: a stub with the date, notches where it would tear off
.ticket {
	--stub: 72px;
	display: flex;
	align-items: stretch;
	border-radius: var(--lnx-radius-4);
	background: var(--color-gray-0);
	mask:
		radial-gradient(circle 7px at var(--stub) 0, #0000 98%, #000) top / 100% 51% no-repeat,
		radial-gradient(circle 7px at var(--stub) 100%, #0000 98%, #000) bottom / 100% 51% no-repeat;

	.stub {
		flex: 0 0 var(--stub);
		margin: var(--lnx-spacing-2);
		margin-right: 0;
		padding: var(--lnx-spacing-2) 0;
		border-radius: var(--lnx-radius-3);
		background: $tint;
		color: var(--color-primary);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		flex-basis: calc(var(--stub) - var(--lnx-spacing-2) * 2);

		small {
			font-size: .75rem;
			text-transform: uppercase;
			letter-spacing: .04em;
		}

		strong {
			font-size: 1.6rem;
			line-height: 1.1;
			font-variant-numeric: tabular-nums;
		}
	}

	.ticket-body {
		flex: 1;
		min-width: 0;
		margin-left: var(--lnx-spacing-2);
		padding: var(--lnx-spacing-3);
		border-left: 2px dashed var(--color-gray-2);
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;

		h2 {
			display: flex;
			align-items: center;
			gap: var(--lnx-spacing-1);
			font-size: var(--lnx-font-size-body);
			color: var(--color-gray-9);
		}

		p {
			color: var(--color-gray-7);
			font-weight: var(--lnx-font-weight-bold);
		}
	}

	.status {
		margin-top: var(--lnx-spacing-1);
		padding: 2px var(--lnx-spacing-2);
		border-radius: var(--lnx-radius-4);
		font-size: .75rem;
		font-weight: var(--lnx-font-weight-bold);

		&.owed {
			background: #fde8e8;
			color: var(--color-secondary-accent);
		}

		&.paid {
			background: #def1dc;
			color: #2f6e1c;
		}

		&.free {
			background: var(--color-gray-1);
			color: var(--color-gray-7);
		}
	}

	.ticket-actions {
		padding-right: var(--lnx-spacing-2);
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-1);
	}
}

.nothing {
	padding: var(--lnx-spacing-6) var(--lnx-spacing-4);
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: var(--lnx-spacing-3);
	color: var(--color-gray-6);
	text-align: center;

	.nothing-icon {
		width: 64px;
		height: 64px;
		border-radius: var(--lnx-radius-circle);
		background: $tint;
		color: var(--color-primary);
		display: flex;
		align-items: center;
		justify-content: center;
	}
}

.past {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);

	h2 {
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
		color: var(--color-gray-6);
		text-transform: uppercase;
		letter-spacing: .04em;
	}

	li {
		min-height: 44px;
		display: grid;
		grid-template-columns: 56px 1fr auto 32px;
		align-items: center;
		gap: var(--lnx-spacing-2);
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);

		+ li {
			border-top: 1px solid var(--color-gray-2);
		}
	}
}

.hint {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}
</style>
