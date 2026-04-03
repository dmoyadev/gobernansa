<script setup lang="ts">
import MainLayout from '../layouts/MainLayout.vue';

defineProps<{ id: string }>()
</script>

<template>
	<MainLayout>
		Issue Detail {{ id }}
	</MainLayout>
</template>

<style lang="scss" scoped>

</style>
