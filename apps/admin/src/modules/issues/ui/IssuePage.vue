<script setup lang="ts">
import type { IssueSuggestion } from '@gobernansa/shared/application/writing.ts';
import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { ClaimStatus, IssueComment, IssueStatus } from '@gobernansa/shared/domain/issue.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { claimStatus, findIssueCategory, getIssueAge, getIssueCategories, issueCategoryStyle, issueLocationTypes, issueStatus } from '@gobernansa/shared/domain/issue.ts';
import { providerCategories } from '@gobernansa/shared/domain/provider.ts';
import { roles } from '@gobernansa/shared/domain/user.ts';
import DatePicker from '@gobernansa/shared/ui/DatePicker.vue';
import LnxTextarea from '@gobernansa/shared/ui/LnxTextarea.vue';
import { LnxButton, LnxIcon, LnxInput, LnxSelect } from 'lnxjs-components';
import { computed, defineAsyncComponent, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import BackButton from '@/app/ux/BackButton.vue';
import Kbd from '@/app/ux/Kbd.vue';
import { newId } from '@/app/ux/navigation.ts';
import { useEventListener, useShortcut } from '@/app/ux/shortcuts.ts';
import { optimistic } from '@/app/ux/toast.ts';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { setBlocked } from '@/modules/people/application/useModeration.ts';
import { usePeople } from '@/modules/people/application/usePeople.ts';
import { useProviders } from '@/modules/providers/application/useProviders.ts';
import { useIssue, workOrderUrl } from '../application/useIssues.ts';
import IssueAge from './IssueAge.vue';
import WorkOrderPanel from './WorkOrderPanel.vue';

const props = defineProps<{ id: string; issueId: string }>();

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
const VIDEO_REGEX = /\/video\//;
const SPACES_REGEX = /\s+/;

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

// Filled with what's saved each time it changes, also after saving
const assignment = ref({ providerId: '', expectedAt: '', note: '' });
function resetAssignment() {
	assignment.value = {
		providerId: issue.value?.provider?.id ?? '',
		expectedAt: issue.value?.expectedAt ? toDateString(issue.value.expectedAt.toDate()) : '',
		note: adminData.value?.note ?? '',
	};
}
// Not while it's being edited, so what's typed stays when a save fails and goes back
watch(() => [issue.value?.provider?.id, issue.value?.expectedAt?.toMillis(), adminData.value?.note], () => {
	if (!editingAssignment.value) {
		resetAssignment();
	}
}, { immediate: true });

// Sugerencias y redacción automática, loaded with the issue. The providers of the trade it suggests come first
const IssueSuggestions = defineAsyncComponent(async () => import('./IssueSuggestions.vue'));
const suggestion = ref<IssueSuggestion>();
const sortedProviders = computed(() => {
	const trade = suggestion.value?.provider;
	return trade && trade !== 'other' ? [...providers.value].sort((a, b) => Number(b.category === trade) - Number(a.category === trade)) : providers.value;
});

const providerOptions = computed(() => [{ value: '', label: 'Sin asignar' }, ...sortedProviders.value.map(provider => ({ value: provider.id, label: provider.name }))]);
const selectedProvider = computed(() => providers.value.find(provider => provider.id === assignment.value.providerId));

// To send the provider what to fix from their own mail app
const providerMail = computed(() => {
	const email = selectedProvider.value?.email;
	if (!email || !issue.value) {
		return undefined;
	}
	const where = issue.value.location ? `\nUbicación: ${issueLocationTypes[issue.value.location.type]}${issue.value.location.reference ? `: ${issue.value.location.reference}` : ''}` : '';
	const when = assignment.value.expectedAt ? `\nFecha prevista: ${new Date(`${assignment.value.expectedAt}T00:00`).toLocaleDateString('es')}` : '';
	const token = adminData.value?.workOrder;
	const link = token ? `\n\nParte de trabajo, para aceptarlo, programar la visita y avisarnos al terminar:\n${workOrderUrl(token)}` : '';
	const body = `${issue.value.title}\n\n${issue.value.description || ''}${where}${when}${issue.value.assets?.length ? `\n\nFotos:\n${issue.value.assets.join('\n')}` : ''}${link}`;
	return `mailto:${email}?subject=${encodeURIComponent(`Incidencia: ${issue.value.title}`)}&body=${encodeURIComponent(body)}`;
});

function saveAssignment() {
	const values = { ...assignment.value };
	const { providerId, expectedAt, note } = values;
	// A provider removed from the directory stays assigned until it's changed
	const provider = selectedProvider.value ?? (providerId === issue.value?.provider?.id ? issue.value.provider : undefined);
	editingAssignment.value = false;
	void optimistic(assign(me.value!, provider, expectedAt ? new Date(`${expectedAt}T00:00`) : undefined, note.trim()), {
		done: provider ? 'Asignada' : 'Proveedor quitado',
		failed: 'No se ha podido guardar la asignación',
		onError: () => {
			editingAssignment.value = true;
			assignment.value = values;
		},
	});
}

const assignedProvider = computed(() => providers.value.find(provider => provider.id === issue.value?.provider?.id));
const initials = (name: string) => name.split(SPACES_REGEX).slice(0, 2).map(word => word[0]?.toUpperCase()).join('');

const quickDates = [{ label: 'Hoy', days: 0 }, { label: 'Mañana', days: 1 }, { label: 'En 3 días', days: 3 }, { label: 'En una semana', days: 7 }];

function setExpectedIn(days: number) {
	const date = new Date();
	date.setDate(date.getDate() + days);
	assignment.value.expectedAt = toDateString(date);
}

const claimColors: Record<ClaimStatus, string> = {
	opened: '#4fa2dc',
	expert: '#d97706',
	accepted: '#11ad70',
	rejected: '#dc2626',
	paid: '#15803d',
	closed: '#718096',
};

const copied = ref(false);

async function copyClaimNumber(number: string) {
	await navigator.clipboard.writeText(number);
	copied.value = true;
	setTimeout(() => copied.value = false, 1500);
}

const claimStatusOptions = Object.entries(claimStatus).map(([value, { label }]) => ({ value: value as ClaimStatus, label }));
const claimForm = ref<{ insurer: string; number: string; status: ClaimStatus; note: string }>();

// The insurer is taken from the community's insurance contact, read only when opening a claim
async function openClaimForm() {
	const claim = adminData.value?.claim;
	if (claim) {
		claimForm.value = { insurer: claim.insurer, number: claim.number, status: claim.status, note: '' };
		return;
	}
	claimForm.value = { insurer: '', number: '', status: 'opened', note: '' };
	const loaded = community.value ?? await loadCommunity(props.id).catch(() => undefined);
	const insurer = loaded?.contacts?.find(contact => contact.type === 'insurance')?.name;
	if (insurer && claimForm.value && !claimForm.value.insurer) {
		claimForm.value.insurer = insurer;
	}
}

function submitClaim() {
	const form = claimForm.value;
	if (!form) {
		return;
	}
	claimForm.value = undefined;
	void optimistic(saveClaim(me.value!, { insurer: form.insurer.trim(), number: form.number.trim(), status: form.status, note: form.note.trim() }), {
		done: 'Parte guardado',
		failed: 'No se ha podido guardar el parte',
		onError: () => claimForm.value = form,
	});
}

function toggleHidden(comment: IssueComment) {
	const hidden = !comment.hiddenAt;
	void optimistic(setHidden(me.value!.id, comment, hidden), {
		done: hidden ? 'Comentario oculto' : 'Comentario visible',
		failed: 'No se ha podido cambiar el comentario',
		revert: async () => setHidden(me.value!.id, comment, !hidden),
	});
}

// Neighbours only, the administration's answers carry their role
function authorOf(comment: IssueComment) {
	return comment.authorRole || comment.authorId === me.value?.id ? undefined : people.value.find(person => person.id === comment.authorId);
}

async function toggleBlocked(comment: IssueComment) {
	const author = authorOf(comment);
	if (!author) {
		return;
	}
	// eslint-disable-next-line no-alert
	if (author.blocked || window.confirm(`¿Bloquear a ${author.name}? No podrá crear incidencias ni comentar.`)) {
		const blocked = !author.blocked;
		void optimistic(setBlocked(author.id, props.id, blocked, author.name), {
			done: blocked ? 'Vecino bloqueado' : 'Vecino desbloqueado',
			failed: 'No se ha podido cambiar el bloqueo',
			revert: async () => setBlocked(author.id, props.id, !blocked, author.name),
		});
	}
}

const message = ref('');

// No undo: neighbours may have been told already. If it fails, what was written comes back
function sendReply() {
	const text = message.value.trim();
	if (!text) {
		return;
	}
	message.value = '';
	void optimistic(reply(me.value!, text), {
		failed: 'No se ha podido enviar',
		onError: () => message.value ||= text,
	});
}

function deleteIssue() {
	// eslint-disable-next-line no-alert
	if (window.confirm('¿Borrar esta incidencia? Dejará de verse en la app.')) {
		const uid = me.value!.id;
		void optimistic(remove(uid), {
			done: 'Incidencia borrada',
			failed: 'No se ha podido borrar',
			revert: async () => restore(uid),
		});
		void router.push(`/communities/${props.id}/issues`);
	}
}

// Sends the form being written in, or else the reply
useShortcut('mod+enter', () => {
	const form = document.activeElement?.closest('form');
	if (form) {
		form.requestSubmit();
	} else {
		sendReply();
	}
}, 'Enviar el formulario o la respuesta');
useEventListener(window, 'keydown', (event) => {
	if (event.key !== 'Escape' || event.defaultPrevented) {
		return;
	}
	if (claimForm.value) {
		claimForm.value = undefined;
	} else if (editingAssignment.value) {
		resetAssignment();
		editingAssignment.value = false;
	}
});
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
			<span class="skeleton-item skeleton-item--big-square tile" />
			<div class="heading skeleton-stack">
				<span class="skeleton-item skeleton-item--small" style="width: 90px" />
				<span class="skeleton-item skeleton-item--title" style="width: 58%" />
				<span class="skeleton-item skeleton-item--small" style="width: 72%" />
			</div>
		</section>
		<div class="facts" aria-hidden="true">
			<div v-for="width in [70, 55, 62]" :key="width" class="skeleton-stack">
				<span class="skeleton-item skeleton-item--small" style="width: 40%" />
				<span class="skeleton-item" :style="{ width: `${width}%` }" />
			</div>
		</div>
		<div class="layout" aria-hidden="true">
			<section class="card">
				<span class="skeleton-item skeleton-item--small" style="width: 30%" />
				<span class="skeleton-item" style="width: 92%" />
				<span class="skeleton-item" style="width: 78%" />
				<span class="skeleton-item" style="width: 45%" />
			</section>
			<section class="card">
				<span class="skeleton-item skeleton-item--small" style="width: 40%" />
				<span class="skeleton-item skeleton-item--big-square" />
			</section>
		</div>
	</div>

	<template v-else-if="issue">
		<section
			class="hero ux-appear"
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
									v-if="VIDEO_REGEX.test(asset)"
									:ref="element => checkLoaded(asset, element)"
									:src="asset"
									muted
									preload="metadata"
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

				<section class="card">
					<h2>Historial y mensajes</h2>
					<TransitionGroup v-if="comments.length" tag="ol" name="comment" class="history">
						<li
							v-for="comment in comments"
							:key="comment.id"
							:class="{ status: comment.type === 'status', hidden: comment.hiddenAt, mine: !!comment.authorRole }"
							:style="comment.status ? { '--status-color': `var(--color-issue-status-${comment.status})` } : undefined"
						>
							<p v-if="comment.type === 'status'" class="status-change">
								<span class="dot" />
								<span>
									<strong>{{ comment.authorName || 'Vecino' }}</strong> la ha pasado a
									<strong class="status-label">{{ statusLabels[comment.status!] }}</strong>
								</span>
								<small v-if="comment.createdAt">{{ formatDate(comment.createdAt.toDate(), 'short') }}</small>
							</p>
							<template v-else>
								<small>
									<strong>{{ comment.authorName || 'Vecino' }}</strong>
									<template v-if="comment.authorRole"> ({{ roles[comment.authorRole]?.label }})</template>
									<template v-if="comment.createdAt"> · {{ formatDate(comment.createdAt.toDate(), 'short') }}</template>
									<template v-if="comment.hiddenAt"> · Oculto</template>
									<template v-if="authorOf(comment)?.blocked"> · Bloqueado</template>
								</small>
								<p>
									{{ comment.message }}
								</p>
								<div class="moderation">
									<LnxButton mode="clear" class="size-small" @click="toggleHidden(comment)">
										<LnxIcon :icon="comment.hiddenAt ? 'lucide:eye' : 'lucide:eye-off'" />
										{{ comment.hiddenAt ? 'Mostrar' : 'Ocultar' }}
									</LnxButton>
									<LnxButton v-if="authorOf(comment)" mode="clear" class="size-small" @click="toggleBlocked(comment)">
										<LnxIcon :icon="authorOf(comment)?.blocked ? 'lucide:user-check' : 'lucide:user-x'" />
										{{ authorOf(comment)?.blocked ? 'Desbloquear vecino' : 'Bloquear vecino' }}
									</LnxButton>
								</div>
							</template>
						</li>
					</TransitionGroup>
					<p v-else class="hint">
						Aún no hay comentarios.
					</p>

					<form class="reply" @submit.prevent="sendReply()">
						<LnxTextarea v-model="message" rows="3" placeholder="Responder a los vecinos…" aria-label="Responder" required />
						<LnxButton type="submit" :disabled="!message.trim()">
							<LnxIcon icon="lucide:send" />
							Responder
							<Kbd combo="mod+enter" />
						</LnxButton>
					</form>
				</section>
			</div>

			<aside class="side">
				<section class="card box">
					<header class="box-header">
						<span class="box-icon provider-icon"><LnxIcon icon="lucide:hard-hat" :size="18" /></span>
						<h2>Proveedor</h2>
						<LnxButton
							v-if="issue.provider && !editingAssignment"
							mode="clear"
							class="size-small"
							@click="editingAssignment = true"
						>
							<LnxIcon icon="lucide:pencil" />
							Cambiar
						</LnxButton>
					</header>

					<template v-if="issue.provider && !editingAssignment">
						<div class="provider">
							<span class="avatar">{{ initials(issue.provider.name) }}</span>
							<div>
								<strong>{{ issue.provider.name }}</strong>
								<small v-if="assignedProvider">{{ providerCategories[assignedProvider.category]?.label }}</small>
							</div>
						</div>
						<div class="quick-actions">
							<LnxButton v-if="assignedProvider?.phone" :href="`tel:${assignedProvider.phone}`" mode="outline" class="size-small">
								<LnxIcon icon="lucide:phone" />
								Llamar
							</LnxButton>
							<LnxButton v-if="providerMail" :href="providerMail" mode="outline" class="size-small">
								<LnxIcon icon="lucide:mail" />
								Enviar aviso
							</LnxButton>
						</div>
						<p class="expected" :class="{ late: overdue, unset: !issue.expectedAt }">
							<LnxIcon :icon="overdue ? 'lucide:calendar-x' : 'lucide:calendar-clock'" :size="16" />
							<span v-if="issue.expectedAt">
								{{ overdue ? 'Debía estar el' : 'Previsto para el' }} <strong>{{ formatDate(issue.expectedAt.toDate()) }}</strong>
							</span>
							<span v-else>Sin fecha prevista</span>
						</p>
						<p v-if="adminData?.note" class="note">
							<small><LnxIcon icon="lucide:lock" :size="12" /> Nota interna</small>
							{{ adminData.note }}
						</p>
					</template>

					<form v-else class="assignment" @submit.prevent="saveAssignment()">
						<p v-if="!issue.provider" class="hint">
							Elige quién se encarga. Si está notificada, pasará a «Actuando».
						</p>
						<LnxSelect
							v-model.convert="assignment.providerId"
							:options="providerOptions"
							:convert-fn="option => option.value"
							search-placeholder-text="Buscar..."
							placeholder="Sin asignar"
						>
							Proveedor
							<template #option="{ option }">
								{{ option.label }}
							</template>
							<template #optionInput="{ value }">
								{{ providerOptions.find(option => option.value === value)?.label ?? issue.provider?.name }}
							</template>
						</LnxSelect>
						<RouterLink to="/providers" class="add-provider">
							<LnxIcon icon="lucide:plus" :size="14" />
							¿No está? Añádelo al directorio
						</RouterLink>
						<div>
							<DatePicker v-model="assignment.expectedAt">
								Fecha prevista
							</DatePicker>
							<div class="quick-dates">
								<button v-for="quick in quickDates" :key="quick.days" type="button" @click="setExpectedIn(quick.days)">
									{{ quick.label }}
								</button>
							</div>
						</div>
						<LnxTextarea v-model="assignment.note" rows="3" placeholder="Llaves, presupuesto aprobado, contacto…">
							Nota interna (los vecinos no la ven)
						</LnxTextarea>
						<footer class="form-actions">
							<LnxButton v-if="issue.provider" type="button" mode="clear" @click="resetAssignment(); editingAssignment = false">
								Cancelar
							</LnxButton>
							<LnxButton type="submit">
								<LnxIcon icon="lucide:check" />
								{{ issue.provider ? 'Guardar' : 'Asignar' }}
								<Kbd combo="mod+enter" />
							</LnxButton>
						</footer>
					</form>
				</section>

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

				<section class="card box">
					<header class="box-header">
						<span class="box-icon claim-icon"><LnxIcon icon="lucide:shield" :size="18" /></span>
						<h2>Seguro</h2>
						<LnxButton
							v-if="adminData?.claim && !claimForm"
							mode="clear"
							class="size-small"
							@click="openClaimForm()"
						>
							<LnxIcon icon="lucide:pencil" />
							Actualizar
						</LnxButton>
					</header>

					<template v-if="adminData?.claim && !claimForm">
						<div class="claim-summary" :style="{ '--claim-color': claimColors[adminData.claim.status] }">
							<div>
								<strong>{{ adminData.claim.insurer }}</strong>
								<button
									v-if="adminData.claim.number"
									type="button"
									class="claim-number"
									:title="copied ? 'Copiado' : 'Copiar número de siniestro'"
									@click="copyClaimNumber(adminData.claim.number)"
								>
									Siniestro {{ adminData.claim.number }}
									<LnxIcon :icon="copied ? 'lucide:check' : 'lucide:copy'" :size="12" />
								</button>
								<small v-else class="hint">Sin número de siniestro</small>
							</div>
							<span class="claim-status">
								<LnxIcon :icon="claimStatus[adminData.claim.status].icon" :size="14" />
								{{ claimStatus[adminData.claim.status].label }}
							</span>
						</div>
						<ol class="timeline">
							<li
								v-for="entry in [...adminData.claim.history].reverse()"
								:key="entry.at.toMillis()"
								:style="{ '--claim-color': claimColors[entry.status] }"
							>
								<span class="timeline-icon"><LnxIcon :icon="claimStatus[entry.status].icon" :size="12" /></span>
								<div>
									<strong>{{ claimStatus[entry.status].label }}</strong>
									<small>{{ formatDate(entry.at.toDate(), 'short') }}</small>
									<p v-if="entry.note">
										{{ entry.note }}
									</p>
								</div>
							</li>
						</ol>
					</template>

					<div v-else-if="!claimForm" class="empty">
						<p class="hint">
							Si los daños los cubre el seguro, abre un parte y sigue aquí su tramitación.
						</p>
						<LnxButton mode="outline" @click="openClaimForm()">
							<LnxIcon icon="lucide:file-plus" />
							Abrir parte al seguro
						</LnxButton>
					</div>

					<form v-if="claimForm" class="claim ux-appear" @submit.prevent="submitClaim()">
						<LnxInput v-model="claimForm.insurer" required>
							Aseguradora
						</LnxInput>
						<LnxInput v-model="claimForm.number">
							Número de siniestro
						</LnxInput>
						<fieldset class="claim-statuses">
							<legend>Estado</legend>
							<label v-for="option in claimStatusOptions" :key="option.value" :style="{ '--claim-color': claimColors[option.value] }">
								<input v-model="claimForm.status" type="radio" class="sr-only" name="claim-status" :value="option.value">
								<span><LnxIcon :icon="claimStatus[option.value].icon" :size="14" />{{ option.label }}</span>
							</label>
						</fieldset>
						<LnxTextarea v-model="claimForm.note" rows="2" placeholder="Visita del perito el martes, piden presupuesto…">
							Qué ha pasado
						</LnxTextarea>
						<footer class="form-actions">
							<LnxButton type="button" mode="clear" @click="claimForm = undefined">
								Cancelar
							</LnxButton>
							<LnxButton type="submit">
								<LnxIcon icon="lucide:check" />
								{{ adminData?.claim ? 'Guardar' : 'Abrir parte' }}
								<Kbd combo="mod+enter" />
							</LnxButton>
						</footer>
					</form>
				</section>

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
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
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
	padding: var(--lnx-spacing-5);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);

	h2 {
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

.history {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);

	li {
		padding: var(--lnx-spacing-2) var(--lnx-spacing-3);
		border-radius: var(--lnx-radius-2);
		background: var(--color-gray-1);

		&.mine {
			background: #e8f1f8;
		}

		&.hidden {
			opacity: .55;
		}

		&.status {
			padding: 0 var(--lnx-spacing-3);
			background: none;
		}
	}

	small {
		color: var(--color-gray-6);
		font-variant-numeric: tabular-nums;
	}

	p {
		white-space: pre-line;
	}
}

