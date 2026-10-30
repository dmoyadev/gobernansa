<script setup lang="ts">
import type { IssueStatus } from '@gobernansa/shared/domain/issue.ts';
import type { InboxIssue } from '../application/usePortfolio.ts';
import { issuesCategories, issueStatus } from '@gobernansa/shared/domain/issue.ts';
import { LnxButton, LnxIcon, LnxSelect } from 'lnxjs-components';
import { computed, ref, watch } from 'vue';
import BackButton from '@/app/ux/BackButton.vue';
import { onRevalidate } from '@/app/ux/navigation.ts';
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
const now = ref(Date.now());

// Status is filtered by the query, the rest on what's loaded
async function load() {
	if (communitiesLoading.value) {
		return;
	}
	loading.value = true;
	error.value = undefined;
	try {
		issues.value = await loadInbox(communities.value, statuses.value);
		now.value = Date.now();
	} catch (e) {
		error.value = e as Error;
	} finally {
		loading.value = false;
	}
}
watch([communitiesLoading, statuses], load, { immediate: true });
// Coming back shows the last list while it's read again
onRevalidate(load);
const ROW_WIDTHS = [65, 45, 75, 55];

function zoneOf(issue: InboxIssue) {
	if (issue.location?.type === 'common_area') {
		return issue.location.reference ?? '';
	}
	return issue.location?.type === PROPERTY_ZONE ? PROPERTY_ZONE : '';
}

const communityOptions = computed(() => [{ value: '', label: 'Todas' }, ...communities.value.map(community => ({ value: community.id, label: community.name }))]);
const ageOptions = [{ value: '', label: 'Cualquiera' }, ...AGES];
const zones = computed(() => [...new Set(issues.value.map(zoneOf).filter(value => value && value !== PROPERTY_ZONE))].sort((a, b) => a.localeCompare(b, 'es')));
const zoneOptions = computed(() => [{ value: '', label: 'Todas' }, { value: PROPERTY_ZONE, label: 'Propiedades' }, ...zones.value.map(name => ({ value: name, label: name }))]);

const filtered = computed(() => {
	const range = AGES.find(option => option.value === age.value);
	return issues.value.filter(issue => (!communityId.value || issue.communityId === communityId.value)
		&& (!zone.value || zoneOf(issue) === zone.value)
		&& (!range || (ageInDays(issue) >= range.min && ageInDays(issue) < range.max)));
});

const categories = Object.fromEntries(issuesCategories.map(category => [category.value, category]));
const statusLabels = Object.fromEntries(issueStatus.map(({ value, label }) => [value, label]));
</script>

<template>
	<header class="page-header">
		<BackButton to="/" label="Volver" />
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
		<LnxSelect
			v-model.convert="communityId"
			:options="communityOptions"
			:convert-fn="option => option.value"
			search-placeholder-text="Buscar..."
			placeholder="Todas"
		>
			Comunidad
			<template #option="{ option }">
				{{ option.label }}
			</template>
			<template #optionInput="{ value }">
				{{ communityOptions.find(option => option.value === value)?.label }}
			</template>
		</LnxSelect>
		<LnxSelect
			v-model.convert="age"
			:options="ageOptions"
			:convert-fn="option => option.value"
			search-placeholder-text="Buscar..."
			placeholder="Cualquiera"
		>
			Antigüedad
			<template #option="{ option }">
				{{ option.label }}
			</template>
			<template #optionInput="{ value }">
				{{ ageOptions.find(option => option.value === value)?.label }}
			</template>
		</LnxSelect>
		<LnxSelect
			v-model.convert="zone"
			:options="zoneOptions"
			:convert-fn="option => option.value"
			search-placeholder-text="Buscar..."
			placeholder="Todas"
		>
			Zona
			<template #option="{ option }">
				{{ option.label }}
			</template>
			<template #optionInput="{ value }">
				{{ zoneOptions.find(option => option.value === value)?.label }}
			</template>
		</LnxSelect>
	</div>

	<section class="card" :aria-busy="(loading || communitiesLoading) && !issues.length">
		<p v-if="error || communitiesError" class="error" role="alert">
			No se han podido cargar: {{ (error ?? communitiesError)?.message }}
		</p>

		<ul v-if="(loading || communitiesLoading) && !issues.length" class="list">
			<li v-for="width in ROW_WIDTHS" :key="width" class="issue">
				<span class="skeleton-item skeleton-item--icon" />
				<div class="what">
					<span class="skeleton-item" :style="{ width: `${width}%` }" />
					<span class="skeleton-item skeleton-item--small" :style="{ width: `${width - 15}%` }" />
				</div>
				<span class="skeleton-item skeleton-item--small" style="width: 64px" />
			</li>
		</ul>
		<TransitionGroup v-else-if="filtered.length" tag="ul" name="row" class="list ux-appear">
			<li v-for="issue in filtered" :key="`${issue.communityId}/${issue.id}`">
				<RouterLink class="issue ux-row" :to="`/communities/${issue.communityId}/issues/${issue.id}`">
					<LnxIcon class="category" :icon="categories[issue.category]?.icon ?? 'lucide:triangle-alert'" :size="20" />
					<div class="what">
						<strong :style="{ viewTransitionName: `issue-${issue.id}` }">{{ issue.title }}</strong>
						<small class="tabular">
							{{ issue.communityName }} · {{ categories[issue.category]?.label }} · hace {{ ageInDays(issue, now) }} días
							<template v-if="zoneOf(issue)"> · {{ zoneOf(issue) === PROPERTY_ZONE ? 'Propiedad' : zoneOf(issue) }}</template>
						</small>
						<small v-if="issue.provider || issue.expectedAt" class="tabular">
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
		</TransitionGroup>
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
		transition: background-color var(--duration) var(--ease-out), border-color var(--duration) var(--ease-out), color var(--duration) var(--ease-out), scale var(--duration-fast) var(--ease-out);
	}

	label:hover span {
		background: var(--color-gray-1);
	}

	label:active span {
		scale: var(--press-scale);
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

	> * {
		width: 220px;
	}

	/* With no filter the placeholder («Todas») is a real choice, not an empty field */
	:deep(.select:not(:has(.input-content)) label input::placeholder) {
		color: var(--color-gray-9);
	}
}

.list {
	position: relative;
	display: flex;
	flex-direction: column;

	li + li {
		border-top: 1px solid var(--color-gray-3);
	}
}

.row-move,
.row-enter-active,
.row-leave-active {
	transition: opacity var(--duration) var(--ease-out), translate var(--duration) var(--ease-out);
}

.row-enter-from,
.row-leave-to {
	opacity: 0;
	translate: 0 4px;
}

// Out of the flow while it leaves, so the rest move up at once
.row-leave-active {
	position: absolute;
	width: 100%;
}

.issue {
	margin: 0 calc(-1 * var(--lnx-spacing-2));
	padding: var(--lnx-spacing-3) var(--lnx-spacing-2);
	border-radius: var(--lnx-radius-2);
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
