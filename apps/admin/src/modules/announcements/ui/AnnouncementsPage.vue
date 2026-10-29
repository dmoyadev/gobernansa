<script setup lang="ts">
import type { Event } from '@gobernansa/shared/domain/event.ts';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { eventTypes } from '@gobernansa/shared/domain/event.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, doc, getDocs, limit, orderBy, query, serverTimestamp, Timestamp, where, writeBatch } from 'firebase/firestore';
import { LnxButton, LnxIcon, LnxInput, LnxSelect } from 'lnxjs-components';
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useCommunities } from '@/modules/communities/application/useCommunities.ts';
import { toInputDate } from '@/modules/communities/domain/communityForm.ts';

const eventsRef = collection(db, 'events');

// Per community, the ones dated from this many days ago on, upcoming included: the latest by date alone would be the furthest future events
const RECENT_DAYS = 60;
const RECENT_PER_COMMUNITY = 100;

const typeOptions = Object.entries(eventTypes).map(([value, { label }]) => ({ value: value as Event['type'], label }));

const route = useRoute();
const { communities, loading, error } = useCommunities();
const communityNames = computed(() => new Map(communities.value.map(community => [community.id, community.name || 'Sin nombre'])));

function emptyForm() {
	return { title: '', description: '', type: 'notice' as Event['type'], date: toInputDate(new Date()) };
}

const form = ref(emptyForm());
const selected = ref<string[]>(typeof route.query.community === 'string' ? [route.query.community] : []);
const allSelected = computed({
	get: () => communities.value.length > 0 && communities.value.every(community => selected.value.includes(community.id)),
	set: (all: boolean) => {
		selected.value = all ? communities.value.map(community => community.id) : [];
	},
});

const sending = ref(false);
const formError = ref<string>();

async function send() {
	if (!selected.value.length) {
		formError.value = 'Elige al menos una comunidad.';
		return;
	}

	sending.value = true;
	formError.value = undefined;
	try {
		const uid = auth.currentUser!.uid;
		const { date, description, ...rest } = form.value;
		const now = serverTimestamp();
		// The copies share it so they can be listed and removed together
		const broadcastId = doc(eventsRef).id;
		const batch = writeBatch(db);
		for (const communityId of selected.value) {
			batch.set(doc(eventsRef), {
				...rest,
				title: rest.title.trim(),
				description: description.trim(),
				date: Timestamp.fromDate(new Date(`${date}T00:00`)),
				communityId,
				broadcastId,
				createdAt: now,
				createdBy: uid,
				updatedAt: now,
				updatedBy: uid,
			});
			logActivity(batch, communityId, {
				area: 'event',
				summary: `Envió el comunicado «${rest.title.trim()}»`,
				link: `/communities/${communityId}/notifications`,
			});
		}
		await batch.commit();
		form.value = emptyForm();
		await loadRecent();
	} catch (e) {
		formError.value = `No se ha podido enviar: ${(e as Error).message}`;
	} finally {
		sending.value = false;
	}
}

interface Broadcast {
	id: string;
	title: string;
	type: Event['type'];
	date: Timestamp;
	description?: string;
	copies: Event[];
}

const recent = ref<Broadcast[]>([]);
const recentLoading = ref(false);
const recentError = ref<string>();
// Ticking several communities quickly starts several reads, only the last one is shown
let latestLoad = 0;

// Once per change of the selection and not live: it reads up to RECENT_PER_COMMUNITY per community
// ponytail: each toggle re-reads every selected community, cache per community if large portfolios make it costly
async function loadRecent() {
	const ids = [...selected.value];
	if (!ids.length) {
		recent.value = [];
		return;
	}

	const load = ++latestLoad;
	recentLoading.value = true;
	recentError.value = undefined;
	try {
		const snapshots = await Promise.all(ids.map(async communityId => getDocs(query(
			eventsRef,
			where('communityId', '==', communityId),
			// Same index as the timeline's: communityId and date
			where('date', '>=', Timestamp.fromMillis(Date.now() - RECENT_DAYS * 86_400_000)),
			orderBy('date', 'desc'),
			limit(RECENT_PER_COMMUNITY),
		))));
		if (load !== latestLoad) {
			return;
		}
		const groups = new Map<string, Broadcast>();
		for (const event of snapshots.flatMap(snapshot => snapshot.docs.map(snapshot => ({ ...snapshot.data(), id: snapshot.id }) as Event))) {
			// Only the ones sent from here, each community's own are on its notifications page
			if (!event.broadcastId) {
				continue;
			}
			const group = groups.get(event.broadcastId) ?? { id: event.broadcastId, title: event.title, type: event.type, date: event.date, description: event.description, copies: [] };
			group.copies.push(event);
			groups.set(event.broadcastId, group);
		}
		recent.value = [...groups.values()].sort((a, b) => b.date.toMillis() - a.date.toMillis());
	} catch (e) {
		if (load !== latestLoad) {
			return;
		}
		recentError.value = `No se han podido cargar: ${(e as Error).message}`;
	} finally {
		if (load === latestLoad) {
			recentLoading.value = false;
		}
	}
}

watch(selected, loadRecent, { immediate: true });

const actionError = ref<string>();

