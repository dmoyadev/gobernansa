<script setup lang="ts">
import type { BookingSettings, CommonArea } from '@gobernansa/shared/domain/community.ts';
import { commonAreaIcons, formatSchedule, getCommonAreas } from '@gobernansa/shared/domain/community.ts';
import LnxCheckbox from '@gobernansa/shared/ui/LnxCheckbox.vue';
import { LnxButton, LnxIcon, LnxInput } from 'lnxjs-components';
import { ref, toRaw, useTemplateRef } from 'vue';
import BackButton from '@/app/ux/BackButton.vue';
import IconPicker from '@/app/ux/IconPicker.vue';
import Kbd from '@/app/ux/Kbd.vue';
import { onRevalidate } from '@/app/ux/navigation.ts';
import NewButton from '@/app/ux/NewButton.vue';
import { useNewForm } from '@/app/ux/newForm.ts';
import { useShortcut } from '@/app/ux/shortcuts.ts';
import { useSortable } from '@/app/ux/sortable.ts';
import { optimistic } from '@/app/ux/toast.ts';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { saveCommonAreas } from '../application/useBookings.ts';

const props = defineProps<{ id: string }>();

const DEFAULT_BOOKING: BookingSettings = { days: [1, 2, 3, 4, 5, 6, 7], opens: '09:00', closes: '21:00', slotMinutes: 60 };

const loading = ref(true);
const loadError = ref<string>();
const areas = ref<CommonArea[]>([]);

// What the form edits, a copy so cancelling leaves the area as it was. Its booking settings are kept while it's
// unticked, so ticking it again in the same edit brings them back
interface Draft extends CommonArea { bookable: boolean }
const newDraft = (): Draft => ({ id: crypto.randomUUID(), name: '', icon: 'lucide:building-2', bookable: false });
const draft = ref(newDraft());
// The one being edited, none while adding a new one
const editingId = ref<string>();
const error = ref<string>();
const formElement = useTemplateRef<HTMLFormElement>('formElement');

// Read again when the page comes back, the last one shown meanwhile. The draft is its own copy, so the list is
// always the latest: saving it mustn't write back what the bookings page changed meanwhile
function load() {
	return loadCommunity(props.id)
		.then((community) => {
			areas.value = getCommonAreas(community);
			loadError.value = undefined;
		})
		.catch((e: Error) => loadError.value = `No se ha podido cargar la comunidad: ${e.message}`)
		.finally(() => loading.value = false);
}

void load();
onRevalidate(load);

function reset() {
	draft.value = newDraft();
	editingId.value = undefined;
	error.value = undefined;
}

const { open, show, close } = useNewForm(formElement, reset);

function edit(area: CommonArea) {
	draft.value = { ...structuredClone(toRaw(area)), bookable: !!area.booking };
	editingId.value = area.id;
	error.value = undefined;
	void show();
}

// The form closes at once and the list shows it. If the server rejects it, the form opens with it again
function save() {
	const { bookable, booking, ...area } = draft.value;
	area.name = area.name.trim();
	// Issues point to the area by its name, so two can't share one
	if (areas.value.some(other => other.id !== area.id && other.name.toLowerCase() === area.name.toLowerCase())) {
		error.value = `Ya hay una zona llamada «${area.name}».`;
		return;
	}

	const sent = { draft: draft.value, editingId: editingId.value };
	const saved: CommonArea = bookable ? { ...area, booking: booking ?? structuredClone(DEFAULT_BOOKING) } : area;
	const next = sent.editingId ? areas.value.map(other => other.id === saved.id ? saved : other) : [saved, ...areas.value];
	close();
	persist(next, `${sent.editingId ? 'Actualizó' : 'Añadió'} la zona común ${saved.name}`, sent.editingId ? 'Zona guardada' : 'Zona creada', undefined, () => {
		({ draft: draft.value, editingId: editingId.value } = sent);
		open.value = true;
	});
}

