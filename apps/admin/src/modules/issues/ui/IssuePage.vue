<script setup lang="ts">
import type { ClaimStatus, IssueComment, IssueStatus } from '@gobernansa/shared/domain/issue.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { claimStatus, issueLocationTypes, issuesCategories, issueStatus } from '@gobernansa/shared/domain/issue.ts';
import { roles } from '@gobernansa/shared/domain/user.ts';
import { LnxButton, LnxIcon, LnxInput, LnxSelect } from 'lnxjs-components';
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { setBlocked } from '@/modules/people/application/useModeration.ts';
import { usePeople } from '@/modules/people/application/usePeople.ts';
import { useProviders } from '@/modules/providers/application/useProviders.ts';
import { useIssue } from '../application/useIssues.ts';

const props = defineProps<{ id: string; issueId: string }>();

const router = useRouter();
const { user: me } = useAuth();
const { issue, adminData, comments, loading, error, changeStatus, assign, saveClaim, reply, setHidden, remove } = useIssue(props.id, props.issueId);
// To name who reported it, issues only keep their id
const { people } = usePeople(props.id);
const { providers } = useProviders(props.id);

const category = computed(() => issuesCategories.find(option => option.value === issue.value?.category));
const reporter = computed(() => people.value.find(person => person.id === issue.value?.createdBy)?.name);
const statusLabels = Object.fromEntries(issueStatus.map(({ value, label }) => [value, label]));
const VIDEO_REGEX = /\/video\//;

const busy = ref(false);
// Shown in the card where it failed, so it's seen next to what was done
const actionError = ref<{ section: 'status' | 'assignment' | 'claim' | 'comments'; message: string }>();

async function run(action: () => Promise<void>, failure: string, section: NonNullable<typeof actionError.value>['section']) {
	busy.value = true;
	actionError.value = undefined;
	try {
		await action();
	} catch (e) {
		actionError.value = { section, message: `${failure}: ${(e as Error).message}` };
	} finally {
		busy.value = false;
	}
}

async function setStatus(status: IssueStatus) {
	if (status !== issue.value?.status) {
		await run(async () => changeStatus(me.value!, status), 'No se ha podido cambiar el estado', 'status');
	}
}

// Filled with what's saved each time it changes, also after saving
const assignment = ref({ providerId: '', expectedAt: '', note: '' });
watch(() => [issue.value?.provider?.id, issue.value?.expectedAt?.toMillis(), adminData.value?.note], () => {
	assignment.value = {
		providerId: issue.value?.provider?.id ?? '',
		expectedAt: issue.value?.expectedAt ? toDateString(issue.value.expectedAt.toDate()) : '',
		note: adminData.value?.note ?? '',
	};
}, { immediate: true });

const providerOptions = computed(() => [{ value: '', label: 'Sin asignar' }, ...providers.value.map(provider => ({ value: provider.id, label: provider.name }))]);
const selectedProvider = computed(() => providers.value.find(provider => provider.id === assignment.value.providerId));

// To send the provider what to fix from their own mail app
const providerMail = computed(() => {
	const email = selectedProvider.value?.email;
	if (!email || !issue.value) {
		return undefined;
	}
	const where = issue.value.location ? `\nUbicación: ${issueLocationTypes[issue.value.location.type]}${issue.value.location.reference ? `: ${issue.value.location.reference}` : ''}` : '';
	const when = assignment.value.expectedAt ? `\nFecha prevista: ${new Date(`${assignment.value.expectedAt}T00:00`).toLocaleDateString('es')}` : '';
	const body = `${issue.value.title}\n\n${issue.value.description || ''}${where}${when}${issue.value.assets?.length ? `\n\nFotos:\n${issue.value.assets.join('\n')}` : ''}`;
	return `mailto:${email}?subject=${encodeURIComponent(`Incidencia: ${issue.value.title}`)}&body=${encodeURIComponent(body)}`;
});

