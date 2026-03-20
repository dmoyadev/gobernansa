<script setup lang="ts">
import { RouterView } from 'vue-router';
import useWebAppZoom from './modules/app/composables/useWebAppZoom.ts';
import useAuth from './modules/app/composables/useAuth.ts';

useWebAppZoom();
useAuth();
</script>

<template>
	<RouterView :key="$route.fullPath" />
</template>

<style scoped></style>
