<script setup lang="ts">
import type { IssueStatus } from '@gobernansa/shared/domain/issue.ts';
import type { LocationQuery, LocationQueryRaw } from 'vue-router';
import type { InboxIssue } from '../application/usePortfolio.ts';
import { errorMessage } from '@gobernansa/shared/application/errors.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { toCsv } from '@gobernansa/shared/domain/accounting.ts';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { findIssueCategory, getIssueCategories, issueStatus } from '@gobernansa/shared/domain/issue.ts';
import { LnxButton, LnxCheckbox, LnxIcon, LnxRadioGroup, LnxSelect } from 'lnxjs-components';
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BackButton from '@/app/ux/BackButton.vue';
import { downloadFile } from '@/app/ux/download.ts';
import { onRevalidate } from '@/app/ux/navigation.ts';
import { optimistic } from '@/app/ux/toast.ts';
import { useCommunities } from '@/modules/communities/application/useCommunities.ts';
import { changeStatuses, revertStatuses } from '@/modules/issues/application/useIssues.ts';
import { ageInDays, loadInbox } from '../application/usePortfolio.ts';

const AGES = [
	{ value: 'new', label: 'Menos de 7 días', min: 0, max: 7 },
	{ value: 'month', label: '7–30 días', min: 7, max: 31 },
	{ value: 'old', label: 'Más de 30 días', min: 31, max: Infinity },
];
const PROPERTY_ZONE = 'property';
const DEFAULT_STATUSES: IssueStatus[] = ['open', 'in_progress'];

const { communities, loading: communitiesLoading, error: communitiesError } = useCommunities();
const { user: me } = useAuth();

// The filters are in the URL, so a reload or a shared link opens the same list. Kept alive, it only follows its own
const route = useRoute();
const router = useRouter();
const path = route.path;
const query = computed<LocationQuery>(previous => route.path === path ? route.query : previous ?? {});

// Defaults are '' and left out of the URL. One replace for every change, as two in a row keep only the last
function setView(changes: Record<string, string>) {
	const next: LocationQueryRaw = { ...route.query };
	for (const [key, value] of Object.entries(changes)) {
		next[key] = value || undefined;
	}
	void router.replace({ query: next });
}

function param(key: string, values?: string[]) {
	return computed({
		get: () => {
			const value = query.value[key];
			return typeof value === 'string' && (!values || values.includes(value)) ? value : '';
		},
		set: value => setView({ [key]: value }),
	});
}

const communityId = param('community');
const age = param('age', AGES.map(({ value }) => value));
const zone = param('zone');
// Comma-separated, 'none' when none is ticked
const statuses = computed<IssueStatus[]>({
	get: () => {
		const value = query.value.status;
		return typeof value === 'string' ? issueStatus.map(({ value: status }) => status).filter(status => value.split(',').includes(status)) : DEFAULT_STATUSES;
	},
	set: value => setView({ status: !value.length ? 'none' : value.length === DEFAULT_STATUSES.length && DEFAULT_STATUSES.every(status => value.includes(status)) ? '' : value.join(',') }),
});
const isFiltered = computed(() => !!(query.value.status || communityId.value || age.value || zone.value));

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
watch([communitiesLoading, () => statuses.value.join(',')], load, { immediate: true });
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

// Status too, so what's moved to another status leaves the list without reading it again
const filtered = computed(() => {
	const range = AGES.find(option => option.value === age.value);
	return issues.value.filter(issue => statuses.value.includes(issue.status)
		&& (!communityId.value || issue.communityId === communityId.value)
		&& (!zone.value || zoneOf(issue) === zone.value)
		&& (!range || (ageInDays(issue) >= range.min && ageInDays(issue) < range.max)));
});

// Each issue's, among its community's categories
function categoryOf(issue: { communityId: string; category: string }) {
	return findIssueCategory(getIssueCategories(communities.value.find(community => community.id === issue.communityId)), issue.category);
}
const statusLabels = Object.fromEntries(issueStatus.map(({ value, label }) => [value, label]));

const keyOf = (issue: InboxIssue) => `${issue.communityId}/${issue.id}`;
const selected = ref(new Set<string>());
const selectedIssues = computed(() => filtered.value.filter(issue => selected.value.has(keyOf(issue))));

function select(list: InboxIssue[], on: boolean) {
	const next = new Set(selected.value);
	for (const issue of list) {
		if (on) {
			next.add(keyOf(issue));
		} else {
			next.delete(keyOf(issue));
		}
	}
	selected.value = next;
}

// The list isn't live, so it's changed here as well, and put back if the server says no or it's undone
function setLocal(changes: { communityId: string; id: string; status: IssueStatus }[]) {
	const byKey = new Map(changes.map(change => [`${change.communityId}/${change.id}`, change.status]));
	issues.value = issues.value.map(issue => byKey.has(keyOf(issue)) ? { ...issue, status: byKey.get(keyOf(issue))! } : issue);
}

function changeSelected(status: IssueStatus) {
	const list = selectedIssues.value.filter(issue => issue.status !== status);
	selected.value = new Set();
	if (!me.value || !list.length) {
		return;
	}
	const author = me.value;
	const action = changeStatuses(author, list, status);
	setLocal(list.map(issue => ({ ...issue, status })));
	const label = statusLabels[status];
	void optimistic(action, {
		done: list.length === 1 ? `Incidencia pasada a ${label}` : `${list.length} incidencias pasadas a ${label}`,
		failed: 'No se ha podido cambiar el estado',
		revert: async () => {
			const changes = await action;
			setLocal(changes);
			return revertStatuses(author, changes);
		},
		onError: () => setLocal(list),
	});
}

