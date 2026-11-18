<script setup lang="ts">
import type { IssueSuggestion } from '@gobernansa/shared/application/writing.ts';
import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { IssueStatus } from '@gobernansa/shared/domain/issue.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { claimStatus, findIssueCategory, getIssueAge, getIssueCategories, issueCategoryStyle, issueLocationTypes, issueStatus } from '@gobernansa/shared/domain/issue.ts';
import { isVideoUrl } from '@gobernansa/shared/domain/media.ts';
import { LnxButton, LnxIcon, useConfirm } from 'lnxjs-components';
import { computed, defineAsyncComponent, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import BackButton from '@/app/ux/BackButton.vue';
import { newId } from '@/app/ux/navigation.ts';
import { optimistic } from '@/app/ux/toast.ts';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { usePeople } from '@/modules/people/application/usePeople.ts';
import { useProviders } from '@/modules/providers/application/useProviders.ts';
import { useIssue, workOrderUrl } from '../application/useIssues.ts';
import IssueAge from './IssueAge.vue';
import IssueAssignment from './IssueAssignment.vue';
import IssueClaim from './IssueClaim.vue';
import IssueHistory from './IssueHistory.vue';
import WorkOrderPanel from './WorkOrderPanel.vue';

const props = defineProps<{ id: string; issueId: string }>();

const ask = useConfirm();

const router = useRouter();
const { user: me } = useAuth();
const { issue, adminData, author, workOrder, comments, loading, error, changeStatus, revertStatus, assign, createWorkOrder, updateWorkOrderDate, revokeWorkOrder, saveClaim, reply, setHidden, remove, restore } = useIssue(props.id, props.issueId);
// To name who reported it, its private author document only keeps their id
const { people } = usePeople(props.id);
const { providers } = useProviders(props.id);

// For its categories, the defaults until it's read
const community = ref<Community>();
loadCommunity(props.id).then(loaded => community.value = loaded, () => {});
const category = computed(() => issue.value && findIssueCategory(getIssueCategories(community.value), issue.value.category));
const reporter = computed(() => people.value.find(person => person.id === author.value?.uid)?.name);
const statusLabels = Object.fromEntries(issueStatus.map(({ value, label }) => [value, label]));

const age = computed(() => issue.value && getIssueAge(issue.value));
const waiting = computed(() => issue.value?.status === 'open' || issue.value?.status === 'in_progress');
// The provider's date has passed and it's still not fixed
const overdue = computed(() => waiting.value && !!issue.value?.expectedAt && issue.value.expectedAt.toMillis() < new Date().setHours(0, 0, 0, 0));
const messagesCount = computed(() => comments.value.filter(comment => comment.type !== 'status').length);

function formatDate(date: Date, timeStyle?: 'short') {
	return date.toLocaleString('es', { dateStyle: 'medium', timeStyle });
}

// Photos and videos fade in from a blur once loaded, also those the browser already had
const loadedAssets = reactive(new Set<string>());

function checkLoaded(asset: string, element: unknown) {
	if ((element instanceof HTMLImageElement && element.complete) || (element instanceof HTMLVideoElement && element.readyState >= 2)) {
		loadedAssets.add(asset);
	}
}

function setStatus(status: IssueStatus) {
	if (!issue.value || status === issue.value.status) {
		return;
	}
	const previous = { status: issue.value.status, resolvedAt: issue.value.resolvedAt };
	const commentId = newId();
	void optimistic(changeStatus(me.value!, status, commentId), {
		done: `Estado: ${statusLabels[status]}`,
		failed: 'No se ha podido cambiar el estado',
		revert: async () => revertStatus(me.value!, previous, commentId),
	});
}

// Shown as a card once someone is assigned, the form only to change it
const editingAssignment = ref(false);

// Sugerencias y redacción automática, loaded with the issue. The providers of the trade it suggests come first
const IssueSuggestions = defineAsyncComponent(async () => import('./IssueSuggestions.vue'));
const suggestion = ref<IssueSuggestion>();

const assignedProvider = computed(() => providers.value.find(provider => provider.id === issue.value?.provider?.id));

// To send the provider what to fix from their own mail app, with what's saved
const providerMail = computed(() => {
	const email = assignedProvider.value?.email;
	if (!email || !issue.value) {
		return undefined;
	}
	const where = issue.value.location ? `\nUbicación: ${issueLocationTypes[issue.value.location.type]}${issue.value.location.reference ? `: ${issue.value.location.reference}` : ''}` : '';
	const when = issue.value.expectedAt ? `\nFecha prevista: ${issue.value.expectedAt.toDate().toLocaleDateString('es')}` : '';
	const token = adminData.value?.workOrder;
	const link = token ? `\n\nParte de trabajo, para aceptarlo, programar la visita y avisarnos al terminar:\n${workOrderUrl(token)}` : '';
	// With the emulators they're saved without their host (uploadMedia), the mail needs it
	const photos = (issue.value.assets ?? []).map(asset => asset.startsWith('/') ? location.origin + asset : asset);
	const body = `${issue.value.title}\n\n${issue.value.description || ''}${where}${when}${photos.length ? `\n\nFotos:\n${photos.join('\n')}` : ''}${link}`;
	return `mailto:${email}?subject=${encodeURIComponent(`Incidencia: ${issue.value.title}`)}&body=${encodeURIComponent(body)}`;
});

async function deleteIssue() {
	if (await ask({ title: '¿Borrar esta incidencia?', message: 'Dejará de verse en la app.', confirmText: 'Borrar', variant: 'danger' })) {
		const uid = me.value!.id;
		void optimistic(remove(uid), {
			done: 'Incidencia borrada',
			failed: 'No se ha podido borrar',
			revert: async () => restore(uid),
		});
		void router.push(`/communities/${props.id}/issues`);
	}
}
</script>

<template>
	<header class="page-header">
		<BackButton :to="`/communities/${id}/issues`" label="Volver a incidencias" />
		<span>Incidencias</span>
	</header>

	<p v-if="error" class="error" role="alert">
		No se ha podido cargar: {{ error.message }}
	</p>
	<p v-else-if="!loading && (!issue || issue.deletedAt)" class="hint">
		Esta incidencia no existe o se ha borrado.
	</p>
	<div v-else-if="loading" aria-busy="true">
		<section class="hero" aria-hidden="true">
			<span class="lnx-skeleton lnx-skeleton--rect tile" />
			<div class="heading skeleton-stack">
				<span class="lnx-skeleton lnx-skeleton--small" style="width: 90px" />
				<span class="lnx-skeleton lnx-skeleton--title" style="width: 58%" />
				<span class="lnx-skeleton lnx-skeleton--small" style="width: 72%" />
			</div>
		</section>
		<div class="facts" aria-hidden="true">
			<div v-for="width in [70, 55, 62]" :key="width" class="skeleton-stack">
				<span class="lnx-skeleton lnx-skeleton--small" style="width: 40%" />
				<span class="lnx-skeleton" :style="{ width: `${width}%` }" />
			</div>
		</div>
		<div class="layout" aria-hidden="true">
			<section class="card">
				<span class="lnx-skeleton lnx-skeleton--small" style="width: 30%" />
				<span class="lnx-skeleton" style="width: 92%" />
				<span class="lnx-skeleton" style="width: 78%" />
				<span class="lnx-skeleton" style="width: 45%" />
			</section>
			<section class="card">
				<span class="lnx-skeleton lnx-skeleton--small" style="width: 40%" />
				<span class="lnx-skeleton lnx-skeleton--rect" />
			</section>
		</div>
	</div>

	<template v-else-if="issue">
		<section
			class="hero lnx-appear"
			:style="{
				...(category && issueCategoryStyle(category)),
				'--status-color': `var(--color-issue-status-${issue.status})`,
			}"
		>
			<span class="tile">
				<LnxIcon :icon="category?.icon ?? 'lucide:triangle-alert'" :size="28" />
			</span>
			<div class="heading">
				<span class="category">{{ category?.name ?? 'Sin categoría' }}</span>
				<h1 :style="{ viewTransitionName: `issue-${issue.id}` }">
					{{ issue.title || 'Incidencia' }}
				</h1>
				<p class="tags">
					<span class="badge">{{ statusLabels[issue.status] }}</span>
					<span v-if="issue.createdAt" class="tabular">
						<LnxIcon icon="lucide:calendar" :size="14" />
						Abierta el {{ formatDate(issue.createdAt.toDate()) }}
						<template v-if="age && age.days > 0"> (hace {{ age.days }} {{ age.days === 1 ? 'día' : 'días' }})</template>
					</span>
					<IssueAge :issue="issue" />
					<span v-if="reporter">
						<LnxIcon icon="lucide:user" :size="14" />
						{{ reporter }}
					</span>
					<span v-if="issue.location">
						<LnxIcon icon="lucide:map-pin" :size="14" />
						{{ issueLocationTypes[issue.location.type] }}<template v-if="issue.location.reference">
							· {{ issue.location.reference }}
						</template>
					</span>
				</p>
			</div>
			<dl class="counters">
				<div>
					<dt>Votos</dt>
					<dd :class="{ hot: issue.votesScore > 0 }">
						{{ issue.votesScore }}
					</dd>
				</div>
				<div>
					<dt>Mensajes</dt>
					<dd>{{ messagesCount }}</dd>
				</div>
			</dl>
		</section>

		<dl class="facts">
			<div>
				<dt>Proveedor</dt>
				<dd :class="{ missing: !issue.provider && waiting }">
					<LnxIcon icon="lucide:hard-hat" :size="16" />
					{{ issue.provider?.name ?? 'Sin asignar' }}
				</dd>
			</div>
			<div>
				<dt>Fecha prevista</dt>
				<dd :class="{ missing: overdue }">
					<LnxIcon :icon="overdue ? 'lucide:calendar-x' : 'lucide:calendar-clock'" :size="16" />
					{{ issue.expectedAt ? formatDate(issue.expectedAt.toDate()) : 'Sin fecha' }}
					<template v-if="overdue">
						· Retrasada
					</template>
				</dd>
			</div>
			<div v-if="issue.resolvedAt">
				<dt>Solucionada</dt>
				<dd>
					<LnxIcon icon="lucide:circle-check" :size="16" />
					{{ formatDate(issue.resolvedAt.toDate()) }}
				</dd>
			</div>
			<div>
				<dt>Seguro</dt>
				<dd>
					<LnxIcon icon="lucide:shield" :size="16" />
					{{ adminData?.claim ? claimStatus[adminData.claim.status].label : 'Sin parte' }}
				</dd>
			</div>
		</dl>

		<section class="status-card">
			<fieldset class="statuses">
				<legend class="sr-only">
					Estado
				</legend>
				<label v-for="option in issueStatus" :key="option.value" :style="{ '--status-color': `var(--color-issue-status-${option.value})` }">
					<input type="radio" class="sr-only" name="status" :checked="issue.status === option.value" @change="setStatus(option.value)">
					<span>
						<i />
						{{ option.label }}
					</span>
				</label>
			</fieldset>
		</section>
		<div class="layout">
			<div class="main">
				<section class="card">
					<h2>Descripción</h2>
					<p class="description" :class="{ hint: !issue.description }">
						{{ issue.description || 'Sin descripción' }}
					</p>
					<ul v-if="issue.assets?.length" class="assets">
						<li v-for="asset in issue.assets" :key="asset">
							<a :href="asset" target="_blank" rel="noopener" class="ux-lift" :class="{ loaded: loadedAssets.has(asset) }">
								<video
									v-if="isVideoUrl(asset)"
									:ref="element => checkLoaded(asset, element)"
									:src="`${asset}#t=0.1`"
									muted
									playsinline
									preload="metadata"
									aria-label="Vídeo de la incidencia"
									@loadeddata="loadedAssets.add(asset)"
								/>
								<img
									v-else
									:ref="element => checkLoaded(asset, element)"
									:src="asset"
									alt="Foto de la incidencia"
									loading="lazy"
									@load="loadedAssets.add(asset)"
								>
							</a>
						</li>
					</ul>
				</section>

				<IssueSuggestions :issue :comments @suggest="suggestion = $event" />

				<IssueHistory :community-id="id" :comments :people :actions="{ reply, setHidden }" />
			</div>

			<aside class="side">
				<IssueAssignment
					v-model:editing="editingAssignment"
					:issue
					:note="adminData?.note"
					:providers
					:assigned-provider
					:provider-mail
					:overdue
					:suggestion
					:assign
				/>

				<section v-if="issue.provider" class="card box">
					<header class="box-header">
						<span class="box-icon work-order-icon"><LnxIcon icon="lucide:clipboard-list" :size="18" /></span>
						<h2>Parte de trabajo</h2>
					</header>
					<WorkOrderPanel
						:issue="issue"
						:work-order="workOrder"
						:comments="comments"
						:provider="assignedProvider"
						:mail="editingAssignment ? undefined : providerMail"
						:actions="{ createWorkOrder, updateWorkOrderDate, revokeWorkOrder, reply }"
						@resolve="setStatus('resolved')"
					/>
				</section>

				<IssueClaim :community-id="id" :claim="adminData?.claim" :community :save-claim />

				<LnxButton mode="clear" variant="danger" @click="deleteIssue()">
					<LnxIcon icon="lucide:trash-2" />
					Borrar incidencia
				</LnxButton>
			</aside>
		</div>
	</template>
