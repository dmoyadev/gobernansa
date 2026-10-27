<script setup lang="ts">
import MainLayout from '@/shared/ui/MainLayout.vue';
import TheHeader from '@/shared/ui/TheHeader.vue';
import { useUserCommunity } from '../application/useUserCommunity.ts';

const { userCommunity } = useUserCommunity();
</script>

<template>
	<TheHeader>
		<h1>{{ userCommunity?.name }}</h1>
		<p>Información de utilidad de tu comunidad.</p>
	</TheHeader>
	<MainLayout />
</template>

<style lang="scss" scoped>
</style>