// Only the copies in the selected communities, the rules don't let a query reach the rest
async function remove(broadcast: Broadcast) {
	// eslint-disable-next-line no-alert
	if (!window.confirm(`¿Borrar «${broadcast.title}» de ${broadcast.copies.length} comunidad(es)?`)) {
		return;
	}

	actionError.value = undefined;
	try {
		const batch = writeBatch(db);
		for (const copy of broadcast.copies) {
			batch.delete(doc(eventsRef, copy.id));
			logActivity(batch, copy.communityId, { area: 'event', summary: `Borró el comunicado «${copy.title}»` });
		}
		await batch.commit();
		recent.value = recent.value.filter(item => item.id !== broadcast.id);
	} catch (e) {
		actionError.value = `No se ha podido borrar: ${(e as Error).message}`;
	}
}
</script>

<template>
	<header class="page-header">
		<LnxButton to="/" mode="clear" shape="circle" aria-label="Volver">
			<LnxIcon icon="lucide:arrow-left" />
		</LnxButton>
		<h1>Comunicados</h1>
	</header>

	<form class="card" @submit.prevent="send()">
		<h2>Nuevo comunicado</h2>
		<div class="fields">
			<LnxInput v-model="form.title" class="wide" required>
				Título
			</LnxInput>
			<LnxSelect
				v-model.convert="form.type"
				:options="typeOptions"
				:convert-fn="option => option.value"
				search-placeholder-text="Buscar..."
			>
				Tipo
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ eventTypes[value]?.label }}
				</template>
			</LnxSelect>
			<LnxInput v-model="form.date" type="date" required>
				Fecha
			</LnxInput>
			<label class="textarea wide">
				Descripción
				<textarea v-model="form.description" rows="3" placeholder="Por ejemplo: el martes de 9:00 a 14:00 no habrá agua por obras en la red." />
			</label>
		</div>

		<fieldset class="communities">
			<legend>Comunidades</legend>
			<p v-if="error" class="error" role="alert">
				No se han podido cargar: {{ error.message }}
			</p>
			<span v-if="loading" class="skeleton-item" />
			<template v-else-if="communities.length">
				<label class="check all">
					<input v-model="allSelected" type="checkbox">
					Todas
				</label>
				<label v-for="community in communities" :key="community.id" class="check">
					<input v-model="selected" type="checkbox" :value="community.id">
					{{ community.name || 'Sin nombre' }}
				</label>
			</template>
			<p v-else class="hint">
				No gestionas ninguna comunidad.
			</p>
		</fieldset>

		<footer class="form-actions">
			<p v-if="formError" class="error" role="alert">
				{{ formError }}
			</p>
			<LnxButton type="submit" :is-loading="sending" :disabled="!selected.length">
				<LnxIcon icon="lucide:send" />
				Enviar a {{ selected.length }} comunidad{{ selected.length === 1 ? '' : 'es' }}
			</LnxButton>
		</footer>
	</form>

	<section class="card">
		<h2>Enviados a las comunidades elegidas</h2>
		<p v-if="recentError" class="error" role="alert">
			{{ recentError }}
		</p>
		<p v-if="actionError" class="error" role="alert">
			{{ actionError }}
		</p>

		<span v-if="recentLoading && !recent.length" class="skeleton-item" />
		<ul v-else-if="recent.length" class="list">
			<li v-for="broadcast in recent" :key="broadcast.id" class="item">
				<LnxIcon class="type" :icon="eventTypes[broadcast.type]?.icon ?? 'lucide:info'" :size="20" />
				<div class="what">
					<strong>{{ broadcast.title }}</strong>
					<small>
						{{ eventTypes[broadcast.type]?.label }} · {{ broadcast.date.toDate().toLocaleDateString('es') }}
					</small>
					<p v-if="broadcast.description">
						{{ broadcast.description }}
					</p>
					<small>
						{{ broadcast.copies.map(copy => communityNames.get(copy.communityId) ?? copy.communityId).join(', ') }}
					</small>
				</div>
				<LnxButton mode="clear" size="small" shape="circle" variant="danger" aria-label="Borrar de todas" @click="remove(broadcast)">
					<LnxIcon icon="lucide:trash-2" />
				</LnxButton>
			</li>
		</ul>
		<p v-else class="hint">
			{{ selected.length ? 'Aún no hay comunicados enviados a varias comunidades.' : 'Elige comunidades para ver lo que se les ha enviado.' }}
		</p>
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

	h2 {
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
		color: var(--color-gray-6);
		text-transform: uppercase;
		letter-spacing: .04em;
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

.communities {
	border: 0;
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr));
	gap: var(--lnx-spacing-2) var(--lnx-spacing-4);

	legend {
		margin-bottom: var(--lnx-spacing-2);
		font-size: var(--lnx-font-size-small);
	}

	.all {
		grid-column: 1 / -1;
		font-weight: var(--lnx-font-weight-bold);
	}
}

.check {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
	min-height: 32px;
	cursor: pointer;

	input {
		width: 18px;
		height: 18px;
		accent-color: var(--color-primary);
	}
}

.form-actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: flex-end;
	gap: var(--lnx-spacing-2);

	.error {
		flex: 1;
	}
}

.list {
	display: flex;
	flex-direction: column;
}

.item {
	padding: var(--lnx-spacing-3) 0;
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto;
	align-items: start;
	gap: var(--lnx-spacing-3);

	& + & {
		border-top: 1px solid var(--color-gray-3);
	}

	.type {
		margin-top: 2px;
		color: var(--color-primary);
	}
}

.what {
	display: flex;
	flex-direction: column;
	min-width: 0;

	small {
		color: var(--color-gray-6);
	}

	p {
		margin-top: var(--lnx-spacing-1);
		font-size: var(--lnx-font-size-small);
		white-space: pre-line;
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
