<script setup lang="ts">
import type { IssueStatus } from '@gobernansa/shared/domain/issue.ts';
import type { InboxIssue } from '../application/usePortfolio.ts';
import { issuesCategories, issueStatus } from '@gobernansa/shared/domain/issue.ts';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed, ref, watch } from 'vue';
import { useCommunities } from '@/modules/communities/application/useCommunities.ts';
import { ageInDays, loadInbox } from '../application/usePortfolio.ts';

const AGES = [
	{ value: 'new', label: 'Menos de 7 días', min: 0, max: 7 },
	{ value: 'month', label: '7–30 días', min: 7, max: 31 },
	{ value: 'old', label: 'Más de 30 días', min: 31, max: Infinity },
];
const PROPERTY_ZONE = 'property';

const { communities, loading: communitiesLoading, error: communitiesError } = useCommunities();

const statuses = ref<IssueStatus[]>(['open', 'in_progress']);
const communityId = ref('');
const age = ref('');
const zone = ref('');

const issues = ref<InboxIssue[]>([]);
const loading = ref(false);
const error = ref<Error>();

// Status is filtered by the query, the rest on what's loaded
async function load() {
	if (communitiesLoading.value) {
		return;
	}
	loading.value = true;
	error.value = undefined;
	try {
		issues.value = await loadInbox(communities.value, statuses.value);
	} catch (e) {
		error.value = e as Error;
	} finally {
		loading.value = false;
	}
}
watch([communitiesLoading, statuses], load, { immediate: true });

function zoneOf(issue: InboxIssue) {
	if (issue.location?.type === 'common_area') {
		return issue.location.reference ?? '';
	}
	return issue.location?.type === PROPERTY_ZONE ? PROPERTY_ZONE : '';
}

const zones = computed(() => [...new Set(issues.value.map(zoneOf).filter(value => value && value !== PROPERTY_ZONE))].sort((a, b) => a.localeCompare(b, 'es')));

const filtered = computed(() => {
	const range = AGES.find(option => option.value === age.value);
	return issues.value.filter(issue => (!communityId.value || issue.communityId === communityId.value)
		&& (!zone.value || zoneOf(issue) === zone.value)
		&& (!range || (ageInDays(issue) >= range.min && ageInDays(issue) < range.max)));
});

const now = Date.now();
const categories = Object.fromEntries(issuesCategories.map(category => [category.value, category]));
const statusLabels = Object.fromEntries(issueStatus.map(({ value, label }) => [value, label]));
</script>

<template>
	<header class="page-header">
		<LnxButton to="/" mode="clear" shape="circle" aria-label="Volver">
			<LnxIcon icon="lucide:arrow-left" />
		</LnxButton>
		<h1>Bandeja de incidencias</h1>
		<LnxButton class="reload" mode="outline" :is-loading="loading" @click="load">
			<LnxIcon icon="lucide:refresh-cw" />
			Recargar
		</LnxButton>
	</header>

	<fieldset class="chips">
		<legend class="sr-only">
			Estado
		</legend>
		<label v-for="option in issueStatus" :key="option.value">
			<input v-model="statuses" type="checkbox" class="sr-only" :value="option.value">
			<span>{{ option.label }}</span>
		</label>
	</fieldset>

	<div class="filters">
		<label>
			Comunidad
			<select v-model="communityId">
				<option value="">Todas</option>
				<option v-for="community in communities" :key="community.id" :value="community.id">{{ community.name }}</option>
			</select>
		</label>
		<label>
			Antigüedad
			<select v-model="age">
				<option value="">Cualquiera</option>
				<option v-for="option in AGES" :key="option.value" :value="option.value">{{ option.label }}</option>
			</select>
		</label>
		<label>
			Zona
			<select v-model="zone">
				<option value="">Todas</option>
				<option :value="PROPERTY_ZONE">Propiedades</option>
				<option v-for="name in zones" :key="name" :value="name">{{ name }}</option>
			</select>
		</label>
	</div>

	<section class="card">
		<p v-if="error || communitiesError" class="error" role="alert">
			No se han podido cargar: {{ (error ?? communitiesError)?.message }}
		</p>

		<span v-if="(loading || communitiesLoading) && !issues.length" class="skeleton-item" />
		<ul v-else-if="filtered.length" class="list">
			<li v-for="issue in filtered" :key="`${issue.communityId}/${issue.id}`">
				<RouterLink class="issue" :to="`/communities/${issue.communityId}/issues/${issue.id}`">
					<LnxIcon class="category" :icon="categories[issue.category]?.icon ?? 'lucide:triangle-alert'" :size="20" />
					<div class="what">
						<strong>{{ issue.title }}</strong>
						<small>
							{{ issue.communityName }} · {{ categories[issue.category]?.label }} · hace {{ ageInDays(issue, now) }} días
							<template v-if="zoneOf(issue)"> · {{ zoneOf(issue) === PROPERTY_ZONE ? 'Propiedad' : zoneOf(issue) }}</template>
						</small>
						<small v-if="issue.provider || issue.expectedAt">
							<template v-if="issue.provider">{{ issue.provider.name }}</template>
							<template v-if="issue.provider && issue.expectedAt"> · </template>
							<span v-if="issue.expectedAt" :class="{ late: issue.expectedAt.toMillis() < now }">
								Prevista {{ issue.expectedAt.toDate().toLocaleDateString('es') }}
							</span>
						</small>
					</div>
					<span class="badge" :style="{ '--status-color': `var(--color-issue-status-${issue.status})` }">{{ statusLabels[issue.status] }}</span>
				</RouterLink>
			</li>
		</ul>
		<p v-else class="hint">
			No hay incidencias con estos filtros.
		</p>
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

	.reload {
		margin-left: auto;
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

.filters {
	margin-bottom: var(--lnx-spacing-4);
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-3);

	label {
		display: flex;
		flex-direction: column;
		gap: var(--lnx-spacing-1);
		color: var(--color-gray-7);
		font-size: var(--lnx-font-size-small);
	}

	select {
		min-height: 36px;
		padding: 0 var(--lnx-spacing-2);
		border: 1px solid var(--color-gray-4);
		border-radius: var(--lnx-radius-2);
		background: var(--color-gray-0);
		color: var(--color-gray-9);
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

	.late {
		color: var(--color-secondary-accent);
		font-weight: var(--lnx-font-weight-bold);
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
