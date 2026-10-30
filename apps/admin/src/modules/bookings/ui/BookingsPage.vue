<script setup lang="ts">
import type { Booking } from '@gobernansa/shared/domain/booking.ts';
import type { BookingSettings, CommonArea } from '@gobernansa/shared/domain/community.ts';
import { getSlots, getWeek, toDateString } from '@gobernansa/shared/domain/booking.ts';
import { getCommonAreas, WEEKDAYS } from '@gobernansa/shared/domain/community.ts';
import LnxTextarea from '@gobernansa/shared/ui/LnxTextarea.vue';
import { LnxButton, LnxIcon, LnxInput } from 'lnxjs-components';
import { computed, ref } from 'vue';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { cancelBooking, saveCommonAreas, useBookingsOf } from '../application/useBookings.ts';

const props = defineProps<{ id: string; areaId: string }>();

// Numbers as text, as the inputs give them, so an empty optional one can be told apart
type BookingForm = Omit<BookingSettings, 'slotMinutes' | 'maxPerWeek' | 'advanceDays' | 'rules'>
	& { slotMinutes: string; maxPerWeek: string; advanceDays: string; rules: string };

function toForm(booking: BookingSettings): BookingForm {
	return {
		days: [...booking.days],
		opens: booking.opens,
		closes: booking.closes,
		slotMinutes: String(booking.slotMinutes),
		maxPerWeek: booking.maxPerWeek?.toString() ?? '',
		advanceDays: booking.advanceDays?.toString() ?? '',
		rules: booking.rules ?? '',
	};
}

// Optional fields left empty are left out, Firestore doesn't take undefined
function fromForm(form: BookingForm): BookingSettings {
	return {
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
const areas = ref<CommonArea[]>([]);
// What's saved, the agenda follows it even while the form is being edited
const area = computed(() => areas.value.find(({ id }) => id === props.areaId));
const form = ref<BookingForm>();

loadCommunity(props.id)
	.then((community) => {
		areas.value = getCommonAreas(community);
		form.value = area.value?.booking && toForm(area.value.booking);
	})
	.catch((e: Error) => loadError.value = `No se ha podido cargar la comunidad: ${e.message}`)
	.finally(() => loading.value = false);

const saving = ref(false);
const formError = ref<string>();
const saved = ref(false);

async function save() {
	if (!form.value!.days.length || form.value!.opens >= form.value!.closes) {
		formError.value = 'Necesita al menos un día y abrir antes de cerrar.';
		return;
	}

	saving.value = true;
	formError.value = undefined;
	saved.value = false;
	try {
		const next = areas.value.map(other => other.id === props.areaId ? { ...other, booking: fromForm(form.value!) } : other);
		await saveCommonAreas(props.id, next, `Actualizó las reservas de ${area.value!.name}`);
		areas.value = next;
		saved.value = true;
	} catch (e) {
		formError.value = `No se han podido guardar: ${(e as Error).message}`;
	} finally {
		saving.value = false;
	}
}

/* Weekly agenda */
const today = toDateString(new Date());
const weekStart = ref(getWeek(today).from);

function addDays(date: string, days: number) {
	const day = new Date(`${date}T00:00`);
	return toDateString(new Date(day.getFullYear(), day.getMonth(), day.getDate() + days));
}

const dates = computed(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart.value, index)));
const { data: weekBookings, pending, error } = useBookingsOf(props.id, dates);

function formatDay(date: string, options: Intl.DateTimeFormatOptions) {
	return new Date(`${date}T00:00`).toLocaleDateString('es', options);
}

const weekLabel = computed(() => `${formatDay(dates.value[0], { day: 'numeric', month: 'short' })} – ${formatDay(dates.value[6], { day: 'numeric', month: 'short', year: 'numeric' })}`);

