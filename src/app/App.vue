<script setup lang="ts">
import { RouterView } from 'vue-router';
import useAuth from '@/modules/auth/application/useAuth.ts';
import useWebAppZoom from './useWebAppZoom.ts';

useWebAppZoom();
useAuth();
</script>

<template>
	<RouterView :key="$route.fullPath" />
</template>

<style scoped></style>
