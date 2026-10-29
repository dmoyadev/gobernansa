<script setup lang="ts">
import type { Event } from '@gobernansa/shared/domain/event.ts';
import type { NotificationForm } from '../application/useNotifications.ts';
import { eventTypes } from '@gobernansa/shared/domain/event.ts';
import { LnxButton, LnxIcon, LnxInput, LnxSelect } from 'lnxjs-components';
import { ref } from 'vue';
import { toInputDate } from '@/modules/communities/domain/communityForm.ts';
import { deleteNotification, saveNotification, useNotifications } from '../application/useNotifications.ts';

const props = defineProps<{ id: string }>();

const PAGE_SIZE = 20;

const typeOptions = Object.entries(eventTypes).map(([value, { label }]) => ({ value: value as Event['type'], label }));

const max = ref(PAGE_SIZE);
const { data: notifications, pending, error } = useNotifications(props.id, max);

function emptyForm(): NotificationForm {
	return { title: '', description: '', type: 'community', date: toInputDate(new Date()) };
}

const form = ref(emptyForm());
// The one being edited, none while writing a new one
const editingId = ref<string>();
const saving = ref(false);
const formError = ref<string>();

function edit(notification: Event) {
	editingId.value = notification.id;
	form.value = {
		title: notification.title,
		description: notification.description ?? '',
		type: notification.type,
		date: toInputDate(notification.date.toDate()),
	};
	window.scrollTo({ top: 0, behavior: 'smooth' });
}

function reset() {
	editingId.value = undefined;
	form.value = emptyForm();
}

async function save() {
	saving.value = true;
	formError.value = undefined;
	try {
		await saveNotification(props.id, editingId.value, form.value);
		reset();
	} catch (e) {
		formError.value = `No se ha podido guardar: ${(e as Error).message}`;
	} finally {
		saving.value = false;
	}
}

const actionError = ref<string>();

async function remove(notification: Event) {
	// eslint-disable-next-line no-alert
	if (!window.confirm(`¿Borrar «${notification.title}»?`)) {
		return;
	}

	actionError.value = undefined;
	try {
		await deleteNotification(notification.id);
		if (editingId.value === notification.id) {
			reset();
		}
	} catch (e) {
		actionError.value = `No se ha podido borrar: ${(e as Error).message}`;
	}
}
</script>

<template>
	<header class="page-header">
		<LnxButton :to="`/communities/${id}`" mode="clear" shape="circle" aria-label="Volver a la comunidad">
			<LnxIcon icon="lucide:arrow-left" />
		</LnxButton>
		<h1>Notificaciones</h1>
	</header>

	<form class="card" @submit.prevent="save()">
		<h2>{{ editingId ? 'Editar notificación' : 'Nueva notificación' }}</h2>
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
				<textarea v-model="form.description" rows="3" />
			</label>
		</div>

		<footer class="form-actions">
			<p v-if="formError" class="error" role="alert">
				{{ formError }}
			</p>
			<LnxButton v-if="editingId" mode="clear" @click="reset()">
				Cancelar
			</LnxButton>
			<LnxButton type="submit" :is-loading="saving">
				<LnxIcon :icon="editingId ? 'lucide:save' : 'lucide:send'" />
				{{ editingId ? 'Guardar cambios' : 'Publicar' }}
			</LnxButton>
		</footer>
	</form>

	<section class="card">
		<h2>Publicadas</h2>
		<p v-if="error" class="error" role="alert">
			No se han podido cargar: {{ error.message }}
		</p>
		<p v-if="actionError" class="error" role="alert">
			{{ actionError }}
		</p>

		<span v-if="pending && !notifications.length" class="skeleton-item" />
		<ul v-else-if="notifications.length" class="list">
			<li v-for="notification in notifications" :key="notification.id" class="item">
				<LnxIcon class="type" :icon="eventTypes[notification.type]?.icon ?? 'lucide:info'" :size="20" />
				<div class="what">
					<strong>{{ notification.title }}</strong>
					<small>
						{{ eventTypes[notification.type]?.label }} · {{ notification.date.toDate().toLocaleDateString('es') }}
					</small>
					<p v-if="notification.description">
						{{ notification.description }}
					</p>
				</div>
				<div class="item-actions">
					<LnxButton mode="clear" size="small" shape="circle" aria-label="Editar" @click="edit(notification)">
						<LnxIcon icon="lucide:pencil" />
					</LnxButton>
					<LnxButton mode="clear" size="small" shape="circle" variant="danger" aria-label="Borrar" @click="remove(notification)">
						<LnxIcon icon="lucide:trash-2" />
					</LnxButton>
				</div>
			</li>
		</ul>
		<p v-else class="hint">
			Aún no hay notificaciones.
		</p>

		<LnxButton v-if="notifications.length >= max" mode="outline" :is-loading="pending" @click="max += PAGE_SIZE">
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

.item-actions {
	display: flex;
	gap: var(--lnx-spacing-1);
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
