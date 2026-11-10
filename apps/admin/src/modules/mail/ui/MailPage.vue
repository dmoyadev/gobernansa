<script setup lang="ts">
import type { Mail } from '@gobernansa/shared/domain/mail.ts';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { deliveryStates, mailKinds, mailStatus, statusOf } from '@gobernansa/shared/domain/mail.ts';
import { db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { timeAgo } from '@gobernansa/shared/utils/helpers.ts';
import { collection, getDocs, limit, query, startAfter, where } from 'firebase/firestore';
import { LnxButton, LnxIcon, LnxSelect } from 'lnxjs-components';
import { computed, ref, watch } from 'vue';
import BackButton from '@/app/ux/BackButton.vue';
import { onRevalidate } from '@/app/ux/navigation.ts';
import { useCommunities } from '@/modules/communities/application/useCommunities.ts';
import { MAIL_MODE } from '../application/mail.ts';

const PAGE_SIZE = 25;
// The most values Firestore takes in an 'in' filter
const MAX_IN = 30;

const mailRef = collection(db, 'mail');
const { user } = useAuth();
const { communities } = useCommunities();

// A query only reaches the communities the user manages: the team all, the rest theirs, from their profile
const isSuperadmin = user.value?.role === 'superadmin';
const managedIds = user.value?.role === 'admin' ? user.value.communityIds ?? [] : [user.value?.communityId ?? ''].filter(Boolean);
// ponytail: past 30 communities one 'in' can't take them all, so they're seen one at a time; merge several queries if a portfolio gets there
const canSeeAll = isSuperadmin || managedIds.length <= MAX_IN;
const communityId = ref(canSeeAll ? '' : managedIds[0]);
const communityOptions = computed(() => [
	...(canSeeAll ? [{ value: '', label: 'Todas' }] : []),
	...communities.value.map(community => ({ value: community.id, label: community.name || 'Sin nombre' })),
]);
const communityNames = computed(() => new Map(communities.value.map(community => [community.id, community.name || 'Sin nombre'])));

const mails = ref<Mail[]>([]);
const last = ref<QueryDocumentSnapshot>();
const hasMore = ref(false);
const loading = ref(false);
const error = ref<string>();
// Changing the community while a page loads only keeps the last one asked for
let latestLoad = 0;

// A page at a time and once, not live: each page added only reads its own. In id order, which is newest first (mailId)
async function load(more = false) {
	const scope = communityId.value
		? [where('communityId', '==', communityId.value)]
		: isSuperadmin ? [] : [where('communityId', 'in', managedIds)];
	if (!communityId.value && !isSuperadmin && !managedIds.length) {
		return;
	}

	const current = ++latestLoad;
	loading.value = true;
	error.value = undefined;
	try {
		const snapshot = await getDocs(query(mailRef, ...scope, ...(more && last.value ? [startAfter(last.value)] : []), limit(PAGE_SIZE)));
		if (current !== latestLoad) {
			return;
		}
		const page = snapshot.docs.map(mail => ({ ...mail.data(), id: mail.id }) as Mail);
		mails.value = more ? [...mails.value, ...page] : page;
		last.value = snapshot.docs.at(-1) ?? (more ? last.value : undefined);
		hasMore.value = snapshot.size === PAGE_SIZE;
	} catch (e) {
		if (current === latestLoad) {
			error.value = (e as Error).message;
		}
	} finally {
		if (current === latestLoad) {
			loading.value = false;
		}
	}
}
watch(communityId, () => load(), { immediate: true });
// Coming back reads the first page again
onRevalidate(() => load());

const open = ref<string>();
const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'full', timeStyle: 'short' });
</script>

