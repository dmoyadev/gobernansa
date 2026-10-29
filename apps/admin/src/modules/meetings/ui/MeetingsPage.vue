<script setup lang="ts">
import { meetingStatus, meetingTypes } from '@gobernansa/shared/domain/meeting.ts';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed } from 'vue';
import { useMeetings } from '../application/useMeetings.ts';

const props = defineProps<{ id: string }>();

const { data: meetings, pending, error } = useMeetings(props.id);
// Newest first. A draft just created has no server date yet for an instant
const sortedMeetings = computed(() => [...meetings.value].sort((a, b) => (b.date?.toMillis() ?? 0) - (a.date?.toMillis() ?? 0)));

const dateFormat = new Intl.DateTimeFormat('es-ES', { dateStyle: 'full', timeStyle: 'short' });
</script>

<template>
	<header class="page-header">
		<LnxButton :to="`/communities/${id}`" mode="clear" shape="circle" aria-label="Volver a la comunidad">
			<LnxIcon icon="lucide:arrow-left" />
		</LnxButton>
		<h1>Juntas</h1>
		<LnxButton :to="`/communities/${id}/meetings/new`">
			<LnxIcon icon="lucide:plus" />
			Nueva junta
		</LnxButton>
	</header>

	<section class="card">
		<p v-if="error" class="error" role="alert">
			No se han podido cargar: {{ error.message }}
		</p>

		<span v-if="pending" class="skeleton-item" />
		<ul v-else-if="sortedMeetings.length" class="list">
			<li v-for="meeting in sortedMeetings" :key="meeting.id">
				<RouterLink :to="`/communities/${id}/meetings/${meeting.id}`" class="item">
					<LnxIcon class="icon" icon="lucide:gavel" :size="20" />
					<div class="what">
						<strong>{{ meeting.title }}</strong>
						<small>
							{{ meetingTypes[meeting.type] }} · {{ meeting.date ? dateFormat.format(meeting.date.toDate()) : '' }}
						</small>
					</div>
					<span class="status" :class="`status--${meeting.status}`">{{ meetingStatus[meeting.status] }}</span>
				</RouterLink>
			</li>
		</ul>
		<p v-else class="hint">
			Aún no hay juntas. Los vecinos las verán en la app una vez convocadas.
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
}

.list {
	display: flex;
	flex-direction: column;

	li + li {
		border-top: 1px solid var(--color-gray-3);
	}
}

.item {
	padding: var(--lnx-spacing-3) 0;
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto;
	align-items: center;
	gap: var(--lnx-spacing-3);
	color: inherit;
	text-decoration: none;

	.icon {
		color: var(--color-primary);
	}

	&:hover strong {
		color: var(--color-primary);
	}
}

.what {
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

.status {
	padding: var(--lnx-spacing-1) var(--lnx-spacing-2);
	border-radius: var(--lnx-radius-2);
	background: var(--color-gray-2);
	color: var(--color-gray-7);
	font-size: var(--lnx-font-size-small);

	&--convened {
		background: var(--color-primary);
		color: var(--color-gray-0);
	}
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
