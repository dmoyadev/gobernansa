<script setup lang="ts">
import type { ErrorGroup, ErrorSample } from '@gobernansa/shared/domain/errors.ts';
import type { Timestamp as FirestoreTimestamp } from 'firebase/firestore';
import { errorApps, errorKinds, hasReturned } from '@gobernansa/shared/domain/errors.ts';
import { roles } from '@gobernansa/shared/domain/user.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { RELEASE } from '@gobernansa/shared/infrastructure/monitoring.ts';
import { collection, doc, getDocs, limit, orderBy, query, serverTimestamp, Timestamp, where, writeBatch } from 'firebase/firestore';
import { LnxButton, LnxIcon, LnxInput, LnxSelect } from 'lnxjs-components';
import { computed, ref, watch } from 'vue';
import { optimistic, toast } from '@/app/ux/toast.ts';

// One group of the Errores page: its samples, with what the user did before, and what the team does with it
const props = defineProps<{
	group: ErrorGroup & { merged: ErrorGroup[] };
	// The other groups loaded, to merge it into one of them
	candidates: ErrorGroup[];
	// What an action changed, in the page's list. A function and not an event, as undoing from the toast can come after
	// this is gone (a merged group leaves the list)
	patch: (ids: string[], changes: Partial<ErrorGroup>) => void;
}>();

const SAMPLES = 10;
const SOURCES: Record<string, string> = {
	vue: 'Componente',
	window: 'Script',
	promise: 'Promesa sin capturar',
	router: 'Navegación',
	action: 'Acción',
	manual: 'Página',
	quota: 'Cuota',
};

// All those merged into it, not only the ones loaded in the list: what's done to it is done to them
const merged = ref<ErrorGroup[]>(props.group.merged);
const samples = ref<ErrorSample[]>([]);
const loading = ref(true);
const error = ref<string>();

async function load() {
	loading.value = true;
	error.value = undefined;
	const samplesOf = async (id: string) => getDocs(query(collection(db, 'errors', id, 'samples'), orderBy('at', 'desc'), limit(SAMPLES)));
	try {
		const [mergedDocs, own] = await Promise.all([getDocs(query(collection(db, 'errors'), where('mergedInto', '==', props.group.id))), samplesOf(props.group.id)]);
		merged.value = mergedDocs.docs.map(item => ({ ...item.data(), id: item.id }) as ErrorGroup);
		const pages = [own, ...await Promise.all(merged.value.map(async item => samplesOf(item.id)))];
		samples.value = pages.flatMap(page => page.docs.map(item => ({ ...item.data(), id: item.id }) as ErrorSample))
			.sort((a, b) => b.at.toMillis() - a.at.toMillis())
			.slice(0, SAMPLES);
	} catch (e) {
		error.value = (e as Error).message;
	} finally {
		loading.value = false;
	}
}
watch(() => props.group.id, load, { immediate: true });

// The same change to the group and to those merged into it. Undone from its toast
function change(changes: Record<string, unknown>, local: Partial<ErrorGroup>, texts: { done: string; failed: string }) {
	const ids = [props.group.id, ...merged.value.map(item => item.id)];
	// What each had before: the same status, and those merged into it pointed to it
	const { id: groupId, status, mergedInto = '' } = props.group;
	const before = (id: string) => 'mergedInto' in changes ? { status, mergedInto: id === groupId ? mergedInto : groupId } : { status };
	const write = async (values: (id: string) => Record<string, unknown>) => {
		const batch = writeBatch(db);
		ids.forEach(id => batch.update(doc(db, 'errors', id), values(id)));
		await batch.commit();
	};
	const restore = () => ids.forEach(id => props.patch([id], before(id)));
	props.patch(ids, local);
	void optimistic(write(() => changes), {
		...texts,
		// Resolving again one that came back can't be undone: the rules only take the server's time as when it was resolved
		revert: 'resolvedAt' in changes && status === 'resolved'
			? undefined
			: async () => {
				restore();
				await write(before);
			},
		onError: restore,
	});
}

// Resolved in the release that has the fix, this admin's by default as it's the last one deployed
const resolving = ref(false);
const resolvedIn = ref(RELEASE);
const note = ref('');
function resolve() {
	const values = { status: 'resolved' as const, resolvedBy: auth.currentUser?.uid ?? '', resolvedIn: resolvedIn.value.trim().slice(0, 40), note: note.value.trim().slice(0, 1000) };
	change({ ...values, resolvedAt: serverTimestamp(), seenSinceResolved: false }, { ...values, resolvedAt: Timestamp.now(), seenSinceResolved: false }, { done: 'Error resuelto', failed: 'No se ha podido resolver' });
	resolving.value = false;
}

const mergeTarget = ref('');
const mergeOptions = computed(() => props.candidates
	.filter(candidate => !candidate.mergedInto && !merged.value.some(item => item.id === candidate.id))
	.map(candidate => ({ value: candidate.id, label: `${candidate.message} (${errorApps[candidate.app]})` })));