</template>

<style lang="scss" scoped>
.page-header {
	margin-bottom: var(--lnx-spacing-3);
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.hero {
	margin-bottom: var(--lnx-spacing-3);
	padding: var(--lnx-spacing-5);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: linear-gradient(180deg, var(--cat-color-bg), var(--color-gray-0) 70%);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto;
	align-items: start;
	gap: var(--lnx-spacing-4);

	.tile {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 56px;
		height: 56px;
		border-radius: var(--lnx-radius-3);
		background: var(--color-gray-0);
		color: var(--cat-color);
		box-shadow: 0 0 0 1px var(--cat-color-bg), 0 2px 6px #0000000F;
	}

	.category {
		color: var(--cat-color);
		font-size: .75rem;
		font-weight: var(--lnx-font-weight-bold);
		letter-spacing: .06em;
		text-transform: uppercase;
	}

	h1 {
		margin: 2px 0 var(--lnx-spacing-2);
		font-size: var(--lnx-font-size-title);
		line-height: 1.2;
	}
}

.tags {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--lnx-spacing-1) var(--lnx-spacing-3);
	color: var(--color-gray-7);
	font-size: var(--lnx-font-size-small);

	> span {
		display: inline-flex;
		align-items: center;
		gap: 4px;
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

.counters {
	display: flex;
	gap: var(--lnx-spacing-2);

	div {
		min-width: 64px;
		padding: var(--lnx-spacing-2);
		border-radius: var(--lnx-radius-3);
		background: var(--color-gray-0);
		box-shadow: 0 0 0 1px var(--color-gray-3);
		text-align: center;
	}

	dt {
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-legal);
	}

	dd {
		font-size: 1.4rem;
		font-weight: var(--lnx-font-weight-bold);
		line-height: 1.2;

		&.hot {
			color: #ed821d;
		}
	}
}

.facts {
	margin-bottom: var(--lnx-spacing-2);
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
	gap: var(--lnx-spacing-2);

	div {
		padding: var(--lnx-spacing-2) var(--lnx-spacing-3);
		border: 1px solid var(--color-gray-3);
		border-radius: var(--lnx-radius-3);
		background: var(--color-gray-0);
	}

	dt {
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-legal);
		text-transform: uppercase;
		letter-spacing: .04em;
	}

	dd {
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-1);
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
		font-variant-numeric: tabular-nums;

		&.missing {
			color: #dc2626;
		}
	}
}

