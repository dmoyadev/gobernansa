<script setup lang="ts">
import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { Issue, IssueStatus } from '@gobernansa/shared/domain/issue.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { getCommonAreas } from '@gobernansa/shared/domain/community.ts';
import { findIssueCategory, getIssueAge, getIssueCategories, issueCategoryStyle, issueLocationTypes, issueStatus } from '@gobernansa/shared/domain/issue.ts';
import LnxTextarea from '@gobernansa/shared/ui/LnxTextarea.vue';
import { LnxButton, LnxIcon, LnxInput } from 'lnxjs-components';
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import BackButton from '@/app/ux/BackButton.vue';
import Kbd from '@/app/ux/Kbd.vue';
import { newId } from '@/app/ux/navigation.ts';
import NewButton from '@/app/ux/NewButton.vue';
import { useNewForm } from '@/app/ux/newForm.ts';
import { useShortcut } from '@/app/ux/shortcuts.ts';
import { optimistic } from '@/app/ux/toast.ts';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { createIssue, useIssues } from '../application/useIssues.ts';
import IssueAge from './IssueAge.vue';

const props = defineProps<{ id: string }>();

const PAGE_SIZE = 20;

const router = useRouter();
const { user: me } = useAuth();

const status = ref<IssueStatus>();
const max = ref(PAGE_SIZE);
const { data: issues, pending, error } = useIssues(props.id, status, max);

function filter(value?: IssueStatus) {
	status.value = value;
	max.value = PAGE_SIZE;
}

// Its categories and common areas, as neighbours see them. Read once with the page, the defaults and a typed place until then
const community = ref<Community>();
loadCommunity(props.id).then(loaded => community.value = loaded, () => {});
const categories = computed(() => getIssueCategories(community.value));
const areas = computed(() => community.value && getCommonAreas(community.value));
const statusLabels = Object.fromEntries(issueStatus.map(({ value, label }) => [value, label]));
const thisYear = new Date().getFullYear();

function openedOn(issue: Issue) {
	const date = issue.createdAt.toDate();
	return date.toLocaleDateString('es', { day: 'numeric', month: 'short', ...(date.getFullYear() === thisYear ? {} : { year: 'numeric' }) });
}

function openedAgo(issue: Issue) {
	const { days } = getIssueAge(issue);
	return days < 1 ? 'hoy' : days < 2 ? 'ayer' : `hace ${days} días`;
}

// Each form brings the new issue's id, so sending it again can't duplicate it
function emptyForm() {
	return { id: newId(), title: '', description: '', category: categories.value[0]?.id ?? '', place: '' as '' | keyof typeof issueLocationTypes, reference: '' };
}

const form = ref(emptyForm());
const formElement = ref<HTMLFormElement>();
const { open, show, close } = useNewForm(formElement);

// Fresh each time, with the community's categories once they've loaded
function openForm() {
	form.value = emptyForm();
	void show();
}

function defaultTitle(categoryId: string) {
	const category = findIssueCategory(categories.value, categoryId);
	return category.defaultTitle || category.name;
}

// The issue is in the local cache at once, so it opens straight away. If the server rejects it, back to the form as it was
function create() {
	const values = form.value;
	close();
	const { id: issueId, title, description, category, place, reference } = values;
	const link = `/communities/${props.id}/issues/${issueId}`;
	void optimistic(createIssue(props.id, me.value!.id, issueId, {
		title: title.trim() || defaultTitle(category),
		description: description.trim(),
		category,
		...(place ? { location: { type: place, reference: reference.trim() } } : {}),
	}), {
		done: 'Incidencia creada',
		failed: 'No se ha podido crear',
		onError: () => {
			form.value = values;
			open.value = true;
			if (router.currentRoute.value.path === link) {
				void router.replace(`/communities/${props.id}/issues`);
			}
		},
	});
	void router.push(link);
}

useShortcut('mod+enter', create, 'Crear la incidencia', () => open.value);
</script>

