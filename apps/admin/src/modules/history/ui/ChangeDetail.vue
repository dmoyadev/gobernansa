<script setup lang="ts">
import type { Change } from '../domain/history.ts';
import { reportError } from '@gobernansa/shared/infrastructure/monitoring.ts';
import { Bytes, DocumentReference, GeoPoint, Timestamp } from 'firebase/firestore';
import { FunctionsError } from 'firebase/functions';
import { LnxButton, LnxIcon, toast, useConfirm } from 'lnxjs-components';
import { computed, ref } from 'vue';
import { hasFunctions, restoreVersion } from '../application/restoreVersion.ts';

// One change of the Historial: each field as it was and as it was left, and putting the document back as it was
const props = defineProps<{ change: Change }>();
const emit = defineEmits<{ versions: [path: string] }>();

const ask = useConfirm();

// Past this, a value is folded and opened on demand
const LONG = 160;
// What the function says when it refuses, already for people: the rest is a failure of ours
const EXPECTED = ['functions/unauthenticated', 'functions/permission-denied', 'functions/invalid-argument', 'functions/not-found', 'functions/failed-precondition'];

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });

// Firestore's types as people read them: dates as dates, files by their size, references by their path
function plain(value: unknown): unknown {
	if (value instanceof Timestamp) {
		return dateFormat.format(value.toDate());
	}
	if (value instanceof Bytes) {
		return `(archivo de ${value.toUint8Array().length.toLocaleString('es')} bytes)`;
	}
	if (value instanceof DocumentReference) {
		return value.path;
	}
	if (value instanceof GeoPoint) {
		return `${value.latitude}, ${value.longitude}`;
	}
	if (Array.isArray(value)) {
		return value.map(plain);
	}
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
	}
	return value;
}

function readable(value: unknown) {
	if (value === undefined) {
		return '—';
	}
	const shown = plain(value);
	if (shown === null || shown === '') {
		return 'vacío';
	}
	if (typeof shown === 'boolean') {
		return shown ? 'sí' : 'no';
	}
	if (typeof shown === 'number') {
		return shown.toLocaleString('es');
	}
	return typeof shown === 'string' ? shown : JSON.stringify(shown, null, 2);
}

// Created, only how it was left; removed, only how it was
const rows = computed(() => props.change.changed.map((field) => {
	const before = readable(props.change.before?.[field]);
	const after = readable(props.change.after?.[field]);
	return { field, values: props.change.op === 'create' ? [after] : props.change.op === 'delete' ? [before] : [before, after] };
}));
const isLong = (text: string) => text.length > LONG || text.includes('\n');

// Why it can't be put back, if it can't
const blocked = computed(() => {
	if (!hasFunctions) {
		return 'En la demo local no corren las funciones de Firebase, que son las que restauran.';
	}
	if (props.change.collection === 'auth') {
		return 'Las cuentas de acceso no se restauran desde aquí.';
	}
	if (props.change.truncated) {
		return 'El documento era demasiado grande y solo se guardaron los campos que cambiaron: no se puede restaurar.';
	}
	return undefined;
});

const restoring = ref<'before' | 'after'>();
async function restore(side: 'before' | 'after') {
	const { change } = props;
	const recovers = side === 'before' && change.op === 'delete';
	if (!await ask({
		title: recovers ? '¿Recuperar el documento?' : '¿Restaurar esta versión?',
		message: `${change.path} volverá a estar como ${side === 'before' ? 'antes de' : 'después de'} este cambio, del ${dateFormat.format(change.at.toDate())}. Lo que tenga ahora se sustituye entero. La restauración queda en el historial y se puede deshacer igual.`,
		confirmText: recovers ? 'Recuperar' : 'Restaurar',
		variant: 'danger',
	})) {
		return;
	}

	restoring.value = side;
	try {
		await restoreVersion({ auditId: change.id, side });
		toast(`${recovers ? 'Documento recuperado' : 'Versión restaurada'}. Saldrá en el historial en unos segundos`);
	} catch (e) {
		toast(`No se ha podido restaurar: ${(e as Error).message}`, { variant: 'danger' });
		if (!(e instanceof FunctionsError && EXPECTED.includes(e.code))) {
			reportError(e, { source: 'action', action: 'No se ha podido restaurar la versión' });
		}
	} finally {
		restoring.value = undefined;
	}
}
</script>

