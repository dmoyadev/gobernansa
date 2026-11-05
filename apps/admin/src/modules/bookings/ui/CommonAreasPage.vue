<script setup lang="ts">
import type { BookingSettings, CommonArea } from '@gobernansa/shared/domain/community.ts';
import { commonAreaIcons, formatSchedule, getCommonAreas } from '@gobernansa/shared/domain/community.ts';
import LnxCheckbox from '@gobernansa/shared/ui/LnxCheckbox.vue';
import { LnxButton, LnxIcon, LnxInput } from 'lnxjs-components';
import { nextTick, ref, toRaw } from 'vue';
import BackButton from '@/app/ux/BackButton.vue';
import IconPicker from '@/app/ux/IconPicker.vue';
import Kbd from '@/app/ux/Kbd.vue';
import { onRevalidate } from '@/app/ux/navigation.ts';
import NewButton from '@/app/ux/NewButton.vue';
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

// The one being edited, a copy so cancelling leaves it as it was. Its booking settings are kept while it's
// unticked, so ticking it again in the same edit brings them back
interface Draft extends CommonArea { bookable: boolean; isNew?: boolean }
const draft = ref<Draft>();
const error = ref<string>();

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

async function edit(area: CommonArea) {
	draft.value = { ...structuredClone(toRaw(area)), bookable: !!area.booking };
	error.value = undefined;
	await nextTick();
	document.querySelector<HTMLInputElement>('.editing input')?.focus();
}

async function create() {
	if (draft.value?.isNew) {
		document.querySelector<HTMLInputElement>('.editing input')?.focus();
		return;
	}
	const area = { id: crypto.randomUUID(), name: '', icon: 'lucide:building-2' };
	await edit(area);
	draft.value!.isNew = true;
}

function cancel() {
	draft.value = undefined;
	error.value = undefined;
}

function save() {
	const { bookable, isNew, booking, ...area } = draft.value!;
	area.name = area.name.trim();
	// Issues point to the area by its name, so two can't share one
	if (areas.value.some(other => other.id !== area.id && other.name.toLowerCase() === area.name.toLowerCase())) {
		error.value = `Ya hay una zona llamada «${area.name}».`;
		return;
	}

	const saved: CommonArea = bookable ? { ...area, booking: booking ?? structuredClone(DEFAULT_BOOKING) } : area;
	const next = isNew ? [saved, ...areas.value] : areas.value.map(other => other.id === saved.id ? saved : other);
	persist(next, `${isNew ? 'Añadió' : 'Actualizó'} la zona común ${saved.name}`, isNew ? 'Zona creada' : 'Zona guardada');
}

function remove(area: CommonArea) {
	const bookingsNote = area.booking ? ' Sus reservas ya hechas se mantienen hasta que las anules.' : '';
	// eslint-disable-next-line no-alert
	if (!window.confirm(`¿Quitar «${area.name}»?${bookingsNote}`)) {
		return;
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
	disabled: () => !!draft.value,
	reorder: next => persist(next, 'Reordenó las zonas comunes', 'Orden guardado'),
});

// The list changes at once; if the server rejects it, it goes back and what was being edited is open again
function persist(next: CommonArea[], summary: string, done: string, revert?: () => Promise<unknown>) {
	const previous = areas.value;
	const editing = draft.value;
	areas.value = next;
	draft.value = undefined;
	error.value = undefined;
	void optimistic(saveCommonAreas(props.id, next, summary), {
		done,
		failed: 'No se ha podido guardar',
		revert,
		onError: () => {
			areas.value = previous;
			draft.value ??= editing;
		},
	});
}

useShortcut('mod+enter', () => document.querySelector<HTMLFormElement>('form.editing')?.requestSubmit(), 'Guardar la zona');
</script>

<template>
	<header class="page-header">
		<BackButton :to="`/communities/${id}`" label="Volver a la comunidad" />
		<h1>Zonas comunes</h1>
		<NewButton label="Nueva zona común" :disabled="loading || (!!loadError && !areas.length) || !!draft?.isNew" @click="create()" />
	</header>

	<p class="hint">
		Los vecinos las eligen como lugar al dar un aviso, y reservan las que son reservables.
	</p>
	<p v-if="loadError && !areas.length" class="error" role="alert">
		{{ loadError }}
	</p>

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
		<li v-if="!areas.length && !draft" key="empty" class="empty">
			Aún no hay zonas comunes: portal, garaje, piscina…
		</li>

		<li
			v-for="area in draft?.isNew ? [draft, ...areas] : areas"
			:key="area.id"
			:data-id="area.id"
			:class="rowClass(area)"
			:style="rowStyle(area)"
		>
			<form v-if="draft?.id === area.id" class="row editing" @submit.prevent="save()" @keydown.esc="cancel()">
				<IconPicker v-model="draft.icon" :options="commonAreaIcons" />

				<LnxInput v-model="draft.name" class="name" placeholder="Portal, piscina, pista de pádel…" aria-label="Nombre" required />
				<LnxCheckbox v-model="draft.bookable">
					Reservable
				</LnxCheckbox>

				<div class="actions">
					<LnxButton
						v-if="!draft.isNew"
						type="button"
						mode="clear"
						shape="circle"
						variant="danger"
						:aria-label="`Quitar ${area.name}`"
						:title="`Quitar ${area.name}`"
						@click="remove(area)"
					>
						<LnxIcon icon="lucide:trash-2" />
					</LnxButton>
					<LnxButton type="button" mode="clear" size="small" @click="cancel()">
						Cancelar
						<Kbd combo="escape" />
					</LnxButton>
					<LnxButton type="submit" size="small">
						<LnxIcon icon="lucide:check" />
						Guardar
						<Kbd combo="mod+enter" />
					</LnxButton>
				</div>
				<p v-if="error" class="error wide" role="alert">
					{{ error }}
				</p>
			</form>

			<div v-else class="row">
				<button
					type="button"
					class="handle"
					title="Reordenar"
					:aria-label="`Reordenar ${area.name}, con las flechas arriba y abajo`"
					:disabled="!!draft || areas.length < 2"
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
					<LnxButton v-if="area.booking" :to="`/communities/${id}/locations/${area.id}`" mode="outline" size="small">
						<LnxIcon icon="lucide:calendar-clock" />
						Reservas
					</LnxButton>
					<LnxButton
						mode="clear"
						shape="circle"
						:aria-label="`Editar ${area.name}`"
						:title="`Editar ${area.name}`"
						:disabled="!!draft"
						@click="edit(area)"
					>
						<LnxIcon icon="lucide:pencil" />
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

section.card {
	padding: var(--lnx-spacing-5);
	gap: var(--lnx-spacing-3);
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

.wide {
	flex-basis: 100%;
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
