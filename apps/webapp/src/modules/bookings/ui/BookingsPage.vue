<script setup lang="ts">
import type { Booking } from '@gobernansa/shared/domain/booking.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { bookingId, getSlots, getWeek, toDateString } from '@gobernansa/shared/domain/booking.ts';
import { getBookableAreas } from '@gobernansa/shared/domain/community.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { remote } from '@gobernansa/shared/infrastructure/remoteConfig.ts';
import { FirebaseError } from 'firebase/app';
import { LnxButton, LnxIcon, useConfirm } from 'lnxjs-components';
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import MainLayout from '@/app/ui/MainLayout.vue';
import TheHeader from '@/app/ui/TheHeader.vue';
import { useUserCommunity } from '@/modules/community/application/useUserCommunity.ts';
import { useBookings } from '../application/useBookings.ts';
import { formatDay } from '../domain/days.ts';
import MyBookings from './MyBookings.vue';

const ask = useConfirm();
const route = useRoute();
const router = useRouter();

// In the URL, so coming back from paying or a receipt lands on the same tab
const tab = computed(() => route.query.tab === 'mine' ? 'mine' : 'book');
function show(name: 'book' | 'mine') {
	void router.replace({ query: name === 'mine' ? { tab: 'mine' } : {} });
}

const DEFAULT_ADVANCE_DAYS = 14;

const { user, viewingAs } = useAuth();
const { userCommunity } = useUserCommunity();
const areas = computed(() => getBookableAreas(userCommunity.value));

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

const { dayBookings, myBookings, book, cancel } = useBookings(date);
const loadError = computed(() => dayBookings.error.value || myBookings.error.value);

const blocked = computed(() => !!user.value?.blocked);

const week = computed(() => getWeek(date.value));
const bookedThisWeek = computed(() => myBookings.value.filter(booking => booking.areaId === areaId.value && booking.date >= week.value.from && booking.date <= week.value.to).length);
const weekFull = computed(() => !!area.value?.maxPerWeek && bookedThisWeek.value >= area.value.maxPerWeek);

const upcoming = computed(() => myBookings.value
	.filter(booking => booking.date >= today)
	.sort((a, b) => a.date.localeCompare(b.date) || a.from.localeCompare(b.from)));
// The last ones, most recent first
const past = computed(() => myBookings.value
	.filter(booking => booking.date < today)
	.sort((a, b) => b.date.localeCompare(a.date) || b.from.localeCompare(a.from))
	.slice(0, 10));

function priceOf(option: { price?: number; deposit?: number }) {
	if (!option.price && !option.deposit) {
		return 'Gratis';
	}
	return [option.price && formatCents(option.price), option.deposit && `fianza ${formatCents(option.deposit)}`].filter(Boolean).join(' + ');
}

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
watch([areaId, date], () => {
	selected.value = undefined;
});

// What the area costs per slot, the fianza is given back after
const fee = computed(() => ({ price: area.value?.price ?? 0, deposit: area.value?.deposit ?? 0 }));
const feeTotal = computed(() => fee.value.price + fee.value.deposit);
// Online payments can be turned off from the console (ROB-5)
const canPayOnline = computed(() => userCommunity.value?.onlinePayments === 'test' && remote.payments);

const busy = ref(false);
const message = ref<string>();

// Booked owed or free, paid ones are booked from the pay wizard
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
		await book({ areaId: area.value.id, date: date.value, from: selected.value.from, to: selected.value.to }, fee.value);
		selected.value = undefined;
		if (feeTotal.value) {
			message.value = 'Reservada. Queda pendiente de pago: págalo a la administración.';
		}
		// Its ticket is waiting there
		show('mine');
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
	if (!await ask({ title: `¿Anular tu reserva del ${formatDay(booking.date)} a las ${booking.from}?`, confirmText: 'Anular reserva', variant: 'danger' })) {
		return;
	}

	message.value = undefined;
	try {
		await cancel(booking);
	} catch {
		message.value = 'No se ha podido anular. Inténtalo de nuevo.';
	}
}

