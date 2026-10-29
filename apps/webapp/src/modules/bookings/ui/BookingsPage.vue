<script setup lang="ts">
import type { Booking } from '@gobernansa/shared/domain/booking.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { getSlots, getWeek, toDateString } from '@gobernansa/shared/domain/booking.ts';
import { getCommonAreaIcon } from '@gobernansa/shared/domain/community.ts';
import { FirebaseError } from 'firebase/app';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed, onUnmounted, ref, watch } from 'vue';
import { useUserCommunity } from '@/modules/community/application/useUserCommunity.ts';
import MainLayout from '@/shared/ui/MainLayout.vue';
import TheHeader from '@/shared/ui/TheHeader.vue';
import { useBookings } from '../application/useBookings.ts';

const DEFAULT_ADVANCE_DAYS = 14;

const { user, viewingAs } = useAuth();
const { userCommunity } = useUserCommunity();
const areas = computed(() => userCommunity.value?.bookableAreas ?? []);

const areaId = ref<string>();
const area = computed(() => areas.value.find(({ id }) => id === areaId.value));
// The first one until the user picks another, or when the picked one is removed
watch(areas, () => {
	if (!area.value) {
		areaId.value = areas.value[0]?.id;
	}
}, { immediate: true });

const today = toDateString(new Date());
const date = ref(today);

const days = computed(() => {
	const now = new Date();
	return Array.from({ length: (area.value?.advanceDays ?? DEFAULT_ADVANCE_DAYS) + 1 }, (_, index) => {
		const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + index);
		const value = toDateString(day);
		return {
			value,
			weekday: day.toLocaleDateString('es', { weekday: 'short' }),
			number: day.getDate(),
			closed: !area.value || !getSlots(area.value, value).length,
		};
	});
});
// Back to today when the picked day falls out of the new area's range
watch(days, () => {
	if (!days.value.some(({ value }) => value === date.value)) {
		date.value = today;
	}
});

const { dayBookings, myBookings, book, cancel } = useBookings(date, areaId);
const loadError = computed(() => dayBookings.error.value || myBookings.error.value);

const blocked = computed(() => !!user.value?.blocked);

const week = computed(() => getWeek(date.value));
const bookedThisWeek = computed(() => myBookings.value.filter(booking => booking.date >= week.value.from && booking.date <= week.value.to).length);
const weekFull = computed(() => !!area.value?.maxPerWeek && bookedThisWeek.value >= area.value.maxPerWeek);

const upcoming = computed(() => myBookings.value
	.filter(booking => booking.date >= today)
	.sort((a, b) => a.date.localeCompare(b.date) || a.from.localeCompare(b.from)));

// Ticks every minute, so a slot of today that starts while the page is open can't be booked anymore
const now = ref(new Date());
const clock = setInterval(() => now.value = new Date(), 60_000);
onUnmounted(() => clearInterval(clock));

function hasStarted(day: string, from: string) {
	return new Date(`${day}T${from}`) <= now.value;
}

const slots = computed(() => {
	if (!area.value) {
		return [];
	}

	const taken = new Map(dayBookings.value.filter(booking => booking.areaId === area.value!.id).map(booking => [booking.from, booking]));
	return getSlots(area.value, date.value).map((slot) => {
		const booking = taken.get(slot.from);
		return {
			...slot,
			booking,
			state: booking ? (booking.uid === user.value?.id ? 'mine' : 'taken') : 'free',
			past: hasStarted(date.value, slot.from),
		};
	});
});

const selected = ref<{ from: string; to: string }>();
watch([areaId, date], () => selected.value = undefined);

const busy = ref(false);
const message = ref<string>();

async function confirm() {
	if (!area.value || !selected.value) {
		return;
	}
	// The limit may have been reached from another tab or device since the slot was picked
	if (weekFull.value) {
		message.value = `Ya has llegado al máximo de reservas semanales en ${area.value.name}.`;
		selected.value = undefined;
		return;
	}

	busy.value = true;
	message.value = undefined;
	try {
		// Only the times: the slot shown also carries its state, which isn't stored
		await book({ areaId: area.value.id, date: date.value, from: selected.value.from, to: selected.value.to });
		selected.value = undefined;
	} catch (e) {
		// The rules turn down a slot that's already booked, someone got it first
		message.value = e instanceof FirebaseError && e.code === 'permission-denied'
			? 'Esa franja acaba de reservarse.'
			: 'No se ha podido reservar. Inténtalo de nuevo.';
		selected.value = undefined;
	} finally {
		busy.value = false;
	}
}

