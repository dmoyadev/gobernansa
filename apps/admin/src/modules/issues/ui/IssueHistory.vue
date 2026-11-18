<script setup lang="ts">
import type { IssueComment } from '@gobernansa/shared/domain/issue.ts';
import type { useIssue } from '../application/useIssues.ts';
import type { usePeople } from '@/modules/people/application/usePeople.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { issueStatus } from '@gobernansa/shared/domain/issue.ts';
import { roles } from '@gobernansa/shared/domain/user.ts';
import { LnxButton, LnxIcon, LnxKbd, LnxTextarea, useConfirm, useShortcut } from 'lnxjs-components';
import { ref } from 'vue';
import { optimistic } from '@/app/ux/toast.ts';
import { setBlocked } from '@/modules/people/application/useModeration.ts';

// The issue's status changes and messages, hiding a comment or blocking its author, and the reply to the neighbours
const props = defineProps<{
	communityId: string;
	comments: IssueComment[];
	people: ReturnType<typeof usePeople>['people']['value'];
	actions: Pick<ReturnType<typeof useIssue>, 'reply' | 'setHidden'>;
}>();

const ask = useConfirm();
const { user: me } = useAuth();
const statusLabels = Object.fromEntries(issueStatus.map(({ value, label }) => [value, label]));

function formatDate(date: Date, timeStyle?: 'short') {
	return date.toLocaleString('es', { dateStyle: 'medium', timeStyle });
}

function toggleHidden(comment: IssueComment) {
	const hidden = !comment.hiddenAt;
	void optimistic(props.actions.setHidden(me.value!.id, comment, hidden), {
		done: hidden ? 'Comentario oculto' : 'Comentario visible',
		failed: 'No se ha podido cambiar el comentario',
		revert: async () => props.actions.setHidden(me.value!.id, comment, !hidden),
	});
}

// Neighbours only, the administration's answers carry their role
function authorOf(comment: IssueComment) {
	return comment.authorRole || comment.authorId === me.value?.id ? undefined : props.people.find(person => person.id === comment.authorId);
}

async function toggleBlocked(comment: IssueComment) {
	const author = authorOf(comment);
	if (!author) {
		return;
	}
	if (author.blocked || await ask({ title: `¿Bloquear a ${author.name}?`, message: 'No podrá crear incidencias ni comentar.', confirmText: 'Bloquear', variant: 'danger' })) {
		const blocked = !author.blocked;
		void optimistic(setBlocked(author.id, props.communityId, blocked, author.name), {
			done: blocked ? 'Vecino bloqueado' : 'Vecino desbloqueado',
			failed: 'No se ha podido cambiar el bloqueo',
			revert: async () => setBlocked(author.id, props.communityId, !blocked, author.name),
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
	void optimistic(props.actions.reply(me.value!, text), {
		failed: 'No se ha podido enviar',
		onError: () => message.value ||= text,
	});
}

// Sends the form being written in, or else the reply
useShortcut('mod+enter', () => {
	const form = document.activeElement?.closest('form');
	if (form) {
		form.requestSubmit();
	} else {
		sendReply();
	}
}, { description: 'Enviar el formulario o la respuesta' });
</script>

<template>
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
						<LnxButton mode="clear" class="lnx-size-small" @click="toggleHidden(comment)">
							<LnxIcon :icon="comment.hiddenAt ? 'lucide:eye' : 'lucide:eye-off'" />
							{{ comment.hiddenAt ? 'Mostrar' : 'Ocultar' }}
						</LnxButton>
						<LnxButton v-if="authorOf(comment)" mode="clear" class="lnx-size-small" @click="toggleBlocked(comment)">
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
				<LnxKbd combo="mod+enter" />
			</LnxButton>
		</form>
	</section>
</template>

<style lang="scss" scoped>
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
</style>