const month = computed(() => new Date(`${date.value}T00:00`).toLocaleDateString('es', { month: 'long', year: 'numeric' }));
</script>

<template>
	<TheHeader back="/neighborhood">
		<h1>Reservas</h1>
		<p>Reserva las zonas comunes de tu comunidad.</p>

		<div class="tabs" role="tablist" aria-label="Reservas">
			<button
				id="tab-book"
				type="button"
				role="tab"
				:aria-selected="tab === 'book'"
				aria-controls="panel-book"
				@click="show('book')"
			>
				Reservar
			</button>
			<button
				id="tab-mine"
				type="button"
				role="tab"
				:aria-selected="tab === 'mine'"
				aria-controls="panel-mine"
				@click="show('mine')"
			>
				Mis reservas
				<span v-if="upcoming.length" class="count" :aria-label="`${upcoming.length} próximas`">{{ upcoming.length }}</span>
			</button>
		</div>
	</TheHeader>

	<MainLayout>
		<!-- Viewing as a neighbour is read-only too, its banner already says so -->
		<p v-if="blocked && !viewingAs" class="notice" role="status">
			<LnxIcon icon="lucide:lock" :size="18" />
			Tu cuenta está bloqueada por la administración: puedes ver las reservas, pero no reservar.
		</p>
		<p v-if="message" class="error" role="alert">
			{{ message }}
		</p>
		<p v-if="loadError" class="error" role="alert">
			No se han podido cargar las reservas. Recarga la página.
		</p>

		<div
			v-if="tab === 'book'"
			id="panel-book"
			role="tabpanel"
			aria-labelledby="tab-book"
			class="panel"
		>
			<p v-if="userCommunity && !areas.length" class="empty">
				Tu comunidad aún no tiene zonas que se puedan reservar.
			</p>

			<template v-else-if="area">
				<div class="areas" role="radiogroup" aria-label="Zona">
					<label v-for="option in areas" :key="option.id" class="area" :class="{ active: option.id === areaId }">
						<input v-model="areaId" type="radio" name="area" class="sr-only" :value="option.id">
						<span class="area-icon"><LnxIcon :icon="option.icon" :size="22" /></span>
						<strong>{{ option.name }}</strong>
						<small class="tabular">{{ priceOf(option) }}</small>
					</label>
				</div>

				<div class="calendar">
					<p id="month" class="month">
						{{ month }}
					</p>
					<div class="days" role="radiogroup" aria-labelledby="month">
						<label v-for="day in days" :key="day.value" :class="{ active: day.value === date, closed: day.closed }">
							<input v-model="date" type="radio" name="day" class="sr-only" :value="day.value">
							<small>{{ day.value === today ? 'Hoy' : day.weekday }}</small>
							<strong>{{ day.number }}</strong>
						</label>
					</div>
				</div>

				<section class="agenda" :aria-label="`Franjas del ${formatDay(date)}`">
					<header>
						<h2>{{ formatDay(date) }}</h2>
						<small v-if="area.maxPerWeek" class="tabular">{{ bookedThisWeek }}/{{ area.maxPerWeek }} esta semana</small>
					</header>
					<p v-if="weekFull && !blocked" class="hint">
						Ya tienes {{ bookedThisWeek }} {{ bookedThisWeek === 1 ? 'reserva' : 'reservas' }} esta semana, el máximo en {{ area.name }}.
					</p>

					<ol v-if="slots.length">
						<li v-for="slot in slots" :key="slot.from">
							<button
								v-if="slot.state === 'mine'"
								type="button"
								class="slot mine"
								:class="{ past: slot.past }"
								:disabled="blocked || slot.past || !!slot.booking!.paidAt"
								:aria-label="`${slot.from} a ${slot.to}, tu reserva. Anular`"
								@click="remove(slot.booking!)"
							>
								<span class="time"><strong>{{ slot.from }}</strong><small>a {{ slot.to }}</small></span>
								<span class="state">
									<LnxIcon icon="lucide:calendar-heart" :size="18" />
									Tu reserva
								</span>
							</button>
							<button
								v-else
								type="button"
								class="slot"
								:class="[slot.state, { selected: selected?.from === slot.from, past: slot.past }]"
								:disabled="blocked || slot.past || slot.state === 'taken' || weekFull"
								:aria-pressed="selected?.from === slot.from"
								@click="selected = selected?.from === slot.from ? undefined : slot"
							>
								<span class="time"><strong>{{ slot.from }}</strong><small>a {{ slot.to }}</small></span>
								<span class="state">
									<template v-if="selected?.from === slot.from">
										<LnxIcon icon="lucide:check" :size="18" />
										Elegida
									</template>
									<template v-else-if="slot.state === 'taken'">
										Ocupada
									</template>
									<template v-else-if="slot.past">
										Pasada
									</template>
									<template v-else>
										Libre
										<LnxIcon icon="lucide:plus" :size="18" />
									</template>
								</span>
							</button>
						</li>
					</ol>
					<p v-else class="closed-day">
						<LnxIcon icon="lucide:moon" :size="20" />
						{{ area.name }} no abre este día.
					</p>
				</section>

				<section v-if="selected" class="confirm" aria-live="polite">
					<h2>
						{{ area.name }}
						<span class="tabular">{{ selected.from }}–{{ selected.to }}</span>
					</h2>
					<p class="when">
						{{ formatDay(date) }}
					</p>
					<p v-if="feeTotal" class="fee tabular">
						<template v-if="fee.price">
							Precio <strong>{{ formatCents(fee.price) }}</strong>
						</template>
						<template v-if="fee.deposit">
							{{ fee.price ? ' · ' : '' }}Fianza <strong>{{ formatCents(fee.deposit) }}</strong>, se devuelve después
						</template>
					</p>
					<p v-if="feeTotal && !canPayOnline" class="hint">
						Quedará pendiente de pago hasta que lo pagues a la administración.
					</p>
					<details v-if="area.rules" class="rules">
						<summary>Normas de {{ area.name }}</summary>
						<p>{{ area.rules }}</p>
					</details>
					<div class="confirm-actions">
						<LnxButton mode="clear" @click="selected = undefined">
							Cancelar
						</LnxButton>
						<LnxButton v-if="feeTotal && canPayOnline" :to="`/neighborhood/bookings/${bookingId(area.id, date, selected.from)}/pay`">
							<LnxIcon icon="lucide:credit-card" />
							Pagar {{ formatCents(feeTotal) }}
						</LnxButton>
						<LnxButton v-else :is-loading="busy" @click="confirm()">
							<LnxIcon icon="lucide:calendar-check" />
							{{ area.rules ? 'Acepto y reservo' : 'Reservar' }}
						</LnxButton>
					</div>
				</section>
			</template>
		</div>

		<div
			v-else
			id="panel-mine"
			role="tabpanel"
			aria-labelledby="tab-mine"
			class="panel"
		>
			<MyBookings :upcoming :past :areas :blocked :can-pay-online @remove="remove" @book="show('book')" />
		</div>
	</MainLayout>
