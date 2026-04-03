<script setup lang="ts">
import { LnxButton } from 'lnxjs-components';
import useAuth from '../composables/useAuth.ts';
import MainLayout from '../layouts/MainLayout.vue';

const { logout } = useAuth();
</script>

<template>
	<MainLayout>
		Profile

		<LnxButton @click="logout()" variant="danger">Cerrar sesión</LnxButton>
	</MainLayout>
</template>

<style lang="scss" scoped>

</style>
