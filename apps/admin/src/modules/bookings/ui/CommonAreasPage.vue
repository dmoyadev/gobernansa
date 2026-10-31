<script setup lang="ts">
import type { BookingSettings, CommonArea } from '@gobernansa/shared/domain/community.ts';
import { commonAreaIcons, formatSchedule, getCommonAreas } from '@gobernansa/shared/domain/community.ts';
import LnxCheckbox from '@gobernansa/shared/ui/LnxCheckbox.vue';
import { LnxButton, LnxIcon, LnxInput } from 'lnxjs-components';
import { nextTick, ref, toRaw, useId } from 'vue';
import BackButton from '@/app/ux/BackButton.vue';
import Kbd from '@/app/ux/Kbd.vue';
import { onRevalidate } from '@/app/ux/navigation.ts';
import { useEventListener, useShortcut } from '@/app/ux/shortcuts.ts';
import { optimistic } from '@/app/ux/toast.ts';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { saveCommonAreas } from '../application/useBookings.ts';

const props = defineProps<{ id: string }>();

const DEFAULT_BOOKING: BookingSettings = { days: [1, 2, 3, 4, 5, 6, 7], opens: '09:00', closes: '21:00', slotMinutes: 60 };

const iconsId = useId();

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

// Esc inside the icon list only closes the list
function onEscape(event: KeyboardEvent) {
	if (!(event.target as Element).closest('[popover]')) {
		cancel();
	}
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

// Neighbours see them in this order, when reporting and booking. Dragged by the handle, or with the arrow keys on it
function move(area: CommonArea, by: -1 | 1) {
	const index = areas.value.findIndex(other => other.id === area.id);
	if (draft.value || index + by < 0 || index + by >= areas.value.length) {
		return;
	}
	const next = [...areas.value];
	next.splice(index, 1);
	next.splice(index + by, 0, area);
	persist(next, 'Reordenó las zonas comunes', 'Orden guardado');
	land(area.id);
	// Moving the row in the page takes the focus away, it's given back so the arrows keep moving it
	void nextTick(() => document.querySelector<HTMLElement>(`li[data-id="${area.id}"] .handle`)?.focus());
}

// Dragging: the row lifts and follows the pointer, the others slide out of its way, and on release it glides into its
// slot. Pointer events rather than native drag and drop, whose ghost image can't be styled
interface Sorting {
	id: string;
	from: number;
	to: number;
	offset: number;
	startY: number;
	// Each row's top and height when it started, the layout doesn't change until it's dropped
	tops: number[];
	heights: number[];
	dropping: boolean;
}
const sorting = ref<Sorting>();
const landed = ref<string>();
let landedTimer: ReturnType<typeof setTimeout> | undefined;

function land(id: string) {
	clearTimeout(landedTimer);
	landed.value = id;
	landedTimer = setTimeout(() => landed.value = undefined, 700);
}

function startSorting(area: CommonArea, event: PointerEvent) {
	if (event.button !== 0 || draft.value || sorting.value) {
		return;
	}
	const handle = event.currentTarget as HTMLElement;
	const rows = Array.from(handle.closest('ul')!.querySelectorAll<HTMLElement>(':scope > li[data-id]'), row => row.getBoundingClientRect());
	handle.setPointerCapture(event.pointerId);
	sorting.value = {
		id: area.id,
		from: areas.value.findIndex(other => other.id === area.id),
		to: areas.value.findIndex(other => other.id === area.id),
		offset: 0,
		startY: event.clientY,
		tops: rows.map(row => row.top),
		heights: rows.map(row => row.height),
		dropping: false,
	};
}

function onSortingMove(event: PointerEvent) {
	const state = sorting.value;
	if (!state || state.dropping) {
		return;
	}
	const { from, tops, heights } = state;
	const last = tops.length - 1;
	// Kept within the list, and at either end it takes the first or last slot
	const min = tops[0]! - tops[from]!;
	const max = tops[last]! + heights[last]! - tops[from]! - heights[from]!;
	state.offset = Math.min(Math.max(event.clientY - state.startY, min), max);
	const center = tops[from]! + state.offset + heights[from]! / 2;
	state.to = state.offset <= min
		? 0
		: state.offset >= max ? last : tops.filter((top, index) => index !== from && top + heights[index]! / 2 < center).length;
}

// Where the row ends, relative to where it started
function slotOffset({ from, to, tops, heights }: Sorting) {
	return to > from ? tops[to]! + heights[to]! - tops[from]! - heights[from]! : tops[to]! - tops[from]!;
}

const DROP_MS = 220;

function endSorting(cancel = false) {
	const state = sorting.value;
	if (!state || state.dropping) {
		return;
	}
	if (cancel) {
		state.to = state.from;
	}
	state.dropping = true;
	state.offset = slotOffset(state);
	setTimeout(() => {
		sorting.value = undefined;
		if (state.to !== state.from) {
			const next = [...areas.value];
			const [area] = next.splice(state.from, 1);
			next.splice(state.to, 0, area!);
			persist(next, 'Reordenó las zonas comunes', 'Orden guardado');
		}
		land(state.id);
	}, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : DROP_MS);
}

// The others make room for it in the slot it's over
function sortingStyle(area: CommonArea) {
	const state = sorting.value;
	if (!state) {
		return;
	}
	if (area.id === state.id) {
		return { translate: `0 ${state.offset}px` };
	}
	const index = areas.value.findIndex(other => other.id === area.id);
	const height = state.heights[state.from]!;
	if (state.from < index && index <= state.to) {
		return { translate: `0 ${-height}px` };
	}
	if (state.to <= index && index < state.from) {
		return { translate: `0 ${height}px` };
	}
}

useEventListener(window, 'keydown', (event) => {
	if (event.key === 'Escape' && sorting.value) {
		event.preventDefault();
		endSorting(true);
	}
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

useShortcut('n', () => void create(), 'Crear una zona común');
useShortcut('mod+enter', () => document.querySelector<HTMLFormElement>('form.editing')?.requestSubmit(), 'Guardar la zona');

/* Icon picker */
const iconsPosition = ref<{ top: string; left: string }>();

function closeIcons() {
	iconsPopover()?.hidePopover();
}

// The popover, by id: it's rendered inside the list's v-for, where a template ref would be an array
function iconsPopover() {
	return document.getElementById(iconsId);
}

// A native popover, placed once under its button when it opens and closed on scroll or resize
function onIconsToggle(event: Event) {
	if ((event as ToggleEvent).newState !== 'open') {
		return;
	}

	const rect = document.querySelector(`[popovertarget="${iconsId}"]`)!.getBoundingClientRect();
	iconsPosition.value = { top: `${rect.bottom + 4}px`, left: `${rect.left}px` };
	iconsPopover()?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
}

function pickIcon(icon: string) {
	draft.value!.icon = icon;
	closeIcons();
}

// Hiding a closed popover does nothing, so these can listen all along while the page is shown
useEventListener(document, 'scroll', closeIcons, { capture: true, passive: true });
useEventListener(window, 'resize', closeIcons);
</script>

<template>
	<header class="page-header">
		<BackButton :to="`/communities/${id}`" label="Volver a la comunidad" />
		<h1>Zonas comunes</h1>
		<LnxButton :disabled="loading || (!!loadError && !areas.length) || !!draft?.isNew" @click="create()">
			<LnxIcon icon="lucide:plus" />
			Crear
			<Kbd combo="n" />
		</LnxButton>
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

	<TransitionGroup v-else-if="!loadError || areas.length" tag="ul" name="row" class="card list ux-appear" :class="{ sorting }">
		<li v-if="!areas.length && !draft" key="empty" class="empty">
			Aún no hay zonas comunes: portal, garaje, piscina…
		</li>

		<li
			v-for="area in draft?.isNew ? [draft, ...areas] : areas"
			:key="area.id"
			:data-id="area.id"
			:class="{ lifted: sorting?.id === area.id, dropping: sorting?.id === area.id && sorting.dropping, landed: landed === area.id }"
			:style="sortingStyle(area)"
		>
			<form v-if="draft?.id === area.id" class="row editing" @submit.prevent="save()" @keydown.esc="onEscape">
				<button
					type="button"
					class="icon"
					:popovertarget="iconsId"
					:aria-label="`Icono: ${commonAreaIcons.find(option => option.icon === draft!.icon)?.label ?? 'otro'}. Cambiar`"
					title="Cambiar icono"
				>
					<LnxIcon :icon="draft.icon" :size="20" />
					<LnxIcon class="chevron" icon="lucide:chevron-down" :size="12" />
				</button>
				<div
					:id="iconsId"
					popover
					class="icons"
					role="group"
					aria-label="Iconos"
					:style="iconsPosition"
					@toggle="onIconsToggle"
				>
					<button
						v-for="option in commonAreaIcons"
						:key="option.icon"
						type="button"
						:aria-pressed="option.icon === draft.icon"
						:aria-label="option.label"
						:title="option.label"
						@click="pickIcon(option.icon)"
					>
						<LnxIcon :icon="option.icon" :size="20" />
					</button>
				</div>

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
					@pointerdown="startSorting(area, $event)"
					@pointermove="onSortingMove"
					@pointerup="endSorting()"
					@pointercancel="endSorting(true)"
					@lostpointercapture="endSorting()"
					@keydown.up.prevent="move(area, -1)"
					@keydown.down.prevent="move(area, 1)"
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

// In edit mode the icon is a button, with a small arrow saying it opens the list
button.icon {
	position: relative;
	cursor: pointer;
	outline: 2px dashed var(--color-primary-light);
	outline-offset: 2px;

	&:hover {
		background: var(--color-gray-3);
	}

	&:focus-visible {
		outline: 2px solid var(--color-primary);
	}

	.chevron {
		position: absolute;
		right: -4px;
		bottom: -4px;
		border-radius: var(--lnx-radius-circle);
		background: var(--color-gray-0);
		color: var(--color-gray-7);
	}
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

// On the left of each row, the only place a row is dragged from
.handle {
	flex-shrink: 0;
	margin-left: calc(-1 * var(--lnx-spacing-2));
	display: flex;
	align-items: center;
	justify-content: center;
	width: 24px;
	height: 40px;
	border: none;
	border-radius: var(--lnx-radius-2);
	background: none;
	color: var(--color-gray-5);
	cursor: grab;
	touch-action: none;

	&:hover:not(:disabled),
	&:focus-visible {
		outline: none;
		background: var(--color-gray-2);
		color: var(--color-gray-8);
	}

	&:active:not(:disabled) {
		cursor: grabbing;
	}

	&:disabled {
		cursor: default;
		opacity: .4;
	}
}

// While one is carried the others slide out of its way, springing into the slots
.sorting {
	cursor: grabbing;
	user-select: none;

	> li {
		transition: translate var(--duration) var(--ease-spring);
	}

	.handle {
		cursor: grabbing;
	}
}

.list > li {
	position: relative;
	border-radius: var(--lnx-radius-2);
	background: var(--color-gray-0);
}

// Picked up: above the rest, a little bigger and tilted, with a deeper shadow. It follows the pointer without delay
.sorting > li.lifted {
	z-index: 1;
	border-top-color: transparent;
	scale: 1.02;
	rotate: -.6deg;
	box-shadow: 0 2px 4px #0000000F, 0 12px 32px #00000026;
	transition: scale var(--duration) var(--ease-spring), rotate var(--duration) var(--ease-spring), box-shadow var(--duration) var(--ease-out);

	+ li {
		border-top-color: transparent;
	}

	.handle {
		background: var(--color-gray-2);
		color: var(--color-primary);
	}
}

// Let go: it glides into its slot and settles flat
.sorting > li.lifted.dropping {
	scale: 1;
	rotate: 0deg;
	box-shadow: 0 1px 2px #0000000A;
	transition: translate 220ms var(--ease-out), scale 220ms var(--ease-out), rotate 220ms var(--ease-out), box-shadow 220ms var(--ease-out);
}

// Where it landed glows for a moment
.landed {
	animation: landed 700ms var(--ease-out);
}

@keyframes landed {
	0% {
		background: color-mix(in srgb, var(--color-primary) 14%, var(--color-gray-0));
	}

	100% {
		background: var(--color-gray-0);
	}
}

@media (prefers-reduced-motion: reduce) {
	.sorting > li,
	.sorting > li.lifted,
	.sorting > li.lifted.dropping {
		rotate: 0deg;
		transition: none;
	}

	.landed {
		animation: none;
	}
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

// In the top layer, under the icon button
.icons {
	position: fixed;
	inset: auto;
	margin: 0;
	padding: var(--lnx-spacing-2);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 2px 4px #0000000F, 0 8px 24px #0000001A;
	transform-origin: top left;
	opacity: 0;
	scale: .96;
	translate: 0 -4px;
	// A transition, so closing it while it opens turns back from where it is
	transition:
		opacity var(--duration-fast) var(--ease-out),
		scale var(--duration) var(--ease-spring),
		translate var(--duration) var(--ease-spring),
		display var(--duration) allow-discrete,
		overlay var(--duration) allow-discrete;

	// The layout stays while it fades out, only display goes
	grid-template-columns: repeat(6, 40px);
	gap: var(--lnx-spacing-1);

	&:popover-open {
		display: grid;
		opacity: 1;
		scale: 1;
		translate: 0;

		@starting-style {
			opacity: 0;
			scale: .96;
			translate: 0 -4px;
		}
	}

	button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border: none;
		border-radius: var(--lnx-radius-2);
		background: none;
		color: var(--color-gray-8);
		cursor: pointer;

		&:hover,
		&:focus-visible {
			outline: none;
			background: var(--color-gray-2);
		}

		&:active {
			scale: .9;
		}

		&[aria-pressed='true'] {
			background: var(--color-primary);
			color: var(--color-primary-accent);
		}
	}
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}
</style>
