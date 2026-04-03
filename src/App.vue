<script setup lang="ts">
import { RouterView } from 'vue-router';
import useAuth from './composables/useAuth.ts';
import useWebAppZoom from './composables/useWebAppZoom.ts';

useWebAppZoom();
useAuth();
</script>

<template>
	<RouterView :key="$route.fullPath" />
</template>

<style scoped></style>