// Comments coming in, hidden or shown fade into place
.history li {
	transition: opacity var(--duration) var(--ease-out), translate var(--duration) var(--ease-out), background-color var(--duration) var(--ease-out);
}

.comment-enter-from,
.comment-leave-to {
	opacity: 0;
	translate: 0 4px;
}

.status-change {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--lnx-spacing-2);
	color: var(--color-gray-7);
	font-size: var(--lnx-font-size-small);

	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--status-color);
	}

	.status-label {
		color: var(--status-color);
	}

	small {
		margin-left: auto;
	}
}

.reply {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: var(--lnx-spacing-2);
}

.moderation {
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-1);
}

.box {
	gap: var(--lnx-spacing-4);
}

.box-header {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);

	h2 {
		flex: 1;
	}
}

.box-icon {
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

.provider {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-3);

	div {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	strong {
		font-size: 1.05rem;
		line-height: 1.2;
		text-wrap: balance;
	}

	small {
		color: var(--color-gray-6);
	}
}

.avatar {
	display: flex;
	flex-shrink: 0;
	align-items: center;
	justify-content: center;
	width: 44px;
	height: 44px;
	border-radius: 50%;
	background: var(--color-primary);
	color: var(--color-primary-accent);
	font-weight: var(--lnx-font-weight-bold);
}

.quick-actions {
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-2);
}