// The same slots every open day, so they're the rows; closed days are greyed out in their column
const agenda = computed(() => {
	const booking = area.value?.booking;
	if (!booking) {
		return { slots: [], days: [], others: [] };
	}

	const mine = weekBookings.value.filter(({ areaId }) => areaId === props.areaId);
	const byKey = new Map(mine.map(item => [`${item.date}_${item.from}`, item]));
	const slots = getSlots({ ...booking, days: [1, 2, 3, 4, 5, 6, 7] }, today);
	const shown = new Set<string>();
	const days = dates.value.map(date => ({
		date,
		open: getSlots(booking, date).length > 0,
		past: date < today,
		bookings: slots.map((slot) => {
			const item = byKey.get(`${date}_${slot.from}`);
			if (item) {
				shown.add(item.id);
			}
			return item;
		}),
	}));
	// Booked before the slots or days changed, still to be honoured or cancelled
	const others = mine.filter(item => !shown.has(item.id)).sort((a, b) => `${a.date}${a.from}`.localeCompare(`${b.date}${b.from}`));
	return { slots, days, others };
});

const bookedCount = computed(() => agenda.value.days.reduce((total, day) => total + day.bookings.filter(Boolean).length, 0) + agenda.value.others.length);

const actionError = ref<string>();

async function cancel(booking: Booking) {
	// eslint-disable-next-line no-alert
	if (!window.confirm(`¿Anular la reserva de ${booking.name} el ${formatDay(booking.date, { weekday: 'long', day: 'numeric', month: 'long' })} a las ${booking.from}?`)) {
		return;
	}

	actionError.value = undefined;
	try {
		await cancelBooking(props.id, booking, area.value?.name ?? 'la zona');
	} catch (e) {
		actionError.value = `No se ha podido anular: ${(e as Error).message}`;
	}
}
</script>

