<script setup lang="ts">
import { getBookableAreas } from '@gobernansa/shared/domain/community.ts';
import { ISSUE_ICON } from '@gobernansa/shared/domain/issue.ts';
import { attendanceStatus } from '@gobernansa/shared/domain/meeting.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { LnxIcon } from 'lnxjs-components';
import { computed } from 'vue';
import MainLayout from '@/app/ui/MainLayout.vue';
import TheHeader from '@/app/ui/TheHeader.vue';
import { usePending } from '@/app/usePending.ts';
import { useUserCommunity } from '@/modules/community/application/useUserCommunity.ts';
import { formatMeetingDate } from '@/modules/meetings/application/useMeetings.ts';

const { userCommunity } = useUserCommunity();
const { nextMeeting, attendance, paymentsCount: pendingCount, paymentsTotal: pendingTotal, paymentsLoading, paymentsError, overdue, payLink } = usePending();

const bookableAreas = computed(() => getBookableAreas(userCommunity.value));
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
						<small class="tabular" :class="{ overdue }">
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
						<strong>{{ attendance ? 'Ver la próxima junta' : 'Confirmar asistencia a la junta' }}</strong>
						<small>{{ formatMeetingDate(nextMeeting.date) }}<template v-if="attendance"> · {{ attendanceStatus[attendance.status] }}</template></small>
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
		color: var(--color-gray-6);
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