</template>

<style lang="scss" scoped>
// A soft wash of the brand colour, for picked and own things
$tint: color-mix(in srgb, var(--color-primary) 8%, var(--color-gray-0));
$shadow: 0 1px 2px #0000000A, 0 4px 12px #0000000D;

.tabs {
	display: grid;
	grid-template-columns: 1fr 1fr;
	margin: var(--lnx-spacing-2) calc(-1 * var(--lnx-spacing-4)) 0;
	padding: 0 var(--lnx-spacing-4);
	border-bottom: 1px solid var(--color-gray-3);

	button {
		position: relative;
		min-height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--lnx-spacing-2);
		color: var(--color-gray-6);
		font: inherit;
		cursor: pointer;
		transition: color .2s;

		&::after {
			content: '';
			position: absolute;
			left: var(--lnx-spacing-4);
			right: var(--lnx-spacing-4);
			bottom: -1px;
			height: 3px;
			border-radius: 3px 3px 0 0;
			background: var(--color-primary);
			transform: scaleX(0);
			transition: transform .2s;
		}

		&[aria-selected=true] {
			color: var(--color-gray-9);
			font-weight: var(--lnx-font-weight-bold);

			&::after {
				transform: scaleX(1);
			}
		}

		&:focus-visible {
			outline: 2px solid var(--color-primary-light);
			outline-offset: -2px;
			border-radius: var(--lnx-radius-3);
		}
	}

	.count {
		min-width: 20px;
		height: 20px;
		padding: 0 6px;
		border-radius: 10px;
		background: var(--color-primary);
		color: var(--color-primary-accent);
		font-size: .75rem;
		font-weight: var(--lnx-font-weight-bold);
		line-height: 20px;
	}
}

