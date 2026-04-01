<script setup lang="ts">
import { RouterView } from 'vue-router';
import useAuth from './modules/app/composables/useAuth.ts';
import useWebAppZoom from './modules/app/composables/useWebAppZoom.ts';

useWebAppZoom();
useAuth();
</script>

<template>
	<RouterView :key="$route.fullPath" />
</template>

<style scoped></style>