async function saveAssignment() {
	const { providerId, expectedAt, note } = assignment.value;
	// A provider removed from the directory stays assigned until it's changed
	const provider = selectedProvider.value ?? (providerId === issue.value?.provider?.id ? issue.value.provider : undefined);
	await run(async () => assign(me.value!, provider, expectedAt ? new Date(`${expectedAt}T00:00`) : undefined, note.trim()), 'No se ha podido guardar la asignación', 'assignment');
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
	const community = await loadCommunity(props.id).catch(() => undefined);
	const insurer = community?.contacts?.find(contact => contact.type === 'insurance')?.name;
	if (insurer && claimForm.value && !claimForm.value.insurer) {
		claimForm.value.insurer = insurer;
	}
}

async function submitClaim() {
	const form = claimForm.value!;
	await run(async () => {
		await saveClaim(me.value!, { insurer: form.insurer.trim(), number: form.number.trim(), status: form.status, note: form.note.trim() });
		claimForm.value = undefined;
	}, 'No se ha podido guardar el parte', 'claim');
}

async function toggleHidden(comment: IssueComment) {
	await run(async () => setHidden(me.value!.id, comment, !comment.hiddenAt), 'No se ha podido cambiar el comentario', 'comments');
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
		await run(async () => setBlocked(author.id, props.id, !author.blocked, author.name), 'No se ha podido cambiar el bloqueo', 'comments');
	}
}

const message = ref('');

async function sendReply() {
	await run(async () => {
		await reply(me.value!, message.value.trim());
		message.value = '';
	}, 'No se ha podido enviar', 'comments');
}

async function deleteIssue() {
	// eslint-disable-next-line no-alert
	if (window.confirm('¿Borrar esta incidencia? Dejará de verse en la app.')) {
		await run(async () => {
			await remove(me.value!.id);
			await router.push(`/communities/${props.id}/issues`);
		}, 'No se ha podido borrar', 'status');
	}
}
</script>