.panel {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-5);
}

// Scroll sideways on phones, edge to edge. Relative, so the hidden radios of the last days are clipped too and don't widen the page
.areas,
.days {
	position: relative;
	margin: 0 calc(-1 * var(--lnx-spacing-4));
	padding: 2px var(--lnx-spacing-4);
	display: flex;
	gap: var(--lnx-spacing-2);
	overflow-x: auto;
	scrollbar-width: none;
}

.area {
	flex: 0 0 132px;
	padding: var(--lnx-spacing-3);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-4);
	background: var(--color-gray-0);
	display: flex;
	flex-direction: column;
	gap: 2px;
	cursor: pointer;
	transition: border-color .15s, background .15s, box-shadow .15s;

	.area-icon {
		width: 40px;
		height: 40px;
		margin-bottom: var(--lnx-spacing-2);
		border-radius: var(--lnx-radius-circle);
		background: var(--color-gray-1);
		color: var(--color-gray-7);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background .15s, color .15s;
	}

	strong {
		color: var(--color-gray-9);
		line-height: 1.25;
	}

	small {
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
	}

	&.active {
		border-color: var(--color-primary);
		background: $tint;
		box-shadow: 0 0 0 1px var(--color-primary);

		.area-icon {
			background: var(--color-primary);
			color: var(--color-primary-accent);
		}
	}

	&:has(:focus-visible) {
		outline: 2px solid var(--color-primary-light);
		outline-offset: 2px;
	}
}

// Only one area: a card that tells what it is, nothing to pick
.areas:has(.area:only-of-type) .area {
	flex: 1;
	flex-direction: row;
	flex-wrap: wrap;
	align-items: center;
	column-gap: var(--lnx-spacing-3);
	cursor: default;

	.area-icon {
		margin: 0;
	}

	small {
		flex-basis: 100%;
		padding-left: calc(40px + var(--lnx-spacing-3));
		margin-top: -14px;
	}
}

.calendar {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);

	.month {
		color: var(--color-gray-9);
		font-weight: var(--lnx-font-weight-bold);

		&::first-letter {
			text-transform: uppercase;
		}
	}
}

.days label {
	flex-shrink: 0;
	width: 48px;
	padding: var(--lnx-spacing-2) 0;
	border-radius: 24px;
	color: var(--color-gray-7);
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 2px;
	cursor: pointer;
	transition: background .15s, color .15s;

	small {
		font-size: .75rem;
		text-transform: capitalize;
	}

	strong {
		font-size: 1.2rem;
		font-variant-numeric: tabular-nums;
	}

	&.closed {
		opacity: .45;
	}

	&.active {
		background: var(--color-primary);
		color: var(--color-primary-accent);
		opacity: 1;
	}

	&:has(:focus-visible) {
		outline: 2px solid var(--color-primary-light);
		outline-offset: 2px;
	}
}