async function remove(booking: Booking) {
	// eslint-disable-next-line no-alert
	if (!window.confirm(`¿Anular tu reserva del ${formatDay(booking.date)} a las ${booking.from}?`)) {
		return;
	}

	message.value = undefined;
	try {
		await cancel(booking);
	} catch {
		message.value = 'No se ha podido anular. Inténtalo de nuevo.';
	}
}

function formatDay(day: string) {
	return new Date(`${day}T00:00`).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
}
</script>

<template>
	<TheHeader>
		<h1>Reservas</h1>
		<p>Reserva las zonas comunes de tu comunidad.</p>
	</TheHeader>

	<MainLayout>
		<!-- Viewing as a neighbour is read-only too, its banner already says so -->
		<p v-if="blocked && !viewingAs" class="notice" role="status">
			<LnxIcon icon="lucide:lock" :size="18" />
			Tu cuenta está bloqueada por la administración: puedes ver las reservas, pero no reservar.
		</p>

		<p v-if="userCommunity && !areas.length" class="empty">
			Tu comunidad aún no tiene zonas que se puedan reservar.
		</p>

		<template v-else-if="area">
			<fieldset v-if="areas.length > 1" class="areas">
				<legend class="sr-only">
					Zona
				</legend>
				<label v-for="option in areas" :key="option.id" :class="{ active: option.id === areaId }">
					<input v-model="areaId" type="radio" name="area" class="sr-only" :value="option.id">
					<LnxIcon :icon="getCommonAreaIcon(option.name)" :size="18" />
					{{ option.name }}
				</label>
			</fieldset>
			<h2 v-else class="area-name">
				<LnxIcon :icon="getCommonAreaIcon(area.name)" :size="20" />
				{{ area.name }}
			</h2>

			<fieldset class="days">
				<legend class="sr-only">
					Día
				</legend>
				<label v-for="day in days" :key="day.value" :class="{ active: day.value === date, closed: day.closed }">
					<input v-model="date" type="radio" name="day" class="sr-only" :value="day.value">
					<small>{{ day.weekday }}</small>
					<strong>{{ day.number }}</strong>
				</label>
			</fieldset>

			<section>
				<h2>{{ formatDay(date) }}</h2>
				<p v-if="weekFull && !blocked" class="hint">
					Ya tienes {{ bookedThisWeek }} {{ bookedThisWeek === 1 ? 'reserva' : 'reservas' }} esta semana, el máximo en {{ area.name }}.
				</p>
				<p v-if="message" class="error" role="alert">
					{{ message }}
				</p>
				<p v-if="loadError" class="error" role="alert">
					No se han podido cargar las reservas. Recarga la página.
				</p>

				<ul v-if="slots.length" class="slots">
					<li v-for="slot in slots" :key="slot.from">
						<button
							v-if="slot.state === 'mine'"
							type="button"
							class="slot mine"
							:disabled="blocked || slot.past"
							:aria-label="`${slot.from}–${slot.to}, tu reserva. Anular`"
							@click="remove(slot.booking!)"
						>
							<span>{{ slot.from }}–{{ slot.to }}</span>
							<small>Tuya</small>
						</button>
						<button
							v-else
							type="button"
							class="slot"
							:class="[slot.state, { selected: selected?.from === slot.from }]"
							:disabled="blocked || slot.past || slot.state === 'taken' || weekFull"
							:aria-pressed="selected?.from === slot.from"
							@click="selected = slot"
						>
							<span>{{ slot.from }}–{{ slot.to }}</span>
							<small>{{ slot.state === 'taken' ? 'Ocupada' : slot.past ? 'Pasada' : 'Libre' }}</small>
						</button>
					</li>
				</ul>
				<p v-else class="empty">
					{{ area.name }} no abre este día.
				</p>
			</section>

			<section v-if="selected" class="confirm" aria-live="polite">
				<h2>Confirma tu reserva</h2>
				<p>
					<strong>{{ area.name }}</strong>, {{ formatDay(date) }} de {{ selected.from }} a {{ selected.to }}.
				</p>
				<div v-if="area.rules" class="rules">
					<small>Normas</small>
					<p>{{ area.rules }}</p>
				</div>
				<div class="confirm-actions">
					<LnxButton mode="clear" @click="selected = undefined">
						Cancelar
					</LnxButton>
					<LnxButton :is-loading="busy" @click="confirm()">
						<LnxIcon icon="lucide:calendar-check" />
						{{ area.rules ? 'Acepto las normas y reservo' : 'Reservar' }}
					</LnxButton>
				</div>
			</section>

			<section v-if="upcoming.length">
				<h2>Tus próximas reservas</h2>
				<ul class="list">
					<li v-for="booking in upcoming" :key="booking.id" class="row">
						<span class="body">
							<small>{{ formatDay(booking.date) }}</small>
							<strong>{{ booking.from }}–{{ booking.to }}</strong>
						</span>
						<LnxButton
							v-if="!blocked"
							mode="clear"
							shape="circle"
							variant="danger"
							:aria-label="`Anular la reserva del ${formatDay(booking.date)} a las ${booking.from}`"
							@click="remove(booking)"
						>
							<LnxIcon icon="lucide:x" />
						</LnxButton>
					</li>
				</ul>
			</section>
		</template>
	</MainLayout>