<template>
	<header class="page-header">
		<LnxButton :to="`/communities/${id}/locations`" mode="clear" shape="circle" aria-label="Volver a las zonas comunes" title="Volver a las zonas comunes">
			<LnxIcon icon="lucide:arrow-left" />
		</LnxButton>
		<span v-if="area" class="icon">
			<LnxIcon :icon="area.icon" :size="20" />
		</span>
		<h1>
			<span v-if="loading" class="skeleton-item skeleton-item--title" />
			<template v-else>
				Reservas{{ area ? ` · ${area.name}` : '' }}
			</template>
		</h1>
	</header>

	<p v-if="loadError" class="error" role="alert">
		{{ loadError }}
	</p>
	<section v-else-if="!loading && !area?.booking" class="card">
		<p>{{ area ? 'Esta zona no es reservable. Márcala como reservable desde la lista de zonas comunes.' : 'Esta zona no existe o se ha quitado.' }}</p>
		<LnxButton :to="`/communities/${id}/locations`" mode="outline">
			Ver las zonas comunes
		</LnxButton>
	</section>

	<template v-else-if="area?.booking && form">
		<section class="card">
			<header class="week-header">
				<h2>Agenda semanal</h2>
				<div class="week-nav">
					<LnxButton mode="clear" shape="circle" size="small" aria-label="Semana anterior" title="Semana anterior" @click="weekStart = addDays(weekStart, -7)">
						<LnxIcon icon="lucide:chevron-left" />
					</LnxButton>
					<span class="week-label" aria-live="polite">{{ weekLabel }}</span>
					<LnxButton mode="clear" shape="circle" size="small" aria-label="Semana siguiente" title="Semana siguiente" @click="weekStart = addDays(weekStart, 7)">
						<LnxIcon icon="lucide:chevron-right" />
					</LnxButton>
					<LnxButton mode="outline" size="small" :disabled="dates.includes(today)" @click="weekStart = getWeek(today).from">
						Hoy
					</LnxButton>
				</div>
			</header>
			<p v-if="error" class="error" role="alert">
				No se han podido cargar: {{ error.message }}
			</p>
			<p v-if="actionError" class="error" role="alert">
				{{ actionError }}
			</p>

			<span v-if="pending" class="skeleton-item" />
			<template v-else>
				<p class="hint">
					{{ bookedCount === 1 ? '1 reserva' : `${bookedCount} reservas` }} esta semana.
					<span class="legend free">Libre</span>
					<span class="legend booked">Reservado</span>
					<span class="legend closed">Cerrado</span>
				</p>

				<div class="agenda-scroll">
					<table class="agenda">
						<thead>
							<tr>
								<th scope="col">
									<span class="sr-only">Hora</span>
								</th>
								<th v-for="day in agenda.days" :key="day.date" scope="col" :class="{ today: day.date === today }">
									<small>{{ formatDay(day.date, { weekday: 'short' }) }}</small>
									<strong>{{ formatDay(day.date, { day: 'numeric' }) }}</strong>
								</th>
							</tr>
						</thead>
						<tbody>
							<tr v-for="(slot, slotIndex) in agenda.slots" :key="slot.from">
								<th scope="row">
									{{ slot.from }}
								</th>
								<td v-for="day in agenda.days" :key="day.date" :class="{ closed: !day.open, past: day.past }">
									<div v-if="day.bookings[slotIndex]" class="booked" :title="`${day.bookings[slotIndex]!.name} · ${slot.from}–${slot.to}`">
										<span class="who">{{ day.bookings[slotIndex]!.name }}</span>
										<button
											v-if="!day.past"
											type="button"
											:aria-label="`Anular la reserva de ${day.bookings[slotIndex]!.name} el ${formatDay(day.date, { weekday: 'long', day: 'numeric' })} a las ${slot.from}`"
											title="Anular"
											@click="cancel(day.bookings[slotIndex]!)"
										>
											<LnxIcon icon="lucide:x" :size="14" />
										</button>
									</div>
									<span v-else class="sr-only">{{ day.open ? 'Libre' : 'Cerrado' }}</span>
								</td>
							</tr>
						</tbody>
					</table>
				</div>

				<div v-if="agenda.others.length" class="others">
					<h3>Fuera de las franjas actuales</h3>
					<ul>
						<li v-for="booking in agenda.others" :key="booking.id">
							<span>{{ formatDay(booking.date, { weekday: 'short', day: 'numeric' }) }} · {{ booking.from }}–{{ booking.to }} · {{ booking.name }}</span>
							<LnxButton
								mode="clear"
								size="small"
								shape="circle"
								variant="danger"
								:aria-label="`Anular la reserva de ${booking.name}`"
								:title="`Anular la reserva de ${booking.name}`"
								@click="cancel(booking)"
							>
								<LnxIcon icon="lucide:x" />
							</LnxButton>
						</li>
					</ul>
				</div>
			</template>
		</section>

		<form class="card" @submit.prevent="save()">
			<h2>Configuración</h2>
			<div class="fields">
				<fieldset class="days wide">
					<legend>Días</legend>
					<label v-for="(weekday, dayIndex) in WEEKDAYS" :key="weekday">
						<input v-model="form.days" type="checkbox" class="sr-only" :value="dayIndex + 1">
						<span>{{ weekday }}</span>
					</label>
				</fieldset>
				<LnxInput v-model="form.opens" type="time" required>
					Abre
				</LnxInput>
				<LnxInput v-model="form.closes" type="time" required>
					Cierra
				</LnxInput>
				<LnxInput v-model="form.slotMinutes" type="number" min="15" max="720" step="5" required>
					Minutos por franja
				</LnxInput>
				<LnxInput v-model="form.maxPerWeek" type="number" min="1" max="50" placeholder="Sin límite">
					Reservas por vecino y semana
				</LnxInput>
				<LnxInput v-model="form.advanceDays" type="number" min="1" max="365" placeholder="14">
					Días de antelación
				</LnxInput>
				<LnxTextarea v-model="form.rules" rows="2" placeholder="Máximo 4 personas. Deja la pista como la encontraste." class="wide">
					Normas
				</LnxTextarea>
			</div>

			<footer class="form-actions">
				<p v-if="formError" class="error" role="alert">
					{{ formError }}
				</p>
				<p v-else-if="saved" class="hint" role="status">
					Guardado.
				</p>
				<LnxButton type="submit" :is-loading="saving">
					<LnxIcon icon="lucide:save" />
					Guardar
				</LnxButton>
			</footer>
		</form>
	</template>
