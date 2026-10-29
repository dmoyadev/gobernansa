<script setup lang="ts">
import type { Booking } from '@gobernansa/shared/domain/booking.ts';
import type { BookableArea } from '@gobernansa/shared/domain/community.ts';
import { getSlots, toDateString } from '@gobernansa/shared/domain/booking.ts';
import { WEEKDAYS } from '@gobernansa/shared/domain/community.ts';
import { LnxButton, LnxIcon, LnxInput } from 'lnxjs-components';
import { computed, ref } from 'vue';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { cancelBooking, saveBookableAreas, useDayBookings } from '../application/useBookings.ts';

const props = defineProps<{ id: string }>();

// Numbers as text, as the inputs give them, so an empty optional one can be told apart
type AreaForm = Omit<BookableArea, 'slotMinutes' | 'maxPerWeek' | 'advanceDays' | 'rules'>
	& { slotMinutes: string; maxPerWeek: string; advanceDays: string; rules: string };

function toForm(area: BookableArea): AreaForm {
	return {
		...area,
		slotMinutes: String(area.slotMinutes),
		maxPerWeek: area.maxPerWeek?.toString() ?? '',
		advanceDays: area.advanceDays?.toString() ?? '',
		rules: area.rules ?? '',
	};
}

// Optional fields left empty are left out, Firestore doesn't take undefined
function fromForm(form: AreaForm): BookableArea {
	return {
		id: form.id,
		name: form.name.trim(),
		days: [...form.days].sort((a, b) => a - b),
		opens: form.opens,
		closes: form.closes,
		slotMinutes: Number(form.slotMinutes),
		...(form.maxPerWeek ? { maxPerWeek: Number(form.maxPerWeek) } : {}),
		...(form.advanceDays ? { advanceDays: Number(form.advanceDays) } : {}),
		...(form.rules.trim() ? { rules: form.rules.trim() } : {}),
	};
}

const loading = ref(true);
const loadError = ref<string>();
const commonAreas = ref<string[]>([]);
const areas = ref<AreaForm[]>([]);
// What's saved, to name the areas of the bookings even while the form is being edited
const savedAreas = ref<BookableArea[]>([]);

loadCommunity(props.id)
	.then((community) => {
		commonAreas.value = community?.commonAreas ?? [];
		savedAreas.value = community?.bookableAreas ?? [];
		areas.value = savedAreas.value.map(toForm);
	})
	.catch((e: Error) => loadError.value = `No se ha podido cargar la comunidad: ${e.message}`)
	.finally(() => loading.value = false);

function addArea() {
	areas.value.push({
		id: crypto.randomUUID(),
		name: '',
		days: [1, 2, 3, 4, 5, 6, 7],
		opens: '09:00',
		closes: '21:00',
		slotMinutes: '60',
		maxPerWeek: '',
		advanceDays: '',
		rules: '',
	});
}

function removeArea(index: number) {
	// eslint-disable-next-line no-alert
	if (window.confirm(`¿Quitar «${areas.value[index].name || 'la zona'}»? Sus reservas ya hechas se mantienen hasta que las anules.`)) {
		areas.value.splice(index, 1);
	}
}

const saving = ref(false);
const formError = ref<string>();
const saved = ref(false);

async function save() {
	const invalid = areas.value.find(area => !area.days.length || area.opens >= area.closes);
	if (invalid) {
		formError.value = `«${invalid.name}» necesita al menos un día y abrir antes de cerrar.`;
		return;
	}

	saving.value = true;
	formError.value = undefined;
	saved.value = false;
	try {
		const bookableAreas = areas.value.map(fromForm);
		await saveBookableAreas(props.id, bookableAreas);
		savedAreas.value = bookableAreas;
		saved.value = true;
	} catch (e) {
		formError.value = `No se han podido guardar: ${(e as Error).message}`;
	} finally {
		saving.value = false;
	}
}

const date = ref(toDateString(new Date()));
const { data: bookings, pending, error } = useDayBookings(props.id, date);