</template>

<style lang="scss" scoped>
section {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);

	> h2 {
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
		color: var(--color-gray-6);
		text-transform: uppercase;
		letter-spacing: .04em;
	}
}

.notice {
	padding: var(--lnx-spacing-3);
	border-radius: var(--lnx-radius-3);
	background: #fde8e8;
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
	display: flex;
	align-items: flex-start;
	gap: var(--lnx-spacing-2);
}

.area-name {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
	font-size: var(--lnx-font-size-body);
	color: var(--color-gray-9);
}

// Scroll sideways on phones, edge to edge
.areas,
.days {
	margin: 0 calc(-1 * var(--lnx-spacing-4));
	padding: 0 var(--lnx-spacing-4);
	display: flex;
	gap: var(--lnx-spacing-2);
	overflow-x: auto;
	scrollbar-width: none;

	label {
		flex-shrink: 0;
		border: 1px solid var(--color-gray-3);
		border-radius: var(--lnx-radius-3);
		background: var(--color-gray-0);
		color: var(--color-gray-7);
		cursor: pointer;

		&.active {
			border-color: var(--color-primary);
			background: var(--color-primary);
			color: var(--color-primary-accent);
		}

		&:has(:focus-visible) {
			outline: 2px solid var(--color-primary-light);
			outline-offset: 2px;
		}
	}
}

.areas label {
	min-height: 44px;
	padding: 0 var(--lnx-spacing-3);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
	white-space: nowrap;
}

.days label {
	width: 52px;
	padding: var(--lnx-spacing-2) 0;
	display: flex;
	flex-direction: column;
	align-items: center;

	small {
		font-size: var(--lnx-font-size-legal);
		text-transform: uppercase;
	}

	strong {
		font-size: 1.1rem;
	}

	&.closed:not(.active) {
		color: var(--color-gray-4);
	}
}

.slots {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
	gap: var(--lnx-spacing-2);
}

.slot {
	width: 100%;
	min-height: 56px;
	padding: var(--lnx-spacing-2);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	color: var(--color-gray-9);
	font: inherit;
	display: flex;
	flex-direction: column;
	align-items: center;
	cursor: pointer;

	span {
		font-variant-numeric: tabular-nums;
	}

	small {
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-legal);
	}

	&.free:not(:disabled) small {
		color: var(--color-issue-status-resolved);
	}

	&.selected {
		border-color: var(--color-primary);
		outline: 2px solid var(--color-primary);
	}

	&.mine {
		border-color: var(--color-primary);
		background: var(--color-primary);
		color: var(--color-primary-accent);

		small {
			color: inherit;
		}
	}

	&.taken {
		background: var(--color-gray-1);
	}

	&:disabled {
		cursor: default;
		opacity: .55;
	}

	&:focus-visible {
		outline: 2px solid var(--color-primary-light);
		outline-offset: 2px;
	}
}

.confirm {
	padding: var(--lnx-spacing-4);
	border: 1px solid var(--color-primary);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;

	.rules {
		padding: var(--lnx-spacing-3);
		border-radius: var(--lnx-radius-2);
		background: var(--color-gray-1);

		small {
			color: var(--color-gray-6);
			font-size: var(--lnx-font-size-small);
			font-weight: var(--lnx-font-weight-bold);
		}

		p {
			white-space: pre-line;
		}
	}
}

.confirm-actions {
	display: flex;
	flex-wrap: wrap;
	justify-content: flex-end;
	gap: var(--lnx-spacing-2);
}

.list {
	display: flex;
	flex-direction: column;
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;

	> li + li {
		border-top: 1px solid var(--color-gray-2);
	}
}

.row {
	padding: var(--lnx-spacing-3);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-3);

	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;

		small {
			color: var(--color-gray-6);
			font-size: var(--lnx-font-size-small);
		}
	}
}

.hint,
.empty {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}
</style>
