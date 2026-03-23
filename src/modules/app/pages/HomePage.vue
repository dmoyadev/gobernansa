<script setup lang="ts">
import { LnxButton } from 'lnxjs-components';
import useAuth from '../composables/useAuth';
import TheHeader from '../components/TheHeader.vue';

const { user, logout } = useAuth();
</script>

<template>
	<TheHeader />
	<main>
		Home
		<pre>{{ user }}</pre>
		<LnxButton @click="logout()" variant="danger">Cerrar sesión</LnxButton>
	</main>
</template>

<style lang="scss" scoped>
main {
	min-height: 100svh;
	padding: 16px;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 16px;

	pre {
		max-width: 100%;
		max-height: 200px;
		overflow: auto;
	}
}
</style>