function exportCsv() {
	const content = toCsv([
		['Comunidad', 'Título', 'Categoría', 'Estado', 'Zona', 'Días', 'Proveedor', 'Prevista'],
		...filtered.value.map(issue => [
			issue.communityName,
			issue.title,
			categoryOf(issue).name,
			statusLabels[issue.status],
			zoneOf(issue) === PROPERTY_ZONE ? 'Propiedad' : zoneOf(issue),
			String(ageInDays(issue, now.value)),
			issue.provider?.name ?? '',
			issue.expectedAt ? toDateString(issue.expectedAt.toDate()) : '',
		]),
	]);
	downloadFile(`incidencias-${toDateString(new Date())}.csv`, content, 'text/csv;charset=utf-8');
}
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

	<LnxRadioGroup v-model="statuses" class="statuses" :options="issueStatus" multiple hide-legend>
		Estado
	</LnxRadioGroup>

	<div class="filters">
		<LnxSelect
			v-model.convert="communityId"
			:options="communityOptions"
			:convert-fn="option => option.value"
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
		<div v-if="error || communitiesError" class="error" role="alert">
			<p>No se han podido cargar. {{ errorMessage(error ?? communitiesError) }}</p>
			<LnxButton mode="outline" class="lnx-size-small" @click="load">
				Reintentar
			</LnxButton>
		</div>

		<div v-if="filtered.length" class="toolbar">
			<LnxCheckbox
				:model-value="filtered.every(issue => selected.has(keyOf(issue)))"
				:indeterminate="!!selectedIssues.length && selectedIssues.length < filtered.length"
				@update:model-value="value => select(filtered, !!value)"
			>
				<span class="tabular">{{ filtered.length }} {{ filtered.length === 1 ? 'incidencia' : 'incidencias' }}</span>
			</LnxCheckbox>
			<LnxButton mode="clear" class="lnx-size-small" @click="exportCsv">
				<LnxIcon icon="lucide:download" />
				Exportar CSV
			</LnxButton>
		</div>

		<ul v-if="(loading || communitiesLoading) && !issues.length" class="list">
			<li v-for="width in ROW_WIDTHS" :key="width" class="issue">
				<span class="lnx-skeleton lnx-skeleton--circle" />
				<div class="what">
					<span class="lnx-skeleton" :style="{ width: `${width}%` }" />
					<span class="lnx-skeleton lnx-skeleton--small" :style="{ width: `${width - 15}%` }" />
				</div>
				<span class="lnx-skeleton lnx-skeleton--small" style="width: 64px" />
			</li>
		</ul>
		<TransitionGroup v-else-if="filtered.length" tag="ul" name="row" class="list lnx-appear">
			<li v-for="issue in filtered" :key="keyOf(issue)" class="row">
				<LnxCheckbox :model-value="selected.has(keyOf(issue))" @update:model-value="value => select([issue], !!value)">
					<span class="sr-only">Seleccionar «{{ issue.title }}»</span>
				</LnxCheckbox>
				<RouterLink class="issue ux-row" :to="`/communities/${issue.communityId}/issues/${issue.id}`">
					<LnxIcon class="category" :icon="categoryOf(issue).icon" :size="20" />
					<div class="what">
						<strong :style="{ viewTransitionName: `issue-${issue.id}` }">{{ issue.title }}</strong>
						<small class="tabular">
							{{ issue.communityName }} · {{ categoryOf(issue).name }} · hace {{ ageInDays(issue, now) }} días
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
		<div v-else-if="!error && !communitiesError" class="empty">
			<p class="hint">
				No hay incidencias con estos filtros.
			</p>
			<LnxButton v-if="isFiltered" mode="clear" class="lnx-size-small" @click="setView({ status: '', community: '', age: '', zone: '' })">
				Limpiar filtros
			</LnxButton>
		</div>

		<div v-if="selectedIssues.length" class="bulk lnx-appear">
			<strong class="tabular">{{ selectedIssues.length }} {{ selectedIssues.length === 1 ? 'seleccionada' : 'seleccionadas' }}</strong>
			<LnxButton mode="clear" class="lnx-size-small" @click="selected = new Set()">
				Quitar selección
			</LnxButton>
			<span>Pasar a</span>
			<LnxButton
				v-for="option in issueStatus"
				:key="option.value"
				mode="outline"
				class="lnx-size-small"
				:disabled="selectedIssues.every(issue => issue.status === option.value)"
				@click="changeSelected(option.value)"
			>
				{{ option.label }}
			</LnxButton>
		</div>
	</section>
</template>

<style lang="scss" scoped>
.page-header {
	h1 {
		font-size: var(--lnx-font-size-title);
	}

	.reload {
		margin-left: auto;
	}
}

.card {
	align-items: stretch;
}

.error {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--lnx-spacing-2);
}

.toolbar,
.empty {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: var(--lnx-spacing-2);
}

.bulk {
	position: sticky;
	bottom: 0;
	margin-top: var(--lnx-spacing-3);
	padding: var(--lnx-spacing-3) 0;
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--lnx-spacing-2);
	background: color-mix(in srgb, var(--color-gray-0) 90%, transparent);
	backdrop-filter: blur(8px);
	box-shadow: 0 -1px 0 var(--color-gray-3);

	> span {
		margin-left: auto;
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
	}
}

.statuses {
	margin-bottom: var(--lnx-spacing-4);
}

.filters {
	margin-bottom: var(--lnx-spacing-4);
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-3);

	> * {
		width: 220px;
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

.row {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-3);

	.issue {
		flex: 1;
		min-width: 0;
	}
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
</style>
