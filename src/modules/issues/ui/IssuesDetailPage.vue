<script setup lang="ts">
import MainLayout from '@/shared/ui/MainLayout.vue';
import { useIssue } from '../application/useIssue.ts';

const props = defineProps<{ id: string }>();

const {
	data,
	loading,
	error,
} = useIssue(() => props.id);
</script>

<template>
	<MainLayout>
		Issue Detail {{ id }}
		<br>loading: {{ loading }}
		<br>error: {{ error }}
		<br>data: {{ data }}
	</MainLayout>
</template>

<style lang="scss" scoped>

</style>
