<script setup lang="ts">
import { errorMessage } from '@gobernansa/shared/application/errors.ts';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { onBeforeUnmount, onMounted } from 'vue';
import MainLayout from '@/app/ui/MainLayout.vue';
import TheHeader from '@/app/ui/TheHeader.vue';
import { useUserCommunity } from '@/modules/community/application/useUserCommunity.ts';
import { useCommunityEvents } from '../application/useCommunityEvents.ts';
import { useUnreadNotices } from '../application/useUnreadNotices.ts';
import EventCard from './EventCard.vue';

const { events, loading, loadingMore, error, allLoaded, page } = useCommunityEvents();
const { userCommunity } = useUserCommunity();
// The listener stops on an error, so trying again is loading the page again
const reload = () => location.reload();

// Seen on the way in and on the way out, in case one arrives while reading
const { markSeen } = useUnreadNotices();
onMounted(markSeen);
onBeforeUnmount(markSeen);
</script>

<template>
	<TheHeader back="/">
		<h1>Avisos</h1>
		<p>Lo que comunica tu administración y lo que se ha hecho en tu comunidad.</p>
	</TheHeader>
	<MainLayout>
		<ul v-if="loading" class="events" aria-label="Cargando">
			<li v-for="index in 3" :key="index" class="lnx-skeleton lnx-skeleton--rect" />
		</ul>

		<div v-else-if="error && !events.length" class="empty" role="alert">
			<p>No se han podido cargar los avisos. {{ errorMessage(error) }}</p>
			<LnxButton mode="outline" @click="reload()">
				<template #prefix>
					<LnxIcon icon="lucide:refresh-cw" />
				</template>
				Reintentar
			</LnxButton>
		</div>

		<p v-else-if="!events.length" class="empty">
			Aún no hay avisos. Cuando la administración comunique algo o se arregle una incidencia, aparecerá aquí.
		</p>

		<ul v-else class="events">
			<li v-for="event in events" :key="event.id">
				<EventCard :event />
			</li>
		</ul>

		<template v-if="!loading && !error">
			<LnxButton v-if="!allLoaded" mode="outline" :is-loading="loadingMore" :disabled="loadingMore" @click="page++">
				Cargar más
			</LnxButton>

			<div v-else-if="userCommunity?.constructionYear" class="load-more">
				<LnxIcon class="icon" icon="lucide:building-2" :size="20" />

				<div class="info">
					<div class="metadata">
						<span class="date">
							{{ userCommunity?.constructionYear }}
						</span>
					</div>
					<h3>Construcción del edificio</h3>
				</div>
			</div>
		</template>
	</MainLayout>
</template>

<style lang="scss" scoped>
.events {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-4);
}

.empty {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: var(--lnx-spacing-3);
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.load-more {
	position: relative;
	display: flex;
	gap: var(--lnx-spacing-4);

	.icon {
		width: 36px;
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 3px solid #e9eacd;
		color: #aaaf37;
		border-radius: var(--lnx-radius-circle);
		flex-shrink: 0;
		z-index: 1;
	}

	.info {
		border: 1px solid #e9eacd;
		border-radius: var(--lnx-radius-3);
		padding: var(--lnx-spacing-2);
		width: 100%;

		.metadata {
			width: 100%;
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: var(--lnx-spacing-2);
			text-transform: uppercase;

			.date {
				font-weight: var(--lnx-font-weight-thin);
				flex-shrink: 0;
				font-size: .75rem;
				color: #6f7320;
			}
		}

		h3 {
			font-size: var(--lnx-font-size-body);
			font-weight: var(--lnx-font-weight-regular);
		}
	}
}
</style>
