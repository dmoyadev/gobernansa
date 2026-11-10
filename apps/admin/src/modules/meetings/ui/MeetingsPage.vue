<script setup lang="ts">
import { meetingStatus, meetingTypes } from '@gobernansa/shared/domain/meeting.ts';
import { LnxIcon } from 'lnxjs-components';
import { computed } from 'vue';
import BackButton from '@/app/ux/BackButton.vue';
import NewButton from '@/app/ux/NewButton.vue';
import { useMeetings } from '../application/useMeetings.ts';

const props = defineProps<{ id: string }>();

const { data: meetings, pending, error } = useMeetings(props.id);
// Newest first. A draft just created has no server date yet for an instant
const sortedMeetings = computed(() => [...meetings.value].sort((a, b) => (b.date?.toMillis() ?? 0) - (a.date?.toMillis() ?? 0)));

const dateFormat = new Intl.DateTimeFormat('es-ES', { dateStyle: 'full', timeStyle: 'short' });
</script>

<template>
	<header class="page-header">
		<BackButton :to="`/communities/${id}`" label="Volver a la comunidad" />
		<h1>Juntas</h1>
		<NewButton label="Nueva junta" :to="`/communities/${id}/meetings/new`" />
	</header>

	<section class="card" :aria-busy="pending && !meetings.length">
		<p v-if="error" class="error" role="alert">
			No se han podido cargar: {{ error.message }}
		</p>

		<ul v-if="pending && !meetings.length" class="list">
			<li v-for="width in ['55%', '40%', '65%', '45%']" :key="width" class="item">
				<span class="lnx-skeleton lnx-skeleton--circle" />
				<div class="what">
					<span class="lnx-skeleton" :style="{ width }" />
					<span class="lnx-skeleton lnx-skeleton--small" style="width: 35%" />
				</div>
				<span class="lnx-skeleton lnx-skeleton--small" style="width: 80px" />
			</li>
		</ul>
		<ul v-else-if="sortedMeetings.length" class="list lnx-appear">
			<li v-for="meeting in sortedMeetings" :key="meeting.id">
				<RouterLink :to="`/communities/${id}/meetings/${meeting.id}`" class="item ux-row">
					<LnxIcon class="icon" icon="lucide:gavel" :size="20" />
					<div class="what">
						<strong :style="{ viewTransitionName: `meeting-${meeting.id}` }">{{ meeting.title }}</strong>
						<small class="tabular">
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
	margin: 0 calc(-1 * var(--lnx-spacing-2));
	padding: var(--lnx-spacing-3) var(--lnx-spacing-2);
	border-radius: var(--lnx-radius-2);
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto;
	align-items: center;
	gap: var(--lnx-spacing-3);
	color: inherit;
	text-decoration: none;

	.icon {
		color: var(--color-primary);
	}

	strong {
		text-wrap: balance;
		transition: color var(--duration) var(--ease-out);
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
