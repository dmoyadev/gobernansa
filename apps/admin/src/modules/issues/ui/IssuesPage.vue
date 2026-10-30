<script setup lang="ts">
import type { Issue, IssueCategory, IssueStatus } from '@gobernansa/shared/domain/issue.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { getIssueAge, issueLocationTypes, issuesCategories, issueStatus } from '@gobernansa/shared/domain/issue.ts';
import LnxTextarea from '@gobernansa/shared/ui/LnxTextarea.vue';
import { LnxButton, LnxIcon, LnxInput } from 'lnxjs-components';
import { ref } from 'vue';
import { useRouter } from 'vue-router';
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

const categories = Object.fromEntries(issuesCategories.map(category => [category.value, category]));
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

function emptyForm() {
	return { title: '', description: '', category: 'maintenance' as IssueCategory, place: '' as '' | keyof typeof issueLocationTypes, reference: '' };
}

const form = ref<ReturnType<typeof emptyForm>>();
const saving = ref(false);
const formError = ref<string>();

async function create() {
	const { title, description, category, place, reference } = form.value!;
	saving.value = true;
	formError.value = undefined;
	try {
		const issueId = await createIssue(props.id, me.value!.id, {
			title: title.trim() || categories[category]!.defaultTitle,
			description: description.trim(),
			category,
			...(place ? { location: { type: place, reference: reference.trim() } } : {}),
		});
		await router.push(`/communities/${props.id}/issues/${issueId}`);
	} catch (e) {
		formError.value = `No se ha podido crear: ${(e as Error).message}`;
	} finally {
		saving.value = false;
	}
}
</script>

<template>
	<header class="page-header">
		<LnxButton :to="`/communities/${id}`" mode="clear" shape="circle" aria-label="Volver a la comunidad" title="Volver a la comunidad">
			<LnxIcon icon="lucide:arrow-left" />
		</LnxButton>
		<h1>Incidencias</h1>
		<LnxButton v-if="!form" @click="form = emptyForm()">
			<LnxIcon icon="lucide:plus" />
			Nueva incidencia
		</LnxButton>
	</header>

	<form v-if="form" class="card new" @submit.prevent="create()">
		<h2>Nueva incidencia</h2>
		<fieldset class="categories">
			<legend>Categoría</legend>
			<label
				v-for="category in issuesCategories"
				:key="category.value"
				:style="{ '--cat-color': `var(--color-issue-cat-${category.value}-accent)`, '--cat-color-bg': `var(--color-issue-cat-${category.value})` }"
			>
				<input v-model="form.category" type="radio" class="sr-only" name="category" :value="category.value">
				<span><LnxIcon :icon="category.icon" :size="16" />{{ category.label }}</span>
			</label>
		</fieldset>
		<div class="fields">
			<LnxInput v-model="form.title" class="wide" :placeholder="categories[form.category]?.defaultTitle">
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
			<LnxInput v-if="form.place" v-model="form.reference" :placeholder="form.place === 'property' ? 'Portal 2, 3ºB' : 'Garaje, planta -1'">
				Referencia
			</LnxInput>
			<LnxTextarea v-model="form.description" rows="3" class="wide">
				Descripción
			</LnxTextarea>
		</div>
		<p v-if="formError" class="error" role="alert">
			{{ formError }}
		</p>
		<footer class="form-actions">
			<LnxButton mode="clear" @click="form = undefined">
				Cancelar
			</LnxButton>
			<LnxButton type="submit" :is-loading="saving">
				<LnxIcon icon="lucide:plus" />
				Crear incidencia
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

	<section class="card list-card">
		<p v-if="error" class="error" role="alert">
			No se han podido cargar: {{ error.message }}
		</p>

		<span v-if="pending && !issues.length" class="skeleton-item" />
		<ul v-else-if="issues.length" class="list">
			<li v-for="issue in issues" :key="issue.id">
				<RouterLink
					class="issue"
					:to="`/communities/${id}/issues/${issue.id}`"
					:style="{
						'--cat-color': `var(--color-issue-cat-${issue.category}-accent)`,
						'--cat-color-bg': `var(--color-issue-cat-${issue.category})`,
						'--status-color': `var(--color-issue-status-${issue.status})`,
					}"
				>
					<span class="tile">
						<LnxIcon :icon="categories[issue.category]?.icon ?? 'lucide:triangle-alert'" :size="18" />
					</span>
					<div class="what">
						<strong>{{ issue.title }}</strong>
						<small>
							<span class="category">{{ categories[issue.category]?.label ?? 'Sin categoría' }}</span>
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

.list li + li {
	border-top: 1px solid var(--color-gray-2);
}

.issue {
	padding: var(--lnx-spacing-2) var(--lnx-spacing-4);
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto 128px 92px;
	align-items: center;
	gap: var(--lnx-spacing-3);
	color: var(--color-gray-9);
	text-decoration: none;

	&:hover {
		background: var(--color-gray-1);

		strong {
			color: var(--color-primary);
		}
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
	}
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
		.badge { grid-area: badge; align-self: start; }
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
