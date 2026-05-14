<script setup lang="ts">
import type { Ref } from 'vue';
import type { Community } from '../composables/useUserCommunity.ts';
import ChipsSelector from '../components/ChipsSelector.vue';
import IssueItem from '../components/IssueItem.vue';
import TheHeader from '../components/TheHeader.vue';
import { issuesCategories, issueStatus, useIssues } from '../composables/useIssues.ts';
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
	<TheHeader>
		<h1>Incidencias</h1>
		<p>Informa de problemas en la comunidad.</p>
	</TheHeader>

	<MainLayout>
		<ChipsSelector
			v-model="filters.status"
			:options="issueStatus"
			css-prefix="issue-status"
			name="status"
		/>

		<ChipsSelector
			v-model="filters.category"
			:options="issuesCategories"
			css-prefix="issue-cat"
			name="category"
		/>

		<ul class="issues">
			<li
				v-for="issue in issues" :key="issue.id"
				class="issue"
			>
				<IssueItem :issue />
			</li>
			<li v-if="!issues.length">
				{{ loading ? 'Cargando...' : 'No hay incidencias que mostrar.' }}
			</li>
		</ul>
	</MainLayout>
</template>

<style lang="scss" scoped>
.issues {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
}
</style>