.agenda {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);

	header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--lnx-spacing-2);

		h2 {
			font-size: var(--lnx-font-size-body);
			color: var(--color-gray-9);

			&::first-letter {
				text-transform: uppercase;
			}
		}

		small {
			color: var(--color-gray-6);
			font-size: var(--lnx-font-size-small);
			white-space: nowrap;
		}
	}

	ol {
		display: flex;
		flex-direction: column;
		gap: var(--lnx-spacing-2);
	}
}

.slot {
	width: 100%;
	min-height: 56px;
	padding: var(--lnx-spacing-2) var(--lnx-spacing-4);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-4);
	background: var(--color-gray-0);
	color: var(--color-gray-9);
	font: inherit;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--lnx-spacing-3);
	cursor: pointer;
	transition: background .15s, border-color .15s, color .15s, transform .1s;

	.time {
		display: flex;
		align-items: baseline;
		gap: var(--lnx-spacing-2);
		font-variant-numeric: tabular-nums;

		strong {
			font-size: 1.15rem;
		}

		small {
			color: var(--color-gray-6);
			font-size: var(--lnx-font-size-small);
		}
	}

	.state {
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-1);
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
	}

	&.free:not(:disabled, .selected) .state {
		color: var(--color-issue-status-resolved);
	}

	&:not(:disabled):active {
		transform: scale(.98);
	}

	&.selected {
		border-color: var(--color-primary);
		background: var(--color-primary);
		color: var(--color-primary-accent);

		.time small,
		.state {
			color: inherit;
		}
	}

	&.mine {
		border-color: transparent;
		background: $tint;
		color: var(--color-primary);

		.time small {
			color: var(--color-primary);
		}
	}

	// Stripes say "not yours" without a word
	&.taken {
		border-color: var(--color-gray-2);
		background: repeating-linear-gradient(-45deg, var(--color-gray-1) 0 6px, var(--color-gray-0) 6px 12px);
		color: var(--color-gray-6);
	}

	&.past {
		opacity: .5;
	}

	&:disabled {
		cursor: default;
	}

	&:focus-visible {
		outline: 2px solid var(--color-primary-light);
		outline-offset: 2px;
	}
}

.closed-day {
	padding: var(--lnx-spacing-5) var(--lnx-spacing-4);
	border-radius: var(--lnx-radius-4);
	background: var(--color-gray-1);
	color: var(--color-gray-6);
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: var(--lnx-spacing-2);
	text-align: center;
}

// Stays at hand above the tab bar while the slots scroll under it
.confirm {
	position: sticky;
	bottom: calc(var(--tab-height) + var(--lnx-spacing-2));
	z-index: 1;
	padding: var(--lnx-spacing-4);
	border-radius: var(--lnx-radius-4);
	background: var(--color-gray-0);
	box-shadow: 0 -2px 8px #0000000A, 0 8px 28px #0000002E;
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);

	h2 {
		display: flex;
		justify-content: space-between;
		gap: var(--lnx-spacing-2);
		font-size: var(--lnx-font-size-body);
		color: var(--color-gray-9);
	}

	.when::first-letter {
		text-transform: uppercase;
	}

	.when,
	.fee {
		color: var(--color-gray-7);
		font-size: var(--lnx-font-size-small);
	}

	.rules {
		padding: var(--lnx-spacing-2) var(--lnx-spacing-3);
		border-radius: var(--lnx-radius-3);
		background: var(--color-gray-1);
		font-size: var(--lnx-font-size-small);

		summary {
			color: var(--color-gray-7);
			font-weight: var(--lnx-font-weight-bold);
			cursor: pointer;
		}

		p {
			margin-top: var(--lnx-spacing-2);
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
