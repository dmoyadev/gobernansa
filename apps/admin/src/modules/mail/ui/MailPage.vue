<script setup lang="ts">
import type { Mail } from '@gobernansa/shared/domain/mail.ts';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { errorMessage } from '@gobernansa/shared/application/errors.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { deliveryStates, mailKinds, mailStatus, statusOf } from '@gobernansa/shared/domain/mail.ts';
import { normalize, timeAgo } from '@gobernansa/shared/utils/helpers.ts';
import { LnxButton, LnxIcon, LnxInput, LnxKbd, LnxSelect, useShortcut } from 'lnxjs-components';
import { computed, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BackButton from '@/app/ux/BackButton.vue';
import { onRevalidate } from '@/app/ux/navigation.ts';
import { useCommunities } from '@/modules/communities/application/useCommunities.ts';
import { loadMail, MAIL_MODE, MAX_IN } from '../application/mail.ts';

const { user } = useAuth();
const { communities } = useCommunities();

// A query only reaches the communities the user manages: the team all, the rest theirs, from their profile
const isSuperadmin = user.value?.role === 'superadmin';
const managedIds = user.value?.role === 'admin' ? user.value.communityIds ?? [] : [user.value?.communityId ?? ''].filter(Boolean);
// ponytail: past 30 communities one 'in' can't take them all, so they're seen one at a time; merge several queries if a portfolio gets there
const canSeeAll = isSuperadmin || managedIds.length <= MAX_IN;
const route = useRoute();
const router = useRouter();
const path = route.path;
// In the URL, so a reload or a shared link keeps it: one the user manages, the first when they can't see all at once.
// Kept alive, the page only follows its own
const communityId = computed({
	get: (previous?: string) => {
		if (route.path !== path) {
			return previous ?? '';
		}
		const value = route.query.community;
		return typeof value === 'string' && (isSuperadmin || managedIds.includes(value)) ? value : canSeeAll ? '' : managedIds[0];
	},
	set: value => void router.replace({ query: { ...route.query, community: value || undefined } }),
});
const communityOptions = computed(() => [
	...(canSeeAll ? [{ value: '', label: 'Todas' }] : []),
	...communities.value.map(community => ({ value: community.id, label: community.name || 'Sin nombre' })),
]);
const communityNames = computed(() => new Map(communities.value.map(community => [community.id, community.name || 'Sin nombre'])));

const mails = ref<Mail[]>([]);
const last = shallowRef<QueryDocumentSnapshot>();
const hasMore = ref(false);
const loading = ref(false);
const error = ref<string>();
// Changing the community while a page loads only keeps the last one asked for
let latestLoad = 0;

// A page at a time and once, not live: each page added only reads its own
async function load(more = false) {
	if (!communityId.value && !isSuperadmin && !managedIds.length) {
		return;
	}

	const current = ++latestLoad;
	loading.value = true;
	error.value = undefined;
	try {
		const page = await loadMail(communityId.value || (isSuperadmin ? undefined : managedIds), more ? last.value : undefined);
		if (current !== latestLoad) {
			return;
		}
		mails.value = more ? [...mails.value, ...page.mails] : page.mails;
		last.value = page.last ?? (more ? last.value : undefined);
		hasMore.value = page.more;
	} catch (e) {
		if (current === latestLoad) {
			error.value = errorMessage(e);
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

// Within the pages read: accents and case ignored, every word in its subject, recipients, community or kind
const search = ref('');
const searchElement = useTemplateRef<HTMLElement>('searchElement');
useShortcut('/', () => searchElement.value?.querySelector('input')?.focus(), { description: 'Buscar en el correo' });
const shownMails = computed(() => {
	const words = normalize(search.value).split(' ').filter(Boolean);
	return mails.value.filter((mail) => {
		const text = normalize([mail.message.subject, ...mail.to, mail.communityId && communityNames.value.get(mail.communityId), mailKinds[mail.kind]?.label].filter(Boolean).join(' '));
		return words.every(word => text.includes(word));
	});
});
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
		<div ref="searchElement">
			<LnxInput v-model="search" type="search" placeholder="Asunto, destinatario o tipo">
				Buscar <LnxKbd combo="/" />
			</LnxInput>
		</div>
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
			<LnxButton mode="clear" class="lnx-size-small" @click="load()">
				Reintentar
			</LnxButton>
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
		<ul v-else-if="shownMails.length" class="list lnx-appear">
			<li v-for="mail in shownMails" :key="mail.id" class="mail">
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
		<p v-else-if="search && mails.length" class="hint">
			Nada de lo cargado coincide con la búsqueda.
			<template v-if="hasMore">
				Carga más para buscar también en los anteriores.
			</template>
		</p>
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
}

.filters {
	margin-bottom: var(--lnx-spacing-4);
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-3);

	> * {
		width: 260px;
		max-width: 100%;
	}
}

.card {
	margin-bottom: var(--lnx-spacing-5);
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