// It takes the other's status, so both show and are resolved together. Into a resolved one, as resolved now, so it shows
// as come back when it happens again
function merge() {
	const target = props.candidates.find(candidate => candidate.id === mergeTarget.value);
	if (!target) {
		return;
	}
	const values = { mergedInto: target.id, status: target.status, ...(target.status === 'resolved' ? { resolvedBy: auth.currentUser?.uid ?? '', resolvedIn: target.resolvedIn ?? '' } : {}) };
	const resolvedAt = target.status === 'resolved';
	change({ ...values, ...(resolvedAt ? { resolvedAt: serverTimestamp(), seenSinceResolved: false } : {}) }, { ...values, ...(resolvedAt ? { resolvedAt: Timestamp.now(), seenSinceResolved: false } : {}) }, { done: 'Errores fusionados', failed: 'No se han podido fusionar' });
}

async function copy(text: string) {
	try {
		await navigator.clipboard.writeText(text);
		toast('Pila copiada');
	} catch {
		toast('No se ha podido copiar la pila', { tone: 'error' });
	}
}

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'medium' });
const format = (time?: FirestoreTimestamp) => time ? dateFormat.format(time.toDate()) : '—';
</script>

<template>
	<div class="detail">
		<dl>
			<dt>Tipo</dt>
			<dd>
				{{ errorKinds[group.kind] }}<template v-if="group.kind === 'firebase'">
					· {{ group.code }}
				</template> · {{ errorApps[group.app] }}
			</dd>
			<dt>Fichero</dt>
			<dd>{{ group.file || 'Desconocido' }}</dd>
			<dt>Veces</dt>
			<dd>{{ group.count }} en {{ group.sessions }} {{ group.sessions === 1 ? 'sesión' : 'sesiones' }}</dd>
			<dt>Primera vez</dt>
			<dd>{{ format(group.firstSeen) }} · {{ group.firstRelease }}</dd>
			<dt>Última vez</dt>
			<dd>{{ format(group.lastSeen) }} · {{ group.lastRelease }}</dd>
			<dt>Versiones</dt>
			<dd>{{ group.releases.join(', ') }}</dd>
			<dt>Pantallas</dt>
			<dd>{{ group.routes.join(', ') || '—' }}</dd>
			<template v-if="group.status === 'resolved'">
				<dt>Resuelto</dt>
				<dd>
					{{ format(group.resolvedAt) }}<template v-if="group.resolvedIn">
						· en {{ group.resolvedIn }}
					</template><template v-if="group.note">
						· {{ group.note }}
					</template>
					<strong v-if="hasReturned(group)" class="returned">· ha vuelto después</strong>
				</dd>
			</template>
			<template v-if="merged.length">
				<dt>Fusionados</dt>
				<dd>{{ merged.map(item => `${item.message} (${item.count})`).join(' · ') }}</dd>
			</template>
		</dl>

		<div v-if="!resolving" class="actions">
			<LnxButton v-if="group.status !== 'resolved' || hasReturned(group)" class="size-small" @click="resolving = true">
				<LnxIcon icon="lucide:check" />
				Resolver
			</LnxButton>
			<LnxButton v-if="group.status === 'new'" mode="outline" class="size-small" @click="change({ status: 'ignored' }, { status: 'ignored' }, { done: 'Error ignorado', failed: 'No se ha podido ignorar' })">
				<LnxIcon icon="lucide:eye-off" />
				Ignorar
			</LnxButton>
			<LnxButton v-if="group.status !== 'new'" mode="outline" class="size-small" @click="change({ status: 'new' }, { status: 'new' }, { done: 'Error reabierto', failed: 'No se ha podido reabrir' })">
				<LnxIcon icon="lucide:rotate-ccw" />
				Reabrir
			</LnxButton>
			<form v-if="mergeOptions.length" class="merge" @submit.prevent="merge()">
				<LnxSelect v-model.convert="mergeTarget" :options="mergeOptions" :convert-fn="option => option.value" search-placeholder-text="Buscar...">
					Es el mismo fallo que
					<template #option="{ option }">
						{{ option.label }}
					</template>
					<template #optionInput="{ value }">
						{{ mergeOptions.find(option => option.value === value)?.label }}
					</template>
				</LnxSelect>
				<LnxButton type="submit" mode="outline" class="size-small" :disabled="!mergeTarget">
					<LnxIcon icon="lucide:merge" />
					Fusionar
				</LnxButton>
			</form>
		</div>
		<form v-else class="resolve" @submit.prevent="resolve()">
			<LnxInput v-model="resolvedIn" maxlength="40" required>
				Versión con la corrección
			</LnxInput>
			<LnxInput v-model="note" maxlength="1000" placeholder="Qué fallaba y cómo se ha corregido">
				Nota
			</LnxInput>
			<div class="actions">
				<LnxButton type="submit" class="size-small">
					<LnxIcon icon="lucide:check" />
					Marcar como resuelto
				</LnxButton>
				<LnxButton mode="clear" class="size-small" @click="resolving = false">
					Cancelar
				</LnxButton>
			</div>
		</form>

		<h3>Muestras</h3>
		<p v-if="error" class="error" role="alert">
			No se han podido cargar: {{ error }}
		</p>
		<p v-else-if="loading" class="hint">
			<span class="skeleton-item" style="width: 60%" />
		</p>
		<p v-else-if="!samples.length" class="hint">
			Sin muestras: caducan a los 30 días.
		</p>
		<details v-for="sample in samples" :key="sample.id" class="sample">
			<summary>
				<strong>{{ format(sample.at) }}</strong>
				<span>{{ sample.route || 'Sin pantalla' }} · {{ sample.browser }} · {{ sample.os }}<template v-if="sample.standalone"> · instalada</template></span>
				<small>{{ sample.release }}</small>
			</summary>
			<dl>
				<dt>Usuario</dt>
				<dd>
					{{ roles[sample.role as keyof typeof roles]?.label ?? (sample.role || 'Sin perfil') }} ·
					<!-- A neighbour's page; the admin's own users have none -->
					<RouterLink v-if="sample.communityId && sample.app === 'webapp'" :to="`/communities/${sample.communityId}/people/${sample.uid}/documents`">
						{{ sample.uid }}
					</RouterLink>
					<template v-else>
						{{ sample.uid }}
					</template>
				</dd>
				<template v-if="sample.communityId">
					<dt>Comunidad</dt>
					<dd>
						<RouterLink :to="`/communities/${sample.communityId}`">
							Abrir la comunidad
						</RouterLink>
					</dd>
				</template>
				<dt>Dónde</dt>
				<dd>
					{{ SOURCES[sample.context.source] ?? sample.context.source }}<template v-if="sample.context.action">
						· {{ sample.context.action }}
					</template><template v-if="sample.context.info">
						· {{ sample.context.info }}
					</template>
				</dd>
				<dt>Conexión</dt>
				<dd>{{ sample.online ? 'Con conexión' : 'Sin conexión' }}</dd>
				<dt>Mensaje</dt>
				<dd class="message">
					{{ sample.message }}
				</dd>
			</dl>

			<h4>Lo que hizo antes</h4>
			<ol v-if="sample.trail.length" class="trail">
				<li v-for="(entry, index) in sample.trail" :key="index">
					{{ entry }}
				</li>
			</ol>
			<p v-else class="hint">
				Nada: falló al abrir la app.
			</p>

			<h4>
				Pila
				<LnxButton v-if="sample.stack" mode="clear" class="size-small" @click="copy(sample.stack)">
					<LnxIcon icon="lucide:copy" />
					Copiar
				</LnxButton>
			</h4>
			<pre v-if="sample.stack">{{ sample.stack }}</pre>
			<p v-else class="hint">
				Sin pila.
			</p>
		</details>
	</div>
