<script setup lang="ts">
import { LnxButton, LnxIcon } from 'lnxjs-components';
import EventCard from '../components/EventCard.vue';
import TheHeader from '../components/TheHeader.vue';
import { useCommunityEvents } from '../composables/useCommunityEvents.ts';
import { useUserCommunity } from '../composables/useUserCommunity.ts';
import MainLayout from '../layouts/MainLayout.vue';

const { events, allLoaded, page } = useCommunityEvents();
const { userCommunity } = useUserCommunity();
</script>

<template>
	<TheHeader>
		<h1>Cronograma</h1>
		<p>Conoce qué ha pasado y qué se ha hecho en tu comunidad.</p>
	</TheHeader>
	<MainLayout>
		<ul class="events">
			<li v-for="event in events" :key="event.id">
				<EventCard :event />
			</li>
		</ul>

		<LnxButton v-if="!allLoaded" @click="page++">
			Cargar más...
		</LnxButton>

		<div v-else class="load-more">
			<LnxIcon class="icon" icon="roentgen:building-construction" :size="20" />

			<div class="info">
				<div class="metadata">
					<span class="date">
						{{ userCommunity?.constructionYear }}
					</span>
				</div>
				<h3>Construcción del edificio</h3>
			</div>
		</div>
	</MainLayout>
</template>

<style lang="scss" scoped>
.events {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-4);
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
				font-size: .6em;
				color: #aaaf37;
			}
		}

		h3 {
			font-size: var(--lnx-font-size-body);
			font-weight: var(--lnx-font-weight-regular);
		}
	}
}
</style>
