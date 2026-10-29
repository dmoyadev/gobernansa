<script setup lang="ts">
import { meetingStatus, meetingTypes } from '@gobernansa/shared/domain/meeting.ts';
import { LnxIcon } from 'lnxjs-components';
import MainLayout from '@/shared/ui/MainLayout.vue';
import TheHeader from '@/shared/ui/TheHeader.vue';
import { formatMeetingDate, useMeetings } from '../application/useMeetings.ts';

const { meetings, loading, error } = useMeetings();
</script>

<template>
	<TheHeader>
		<h1>Juntas</h1>
		<p>Convocatorias y resultados de las juntas de propietarios.</p>
	</TheHeader>

	<MainLayout>
		<ul v-if="meetings.length" class="list">
			<li v-for="meeting in meetings" :key="meeting.id">
				<RouterLink class="row" :to="`/neighborhood/meetings/${meeting.id}`">
					<span class="icon">
						<LnxIcon icon="lucide:gavel" :size="20" />
					</span>
					<span class="body">
						<small>{{ formatMeetingDate(meeting.date) }}</small>
						<strong>{{ meeting.title }}</strong>
						<small>{{ meetingTypes[meeting.type] }}</small>
					</span>
					<span class="status" :class="meeting.status">{{ meetingStatus[meeting.status] }}</span>
				</RouterLink>
			</li>
		</ul>

		<template v-else-if="loading">
			<span class="skeleton-item" />
			<span class="skeleton-item" />
		</template>

		<p v-else class="empty">
			{{ error ? 'No se han podido cargar las juntas. Revisa tu conexión e inténtalo de nuevo.' : 'Aún no se ha convocado ninguna junta.' }}
		</p>
	</MainLayout>
</template>

<style lang="scss" scoped>
.list {
	display: flex;
	flex-direction: column;
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;

	> li + li {
		border-top: 1px solid var(--color-gray-2);
	}
}

.row {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-3);
	padding: var(--lnx-spacing-3);
	color: inherit;
	text-decoration: none;

	&:active {
		background: var(--color-gray-1);
	}

	.icon {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border-radius: var(--lnx-radius-circle);
		background: var(--color-gray-1);
		color: var(--color-primary);
	}

	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;

		small {
			color: var(--color-gray-6);
			font-size: var(--lnx-font-size-small);
		}

		strong {
			color: var(--color-gray-9);
			font-weight: var(--lnx-font-weight-regular);
		}
	}
}

.status {
	flex-shrink: 0;
	padding: 2px var(--lnx-spacing-2);
	border-radius: var(--lnx-radius-4);
	background: var(--color-gray-1);
	color: var(--color-gray-7);
	font-size: var(--lnx-font-size-small);
	font-weight: var(--lnx-font-weight-bold);

	&.convened {
		background: var(--color-issue-cat-services);
		color: var(--color-issue-cat-services-accent);
	}

	&.cancelled {
		text-decoration: line-through;
	}
}

.empty {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}
</style>