</template>

<style lang="scss" scoped>
.detail {
	padding: 0 0 var(--lnx-spacing-4);
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
	font-size: var(--lnx-font-size-small);

	h3 {
		margin-top: var(--lnx-spacing-2);
		font-size: var(--lnx-font-size-base);
	}

	h4 {
		margin-top: var(--lnx-spacing-3);
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-2);
		color: var(--color-gray-7);
		font-size: var(--lnx-font-size-small);
	}
}

dl {
	display: grid;
	grid-template-columns: auto minmax(0, 1fr);
	gap: var(--lnx-spacing-1) var(--lnx-spacing-3);
}

dt {
	color: var(--color-gray-6);
}

dd {
	overflow-wrap: anywhere;

	a {
		color: var(--color-primary);
	}
}

.returned {
	color: #991b1b;
}

.actions {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-end;
	gap: var(--lnx-spacing-2);
}

.merge {
	display: flex;
	align-items: flex-end;
	gap: var(--lnx-spacing-2);

	> :first-child {
		width: 280px;
		max-width: 100%;
	}
}

.resolve {
	display: grid;
	grid-template-columns: 220px minmax(0, 1fr);
	align-items: end;
	gap: var(--lnx-spacing-3);

	.actions {
		grid-column: 1 / -1;
	}
}

.sample {
	border-top: 1px solid var(--color-gray-3);
	padding: var(--lnx-spacing-2) 0;

	summary {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--lnx-spacing-1) var(--lnx-spacing-3);
		cursor: pointer;

		small {
			margin-left: auto;
			color: var(--color-gray-6);
		}
	}

	> dl {
		margin-top: var(--lnx-spacing-3);
	}
}

.message {
	font-family: var(--lnx-font-family-mono, ui-monospace, monospace);
}

.trail {
	padding-left: var(--lnx-spacing-5);
	list-style: decimal;
	color: var(--color-gray-8);
	font-family: var(--lnx-font-family-mono, ui-monospace, monospace);
	font-size: var(--lnx-font-size-legal);
}

pre {
	max-height: 280px;
	padding: var(--lnx-spacing-3);
	overflow: auto;
	border-radius: var(--lnx-radius-2);
	background: var(--color-gray-1);
	font-size: var(--lnx-font-size-legal);
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}

.hint {
	color: var(--color-gray-6);
}

.error {
	color: var(--color-secondary-accent);
}

@media (max-width: 640px) {
	.resolve {
		grid-template-columns: minmax(0, 1fr);
	}

	.merge {
		flex-wrap: wrap;
	}
}
</style>
