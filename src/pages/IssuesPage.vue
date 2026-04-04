<script setup lang="ts">
import type { Ref } from 'vue';
import type { Community } from '../composables/useUserCommunity.ts';
import { useIssues } from '../composables/useIssues.ts';
import { useUserCommunity } from '../composables/useUserCommunity.ts';
import MainLayout from '../layouts/MainLayout.vue';

const { userCommunity } = useUserCommunity();
const {
	issues,
	loading,
	hasMore,
	filters,
	sortingField,
} = useIssues(userCommunity as Ref<Community>);
</script>

<template>
	<MainLayout>
		Issues

		issues:
		<pre>{{ issues }}</pre>
		<br>
		loading:
		<pre>{{ loading }}</pre>
		<br>
		hasMore:
		<pre>{{ hasMore }}</pre>
		<br>
		filters:
		<pre>{{ filters }}</pre>
		<br>
		sortingField:
		<pre>{{ sortingField }}</pre>
		<br>
	</MainLayout>
</template>

<style lang="scss" scoped>

</style>
