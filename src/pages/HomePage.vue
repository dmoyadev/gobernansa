<script setup lang="ts">
import { LnxButton, LnxIcon } from 'lnxjs-components';
import EventCard from '../components/EventCard.vue';
import TheHeader from '../components/TheHeader.vue';
import useAuth from '../composables/useAuth.ts';
import { useCommunityEvents } from '../composables/useCommunityEvents.ts';
import { useUserCommunity } from '../composables/useUserCommunity.ts';
import { useUserProperties } from '../composables/useUserProperties.ts';
import MainLayout from '../layouts/MainLayout.vue';
import { scrollTop } from '../utils/helpers.ts';

const { user } = useAuth();
const { selectedProperty } = useUserProperties();
const { userCommunity } = useUserCommunity();
const { events } = useCommunityEvents(3);
</script>

<template>
	<TheHeader>
		<div class="greeting">
			<h1 v-if="selectedProperty">
				¡Hola, {{ selectedProperty.name }}!
			</h1>
			<h1 v-else>
				¡Hola!
			</h1>
			<p
				v-if="userCommunity"
				class="text-cursive"
			>
				Bienvenido a {{ userCommunity?.name }}
			</p>
		</div>
	</TheHeader>

	<MainLayout>
		<div class="cta">
			<h2>¿Algo no va bien?</h2>
			<p class="text-cursive">
				Avisa de cualquier problema para que empecemos a trabajar en ello cuanto antes.
			</p>
			<LnxButton variant="danger" to="/issues/new" is-block>
				<LnxIcon icon="mdi:alert-circle-outline" />
				Dar aviso
			</LnxButton>
		</div>

		<!--		<section> -->
		<!--			<header> -->
		<!--				<h2>Últimas incidencias</h2> -->
		<!--				<LnxButton class="btn-all" to="/issues" mode="clear" variant="grayscale" size="small">Ver todas</LnxButton> -->
		<!--			</header> -->
		<!--		</section> -->

		<section>
			<header>
				<h2>Actividad reciente</h2>
				<LnxButton
					class="btn-all"
					to="/neighborhood/timeline"
					mode="clear"
					variant="grayscale"
					size="small"
					@click="scrollTop()"
				>
					Ver todo
				</LnxButton>
			</header>

			<ul class="events">
				<li v-for="event in events" :key="event.id">
					<EventCard :event small />
				</li>
			</ul>
		</section>
	</MainLayout>
</template>

<style lang="scss" scoped>
.greeting {
	p {
		color: var(--color-gray-6);
	}
}

.cta {
	border-radius: var(--lnx-radius-3);
	background: var(--color-primary);
	background: linear-gradient(165deg, var(--color-primary-light) 0%, var(--color-primary) 25%, var(--color-primary-dark) 100%);
	color: var(--color-primary-accent);
	padding: var(--lnx-spacing-5) var(--lnx-spacing-4);

	p {
		color: var(--color-primary-accent-alpha);
		margin-bottom: var(--lnx-spacing-4);
	}
}

section {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-1);

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;

		.btn-all {
			--lnx-button-color: var(--color-gray-6);
			text-transform: uppercase;
			font-size: var(--lnx-font-size-legal);
		}
	}

	.events {
		display: flex;
		flex-direction: column;
		gap: var(--lnx-spacing-2);

		li:last-child {
			mask-image: linear-gradient(to bottom, rgba(0,0,0,1), rgba(0,0,0,.2) 30%, rgba(0,0,0,0) 90%);
		}
	}
}
</style>
