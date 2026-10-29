<script setup lang="ts">
import type { Issue, IssueComment } from '@gobernansa/shared/domain/issue.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { issueStatus } from '@gobernansa/shared/domain/issue.ts';
import { timeAgo } from '@gobernansa/shared/utils/helpers.ts';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed, ref, toRef } from 'vue';
import { useIssueComments } from '../application/useIssueComments.ts';

const props = defineProps<{ issue: Issue }>();

const { user } = useAuth();
const { comments, addComment, deleteComment } = useIssueComments(toRef(props, 'issue'));
// Counted here, the stored counter is missing on issues from before comments existed
const messagesCount = computed(() => comments.value.filter(comment => comment.type !== 'status').length);

const message = ref('');
const sending = ref(false);
const error = ref<string>();

async function send() {
	const text = message.value.trim();
	if (!text || sending.value) {
		return;
	}

	sending.value = true;
	error.value = undefined;
	try {
		await addComment(text);
		message.value = '';
	} catch (e) {
		// eslint-disable-next-line no-console
		console.error(e);
		error.value = 'No se ha podido enviar. Revisa tu conexión e inténtalo de nuevo.';
	} finally {
		sending.value = false;
	}
}

async function remove(comment: IssueComment) {
	// eslint-disable-next-line no-alert
	if (!window.confirm('¿Eliminar tu comentario?')) {
		return;
	}

	error.value = undefined;
	try {
		await deleteComment(comment);
	} catch (e) {
		// eslint-disable-next-line no-console
		console.error(e);
		error.value = 'No se ha podido eliminar. Revisa tu conexión e inténtalo de nuevo.';
	}
}

function isMine(comment: IssueComment) {
	return comment.authorId === user.value?.id;
}

function authorName(comment: IssueComment) {
	if (isMine(comment)) {
		return 'Tú';
	}
	return comment.authorName || (comment.authorRole ? 'Administración' : 'Un vecino');
}
</script>

<template>
	<section class="comments">
		<h2>
			Comentarios
			<span v-if="messagesCount" class="count">{{ messagesCount }}</span>
		</h2>

		<ol>
			<template v-for="comment in comments" :key="comment.id">
				<li v-if="comment.type === 'status'" class="status-change">
					<LnxIcon icon="lucide:refresh-cw" :size="14" />
					<span>
						{{ authorName(comment) }} {{ isMine(comment) ? 'cambiaste' : 'cambió' }} el estado a
						<strong :style="{ color: `var(--color-issue-status-${comment.status})` }">
							{{ issueStatus.find(({ value }) => value === comment.status)?.label }}
						</strong>
						<template v-if="comment.createdAt">
							· {{ timeAgo(comment.createdAt.toDate()) }}
						</template>
					</span>
				</li>

				<li v-else class="message" :class="{ mine: isMine(comment) }">
					<div class="bubble">
						<header>
							<strong>{{ authorName(comment) }}</strong>
							<span v-if="comment.authorRole" class="badge">Administración</span>
							<time v-if="comment.createdAt" :datetime="comment.createdAt.toDate().toISOString()">
								{{ timeAgo(comment.createdAt.toDate()) }}
							</time>
						</header>
						<p>{{ comment.message }}</p>
					</div>
					<LnxButton
						v-if="isMine(comment)"
						class="delete"
						mode="clear"
						variant="grayscale"
						shape="circle"
						size="small"
						aria-label="Eliminar tu comentario"
						@click="remove(comment)"
					>
						<LnxIcon icon="lucide:trash-2" :size="16" />
					</LnxButton>
				</li>
			</template>

			<li v-if="!comments.length" class="empty">
				Aún no hay comentarios.{{ user?.blocked ? '' : ' ¿Sabes algo más? Cuéntalo aquí.' }}
			</li>
		</ol>

		<!-- Blocked neighbours, and whoever is viewing the community as a neighbour, can't comment (the rules reject it too) -->
		<form v-if="!user?.blocked" @submit.prevent="send()">
			<textarea
				v-model="message"
				rows="2"
				maxlength="1000"
				placeholder="Escribe un comentario…"
				aria-label="Comentario"
				:disabled="sending"
				@keydown.enter.meta.prevent="send()"
				@keydown.enter.ctrl.prevent="send()"
			/>
			<LnxButton
				type="submit"
				shape="circle"
				aria-label="Enviar comentario"
				:is-loading="sending"
				:disabled="sending || !message.trim()"
			>
				<LnxIcon icon="lucide:send" />
			</LnxButton>
		</form>

		<p v-if="error" class="error" role="alert">
			<LnxIcon icon="lucide:circle-alert" :size="16" />
			{{ error }}
		</p>
		<small v-if="!user?.blocked" class="hint">Toda la comunidad podrá verlo.</small>
	</section>
