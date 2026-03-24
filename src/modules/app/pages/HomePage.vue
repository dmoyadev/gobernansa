<script setup lang="ts">
import { LnxButton, LnxIcon } from 'lnxjs-components';
import useAuth from '../composables/useAuth';
import TheHeader from '../components/TheHeader.vue';
import { useUserProperties } from '../composables/useUserProperties.ts';
import { useUserCommunity } from '../composables/useUserCommunity.ts';
import MainLayout from '../layouts/MainLayout.vue';

const { user } = useAuth();
const { userProperties } = useUserProperties();
const { userCommunity } = useUserCommunity();

const announcements = [
	{
		id: 1,
		title: 'Anuncio 1',
		content: 'Contenido del anuncio 1',
	},
	{
		id: 2,
		title: 'Anuncio 2',
		content: 'Contenido del anuncio 2',
	},
];
</script>

<template>
	<TheHeader />
	<MainLayout>
		<section v-if="announcements.length">
			<header>
				<h2>Anuncios</h2>
			</header>
		</section>

		<div class="cta">
			<h2>¿Algo no va bien?</h2>
			<p>Avisa de cualquier problema para que empecemos a arreglarlo.</p>
			<LnxButton variant="danger" to="/issues/new">
				<LnxIcon icon="mdi:alert-circle-outline" />
				Dar aviso
			</LnxButton>
		</div>

		<section>
			<header>
				<h2>Últimas incidencias</h2>
				<LnxButton to="/issues" mode="clear" variant="grayscale">Ver todas</LnxButton>
			</header>
		</section>

		<section>
			<header>
				<h2>Actividad reciente</h2>
				<LnxButton to="/timeline" mode="clear" variant="grayscale">Ver todo</LnxButton>
			</header>
		</section>

		<br>
		Propiedades:
		<pre>{{ userProperties }}</pre>
		Comunidad:
		<pre>{{ userCommunity }}</pre>
		Usuario:
		<pre>{{ user }}</pre>
	</MainLayout>
</template>

<style lang="scss" scoped>

</style>