<template>
	<header class="page-header">
		<BackButton to="/" label="Volver" />
		<h1>Correo saliente</h1>
	</header>

	<p v-if="MAIL_MODE === 'demo'" class="mode">
		<LnxIcon icon="lucide:flask-conical" />
		<span>
			<strong>Modo de prueba: no se envía ningún correo.</strong>
			Las invitaciones, convocatorias, actas, partes de trabajo y reclamaciones quedan aquí tal y como saldrán cuando se active el envío.
		</span>
	</p>
	<p v-else class="hint">
		Los envía la extensión Trigger Email de Firebase, que anota en cada uno cómo fue la entrega.
	</p>

	<div class="filters">
		<LnxSelect
			v-model.convert="communityId"
			:options="communityOptions"
			:convert-fn="option => option.value"
		>
			Comunidad
			<template #option="{ option }">
				{{ option.label }}
			</template>
			<template #optionInput="{ value }">
				{{ communityOptions.find(option => option.value === value)?.label }}
			</template>
		</LnxSelect>
	</div>

	<section class="card" :aria-busy="loading && !mails.length">
		<p v-if="error" class="error" role="alert">
			No se ha podido cargar: {{ error }}
		</p>

		<ul v-if="loading && !mails.length" class="list">
			<li v-for="width in [70, 50, 80, 60]" :key="width" class="mail">
				<div class="row">
					<span class="lnx-skeleton lnx-skeleton--circle" />
					<div class="what">
						<span class="lnx-skeleton" :style="{ width: `${width}%` }" />
						<span class="lnx-skeleton lnx-skeleton--small" style="width: 40%" />
					</div>
				</div>
			</li>
		</ul>
		<ul v-else-if="mails.length" class="list lnx-appear">
			<li v-for="mail in mails" :key="mail.id" class="mail">
				<button type="button" class="row" :aria-expanded="open === mail.id" @click="open = open === mail.id ? undefined : mail.id">
					<LnxIcon :icon="mailKinds[mail.kind]?.icon ?? 'lucide:mail'" :title="mailKinds[mail.kind]?.label" />
					<span class="what">
						<strong>{{ mail.message.subject }}</strong>
						<small>
							Para {{ mail.to.join(', ') }}
							<template v-if="mail.communityId"> · {{ communityNames.get(mail.communityId) ?? 'Otra comunidad' }}</template>
							<!-- Pending writes have no server date yet -->
							<template v-if="mail.createdAt">
								· <time :datetime="mail.createdAt.toDate().toISOString()" :title="dateFormat.format(mail.createdAt.toDate())">{{ timeAgo(mail.createdAt.toDate()) }}</time>
							</template>
						</small>
					</span>
					<span class="status" :class="`is-${statusOf(mail)}`">
						<LnxIcon :icon="mailStatus[statusOf(mail)].icon" :size="14" />
						{{ mailStatus[statusOf(mail)].label }}
					</span>
				</button>

				<div v-if="open === mail.id" class="preview">
					<dl>
						<dt>Tipo</dt>
						<dd>{{ mailKinds[mail.kind]?.label }}</dd>
						<template v-if="mail.replyTo">
							<dt>Responder a</dt>
							<dd>{{ mail.replyTo }}</dd>
						</template>
						<template v-if="mail.delivery">
							<dt>Entrega</dt>
							<dd>
								{{ deliveryStates[mail.delivery.state] ?? mail.delivery.state }}<template v-if="mail.delivery.attempts">
									· {{ mail.delivery.attempts }} {{ mail.delivery.attempts === 1 ? 'intento' : 'intentos' }}
								</template><template v-if="mail.delivery.endTime">
									· {{ dateFormat.format(mail.delivery.endTime.toDate()) }}
								</template>
							</dd>
						</template>
						<template v-if="mail.delivery?.error">
							<dt>Error</dt>
							<dd class="error">
								{{ mail.delivery.error }}
							</dd>
						</template>
					</dl>
					<RouterLink v-if="mail.link" :to="mail.link" class="related">
						Ver de dónde viene
						<LnxIcon icon="lucide:arrow-right" :size="14" />
					</RouterLink>
					<!-- No scripts nor same origin: only its links, which open in a new tab -->
					<iframe :srcdoc="mail.message.html" sandbox="allow-popups allow-popups-to-escape-sandbox" :title="`Vista previa de «${mail.message.subject}»`" />
				</div>
			</li>
		</ul>
		<p v-else-if="!error" class="hint">
			Aún no hay correos.
		</p>

		<LnxButton v-if="hasMore" mode="clear" :is-loading="loading" @click="load(true)">
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
		font-size: var(--lnx-font-size-title);
	}
}

.mode {
	margin-bottom: var(--lnx-spacing-4);
	padding: var(--lnx-spacing-3) var(--lnx-spacing-4);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-2);
	color: var(--color-gray-8);
	font-size: var(--lnx-font-size-small);
	display: flex;
	align-items: flex-start;
	gap: var(--lnx-spacing-2);

	iconify-icon {
		flex: none;
		margin-top: 2px;
	}
}

.hint {
	margin-bottom: var(--lnx-spacing-4);
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.filters {
	margin-bottom: var(--lnx-spacing-4);

	> * {
		width: 260px;
		max-width: 100%;
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
	gap: var(--lnx-spacing-4);
}

.list {
	display: flex;
	flex-direction: column;
}

.mail + .mail {
	border-top: 1px solid var(--color-gray-3);
}

.row {
	width: calc(100% + 2 * var(--lnx-spacing-2));
	margin: 0 calc(-1 * var(--lnx-spacing-2));
	padding: var(--lnx-spacing-3) var(--lnx-spacing-2);
	border: 0;
	border-radius: var(--lnx-radius-2);
	background: none;
	color: inherit;
	font: inherit;
	text-align: left;
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto;
	align-items: center;
	gap: var(--lnx-spacing-3);
	cursor: pointer;

	&:hover {
		background: var(--color-gray-1);
	}

	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
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
		overflow-wrap: anywhere;
	}
}

.status {
	padding: 2px var(--lnx-spacing-2);
	border-radius: 999px;
	font-size: var(--lnx-font-size-legal);
	font-weight: var(--lnx-font-weight-bold);
	white-space: nowrap;
	display: inline-flex;
	align-items: center;
	gap: var(--lnx-spacing-1);

	&.is-test {
		background: var(--color-gray-2);
		color: var(--color-gray-7);
	}

	&.is-pending {
		background: #fef3c7;
		color: #92400e;
	}

	&.is-sent {
		background: #dcfce7;
		color: #166534;
	}

	&.is-error {
		background: #fee2e2;
		color: #991b1b;
	}
}

.preview {
	padding: 0 0 var(--lnx-spacing-4);
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);

	dl {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: var(--lnx-spacing-1) var(--lnx-spacing-3);
		font-size: var(--lnx-font-size-small);
	}

	dt {
		color: var(--color-gray-6);
	}

	dd {
		overflow-wrap: anywhere;
	}

	iframe {
		width: 100%;
		height: 520px;
		border: 1px solid var(--color-gray-3);
		border-radius: var(--lnx-radius-2);
		background: #f7fafc;
	}
}

.related {
	align-self: flex-start;
	display: inline-flex;
	align-items: center;
	gap: var(--lnx-spacing-1);
	color: var(--color-primary);
	font-size: var(--lnx-font-size-small);
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}

@media (max-width: 640px) {
	.row {
		grid-template-columns: auto minmax(0, 1fr);

		.status {
			grid-column: 2;
			justify-self: start;
		}
	}
}
</style>