</template>

<style scoped lang="scss">
.comments {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
}

h2 {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
	font-size: var(--lnx-font-size-small);
	font-weight: var(--lnx-font-weight-bold);
	color: var(--color-gray-6);
	text-transform: uppercase;
	letter-spacing: .04em;

	.count {
		padding: 0 var(--lnx-spacing-2);
		border-radius: var(--lnx-radius-4);
		background: var(--color-gray-2);
		color: var(--color-gray-7);
	}
}

ol {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
}

.status-change {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: var(--lnx-spacing-2);
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
	text-align: center;
}

.message {
	display: flex;
	align-items: flex-start;
	gap: var(--lnx-spacing-1);
	max-width: 90%;

	&.mine {
		align-self: flex-end;
		flex-direction: row-reverse;

		.bubble {
			border-color: transparent;
			border-radius: var(--lnx-radius-3) 0 var(--lnx-radius-3) var(--lnx-radius-3);
			background: var(--color-primary);
			color: var(--color-primary-accent);

			header strong,
			time {
				color: var(--color-primary-accent-alpha);
			}
		}
	}
}

.bubble {
	min-width: 0;
	padding: var(--lnx-spacing-2) var(--lnx-spacing-3);
	border: 1px solid var(--color-gray-3);
	border-radius: 0 var(--lnx-radius-3) var(--lnx-radius-3) var(--lnx-radius-3);
	background: var(--color-gray-0);
	color: var(--color-gray-9);

	header {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 var(--lnx-spacing-2);
		font-size: var(--lnx-font-size-small);

		strong {
			color: var(--color-gray-8);
		}
	}

	.badge {
		padding: 0 var(--lnx-spacing-1);
		border-radius: var(--lnx-radius-2);
		background: var(--color-issue-cat-services);
		color: var(--color-issue-cat-services-accent);
		font-size: .65rem;
		font-weight: var(--lnx-font-weight-bold);
		text-transform: uppercase;
	}

	time {
		color: var(--color-gray-6);
	}

	p {
		line-height: 1.4;
		white-space: pre-line;
		overflow-wrap: anywhere;
	}
}

.delete {
	flex-shrink: 0;
}

.empty {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

form {
	display: flex;
	align-items: flex-end;
	gap: var(--lnx-spacing-2);

	// Same look as LnxInput, which has no multiline version
	textarea {
		flex: 1;
		padding: 8px;
		border: 1px solid var(--lnx-color-gray-5);
		border-radius: var(--lnx-radius-3);
		font-size: var(--lnx-font-size-body);
		resize: vertical;

		&::placeholder {
			color: var(--lnx-color-gray-3);
		}
	}
}

.error {
	display: flex;
	align-items: flex-start;
	gap: var(--lnx-spacing-2);
	color: var(--lnx-color-danger);
	font-size: var(--lnx-font-size-small);
}

.hint {
	margin-top: calc(-1 * var(--lnx-spacing-2));
	color: var(--color-gray-6);
}
</style>
