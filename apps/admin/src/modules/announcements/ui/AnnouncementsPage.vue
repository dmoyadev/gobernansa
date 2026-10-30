<script setup lang="ts">
import type { Event } from '@gobernansa/shared/domain/event.ts';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { eventTypes } from '@gobernansa/shared/domain/event.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import DatePicker from '@gobernansa/shared/ui/DatePicker.vue';
import LnxCheckbox from '@gobernansa/shared/ui/LnxCheckbox.vue';
import LnxTextarea from '@gobernansa/shared/ui/LnxTextarea.vue';
import { collection, doc, getDocs, limit, orderBy, query, serverTimestamp, Timestamp, where, writeBatch } from 'firebase/firestore';
import { LnxButton, LnxIcon, LnxInput, LnxSelect } from 'lnxjs-components';
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import BackButton from '@/app/ux/BackButton.vue';
import Kbd from '@/app/ux/Kbd.vue';
import { newId, onRevalidate } from '@/app/ux/navigation.ts';
import { useShortcut } from '@/app/ux/shortcuts.ts';
import { optimistic } from '@/app/ux/toast.ts';
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

function recentSince() {
	return Date.now() - RECENT_DAYS * 86_400_000;
}

function sortBroadcasts(broadcasts: Broadcast[]) {
	return broadcasts.sort((a, b) => b.date.toMillis() - a.date.toMillis());
}

const formError = ref<string>();
const formElement = ref<HTMLFormElement>();
// The copies share it so they can be listed and removed together. Made when the form opens, with each copy's id
// derived from it, so sending twice writes them once
const broadcastId = ref(newId());

function send() {
	if (!selected.value.length) {
		formError.value = 'Elige al menos una comunidad.';
		return;
	}

	formError.value = undefined;
	const uid = auth.currentUser!.uid;
	const sent = { form: form.value, broadcastId: broadcastId.value, communityIds: [...selected.value] };
	const { date, description, ...rest } = sent.form;
	const data = {
		...rest,
		title: rest.title.trim(),
		description: description.trim(),
		date: Timestamp.fromDate(new Date(`${date}T00:00`)),
		broadcastId: sent.broadcastId,
	};
	const now = serverTimestamp();
	const batch = writeBatch(db);
	for (const communityId of sent.communityIds) {
		batch.set(doc(eventsRef, `${sent.broadcastId}-${communityId}`), { ...data, communityId, createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid });
		logActivity(batch, communityId, {
			area: 'event',
			summary: `Envió el comunicado «${data.title}»`,
			link: `/communities/${communityId}/notifications`,
		});
	}

	// Listed at once instead of reading them all again, when it falls in what the list reads
	const previous = recent.value;
	if (data.date.toMillis() >= recentSince()) {
		const at = Timestamp.now();
		const copies = sent.communityIds.map(communityId => ({ ...data, id: `${sent.broadcastId}-${communityId}`, communityId, createdAt: at, createdBy: uid, updatedAt: at, updatedBy: uid }) as Event);
		recent.value = sortBroadcasts([...previous, { id: sent.broadcastId, title: data.title, type: data.type, date: data.date, description: data.description, copies }]);
	}
	form.value = emptyForm();
	broadcastId.value = newId();
	// No undo: neighbours are already told of it
	void optimistic(batch.commit(), {
		done: 'Comunicado enviado',
		failed: 'No se ha podido enviar',
		onError: () => {
			recent.value = previous;
			form.value = sent.form;
			broadcastId.value = sent.broadcastId;
		},
	});
}

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
			where('date', '>=', Timestamp.fromMillis(recentSince())),
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
		recent.value = sortBroadcasts([...groups.values()]);
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
// Kept alive: coming back from a community's page picks that one, whatever was ticked before (its watch reads them),
// else the same are read again
onRevalidate(() => {
	const community = route.query.community;
	if (typeof community === 'string' && (selected.value.length !== 1 || selected.value[0] !== community)) {
		selected.value = [community];
	} else {
		void loadRecent();
	}
});

// Only the copies in the selected communities, the rules don't let a query reach the rest
function remove(broadcast: Broadcast) {
	// eslint-disable-next-line no-alert
	if (!window.confirm(`¿Borrar «${broadcast.title}» de ${broadcast.copies.length} comunidad(es)?`)) {
		return;
	}

	const batch = writeBatch(db);
	for (const copy of broadcast.copies) {
		batch.delete(doc(eventsRef, copy.id));
		logActivity(batch, copy.communityId, { area: 'event', summary: `Borró el comunicado «${copy.title}»` });
	}
	const putBack = () => {
		recent.value = sortBroadcasts([...recent.value.filter(item => item.id !== broadcast.id), broadcast]);
	};
	recent.value = recent.value.filter(item => item.id !== broadcast.id);
	void optimistic(batch.commit(), {
		done: 'Comunicado borrado',
		failed: 'No se ha podido borrar',
		revert: async () => {
			await restoreBroadcast(broadcast);
			putBack();
		},
		onError: putBack,
	});
}

