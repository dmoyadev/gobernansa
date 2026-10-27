<script setup lang="ts">
import { LnxButton } from 'lnxjs-components';
import MainLayout from '@/shared/ui/MainLayout.vue';
import useAuth from '../application/useAuth.ts';

const { logout } = useAuth();
</script>

<template>
	<MainLayout>
		Profile

		<LnxButton variant="danger" @click="logout()">
			Cerrar sesión
		</LnxButton>
	</MainLayout>
</template>

<style lang="scss" scoped>

</style>