.expected {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
	padding: var(--lnx-spacing-2) var(--lnx-spacing-3);
	border-radius: var(--lnx-radius-2);
	background: #e8f6f1;
	color: #0f7a52;
	font-size: var(--lnx-font-size-small);
	font-variant-numeric: tabular-nums;

	&.late {
		background: #fee2e2;
		color: #dc2626;
	}

	&.unset {
		background: var(--color-gray-1);
		color: var(--color-gray-6);
	}
}

.note {
	padding: var(--lnx-spacing-2) var(--lnx-spacing-3);
	border: 1px solid #fde68a;
	border-radius: var(--lnx-radius-2);
	background: #fffbeb;
	color: var(--color-gray-8);
	font-size: var(--lnx-font-size-small);
	white-space: pre-line;

	small {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-bottom: 2px;
		color: #b45309;
		font-size: var(--lnx-font-size-legal);
		font-weight: var(--lnx-font-weight-bold);
		text-transform: uppercase;
		letter-spacing: .04em;
	}
}

.assignment {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
}

.add-provider {
	margin-top: calc(-1 * var(--lnx-spacing-2));
	display: inline-flex;
	align-items: center;
	gap: 4px;
	color: var(--color-primary);
	font-size: var(--lnx-font-size-legal);
}

.quick-dates {
	margin-top: var(--lnx-spacing-1);
	display: flex;
	flex-wrap: wrap;
	gap: 4px;

	button {
		padding: 2px var(--lnx-spacing-2);
		border: 1px solid var(--color-gray-3);
		border-radius: var(--lnx-radius-5);
		background: var(--color-gray-0);
		color: var(--color-gray-7);
		font-size: var(--lnx-font-size-legal);
		cursor: pointer;

		&:hover {
			border-color: var(--color-primary);
			color: var(--color-primary);
		}

		&:active {
			scale: var(--press-scale);
		}
	}
}