function remove(area: CommonArea) {
	const bookingsNote = area.booking ? ' Sus reservas ya hechas se mantienen hasta que las anules.' : '';
	// eslint-disable-next-line no-alert
	if (!window.confirm(`¿Quitar «${area.name}»?${bookingsNote}`)) {
		return;
	}

	if (editingId.value === area.id) {
		close();
	}
	const index = areas.value.findIndex(other => other.id === area.id);
	// Back where it was, among the areas as they are by then
	persist(areas.value.filter(other => other.id !== area.id), `Quitó la zona común ${area.name}`, 'Zona quitada', async () => {
		const previous = areas.value;
		const restored = previous.filter(other => other.id !== area.id);
		restored.splice(index, 0, area);
		areas.value = restored;
		try {
			await saveCommonAreas(props.id, restored, `Restauró la zona común ${area.name}`);
		} catch (e) {
			areas.value = previous;
			throw e;
		}
	});
}

// Neighbours see them in this order, when reporting and booking
const { sorting, rowStyle, rowClass, handleEvents } = useSortable(areas, {
	disabled: () => open.value,
	reorder: next => persist(next, 'Reordenó las zonas comunes', 'Orden guardado'),
});

// The list changes at once; if the server rejects it, it goes back and `reopen` puts back what was being edited
function persist(next: CommonArea[], summary: string, done: string, revert?: () => Promise<unknown>, reopen?: () => void) {
	const previous = areas.value;
	areas.value = next;
	void optimistic(saveCommonAreas(props.id, next, summary), {
		done,
		failed: 'No se ha podido guardar',
		revert,
		onError: () => {
			areas.value = previous;
			reopen?.();
		},
	});
}

useShortcut('mod+enter', () => formElement.value?.requestSubmit(), 'Guardar la zona');
</script>

<template>
	<header class="page-header">
		<BackButton :to="`/communities/${id}`" label="Volver a la comunidad" />
		<h1>Zonas comunes</h1>
		<NewButton v-if="!open" label="Nueva zona común" :disabled="loading || (!!loadError && !areas.length)" @click="show()" />
	</header>

	<p class="hint">
		Los vecinos las eligen como lugar al dar un aviso, y reservan las que son reservables.
	</p>
	<p v-if="loadError && !areas.length" class="error" role="alert">
		{{ loadError }}
	</p>

	<form v-if="open" ref="formElement" class="card form ux-appear" @submit.prevent="save()">
		<h2>{{ editingId ? 'Editar zona común' : 'Nueva zona común' }}</h2>
		<div class="named">
			<IconPicker v-model="draft.icon" :options="commonAreaIcons" />
			<LnxInput v-model="draft.name" autofocus placeholder="Portal, piscina, pista de pádel…" required>
				Nombre
			</LnxInput>
		</div>
		<LnxCheckbox v-model="draft.bookable">
			Reservable
		</LnxCheckbox>

		<footer class="form-actions">
			<p v-if="error" class="error" role="alert">
				{{ error }}
			</p>
			<LnxButton type="button" mode="clear" @click="close()">
				Cancelar
				<Kbd combo="escape" />
			</LnxButton>
			<LnxButton type="submit">
				<LnxIcon :icon="editingId ? 'lucide:save' : 'lucide:plus'" />
				{{ editingId ? 'Guardar cambios' : 'Añadir' }}
				<Kbd combo="mod+enter" />
			</LnxButton>
		</footer>
	</form>

	<ul v-if="loading" class="card list" aria-busy="true">
		<li v-for="width in [30, 45, 25, 38]" :key="width" class="row">
			<span class="skeleton-item skeleton-item--icon icon" />
			<span class="name">
				<span class="skeleton-item" :style="{ width: `${width}%` }" />
				<span class="skeleton-item skeleton-item--small" :style="{ width: `${width + 20}%`, marginTop: '4px' }" />
			</span>
		</li>
	</ul>

	<TransitionGroup v-else-if="!loadError || areas.length" tag="ul" name="row" class="card list sortable ux-appear" :class="{ sorting }">
		<li v-if="!areas.length" key="empty" class="empty">
			Aún no hay zonas comunes: portal, garaje, piscina…
		</li>

		<li
			v-for="area in areas"
			:key="area.id"
			:data-id="area.id"
			:class="rowClass(area)"
			:style="rowStyle(area)"
		>
			<div class="row">
				<button
					type="button"
					class="handle"
					title="Reordenar"
					:aria-label="`Reordenar ${area.name}, con las flechas arriba y abajo`"
					:disabled="open || areas.length < 2"
					v-on="handleEvents(area)"
				>
					<LnxIcon icon="lucide:grip-vertical" :size="18" />
				</button>
				<span class="icon">
					<LnxIcon :icon="area.icon" :size="20" />
				</span>
				<span class="name">
					<strong :style="{ viewTransitionName: `area-${area.id}` }">{{ area.name }}</strong>
					<small v-if="area.booking">
						Reservable · {{ formatSchedule({ days: area.booking.days, from: area.booking.opens, to: area.booking.closes }) }}
					</small>
				</span>
				<div class="actions">
					<LnxButton v-if="area.booking" :to="`/communities/${id}/locations/${area.id}`" mode="outline" class="size-small">
						<LnxIcon icon="lucide:calendar-clock" />
						Reservas
					</LnxButton>
					<LnxButton mode="clear" shape="circle" :aria-label="`Editar ${area.name}`" :title="`Editar ${area.name}`" @click="edit(area)">
						<LnxIcon icon="lucide:pencil" />
					</LnxButton>
					<LnxButton mode="clear" shape="circle" variant="danger" :aria-label="`Quitar ${area.name}`" :title="`Quitar ${area.name}`" @click="remove(area)">
						<LnxIcon icon="lucide:trash-2" />
					</LnxButton>
				</div>
			</div>
		</li>
	</TransitionGroup>