<template>
	<header class="page-header">
		<LnxButton :to="`/communities/${id}/issues`" mode="clear" shape="circle" aria-label="Volver a incidencias">
			<LnxIcon icon="lucide:arrow-left" />
		</LnxButton>
		<h1>
			<span v-if="loading" class="skeleton-item skeleton-item--title" />
			<template v-else>
				{{ issue?.title || 'Incidencia' }}
			</template>
		</h1>
	</header>

	<p v-if="error" class="error" role="alert">
		No se ha podido cargar: {{ error.message }}
	</p>
	<p v-else-if="!loading && (!issue || issue.deletedAt)" class="hint">
		Esta incidencia no existe o se ha borrado.
	</p>

	<template v-else-if="issue">
		<section class="card">
			<p class="meta">
				<LnxIcon :icon="category?.icon ?? 'lucide:triangle-alert'" :size="18" />
				{{ category?.label }}
				<template v-if="reporter">
					· {{ reporter }}
				</template>
				<template v-if="issue.createdAt">
					· {{ issue.createdAt.toDate().toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' }) }}
				</template>
				· {{ issue.votesScore }} votos ({{ issue.votesCount }})
			</p>
			<p v-if="issue.location" class="meta">
				<LnxIcon icon="lucide:map-pin" :size="18" />
				{{ issueLocationTypes[issue.location.type] }}<template v-if="issue.location.reference">
					: {{ issue.location.reference }}
				</template>
			</p>
			<p class="description">
				{{ issue.description || 'Sin descripción' }}
			</p>
			<ul v-if="issue.assets?.length" class="assets">
				<li v-for="asset in issue.assets" :key="asset">
					<a :href="asset" target="_blank" rel="noopener">
						<video v-if="VIDEO_REGEX.test(asset)" :src="asset" muted preload="metadata" />
						<img v-else :src="asset" alt="Foto de la incidencia" loading="lazy">
					</a>
				</li>
			</ul>
		</section>

		<section class="card">
			<h2>Estado</h2>
			<fieldset class="chips" :disabled="busy">
				<legend class="sr-only">
					Estado
				</legend>
				<label v-for="option in issueStatus" :key="option.value">
					<input type="radio" class="sr-only" name="status" :checked="issue.status === option.value" @change="setStatus(option.value)">
					<span>{{ option.label }}</span>
				</label>
			</fieldset>
			<p v-if="actionError?.section === 'status'" class="error" role="alert">
				{{ actionError.message }}
			</p>
		</section>

		<form class="card" @submit.prevent="saveAssignment()">
			<h2>Asignación</h2>
			<div class="fields">
				<LnxSelect
					v-model.convert="assignment.providerId"
					:options="providerOptions"
					:convert-fn="option => option.value"
					search-placeholder-text="Buscar..."
				>
					Proveedor
					<template #option="{ option }">
						{{ option.label }}
					</template>
					<template #optionInput="{ value }">
						{{ providerOptions.find(option => option.value === value)?.label ?? issue.provider?.name }}
					</template>
				</LnxSelect>
				<LnxInput v-model="assignment.expectedAt" type="date">
					Fecha prevista
				</LnxInput>
				<label class="textarea wide">
					Nota interna (los vecinos no la ven)
					<textarea v-model="assignment.note" rows="3" />
				</label>
			</div>
			<p v-if="actionError?.section === 'assignment'" class="error" role="alert">
				{{ actionError.message }}
			</p>
			<footer class="form-actions">
				<RouterLink to="/providers" class="link">
					Añadir proveedor
				</RouterLink>
				<LnxButton v-if="providerMail" :href="providerMail" mode="outline">
					<LnxIcon icon="lucide:mail" />
					Avisar por email
				</LnxButton>
				<LnxButton type="submit" :is-loading="busy">
					<LnxIcon icon="lucide:save" />
					Guardar
				</LnxButton>
			</footer>
		</form>

		<section class="card">
			<h2>Parte al seguro</h2>
			<template v-if="adminData?.claim">
				<p>
					<strong>{{ adminData.claim.insurer }}</strong> · Siniestro {{ adminData.claim.number || 'sin número' }} ·
					{{ claimStatus[adminData.claim.status].label }}
				</p>
				<ol class="history">
					<li v-for="entry in adminData.claim.history" :key="entry.at.toMillis()">
						<small>{{ entry.at.toDate().toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }) }} · {{ claimStatus[entry.status].label }}</small>
						<p v-if="entry.note">
							{{ entry.note }}
						</p>
					</li>
				</ol>
			</template>
			<p v-else-if="!claimForm" class="hint">
				No hay ningún parte abierto.
			</p>

			<form v-if="claimForm" class="claim" @submit.prevent="submitClaim()">
				<div class="fields">
					<LnxInput v-model="claimForm.insurer" required>
						Aseguradora
					</LnxInput>
					<LnxInput v-model="claimForm.number">
						Número de siniestro
					</LnxInput>
					<LnxSelect
						v-model.convert="claimForm.status"
						:options="claimStatusOptions"
						:convert-fn="option => option.value"
						search-placeholder-text="Buscar..."
					>
						Estado
						<template #option="{ option }">
							{{ option.label }}
						</template>
						<template #optionInput="{ value }">
							{{ claimStatus[value as ClaimStatus]?.label }}
						</template>
					</LnxSelect>
					<label class="textarea wide">
						Qué ha pasado
						<textarea v-model="claimForm.note" rows="2" />
					</label>
				</div>
				<p v-if="actionError?.section === 'claim'" class="error" role="alert">
					{{ actionError.message }}
				</p>
				<footer class="form-actions">
					<LnxButton mode="clear" @click="claimForm = undefined">
						Cancelar
					</LnxButton>
					<LnxButton type="submit" :is-loading="busy">
						<LnxIcon icon="lucide:save" />
						{{ adminData?.claim ? 'Guardar cambios' : 'Abrir parte' }}
					</LnxButton>
				</footer>
			</form>
			<footer v-else class="form-actions">
				<LnxButton mode="outline" @click="openClaimForm()">
					<LnxIcon :icon="adminData?.claim ? 'lucide:pencil' : 'lucide:file-plus'" />
					{{ adminData?.claim ? 'Actualizar parte' : 'Abrir parte al seguro' }}
				</LnxButton>
			</footer>
		</section>

		<section class="card">
			<h2>Historial</h2>
			<ol v-if="comments.length" class="history">
				<li v-for="comment in comments" :key="comment.id" :class="{ status: comment.type === 'status', hidden: comment.hiddenAt }">
					<small>
						<strong>{{ comment.authorName || 'Vecino' }}</strong>
						<template v-if="comment.authorRole"> ({{ roles[comment.authorRole]?.label }})</template>
						<template v-if="comment.createdAt"> · {{ comment.createdAt.toDate().toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }) }}</template>
						<template v-if="comment.hiddenAt"> · Oculto</template>
						<template v-if="authorOf(comment)?.blocked"> · Bloqueado</template>
					</small>
					<p v-if="comment.type === 'status'">
						Ha cambiado el estado a «{{ statusLabels[comment.status!] }}»
					</p>
					<template v-else>
						<p>
							{{ comment.message }}
						</p>
						<div class="moderation">
							<LnxButton mode="clear" size="small" :disabled="busy" @click="toggleHidden(comment)">
								<LnxIcon :icon="comment.hiddenAt ? 'lucide:eye' : 'lucide:eye-off'" />
								{{ comment.hiddenAt ? 'Mostrar' : 'Ocultar' }}
							</LnxButton>
							<LnxButton v-if="authorOf(comment)" mode="clear" size="small" :disabled="busy" @click="toggleBlocked(comment)">
								<LnxIcon :icon="authorOf(comment)?.blocked ? 'lucide:user-check' : 'lucide:user-x'" />
								{{ authorOf(comment)?.blocked ? 'Desbloquear vecino' : 'Bloquear vecino' }}
							</LnxButton>
						</div>
					</template>
				</li>
			</ol>
			<p v-else class="hint">
				Aún no hay comentarios.
			</p>

			<p v-if="actionError?.section === 'comments'" class="error" role="alert">
				{{ actionError.message }}
			</p>
			<form class="reply" @submit.prevent="sendReply()">
				<label class="sr-only" for="reply">Responder</label>
				<textarea id="reply" v-model="message" rows="3" placeholder="Responder a los vecinos…" required />
				<LnxButton type="submit" :is-loading="busy" :disabled="!message.trim()">
					<LnxIcon icon="lucide:send" />
					Responder
				</LnxButton>
			</form>
		</section>

		<footer class="danger">
			<LnxButton mode="clear" variant="danger" :disabled="busy" @click="deleteIssue()">
				<LnxIcon icon="lucide:trash-2" />
				Borrar incidencia
			</LnxButton>
		</footer>
	</template>