</template>

<style lang="scss" scoped>
.page-header {
	margin-bottom: var(--lnx-spacing-5);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);

	h1 {
		min-width: 0;
		overflow: hidden;
		font-size: var(--lnx-font-size-title);
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.icon {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border-radius: var(--lnx-radius-circle);
		background: var(--color-gray-2);
		color: var(--color-primary);
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
	align-items: flex-start;
	gap: var(--lnx-spacing-4);

	> * {
		align-self: stretch;
	}

	h2 {
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
		color: var(--color-gray-6);
		text-transform: uppercase;
		letter-spacing: .04em;
	}
}

.week-header {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: var(--lnx-spacing-2);
}

.week-nav {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-1);
}

.week-label {
	min-width: 150px;
	text-align: center;
	font-variant-numeric: tabular-nums;
	color: var(--color-gray-9);
}

.legend {
	margin-left: var(--lnx-spacing-3);
	display: inline-flex;
	align-items: center;
	gap: 4px;

	&::before {
		content: '';
		width: 12px;
		height: 12px;
		border: 1px solid var(--color-gray-3);
		border-radius: 3px;
	}

	&.booked::before {
		border-color: var(--color-primary);
		background: var(--color-primary);
	}

	&.closed::before {
		background: repeating-linear-gradient(45deg, var(--color-gray-2) 0 3px, var(--color-gray-1) 3px 6px);
	}
}

// Seven days side by side need room, on a phone the table scrolls sideways inside its card
.agenda-scroll {
	overflow-x: auto;
}

.agenda {
	width: 100%;
	min-width: 640px;
	border-collapse: separate;
	border-spacing: 0;
	table-layout: fixed;

	th,
	td {
		border-bottom: 1px solid var(--color-gray-2);
	}

	thead th {
		position: sticky;
		top: 0;
		padding: var(--lnx-spacing-1) 0 var(--lnx-spacing-2);
		background: var(--color-gray-0);
		color: var(--color-gray-6);
		font-weight: normal;

		small,
		strong {
			display: block;
		}

		small {
			font-size: var(--lnx-font-size-small);
			text-transform: capitalize;
		}

		strong {
			color: var(--color-gray-9);
			font-size: var(--lnx-font-size-body);
		}

		&.today strong {
			margin: 0 auto;
			width: 28px;
			height: 28px;
			border-radius: var(--lnx-radius-circle);
			display: flex;
			align-items: center;
			justify-content: center;
			background: var(--color-primary);
			color: var(--color-primary-accent);
		}

		&:first-child {
			width: 56px;
		}
	}

	tbody th {
		padding-right: var(--lnx-spacing-2);
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
		font-weight: normal;
		font-variant-numeric: tabular-nums;
		text-align: right;
		vertical-align: top;
	}

	td {
		height: 40px;
		padding: 2px;
		border-left: 1px solid var(--color-gray-2);

		&.closed {
			background: repeating-linear-gradient(45deg, var(--color-gray-2) 0 4px, var(--color-gray-1) 4px 8px);
		}

		&.past {
			opacity: .55;
		}
	}
}

// Inside its cell, not the legend's swatch of the same name
td .booked {
	height: 100%;
	padding: 0 2px 0 var(--lnx-spacing-2);
	border-radius: var(--lnx-radius-2);
	display: flex;
	align-items: center;
	gap: 2px;
	background: var(--color-primary);
	color: var(--color-primary-accent);
	font-size: var(--lnx-font-size-small);

	.who {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	button {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: none;
		border-radius: var(--lnx-radius-circle);
		background: none;
		color: inherit;
		cursor: pointer;

		&:hover,
		&:focus-visible {
			outline: none;
			background: var(--color-gray-0-alpha);
		}
	}
}

.others {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-1);

	h3 {
		font-size: var(--lnx-font-size-body);
	}

	li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--lnx-spacing-2);
	}
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

.hint {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}
</style>