.claim-summary {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: var(--lnx-spacing-2);

	> div {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		min-width: 0;
	}
}

.claim-number {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 0;
	border: 0;
	background: none;
	color: var(--color-gray-6);
	font-family: ui-monospace, monospace;
	font-size: var(--lnx-font-size-legal);
	white-space: nowrap;
	cursor: pointer;

	&:hover {
		color: var(--color-primary);
	}
}

.claim-status {
	display: inline-flex;
	flex-shrink: 0;
	align-items: center;
	gap: 4px;
	padding: 2px var(--lnx-spacing-2);
	border-radius: var(--lnx-radius-5);
	background: color-mix(in srgb, var(--claim-color) 14%, var(--color-gray-0));
	color: var(--claim-color);
	font-size: var(--lnx-font-size-legal);
	font-weight: var(--lnx-font-weight-bold);
}

.timeline {
	display: flex;
	flex-direction: column;

	li {
		position: relative;
		display: flex;
		gap: var(--lnx-spacing-2);
		padding-bottom: var(--lnx-spacing-3);

		&:not(:last-child)::before {
			content: '';
			position: absolute;
			top: 22px;
			bottom: 0;
			left: 10px;
			width: 2px;
			background: var(--color-gray-3);
		}

		&:first-child .timeline-icon {
			background: var(--claim-color);
			color: var(--color-gray-0);
		}
	}

	div {
		display: flex;
		flex-direction: column;
		min-width: 0;
		font-size: var(--lnx-font-size-small);
	}

	small {
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-legal);
		font-variant-numeric: tabular-nums;
	}

	p {
		margin-top: 2px;
		color: var(--color-gray-8);
		white-space: pre-line;
	}
}