</template>

<style lang="scss" scoped>
.page-header {
	margin-bottom: var(--lnx-spacing-5);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);

	h1 {
		flex: 1;
		min-width: 0;
		font-size: var(--lnx-font-size-title);
	}
}

.card {
	margin-bottom: var(--lnx-spacing-5);
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

.meta {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--lnx-spacing-1);
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.description {
	white-space: pre-line;
}

.assets {
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-2);

	:is(img, video) {
		display: block;
		width: 120px;
		height: 90px;
		border-radius: var(--lnx-radius-2);
		object-fit: cover;
	}
}

.chips {
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

	&:disabled span {
		cursor: default;
		opacity: .6;
	}
}

.history {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);

	li {
		padding-left: var(--lnx-spacing-3);
		border-left: 2px solid var(--color-gray-3);

		&.hidden {
			color: var(--color-gray-5);
		}

		&.status {
			border-color: var(--color-primary-light);
			color: var(--color-gray-6);
			font-style: italic;
		}
	}

	small {
		color: var(--color-gray-6);
	}

	p {
		white-space: pre-line;
	}
}

.reply {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: var(--lnx-spacing-2);

	textarea {
		width: 100%;
		padding: var(--lnx-spacing-3);
		border: 1px solid var(--color-gray-4);
		border-radius: var(--lnx-radius-2);
		font: inherit;
		resize: vertical;

		&:focus-visible {
			outline: 2px solid var(--color-primary);
			outline-offset: 1px;
		}
	}
}

.moderation {
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-1);
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

.textarea {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-1);
	font-size: var(--lnx-font-size-small);

	textarea {
		padding: var(--lnx-spacing-3);
		border: 1px solid var(--color-gray-4);
		border-radius: var(--lnx-radius-2);
		font: inherit;
		font-size: var(--lnx-font-size-body);
		resize: vertical;

		&:focus-visible {
			outline: 2px solid var(--color-primary);
			outline-offset: 1px;
		}
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

.danger {
	display: flex;
	justify-content: flex-end;
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
