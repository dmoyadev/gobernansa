<script setup lang="ts">
import { useIssue } from '../composables/useIssue.ts';
import MainLayout from '../layouts/MainLayout.vue';

const props = defineProps<{ id: string }>();

const {
	data,
	loading,
	error,
} = useIssue(props.id);
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