.timeline-icon {
	display: flex;
	flex-shrink: 0;
	align-items: center;
	justify-content: center;
	width: 22px;
	height: 22px;
	border-radius: 50%;
	background: color-mix(in srgb, var(--claim-color) 14%, var(--color-gray-0));
	color: var(--claim-color);
}

.empty {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: var(--lnx-spacing-3);
}

.claim-statuses {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;

	legend {
		margin-bottom: var(--lnx-spacing-1);
		color: var(--color-gray-7);
		font-size: var(--lnx-font-size-small);
	}

	span {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 4px var(--lnx-spacing-2);
		border: 1px solid var(--color-gray-3);
		border-radius: var(--lnx-radius-5);
		color: var(--color-gray-7);
		font-size: var(--lnx-font-size-legal);
		cursor: pointer;
		transition: background-color var(--duration) var(--ease-out), border-color var(--duration) var(--ease-out), color var(--duration) var(--ease-out), scale var(--duration-fast) var(--ease-out);
	}

	label:hover input:not(:checked) + span {
		background: var(--color-gray-1);
	}

	label:active span {
		scale: var(--press-scale);
	}

	input:checked + span {
		border-color: var(--claim-color);
		background: color-mix(in srgb, var(--claim-color) 14%, var(--color-gray-0));
		color: var(--claim-color);
		font-weight: var(--lnx-font-weight-bold);
	}

	input:focus-visible + span {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
}

.claim {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
}

.form-actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: flex-end;
	gap: var(--lnx-spacing-2);

	.link {
		margin-right: auto;
		color: var(--color-primary);
		font-size: var(--lnx-font-size-small);
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

.hint {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}
</style>
