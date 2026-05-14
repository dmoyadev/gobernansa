<script setup lang="ts">
import TheHeader from '../components/TheHeader.vue';
import { useUserCommunity } from '../composables/useUserCommunity.ts';
import MainLayout from '../layouts/MainLayout.vue';

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