.layout {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 320px;
	align-items: start;
	gap: var(--lnx-spacing-5);

	@media (max-width: 860px) {
		grid-template-columns: minmax(0, 1fr);

		.side {
			order: -1;
		}
	}
}

.main,
.side {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-5);
}

.side > :deep(.lnx-button) {
	align-self: flex-end;
}

.card {
	gap: var(--lnx-spacing-3);
	// Also the boxes' own components

	:deep(h2) {
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
		color: var(--color-gray-6);
		text-transform: uppercase;
		letter-spacing: .04em;
	}
}

.skeleton-stack {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);
}

.description {
	font-size: 1.05rem;
	line-height: 1.5;
	white-space: pre-line;
}

.assets {
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-2);

	// A soft shimmer until the photo arrives, then it sharpens out of a blur
	a {
		display: block;
		overflow: hidden;
		border-radius: var(--lnx-radius-2);
		background: linear-gradient(100deg, var(--color-gray-1) 30%, var(--color-gray-2) 50%, var(--color-gray-1) 70%) 0 0 / 300% 100%;
		animation: asset-shimmer 1.4s linear infinite;

		&.loaded {
			animation: none;
		}
	}

	:is(img, video) {
		display: block;
		width: 120px;
		height: 90px;
		object-fit: cover;
		opacity: 0;
		filter: blur(12px);
		scale: 1.04;
		transition: opacity .3s var(--ease-out), filter .5s var(--ease-out), scale .5s var(--ease-out);
	}

	.loaded :is(img, video) {
		opacity: 1;
		filter: none;
		scale: 1;
	}

	@media (prefers-reduced-motion: reduce) {
		a {
			animation: none;
		}

		:is(img, video) {
			scale: none;
		}
	}
}