// Each saved area with its slots that day and who booked them, plus bookings of removed areas or changed slots
const day = computed(() => {
	// The date input gives '' while it's being cleared
	if (!date.value) {
		return { rows: [], others: [] };
	}
	const byId = new Map(bookings.value.map(booking => [booking.id, booking]));
	const shown = new Set<string>();
	const rows = savedAreas.value.map(area => ({
		area,
		slots: getSlots(area, date.value).map((slot) => {
			const booking = byId.get(`${area.id}_${date.value}_${slot.from}`);
			if (booking) {
				shown.add(booking.id);
			}
			return { ...slot, booking };
		}),
	}));
	const others = bookings.value.filter(booking => !shown.has(booking.id))
		.sort((a, b) => a.from.localeCompare(b.from));
	return { rows, others };
});

function areaName(areaId: string) {
	return savedAreas.value.find(area => area.id === areaId)?.name ?? 'Zona eliminada';
}

const actionError = ref<string>();

async function cancel(booking: Booking) {
	const name = areaName(booking.areaId);
	// eslint-disable-next-line no-alert
	if (!window.confirm(`¿Anular la reserva de ${booking.name} en ${name} a las ${booking.from}?`)) {
		return;
	}

	actionError.value = undefined;
	try {
		await cancelBooking(props.id, booking, name);
	} catch (e) {
		actionError.value = `No se ha podido anular: ${(e as Error).message}`;
	}
}
</script>

<template>
	<header class="page-header">
		<LnxButton :to="`/communities/${id}`" mode="clear" shape="circle" aria-label="Volver a la comunidad">
			<LnxIcon icon="lucide:arrow-left" />
		</LnxButton>
		<h1>Reservas</h1>
	</header>

	<form class="card" @submit.prevent="save()">
		<h2>Zonas reservables</h2>
		<p v-if="loadError" class="error" role="alert">
			{{ loadError }}
		</p>
		<span v-if="loading" class="skeleton-item" />
		<template v-else>
			<p v-if="!areas.length" class="hint">
				Aún no hay zonas que los vecinos puedan reservar.
			</p>

			<datalist id="common-areas">
				<option v-for="name in commonAreas" :key="name" :value="name" />
			</datalist>

			<fieldset v-for="(area, index) in areas" :key="area.id" class="area">
				<legend class="sr-only">
					{{ area.name || 'Nueva zona' }}
				</legend>
				<div class="fields">
					<LnxInput v-model="area.name" class="wide" list="common-areas" placeholder="Pista de pádel, sala común…" required>
						Nombre
					</LnxInput>
					<fieldset class="days wide">
						<legend>Días</legend>
						<label v-for="(weekday, dayIndex) in WEEKDAYS" :key="weekday">
							<input v-model="area.days" type="checkbox" class="sr-only" :value="dayIndex + 1">
							<span>{{ weekday }}</span>
						</label>
					</fieldset>
					<LnxInput v-model="area.opens" type="time" required>
						Abre
					</LnxInput>
					<LnxInput v-model="area.closes" type="time" required>
						Cierra
					</LnxInput>
					<LnxInput v-model="area.slotMinutes" type="number" min="15" max="720" step="5" required>
						Minutos por franja
					</LnxInput>
					<LnxInput v-model="area.maxPerWeek" type="number" min="1" max="50" placeholder="Sin límite">
						Reservas por vecino y semana
					</LnxInput>
					<LnxInput v-model="area.advanceDays" type="number" min="1" max="365" placeholder="14">
						Días de antelación
					</LnxInput>
					<label class="textarea wide">
						Normas
						<textarea v-model="area.rules" rows="2" placeholder="Máximo 4 personas. Deja la pista como la encontraste." />
					</label>
				</div>
				<div class="area-actions">
					<LnxButton type="button" mode="clear" size="small" variant="danger" @click="removeArea(index)">
						<LnxIcon icon="lucide:trash-2" />
						Quitar zona
					</LnxButton>
				</div>
			</fieldset>

			<footer class="form-actions">
				<p v-if="formError" class="error" role="alert">
					{{ formError }}
				</p>
				<p v-else-if="saved" class="hint" role="status">
					Guardado.
				</p>
				<LnxButton type="button" mode="outline" @click="addArea()">
					<LnxIcon icon="lucide:plus" />
					Añadir zona
				</LnxButton>
				<LnxButton type="submit" :is-loading="saving">
					<LnxIcon icon="lucide:save" />
					Guardar zonas
				</LnxButton>
			</footer>
		</template>
	</form>

	<section class="card">
		<header class="day-header">
			<h2>Reservas del día</h2>
			<LnxInput v-model="date" type="date" aria-label="Día" />
		</header>
		<p v-if="error" class="error" role="alert">
			No se han podido cargar: {{ error.message }}
		</p>
		<p v-if="actionError" class="error" role="alert">
			{{ actionError }}
		</p>

		<span v-if="pending" class="skeleton-item" />
		<template v-else>
			<p v-if="!savedAreas.length && !day.others.length" class="hint">
				Sin zonas reservables.
			</p>
			<div v-for="{ area, slots } in day.rows" :key="area.id" class="day-area">
				<h3>{{ area.name }}</h3>
				<ul v-if="slots.length" class="list">
					<li v-for="slot in slots" :key="slot.from" class="item">
						<span class="time">{{ slot.from }}–{{ slot.to }}</span>
						<span class="who" :class="{ free: !slot.booking }">{{ slot.booking?.name ?? 'Libre' }}</span>
						<LnxButton
							v-if="slot.booking"
							mode="clear"
							size="small"
							shape="circle"
							variant="danger"
							:aria-label="`Anular la reserva de ${slot.booking.name}`"
							@click="cancel(slot.booking)"
						>
							<LnxIcon icon="lucide:x" />
						</LnxButton>
					</li>
				</ul>
				<p v-else class="hint">
					Cerrada ese día.
				</p>
			</div>
			<div v-if="day.others.length" class="day-area">
				<h3>Otras reservas</h3>
				<ul class="list">
					<li v-for="booking in day.others" :key="booking.id" class="item">
						<span class="time">{{ booking.from }}–{{ booking.to }}</span>
						<span class="who">{{ booking.name }} · {{ areaName(booking.areaId) }}</span>
						<LnxButton
							mode="clear"
							size="small"
							shape="circle"
							variant="danger"
							:aria-label="`Anular la reserva de ${booking.name}`"
							@click="cancel(booking)"
						>
							<LnxIcon icon="lucide:x" />
						</LnxButton>
					</li>
				</ul>
			</div>
		</template>
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

