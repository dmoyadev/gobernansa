<script setup lang="ts">
import { LnxButton } from 'lnxjs-components';
import useAuth from '../composables/useAuth';

const { logout } = useAuth();
</script>

<template>
	<main>
		Home
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
}
</style>