@keyframes asset-shimmer {
	to {
		background-position: -150% 0;
	}
}

.status-card {
	margin-bottom: var(--lnx-spacing-5);
}

.statuses {
	display: flex;
	gap: var(--lnx-spacing-2);

	label {
		flex: 1;
		min-width: 0;
	}

	span {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--lnx-spacing-2);
		padding: var(--lnx-spacing-2) var(--lnx-spacing-3);
		border: 1px solid var(--color-gray-3);
		border-radius: var(--lnx-radius-3);
		background: var(--color-gray-0);
		color: var(--color-gray-7);
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
		white-space: nowrap;
		cursor: pointer;
		transition: background-color var(--duration) var(--ease-out), border-color var(--duration) var(--ease-out), box-shadow var(--duration) var(--ease-out), color var(--duration) var(--ease-out), scale var(--duration-fast) var(--ease-out);

		&:hover {
			border-color: var(--status-color);
			background: color-mix(in srgb, var(--status-color) 6%, var(--color-gray-0));
		}
	}

	label:active span {
		scale: var(--press-scale);
	}

	i {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--status-color);
	}

	input:checked + span {
		border-color: var(--status-color);
		background: color-mix(in srgb, var(--status-color) 12%, var(--color-gray-0));
		box-shadow: inset 0 0 0 1px var(--status-color);
		color: var(--status-color);
	}

	input:focus-visible + span {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
}

.box {
	gap: var(--lnx-spacing-4);
}

.box :deep(.box-header) {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);

	h2 {
		flex: 1;
	}
}

.box :deep(.box-icon) {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 32px;
	height: 32px;
	border-radius: var(--lnx-radius-2);

	&.provider-icon {
		background: #fef3c7;
		color: #d97706;
	}

	&.claim-icon {
		background: #dbeafe;
		color: #1d4ed8;
	}

	&.work-order-icon {
		background: #ccfbf1;
		color: #0d9488;
	}
}

@media (max-width: 640px) {
	.hero {
		grid-template-columns: auto minmax(0, 1fr);

		.counters {
			grid-column: 1 / -1;
		}
	}
}
</style>