.area {
	padding: var(--lnx-spacing-4);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-2);
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
}

.area-actions {
	display: flex;
	justify-content: flex-end;
}

.fields {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr));
	align-items: start;
	gap: var(--lnx-spacing-3) var(--lnx-spacing-4);

	.wide {
		grid-column: 1 / -1;
	}
}

.days {
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-1);

	legend {
		width: 100%;
		margin-bottom: var(--lnx-spacing-1);
		font-size: var(--lnx-font-size-small);
	}

	span {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 44px;
		height: 40px;
		padding: 0 var(--lnx-spacing-2);
		border: 1px solid var(--color-gray-4);
		border-radius: var(--lnx-radius-2);
		background: var(--color-gray-0);
		color: var(--color-gray-7);
		font-size: var(--lnx-font-size-small);
		cursor: pointer;
	}

	input:checked + span {
		border-color: var(--color-primary);
		background: var(--color-primary);
		color: var(--color-primary-accent);
	}

	input:focus-visible + span {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
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

	.error,
	.hint {
		flex: 1;
	}
}

.day-header {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: var(--lnx-spacing-3);
}

.day-area {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-1);

	h3 {
		font-size: var(--lnx-font-size-body);
	}
}

.list {
	display: flex;
	flex-direction: column;
}

.item {
	min-height: 44px;
	padding: var(--lnx-spacing-1) 0;
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto;
	align-items: center;
	gap: var(--lnx-spacing-3);

	& + & {
		border-top: 1px solid var(--color-gray-3);
	}

	.time {
		font-variant-numeric: tabular-nums;
		color: var(--color-gray-7);
	}

	.who {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;

		&.free {
			color: var(--color-gray-5);
		}
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