<template>
	<div class="detail">
		<p v-if="change.truncated" class="note">
			<LnxIcon icon="lucide:triangle-alert" :size="16" />
			Era demasiado grande para guardarlo entero: solo están los campos que cambiaron.
		</p>
		<p v-if="change.restoredFrom" class="note">
			<LnxIcon icon="lucide:history" :size="16" />
			Es una restauración de una versión anterior.
		</p>
		<p v-if="change.actorInferred" class="note">
			<LnxIcon icon="lucide:info" :size="16" />
			Quién lo hizo sale del propio documento, no de la sesión.
		</p>

		<table v-if="rows.length" class="diff">
			<caption class="sr-only">
				Campos que cambiaron
			</caption>
			<thead>
				<tr>
					<th scope="col">
						Campo
					</th>
					<th v-if="change.op !== 'create'" scope="col">
						Antes
					</th>
					<th v-if="change.op !== 'delete'" scope="col">
						Después
					</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="row in rows" :key="row.field">
					<th scope="row">
						{{ row.field }}
					</th>
					<td v-for="(value, index) in row.values" :key="index" :class="{ empty: value === '—' }">
						<details v-if="isLong(value)">
							<summary>{{ value.slice(0, 80) }}…</summary>
							<pre>{{ value }}</pre>
						</details>
						<template v-else>
							{{ value }}
						</template>
					</td>
				</tr>
			</tbody>
		</table>

		<div class="actions">
			<LnxButton mode="outline" class="lnx-size-small" @click="emit('versions', change.path)">
				<LnxIcon icon="lucide:layers" />
				Versiones de este documento
			</LnxButton>
			<LnxButton v-if="change.before" mode="outline" class="lnx-size-small" :disabled="!!blocked || !!restoring" :is-loading="restoring === 'before'" :title="blocked" @click="restore('before')">
				<LnxIcon icon="lucide:rotate-ccw" />
				{{ change.op === 'delete' ? 'Recuperar el documento' : 'Restaurar la versión anterior' }}
			</LnxButton>
			<LnxButton v-if="change.after" mode="outline" class="lnx-size-small" :disabled="!!blocked || !!restoring" :is-loading="restoring === 'after'" :title="blocked" @click="restore('after')">
				<LnxIcon icon="lucide:history" />
				Restaurar esta versión
			</LnxButton>
		</div>
		<p v-if="blocked" class="hint">
			{{ blocked }}
		</p>
	</div>
</template>

<style lang="scss" scoped>
.detail {
	padding: 0 0 var(--lnx-spacing-4);
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
}

.note,
.hint {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
}

.diff {
	width: 100%;
	border-collapse: collapse;
	table-layout: fixed;
	font-size: var(--lnx-font-size-small);

	th,
	td {
		padding: var(--lnx-spacing-2);
		border-bottom: 1px solid var(--color-gray-3);
		text-align: left;
		vertical-align: top;
		overflow-wrap: anywhere;
	}

	thead th {
		color: var(--color-gray-6);
		font-weight: var(--lnx-font-weight-bold);
	}

	tbody th {
		width: 25%;
		font-family: monospace;
		font-weight: normal;
	}

	.empty {
		color: var(--color-gray-5);
	}

	summary {
		cursor: pointer;
	}

	pre {
		max-height: 320px;
		margin-top: var(--lnx-spacing-2);
		padding: var(--lnx-spacing-2);
		border-radius: var(--lnx-radius-2);
		background: var(--color-gray-1);
		overflow: auto;
		white-space: pre-wrap;
	}
}

.actions {
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-2);
}
</style>