</template>

<style lang="scss" scoped>
.page-header {
	margin-bottom: var(--lnx-spacing-2);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);

	h1 {
		flex: 1;
		font-size: var(--lnx-font-size-title);
	}
}

.hint {
	margin-bottom: var(--lnx-spacing-5);
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.card {
	padding: var(--lnx-spacing-2) var(--lnx-spacing-5);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;
	display: flex;
	flex-direction: column;
}

// Above the list, as the other pages' forms
form.card {
	margin-bottom: var(--lnx-spacing-5);
	padding: var(--lnx-spacing-5);
	align-items: flex-start;
	gap: var(--lnx-spacing-4);

	h2 {
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
		color: var(--color-gray-6);
		text-transform: uppercase;
		letter-spacing: .04em;
	}
}

// The icon beside the name, at the height of its input
.named {
	display: flex;
	align-items: flex-end;
	gap: var(--lnx-spacing-3);
	width: min(480px, 100%);

	> :last-child {
		flex: 1;
		min-width: 0;
	}
}

.form-actions {
	align-self: stretch;
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: flex-end;
	gap: var(--lnx-spacing-2);

	.error {
		flex: 1;
	}
}

.list > li + li {
	border-top: 1px solid var(--color-gray-3);
}

.empty {
	padding: var(--lnx-spacing-4) 0;
	color: var(--color-gray-6);
}

.row {
	min-height: 64px;
	padding: var(--lnx-spacing-3) 0;
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--lnx-spacing-3);
}

.icon {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 40px;
	height: 40px;
	border: none;
	border-radius: var(--lnx-radius-circle);
	background: var(--color-gray-2);
	color: var(--color-primary);
}

.name {
	flex: 1 1 200px;
	min-width: 0;
	display: flex;
	flex-direction: column;

	strong {
		color: var(--color-gray-9);
		text-wrap: balance;
	}

	small {
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
	}
}

.actions {
	margin-left: auto;
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-1);
}

// Created or removed, the others make room
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

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}
</style>
