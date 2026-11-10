<script setup lang="ts">
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { bookingTotal } from '@gobernansa/shared/domain/booking.ts';
import { getBookableAreas } from '@gobernansa/shared/domain/community.ts';
import { isOverdue, outstanding } from '@gobernansa/shared/domain/finance.ts';
import { ISSUE_ICON } from '@gobernansa/shared/domain/issue.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { remote } from '@gobernansa/shared/infrastructure/remoteConfig.ts';
import { LnxIcon } from 'lnxjs-components';
import { computed } from 'vue';
import { useOwedBookings } from '@/modules/bookings/application/useBookings.ts';
import { useUserCommunity } from '@/modules/community/application/useUserCommunity.ts';
import { useMyCharges } from '@/modules/finances/application/useMyCharges.ts';
import { formatMeetingDate, useMeetings } from '@/modules/meetings/application/useMeetings.ts';
import MainLayout from '@/shared/ui/MainLayout.vue';
import TheHeader from '@/shared/ui/TheHeader.vue';

const { user } = useAuth();
const { userCommunity } = useUserCommunity();
const { nextMeeting } = useMeetings();
const { unpaid } = useMyCharges();
const owedBookings = useOwedBookings();

const bookableAreas = computed(() => getBookableAreas(userCommunity.value));

// Only what the user has to pay themselves, the domiciled ones are collected by the bank
const charges = computed(() => unpaid.value.filter(charge => outstanding(charge) > 0 && !charge.remittanceId));
const pendingCount = computed(() => charges.value.length + owedBookings.value.length);
const pendingTotal = computed(() => charges.value.reduce((sum, charge) => sum + outstanding(charge), 0)
	+ owedBookings.value.reduce((sum, booking) => sum + bookingTotal(booking), 0));
const paymentsLoading = computed(() => (unpaid.pending.value || owedBookings.pending.value) && !pendingCount.value);
// Not knowing isn't "todo al día", so it leads to the receipts instead
const paymentsError = computed(() => unpaid.error.value || owedBookings.error.value);

// The same checks as the Pagar buttons of the lists
const canPayOnline = computed(() => userCommunity.value?.onlinePayments === 'test' && !user.value?.blocked && remote.payments);

// Straight to paying it when there's only one, otherwise to the list it's in, which also says how to pay by transfer
const payLink = computed(() => {
	const [charge] = charges.value;
	const [booking] = owedBookings.value;
	if (canPayOnline.value && pendingCount.value === 1) {
		return charge ? `/neighborhood/charges/${charge.id}/pay` : `/neighborhood/bookings/${booking!.id}/pay`;
	}
	return booking && !charge ? '/neighborhood/bookings' : '/neighborhood/charges';
});
</script>

<template>
	<TheHeader>
		<h1>¿Qué quieres hacer?</h1>
		<p>Lo más habitual en tu comunidad, a un toque.</p>
	</TheHeader>

	<MainLayout>
		<ul class="actions">
			<li>
				<RouterLink class="action" to="/issues/new">
					<span class="icon issue">
						<LnxIcon :icon="ISSUE_ICON" :size="22" />
					</span>
					<span class="body">
						<strong>Dar aviso de una incidencia</strong>
						<small>Algo roto, sucio o que no funciona</small>
					</span>
					<LnxIcon class="chevron" icon="lucide:chevron-right" :size="18" />
				</RouterLink>
			</li>

			<li v-if="bookableAreas.length">
				<RouterLink class="action" to="/neighborhood/bookings">
					<span class="icon">
						<LnxIcon icon="lucide:calendar-check" :size="22" />
					</span>
					<span class="body">
						<strong>Reservar</strong>
						<small>{{ bookableAreas.map(area => area.name).join(' · ') }}</small>
					</span>
					<LnxIcon class="chevron" icon="lucide:chevron-right" :size="18" />
				</RouterLink>
			</li>

			<li>
				<div v-if="paymentsLoading" class="action" aria-busy="true">
					<span class="icon">
						<LnxIcon icon="lucide:credit-card" :size="22" />
					</span>
					<span class="body">
						<strong>Hacer un pago pendiente</strong>
						<span class="lnx-skeleton lnx-skeleton--small" style="width: 50%" />
					</span>
				</div>
				<RouterLink v-else-if="paymentsError" class="action" to="/neighborhood/charges">
					<span class="icon">
						<LnxIcon icon="lucide:credit-card" :size="22" />
					</span>
					<span class="body">
						<strong>Hacer un pago pendiente</strong>
						<small>Consulta lo que tienes pendiente en tus recibos</small>
					</span>
					<LnxIcon class="chevron" icon="lucide:chevron-right" :size="18" />
				</RouterLink>
				<RouterLink v-else-if="pendingCount" class="action" :to="payLink">
					<span class="icon">
						<LnxIcon icon="lucide:credit-card" :size="22" />
					</span>
					<span class="body">
						<strong>Hacer un pago pendiente</strong>
						<small class="tabular" :class="{ overdue: charges.some(charge => isOverdue(charge)) }">
							{{ pendingCount === 1 ? '1 pendiente' : `${pendingCount} pendientes` }} · {{ formatCents(pendingTotal) }}
						</small>
					</span>
					<LnxIcon class="chevron" icon="lucide:chevron-right" :size="18" />
				</RouterLink>
				<div v-else class="action" aria-disabled="true">
					<span class="icon done">
						<LnxIcon icon="lucide:circle-check" :size="22" />
					</span>
					<span class="body">
						<strong>Todo al día</strong>
						<small>No tienes ningún pago pendiente</small>
					</span>
				</div>
			</li>

			<li v-if="nextMeeting">
				<RouterLink class="action" :to="`/neighborhood/meetings/${nextMeeting.id}`">
					<span class="icon">
						<LnxIcon icon="lucide:gavel" :size="22" />
					</span>
					<span class="body">
						<strong>Confirmar asistencia a la junta</strong>
						<small>{{ formatMeetingDate(nextMeeting.date) }}</small>
					</span>
					<LnxIcon class="chevron" icon="lucide:chevron-right" :size="18" />
				</RouterLink>
			</li>
		</ul>
	</MainLayout>
</template>

<style lang="scss" scoped>
.actions {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);
}

.action {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-3);
	padding: var(--lnx-spacing-4) var(--lnx-spacing-3);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;
	color: inherit;
	text-decoration: none;

	.icon {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		border-radius: var(--lnx-radius-circle);
		background: var(--color-gray-1);
		color: var(--color-primary);

		&.issue {
			background: #fde8e8;
			color: var(--color-secondary-accent);
		}

		&.done {
			color: var(--color-issue-status-resolved);
		}
	}

	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;

		strong {
			color: var(--color-gray-9);
		}

		small {
			color: var(--color-gray-6);
			font-size: var(--lnx-font-size-small);

			&.overdue {
				color: var(--color-secondary-accent);
			}
		}
	}

	.chevron {
		flex-shrink: 0;
		color: var(--color-gray-5);
	}
}

a.action {
	transition: transform .15s;

	&:active {
		transform: scale(.98);
	}
}

@media (prefers-reduced-motion: reduce) {
	a.action {
		transition: none;
	}
}
</style>
