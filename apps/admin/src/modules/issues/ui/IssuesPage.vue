<script setup lang="ts">
import type { IssueStatus } from '@gobernansa/shared/domain/issue.ts';
import { issuesCategories, issueStatus } from '@gobernansa/shared/domain/issue.ts';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { ref } from 'vue';
import { useIssues } from '../application/useIssues.ts';

const props = defineProps<{ id: string }>();

const PAGE_SIZE = 20;

const status = ref<IssueStatus>();
const max = ref(PAGE_SIZE);
const { data: issues, pending, error } = useIssues(props.id, status, max);

function filter(value?: IssueStatus) {
	status.value = value;
	max.value = PAGE_SIZE;
}

const categories = Object.fromEntries(issuesCategories.map(category => [category.value, category]));
const statusLabels = Object.fromEntries(issueStatus.map(({ value, label }) => [value, label]));
</script>

<template>
	<header class="page-header">
		<LnxButton :to="`/communities/${id}`" mode="clear" shape="circle" aria-label="Volver a la comunidad">
			<LnxIcon icon="lucide:arrow-left" />
		</LnxButton>
		<h1>Incidencias</h1>
	</header>

	<fieldset class="chips">
		<legend class="sr-only">
			Estado
		</legend>
		<label>
			<input type="radio" class="sr-only" name="status" :checked="!status" @change="filter()">
			<span>Todas</span>
		</label>
		<label v-for="option in issueStatus" :key="option.value">
			<input type="radio" class="sr-only" name="status" :checked="status === option.value" @change="filter(option.value)">
			<span>{{ option.label }}</span>
		</label>
	</fieldset>

	<section class="card">
		<p v-if="error" class="error" role="alert">
			No se han podido cargar: {{ error.message }}
		</p>

		<span v-if="pending && !issues.length" class="skeleton-item" />
		<ul v-else-if="issues.length" class="list">
			<li v-for="issue in issues" :key="issue.id">
				<RouterLink class="issue" :to="`/communities/${id}/issues/${issue.id}`">
					<LnxIcon class="category" :icon="categories[issue.category]?.icon ?? 'lucide:triangle-alert'" :size="20" />
					<div class="what">
						<strong>{{ issue.title }}</strong>
						<small>
							{{ categories[issue.category]?.label }}
							<template v-if="issue.createdAt"> · {{ issue.createdAt.toDate().toLocaleDateString('es') }}</template>
							· {{ issue.votesScore }} votos · {{ issue.commentsCount ?? 0 }} comentarios
							<template v-if="issue.provider"> · {{ issue.provider.name }}</template>
						</small>
					</div>
					<span class="badge" :style="{ '--status-color': `var(--color-issue-status-${issue.status})` }">{{ statusLabels[issue.status] }}</span>
				</RouterLink>
			</li>
		</ul>
		<p v-else class="hint">
			No hay incidencias{{ status ? ' con este estado' : '' }}.
		</p>

		<LnxButton
			v-if="issues.length >= max"
			mode="outline"
			:is-loading="pending"
			@click="max += PAGE_SIZE"
		>
			Cargar más
		</LnxButton>
	</section>
</template>

<style lang="scss" scoped>
.page-header {
	margin-bottom: var(--lnx-spacing-5);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);

	h1 {
		font-size: var(--lnx-font-size-title);
	}
}

.card {
	padding: var(--lnx-spacing-5);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;
	display: flex;
	flex-direction: column;
	align-items: stretch;
	gap: var(--lnx-spacing-4);
}

.chips {
	margin-bottom: var(--lnx-spacing-4);
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-1);

	span {
		display: inline-flex;
		align-items: center;
		min-height: 36px;
		padding: 0 var(--lnx-spacing-3);
		border: 1px solid var(--color-gray-4);
		border-radius: var(--lnx-radius-2);
		background: var(--color-gray-0);
		color: var(--color-gray-7);
		font-size: var(--lnx-font-size-small);
		cursor: pointer;
	}

	input:checked + span {
		border-color: var(--color-primary);
		background: var(--color-primary);
		color: var(--color-primary-accent);
	}

	input:focus-visible + span {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
}

.list {
	display: flex;
	flex-direction: column;

	li + li {
		border-top: 1px solid var(--color-gray-3);
	}
}

.issue {
	padding: var(--lnx-spacing-3) 0;
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto;
	align-items: center;
	gap: var(--lnx-spacing-3);
	color: var(--color-gray-9);
	text-decoration: none;

	&:hover strong {
		color: var(--color-primary);
	}

	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}

	.category {
		color: var(--color-gray-6);
	}
}

.what {
	display: flex;
	flex-direction: column;
	min-width: 0;

	strong {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	small {
		color: var(--color-gray-6);
	}
}

.badge {
	padding: 2px var(--lnx-spacing-2);
	border-radius: var(--lnx-radius-5);
	background: var(--status-color);
	color: var(--color-gray-0);
	font-size: var(--lnx-font-size-legal);
	font-weight: var(--lnx-font-weight-bold);
	white-space: nowrap;
}

.hint {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}
</style>