// Undoes remove: every copy back with its id and what it had, from the list in memory
async function restoreBroadcast(broadcast: Broadcast) {
	const batch = writeBatch(db);
	for (const { id, ...copy } of broadcast.copies) {
		batch.set(doc(eventsRef, id), copy);
		logActivity(batch, copy.communityId, {
			area: 'event',
			summary: `Restauró el comunicado «${copy.title}»`,
			link: `/communities/${copy.communityId}/notifications`,
		});
	}
	await batch.commit();
}

useShortcut('n', () => formElement.value?.querySelector('input')?.focus(), 'Nuevo comunicado');
useShortcut('mod+enter', () => formElement.value?.requestSubmit(), 'Enviar el comunicado');
</script>

<template>
	<header class="page-header">
		<BackButton to="/" label="Volver" />
		<h1>Comunicados</h1>
	</header>

	<form ref="formElement" class="card" @submit.prevent="send()">
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
			<DatePicker v-model="form.date" required>
				Fecha
			</DatePicker>
			<LnxTextarea v-model="form.description" rows="3" placeholder="Por ejemplo: el martes de 9:00 a 14:00 no habrá agua por obras en la red." class="wide">
				Descripción
			</LnxTextarea>
		</div>

		<fieldset class="communities" :aria-busy="loading && !communities.length">
			<legend>Comunidades</legend>
			<p v-if="error" class="error" role="alert">
				No se han podido cargar: {{ error.message }}
			</p>
			<template v-if="loading && !communities.length">
				<span v-for="width in [20, 60, 45, 70, 50]" :key="width" class="skeleton-row" :class="{ all: width === 20 }" aria-hidden="true">
					<span class="skeleton-item skeleton-item--icon" />
					<span class="skeleton-item" :style="{ width: `${width}%` }" />
				</span>
			</template>
			<template v-else-if="communities.length">
				<LnxCheckbox v-model="allSelected" class="check all">
					Todas
				</LnxCheckbox>
				<LnxCheckbox v-for="community in communities" :key="community.id" v-model="selected" class="check" :value="community.id">
					{{ community.name || 'Sin nombre' }}
				</LnxCheckbox>
			</template>
			<p v-else class="hint">
				No gestionas ninguna comunidad.
			</p>
		</fieldset>

		<footer class="form-actions">
			<p v-if="formError" class="error" role="alert">
				{{ formError }}
			</p>
			<LnxButton type="submit" :disabled="!selected.length">
				<LnxIcon icon="lucide:send" />
				Enviar a <span class="tabular">{{ selected.length }}</span> comunidad{{ selected.length === 1 ? '' : 'es' }}
				<Kbd combo="mod+enter" />
			</LnxButton>
		</footer>
	</form>

	<section class="card">
		<h2>Enviados a las comunidades elegidas</h2>
		<p v-if="recentError" class="error" role="alert">
			{{ recentError }}
		</p>

		<ul v-if="recentLoading && !recent.length" class="list" aria-busy="true" aria-label="Cargando comunicados">
			<li v-for="width in [50, 35, 62]" :key="width" class="item">
				<span class="skeleton-item skeleton-item--icon" />
				<div class="what">
					<span class="skeleton-item" :style="{ width: `${width}%` }" />
					<span class="skeleton-item skeleton-item--small" style="width: 140px" />
					<span class="skeleton-item skeleton-item--small" :style="{ width: `${width + 25}%` }" />
				</div>
			</li>
		</ul>
		<TransitionGroup v-else-if="recent.length" tag="ul" name="row" class="list ux-appear">
			<li v-for="broadcast in recent" :key="broadcast.id" class="item">
				<LnxIcon class="type" :icon="eventTypes[broadcast.type]?.icon ?? 'lucide:info'" :size="20" />
				<div class="what">
					<strong>{{ broadcast.title }}</strong>
					<small class="tabular">
						{{ eventTypes[broadcast.type]?.label }} · {{ broadcast.date.toDate().toLocaleDateString('es') }}
					</small>
					<p v-if="broadcast.description">
						{{ broadcast.description }}
					</p>
					<small>
						{{ broadcast.copies.map(copy => communityNames.get(copy.communityId) ?? copy.communityId).join(', ') }}
					</small>
				</div>
				<LnxButton mode="clear" size="small" shape="circle" variant="danger" aria-label="Borrar de todas" title="Borrar de todas" @click="remove(broadcast)">
					<LnxIcon icon="lucide:trash-2" />
				</LnxButton>
			</li>
		</TransitionGroup>
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
	min-height: 32px;
	justify-content: center;
}

.skeleton-row {
	min-height: 32px;
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
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
	position: relative;
	display: flex;
	flex-direction: column;
}

// Sent and removed ones slide in and out; transitions, so a quick undo turns them back halfway
.row-move,
.row-enter-active,
.row-leave-active {
	transition: opacity var(--duration) var(--ease-out), translate var(--duration) var(--ease-out);
}

.row-enter-from,
.row-leave-to {
	opacity: 0;
	translate: 0 -4px;
}

.row-leave-active {
	position: absolute;
	width: 100%;
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

	strong {
		text-wrap: balance;
	}

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