<template>
	<header class="page-header">
		<BackButton :to="`/communities/${id}`" label="Volver a la comunidad" />
		<h1>Incidencias</h1>
		<LnxButton :to="`/communities/${id}/issue-categories`" mode="outline">
			<LnxIcon icon="lucide:tags" />
			Categorías
		</LnxButton>
		<NewButton v-if="!open" label="Nueva incidencia" @click="openForm()" />
	</header>

	<form v-if="open" ref="formElement" class="card new ux-appear" @submit.prevent="create()">
		<h2>Nueva incidencia</h2>
		<fieldset class="categories">
			<legend>Categoría</legend>
			<label
				v-for="category in categories"
				:key="category.id"
				:style="issueCategoryStyle(category)"
			>
				<input v-model="form.category" type="radio" class="sr-only" name="category" :value="category.id" required>
				<span><LnxIcon :icon="category.icon" :size="16" />{{ category.name }}</span>
			</label>
		</fieldset>
		<div class="fields">
			<LnxInput v-model="form.title" class="wide" :placeholder="defaultTitle(form.category)">
				Título
			</LnxInput>
			<fieldset class="chips wide">
				<legend>Dónde</legend>
				<label>
					<input v-model="form.place" type="radio" class="sr-only" name="place" value="">
					<span>Sin indicar</span>
				</label>
				<label v-for="(label, value) in issueLocationTypes" :key="value">
					<input v-model="form.place" type="radio" class="sr-only" name="place" :value="value">
					<span>{{ label }}</span>
				</label>
			</fieldset>
			<fieldset v-if="form.place === 'common_area' && areas?.length" class="chips wide">
				<legend>Zona común</legend>
				<label v-for="area in areas" :key="area.id">
					<input v-model="form.reference" type="radio" class="sr-only" name="area" :value="area.name">
					<span><LnxIcon :icon="area.icon" :size="16" />{{ area.name }}</span>
				</label>
			</fieldset>
			<LnxInput v-if="form.place" v-model="form.reference" :placeholder="form.place === 'property' ? 'Portal 2, 3ºB' : 'Garaje, planta -1'">
				Referencia
			</LnxInput>
			<LnxTextarea v-model="form.description" rows="3" class="wide">
				Descripción
			</LnxTextarea>
		</div>
		<footer class="form-actions">
			<LnxButton type="button" mode="clear" @click="close()">
				Cancelar
				<Kbd combo="escape" />
			</LnxButton>
			<LnxButton type="submit">
				<LnxIcon icon="lucide:plus" />
				Crear incidencia
				<Kbd combo="mod+enter" />
			</LnxButton>
		</footer>
	</form>

	<fieldset class="chips filters">
		<legend class="sr-only">
			Estado
		</legend>
		<label>
			<input type="radio" class="sr-only" name="status" :checked="!status" @change="filter()">
			<span>Todas</span>
		</label>
		<label v-for="option in issueStatus" :key="option.value">
			<input type="radio" class="sr-only" name="status" :checked="status === option.value" @change="filter(option.value)">
			<span><i :style="{ background: `var(--color-issue-status-${option.value})` }" />{{ option.label }}</span>
		</label>
	</fieldset>

	<section class="card list-card" :aria-busy="pending && !issues.length">
		<p v-if="error" class="error" role="alert">
			No se han podido cargar: {{ error.message }}
		</p>

		<ul v-if="pending && !issues.length" class="list" aria-hidden="true">
			<li v-for="width in [62, 45, 74, 38, 56]" :key="width" class="issue">
				<span class="skeleton-item skeleton-item--big-square tile" />
				<div class="what">
					<span class="skeleton-item" :style="{ width: `${width}%` }" />
					<span class="skeleton-item skeleton-item--small" :style="{ width: `${width / 2 + 10}%` }" />
				</div>
				<span class="skeleton-item skeleton-item--small" style="width: 56px" />
				<span class="skeleton-item skeleton-item--small" style="width: 80px" />
				<span class="skeleton-item skeleton-item--small badge-skeleton" />
			</li>
		</ul>
		<TransitionGroup v-else-if="issues.length" tag="ul" name="row" class="list ux-appear">
			<li v-for="issue in issues" :key="issue.id">
				<RouterLink
					class="issue ux-row"
					:to="`/communities/${id}/issues/${issue.id}`"
					:style="{
						...issueCategoryStyle(findIssueCategory(categories, issue.category)),
						'--status-color': `var(--color-issue-status-${issue.status})`,
					}"
				>
					<span class="tile">
						<LnxIcon :icon="findIssueCategory(categories, issue.category).icon" :size="18" />
					</span>
					<div class="what">
						<strong :style="{ viewTransitionName: `issue-${issue.id}` }">{{ issue.title }}</strong>
						<small>
							<span class="category">{{ findIssueCategory(categories, issue.category).name }}</span>
							<span v-if="issue.location">
								<LnxIcon icon="lucide:map-pin" :size="12" />
								{{ issue.location.reference || issueLocationTypes[issue.location.type] }}
							</span>
							<span v-if="issue.provider">
								<LnxIcon icon="lucide:hard-hat" :size="12" />
								{{ issue.provider.name }}
							</span>
							<span v-if="issue.insuranceClaim">
								<LnxIcon icon="lucide:shield" :size="12" />
								Seguro
							</span>
						</small>
					</div>
					<div class="counters">
						<span :title="`${issue.votesScore} votos`">
							<LnxIcon icon="lucide:thumbs-up" :size="14" />{{ issue.votesScore }}
						</span>
						<span :title="`${issue.commentsCount ?? 0} comentarios`">
							<LnxIcon icon="lucide:message-circle" :size="14" />{{ issue.commentsCount ?? 0 }}
						</span>
					</div>
					<div v-if="issue.createdAt" class="opened">
						<span>
							<time :datetime="issue.createdAt.toDate().toISOString()">{{ openedOn(issue) }}</time>
							<small>{{ openedAgo(issue) }}</small>
						</span>
						<IssueAge :issue="issue" />
					</div>
					<span class="badge">{{ statusLabels[issue.status] }}</span>
				</RouterLink>
			</li>
		</TransitionGroup>
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
		flex: 1;
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

	h2 {
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
		color: var(--color-gray-6);
		text-transform: uppercase;
		letter-spacing: .04em;
	}
}

