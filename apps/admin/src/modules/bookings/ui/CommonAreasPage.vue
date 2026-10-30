<script setup lang="ts">
import type { BookingSettings, CommonArea } from '@gobernansa/shared/domain/community.ts';
import { commonAreaIcons, formatSchedule, getCommonAreas } from '@gobernansa/shared/domain/community.ts';
import LnxCheckbox from '@gobernansa/shared/ui/LnxCheckbox.vue';
import { LnxButton, LnxIcon, LnxInput } from 'lnxjs-components';
import { nextTick, onUnmounted, ref, toRaw, useId } from 'vue';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { saveCommonAreas } from '../application/useBookings.ts';

const props = defineProps<{ id: string }>();

const DEFAULT_BOOKING: BookingSettings = { days: [1, 2, 3, 4, 5, 6, 7], opens: '09:00', closes: '21:00', slotMinutes: 60 };

const iconsId = useId();

const loading = ref(true);
const loadError = ref<string>();
const areas = ref<CommonArea[]>([]);

loadCommunity(props.id)
	.then(community => areas.value = getCommonAreas(community))
	.catch((e: Error) => loadError.value = `No se ha podido cargar la comunidad: ${e.message}`)
	.finally(() => loading.value = false);

// The one being edited, a copy so cancelling leaves it as it was. Its booking settings are kept while it's
// unticked, so ticking it again in the same edit brings them back
interface Draft extends CommonArea { bookable: boolean; isNew?: boolean }
const draft = ref<Draft>();
const saving = ref(false);
const error = ref<string>();
const status = ref('');

async function edit(area: CommonArea) {
	draft.value = { ...structuredClone(toRaw(area)), bookable: !!area.booking };
	error.value = undefined;
	await nextTick();
	document.querySelector<HTMLInputElement>('.editing input')?.focus();
}

async function create() {
	const area = { id: crypto.randomUUID(), name: '', icon: 'lucide:building-2' };
	await edit(area);
	draft.value!.isNew = true;
}

function cancel() {
	draft.value = undefined;
	error.value = undefined;
}

async function save() {
	const { bookable, isNew, booking, ...area } = draft.value!;
	area.name = area.name.trim();
	// Issues point to the area by its name, so two can't share one
	if (areas.value.some(other => other.id !== area.id && other.name.toLowerCase() === area.name.toLowerCase())) {
		error.value = `Ya hay una zona llamada «${area.name}».`;
		return;
	}

	const saved: CommonArea = bookable ? { ...area, booking: booking ?? structuredClone(DEFAULT_BOOKING) } : area;
	const next = isNew ? [saved, ...areas.value] : areas.value.map(other => other.id === saved.id ? saved : other);
	await persist(next, `${isNew ? 'Añadió' : 'Actualizó'} la zona común ${saved.name}`, isNew ? 'Zona creada' : 'Zona guardada');
}

async function remove(area: CommonArea) {
	const bookingsNote = area.booking ? ' Sus reservas ya hechas se mantienen hasta que las anules.' : '';
	// eslint-disable-next-line no-alert
	if (window.confirm(`¿Quitar «${area.name}»?${bookingsNote}`)) {
		await persist(areas.value.filter(other => other.id !== area.id), `Quitó la zona común ${area.name}`, 'Zona quitada');
	}
}

async function persist(next: CommonArea[], summary: string, done: string) {
	saving.value = true;
	error.value = undefined;
	try {
		await saveCommonAreas(props.id, next, summary);
		areas.value = next;
		draft.value = undefined;
		status.value = done;
	} catch (e) {
		error.value = `No se ha podido guardar: ${(e as Error).message}`;
	} finally {
		saving.value = false;
	}
}

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
		document.removeEventListener('scroll', closeIcons, { capture: true });
		window.removeEventListener('resize', closeIcons);
		return;
	}

	document.addEventListener('scroll', closeIcons, { capture: true, passive: true });
	window.addEventListener('resize', closeIcons);
	const rect = document.querySelector(`[popovertarget="${iconsId}"]`)!.getBoundingClientRect();
	iconsPosition.value = { top: `${rect.bottom + 4}px`, left: `${rect.left}px` };
	iconsPopover()?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
}

function pickIcon(icon: string) {
	draft.value!.icon = icon;
	closeIcons();
}

onUnmounted(() => {
	document.removeEventListener('scroll', closeIcons, { capture: true });
	window.removeEventListener('resize', closeIcons);
});
</script>

<template>
	<header class="page-header">
		<LnxButton :to="`/communities/${id}`" mode="clear" shape="circle" aria-label="Volver a la comunidad" title="Volver a la comunidad">
			<LnxIcon icon="lucide:arrow-left" />
		</LnxButton>
		<h1>Zonas comunes</h1>
		<LnxButton :disabled="loading || !!loadError || !!draft?.isNew" @click="create()">
			<LnxIcon icon="lucide:plus" />
			Crear
		</LnxButton>
	</header>

	<p class="hint">
		Los vecinos las eligen como lugar al dar un aviso, y reservan las que son reservables.
	</p>
	<p v-if="loadError" class="error" role="alert">
		{{ loadError }}
	</p>
	<p v-else-if="error && !draft" class="error" role="alert">
		{{ error }}
	</p>
	<p class="sr-only" role="status">
		{{ status }}
	</p>

	<section v-if="loading" class="card" aria-busy="true">
		<span class="skeleton-item" />
		<span class="skeleton-item" />
	</section>

	<ul v-else-if="!loadError" class="card list">
		<li v-if="!areas.length && !draft" class="empty">
			Aún no hay zonas comunes: portal, garaje, piscina…
		</li>

		<li v-for="area in draft?.isNew ? [draft, ...areas] : areas" :key="area.id">
			<form v-if="draft?.id === area.id" class="row editing" @submit.prevent="save()" @keydown.esc="cancel()">
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
						:disabled="saving"
						@click="remove(area)"
					>
						<LnxIcon icon="lucide:trash-2" />
					</LnxButton>
					<LnxButton type="button" mode="clear" size="small" @click="cancel()">
						Cancelar
					</LnxButton>
					<LnxButton type="submit" size="small" :is-loading="saving">
						<LnxIcon icon="lucide:check" />
						Guardar
					</LnxButton>
				</div>
				<p v-if="error" class="error wide" role="alert">
					{{ error }}
				</p>
			</form>

			<div v-else class="row">
				<span class="icon">
					<LnxIcon :icon="area.icon" :size="20" />
				</span>
				<span class="name">
					<strong>{{ area.name }}</strong>
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
	</ul>
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

	&:popover-open {
		display: grid;
		grid-template-columns: repeat(6, 40px);
		gap: var(--lnx-spacing-1);
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
