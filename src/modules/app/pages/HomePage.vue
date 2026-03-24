<script setup lang="ts">
import { LnxButton } from 'lnxjs-components';
import useAuth from '../composables/useAuth';
import TheHeader from '../components/TheHeader.vue';
import { useUserProperties } from '../composables/useUserProperties.ts';
import { useUserCommunity } from '../composables/useUserCommunity.ts';

const { user, logout } = useAuth();
const { userProperties } = useUserProperties();
const { userCommunity } = useUserCommunity();
</script>

<template>
	<TheHeader />
	<main>
		Home
		<br>
		Propiedades:
		<pre>{{ userProperties }}</pre>
		Comunidad:
		<pre>{{ userCommunity }}</pre>
		Usuario:
		<pre>{{ user }}</pre>
		<LnxButton @click="logout()" variant="danger">Cerrar sesión</LnxButton>
	</main>
</template>

<style lang="scss" scoped>
main {
	min-height: 100svh;
	padding: 16px 16px calc(16px + var(--tab-height));
	display: flex;
	flex-direction: column;
	gap: 16px;

	pre {
		max-width: 100%;
		max-height: 200px;
		overflow: auto;
	}
}
</style>