.new {
	margin-bottom: var(--lnx-spacing-5);

	legend {
		margin-bottom: var(--lnx-spacing-2);
		color: var(--color-gray-7);
		font-size: var(--lnx-font-size-small);
	}
}

.list-card {
	padding: var(--lnx-spacing-2) 0;
	gap: var(--lnx-spacing-2);
	overflow: hidden;

	> :not(.list) {
		margin: 0 var(--lnx-spacing-4);
	}
}

.categories {
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-1);

	span {
		display: inline-flex;
		align-items: center;
		gap: var(--lnx-spacing-1);
		min-height: 36px;
		padding: 0 var(--lnx-spacing-3);
		border: 1px solid var(--color-gray-3);
		border-radius: var(--lnx-radius-2);
		color: var(--cat-color);
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
		cursor: pointer;
		transition: background-color var(--duration) var(--ease-out), border-color var(--duration) var(--ease-out), box-shadow var(--duration) var(--ease-out), scale var(--duration-fast) var(--ease-out);
	}

	label:hover input:not(:checked) + span {
		background: var(--cat-color-bg);
	}

	label:active span {
		scale: var(--press-scale);
	}

	input:checked + span {
		border-color: var(--cat-color);
		background: var(--cat-color-bg);
		box-shadow: inset 0 0 0 1px var(--cat-color);
	}

	input:focus-visible + span {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
}

.chips {
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-1);

	span {
		display: inline-flex;
		align-items: center;
		gap: var(--lnx-spacing-2);
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

	label:hover input:not(:checked) + span {
		background: var(--color-gray-1);
	}

	label:active span {
		scale: var(--press-scale);
	}

	i {
		width: 8px;
		height: 8px;
		border-radius: 50%;
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
}

.list {
	position: relative;

	li + li {
		border-top: 1px solid var(--color-gray-2);
	}
}

// Filtering: rows that stay slide into place, the rest fade. Transitions, so a quick second filter turns them back
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

.row-leave-active {
	position: absolute;
	inset-inline: 0;
}

.issue {
	padding: var(--lnx-spacing-2) var(--lnx-spacing-4);
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto 128px 92px;
	align-items: center;
	gap: var(--lnx-spacing-3);
	color: var(--color-gray-9);
	text-decoration: none;

	&:hover strong {
		color: var(--color-primary);
	}

	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: -2px;
	}
}

.tile {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 34px;
	height: 34px;
	border-radius: var(--lnx-radius-2);
	background: var(--cat-color-bg);
	color: var(--cat-color);
}

.what {
	display: flex;
	flex-direction: column;
	min-width: 0;

	strong {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		line-height: 1.3;
		transition: color var(--duration) var(--ease-out);
	}

	small {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0 var(--lnx-spacing-3);
		color: var(--color-gray-6);

		span {
			display: inline-flex;
			align-items: center;
			gap: 3px;
		}
	}

	.category {
		color: var(--cat-color);
		font-size: .7rem;
		font-weight: var(--lnx-font-weight-bold);
		letter-spacing: .04em;
		text-transform: uppercase;
	}
}

.counters {
	display: flex;
	gap: var(--lnx-spacing-3);
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);

	span {
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}
}

.opened {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--lnx-spacing-2);

	> span {
		display: flex;
		flex-direction: column;
		line-height: 1.2;
		white-space: nowrap;
	}

	time {
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
	}

	small {
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-legal);
		font-variant-numeric: tabular-nums;
	}
}

.badge-skeleton {
	justify-self: end;
	width: 64px;
}

.badge {
	justify-self: end;
	padding: 2px var(--lnx-spacing-2);
	border-radius: var(--lnx-radius-5);
	background: var(--status-color);
	color: var(--color-gray-0);
	font-size: var(--lnx-font-size-legal);
	font-weight: var(--lnx-font-weight-bold);
	white-space: nowrap;
}

@media (max-width: 640px) {
	.issue {
		grid-template-columns: auto minmax(0, 1fr) auto;
		grid-template-areas:
			'tile what badge'
			'tile opened counters';
		row-gap: var(--lnx-spacing-1);

		.tile { grid-area: tile; align-self: start; }
		.what { grid-area: what; }
		.badge, .badge-skeleton { grid-area: badge; align-self: start; }
		.opened { grid-area: opened; justify-content: flex-start; }
		.counters { grid-area: counters; justify-self: end; }

		.opened > span {
			flex-direction: row;
			gap: var(--lnx-spacing-1);
		}
	}
}

.fields {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
	align-items: start;
	gap: var(--lnx-spacing-3) var(--lnx-spacing-4);

	.wide {
		grid-column: 1 / -1;
	}
}

.form-actions {
	display: flex;
	justify-content: flex-end;
	gap: var(--lnx-spacing-2);
}

.hint {
	padding: var(--lnx-spacing-3) 0;
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}
</style>
