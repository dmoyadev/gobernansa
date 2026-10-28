<script setup lang="ts">
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { RouterView } from 'vue-router';
import useWebAppZoom from './useWebAppZoom.ts';

useWebAppZoom();
useAuth();
</script>

<template>
	<RouterView :key="$route.fullPath" />
</template>

<style scoped></style>
