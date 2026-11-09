<script setup lang="ts">
import type { Event } from '@gobernansa/shared/domain/event.ts';
import type { NotificationForm } from '../application/useNotifications.ts';
import { eventTypes } from '@gobernansa/shared/domain/event.ts';
import DatePicker from '@gobernansa/shared/ui/DatePicker.vue';
import LnxTextarea from '@gobernansa/shared/ui/LnxTextarea.vue';
import { LnxButton, LnxIcon, LnxInput, LnxSelect } from 'lnxjs-components';
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import BackButton from '@/app/ux/BackButton.vue';
import Kbd from '@/app/ux/Kbd.vue';
import { newId } from '@/app/ux/navigation.ts';
import NewButton from '@/app/ux/NewButton.vue';
import { useNewForm } from '@/app/ux/newForm.ts';
import { useShortcut } from '@/app/ux/shortcuts.ts';
import { optimistic } from '@/app/ux/toast.ts';
import { toInputDate } from '@/modules/communities/domain/communityForm.ts';
import { deleteNotification, loadNotification, restoreNotification, saveNotification, useNotifications } from '../application/useNotifications.ts';

const props = defineProps<{ id: string }>();

const PAGE_SIZE = 20;

const typeOptions = Object.entries(eventTypes).map(([value, { label }]) => ({ value: value as Event['type'], label }));

const max = ref(PAGE_SIZE);
const { data: notifications, pending, error } = useNotifications(props.id, max);

function emptyForm(): NotificationForm {
	return { title: '', description: '', type: 'community', date: toInputDate(new Date()) };
}

const formElement = ref<HTMLFormElement>();
const form = ref(emptyForm());
// The one being edited, none while writing a new one
const editingId = ref<string>();
// The new one's id, kept until it's published
const draftId = ref(newId());

// Opened from the search with ?edit=<id>, it's shown in the form even when it's not on the first page. Watched, as
// the page is kept and opened again with another one
const route = useRoute();
const path = route.path;
watch(() => route.query.edit, async (editId) => {
	if (route.path !== path || typeof editId !== 'string' || editId === editingId.value) {
		return;
	}
	try {
		const notification = await loadNotification(editId);
		// Another community's id in the URL isn't opened here
		if (notification?.communityId === props.id) {
			edit(notification);
		}
	} catch {
		// Deleted or unreadable, the page is still usable
	}
}, { immediate: true });

function reset() {
	editingId.value = undefined;
	form.value = emptyForm();
}

const { open, show, close } = useNewForm(formElement, reset);

function edit(notification: Event) {
	editingId.value = notification.id;
	form.value = {
		title: notification.title,
		description: notification.description ?? '',
		type: notification.type,
		date: toInputDate(notification.date.toDate()),
	};
	void show();
}

// The form closes at once; if the server rejects it, it opens again with what was written
function save() {
	const sent = { ...form.value };
	const isNew = !editingId.value;
	const id = editingId.value ?? draftId.value;
	close();
	if (isNew) {
		draftId.value = newId();
	}
	void optimistic(saveNotification(props.id, id, isNew, sent), {
		done: isNew ? 'Aviso publicado' : 'Aviso guardado',
		failed: 'No se ha podido guardar',
		onError: () => {
			form.value = sent;
			if (isNew) {
				draftId.value = id;
			} else {
				editingId.value = id;
			}
			open.value = true;
		},
	});
}

function remove(notification: Event) {
	// eslint-disable-next-line no-alert
	if (!window.confirm(`¿Borrar «${notification.title}»?`)) {
		return;
	}

	if (editingId.value === notification.id) {
		close();
	}
	void optimistic(deleteNotification(notification), {
		done: 'Aviso borrado',
		failed: 'No se ha podido borrar',
		revert: () => restoreNotification(notification),
	});
}

useShortcut('mod+enter', () => formElement.value?.requestSubmit(), 'Publicar o guardar el aviso');
</script>

<template>
	<header class="page-header">
		<BackButton :to="`/communities/${id}`" label="Volver a la comunidad" />
		<h1>Avisos</h1>
		<NewButton v-if="!open" label="Nuevo aviso" @click="show()" />
	</header>

	<form v-if="open" ref="formElement" class="card ux-appear" @submit.prevent="save()">
		<h2>{{ editingId ? 'Editar aviso' : 'Nuevo aviso' }}</h2>
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
			<LnxTextarea v-model="form.description" rows="3" class="wide">
				Descripción
			</LnxTextarea>
		</div>

		<footer class="form-actions">
			<LnxButton mode="clear" @click="close()">
				Cancelar
				<Kbd combo="escape" />
			</LnxButton>
			<LnxButton type="submit">
				<LnxIcon :icon="editingId ? 'lucide:save' : 'lucide:send'" />
				{{ editingId ? 'Guardar cambios' : 'Publicar' }}
				<Kbd combo="mod+enter" />
			</LnxButton>
		</footer>
	</form>

	<section class="card" :aria-busy="pending">
		<h2>Publicados</h2>
		<p v-if="error" class="error" role="alert">
			No se han podido cargar: {{ error.message }}
		</p>

		<ul v-if="pending && !notifications.length" class="list">
			<li v-for="width in [55, 70, 40]" :key="width" class="item">
				<span class="skeleton-item skeleton-item--icon" />
				<div class="what">
					<span class="skeleton-item" :style="{ width: `${width}%` }" />
					<span class="skeleton-item skeleton-item--small" style="width: 9em" />
					<span class="skeleton-item skeleton-item--small" :style="{ width: `${width + 25}%` }" />
				</div>
			</li>
		</ul>
		<TransitionGroup v-else-if="notifications.length" tag="ul" name="item" class="list ux-appear">
			<li v-for="notification in notifications" :key="notification.id" class="item">
				<LnxIcon class="type" :icon="eventTypes[notification.type]?.icon ?? 'lucide:info'" :size="20" />
				<div class="what">
					<strong>{{ notification.title }}</strong>
					<small class="tabular">
						{{ eventTypes[notification.type]?.label }} · {{ notification.date.toDate().toLocaleDateString('es') }}
					</small>
					<p v-if="notification.description">
						{{ notification.description }}
					</p>
				</div>
				<div class="item-actions">
					<LnxButton mode="clear" class="size-small" shape="circle" aria-label="Editar" title="Editar" @click="edit(notification)">
						<LnxIcon icon="lucide:pencil" />
					</LnxButton>
					<LnxButton mode="clear" class="size-small" shape="circle" variant="danger" aria-label="Borrar" title="Borrar" @click="remove(notification)">
						<LnxIcon icon="lucide:trash-2" />
					</LnxButton>
				</div>
			</li>
		</TransitionGroup>
		<p v-else class="hint">
			Aún no hay avisos.
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

	strong {
		text-wrap: balance;
	}

	small {
		color: var(--color-gray-6);
	}

	.skeleton-item + .skeleton-item {
		margin-top: var(--lnx-spacing-1);
	}

	p {
		margin-top: var(--lnx-spacing-1);
		font-size: var(--lnx-font-size-small);
		white-space: pre-line;
	}
}

// Published, edited or deleted, also from elsewhere: they make room and fade in or out
.item-move,
.item-enter-active,
.item-leave-active {
	transition: opacity var(--duration) var(--ease-out), translate var(--duration) var(--ease-out);
}

.item-enter-from,
.item-leave-to {
	opacity: 0;
	translate: 0 -4px;
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
