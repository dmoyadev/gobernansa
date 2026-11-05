<script setup lang="ts">
import type { Obligation, ObligationType } from '@gobernansa/shared/domain/obligation.ts';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { OBLIGATION_WARNING_DAYS, obligationDone, obligationStatus, obligationStatusLabels, obligationTypes } from '@gobernansa/shared/domain/obligation.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import DatePicker from '@gobernansa/shared/ui/DatePicker.vue';
import LnxTextarea from '@gobernansa/shared/ui/LnxTextarea.vue';
import { collection, deleteField, doc, serverTimestamp, Timestamp, writeBatch } from 'firebase/firestore';
import { LnxButton, LnxIcon, LnxInput, LnxSelect } from 'lnxjs-components';
import { computed, ref } from 'vue';
import { useCollection } from 'vuefire';
import BackButton from '@/app/ux/BackButton.vue';
import Kbd from '@/app/ux/Kbd.vue';
import { newId } from '@/app/ux/navigation.ts';
import { useEventListener, useShortcut } from '@/app/ux/shortcuts.ts';
import { optimistic } from '@/app/ux/toast.ts';
import { toInputDate } from '@/modules/communities/domain/communityForm.ts';
import { useProviders } from '@/modules/providers/application/useProviders.ts';

const props = defineProps<{ id: string }>();

const DAY = 86_400_000;
const ICS_SPECIAL = /[\\;,]/g;
const NEWLINES = /\n/g;
const TIME_SEPARATORS = /[-:]/g;
const MILLISECONDS = /\.\d+/;

const obligationsRef = collection(db, 'communities', props.id, 'obligations');
// A handful per community, so live and sorted here
const { data: obligations, pending, error } = useCollection<Obligation>(obligationsRef);
const sorted = computed(() => [...obligations.value].sort((a, b) => a.dueAt.toMillis() - b.dueAt.toMillis()));
// Due dates are local midnights, so they count by day: one due today isn't overdue until tomorrow
function today() {
	const now = new Date();
	return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function status(obligation: Obligation) {
	return obligationStatus(obligation, today());
}

// The overdue ones first, so their tone leads the banner, each group already by due date
const warningGroups = computed(() => [
	{ key: 'overdue', label: 'Vencidas', items: sorted.value.filter(obligation => status(obligation) === 'overdue') },
	{ key: 'soon', label: `Próximos ${OBLIGATION_WARNING_DAYS} días`, items: sorted.value.filter(obligation => status(obligation) === 'soon') },
].filter(group => group.items.length));

const warningSummary = computed(() => warningGroups.value.map(({ key, items: { length } }) => key === 'overdue'
	? `${length} vencida${length === 1 ? '' : 's'}`
	: `${length} vence${length === 1 ? '' : 'n'} en los próximos ${OBLIGATION_WARNING_DAYS} días`).join(' y '));

// «Hace 12 días», «ayer», «hoy», «mañana», «dentro de 20 días»
const relativeDay = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

const { providers } = useProviders(() => props.id);
const typeOptions = Object.entries(obligationTypes).map(([value, type]) => ({ value: value as ObligationType, label: type.label }));
const providerOptions = computed(() => [{ value: '', label: 'Ninguno' }, ...providers.value.map(provider => ({ value: provider.id, label: provider.name }))]);

function daysLeft(obligation: Obligation) {
	// Rounded, a day across a time change is 23 or 25 hours long
	return Math.round((obligation.dueAt.toMillis() - today().getTime()) / DAY);
}

function daysLabel(obligation: Obligation) {
	const days = daysLeft(obligation);
	if (days === 0) {
		return 'Vence hoy';
	}
	const count = `${Math.abs(days)} día${Math.abs(days) === 1 ? '' : 's'}`;
	return days > 0 ? `Queda${days === 1 ? '' : 'n'} ${count}` : `Venció hace ${count}`;
}

function addMonths(date: Date, months: number) {
	const next = new Date(date);
	next.setMonth(next.getMonth() + months);
	return next;
}

interface ObligationForm {
	type: ObligationType;
	title: string;
	dueAt: string;
	everyMonths: string;
	providerId: string;
	notes: string;
}

function emptyForm(): ObligationForm {
	return { type: 'iee', title: obligationTypes.iee.label, dueAt: toInputDate(new Date()), everyMonths: String(obligationTypes.iee.everyMonths ?? ''), providerId: '', notes: '' };
}

const form = ref(emptyForm());
const editingId = ref<string>();
// The next new one's id, made with its form, so sending it twice writes it once
const newObligationId = ref(newId());
const formElement = ref<HTMLFormElement>();

// Choosing a type fills in its usual title and period, still editable
function onTypeChange() {
	const type = obligationTypes[form.value.type];
	form.value.title = form.value.type === 'other' ? '' : type.label;
	form.value.everyMonths = String(type.everyMonths ?? '');
}

function edit(obligation: Obligation) {
	editingId.value = obligation.id;
	form.value = {
		type: obligation.type,
		title: obligation.title,
		dueAt: toInputDate(obligation.dueAt.toDate()),
		everyMonths: String(obligation.everyMonths ?? ''),
		providerId: obligation.provider?.id ?? '',
		notes: obligation.notes ?? '',
	};
	window.scrollTo({ top: 0, behavior: 'smooth' });
}

function reset() {
	editingId.value = undefined;
	form.value = emptyForm();
}

// The list shows it at once, so the form empties straight away, and comes back as it was typed if the server refuses it
function save() {
	const uid = auth.currentUser!.uid;
	const typed = form.value;
	const id = editingId.value ?? newObligationId.value;
	const editing = !!editingId.value;
	const { type, title, dueAt, everyMonths, providerId, notes } = typed;
	const months = Number.parseInt(everyMonths, 10);
	const due = new Date(`${dueAt}T00:00`);
	const stored = obligations.value.find(item => item.id === editingId.value);
	// Kept when it's no longer shared with this community, so editing something else doesn't drop it
	const provider = providers.value.find(item => item.id === providerId) ?? (stored?.provider?.id === providerId ? stored.provider : undefined);
	// A one-off one done is pending again once it gets another date or stops repeating
	const stillDone = months > 0 || (stored && !stored.everyMonths && stored.dueAt.toMillis() === due.getTime());
	const now = serverTimestamp();
	const batch = writeBatch(db);
	// Merged, so the optional fields left empty are removed
	batch.set(doc(obligationsRef, id), {
		communityId: props.id,
		type,
		title: title.trim(),
		dueAt: Timestamp.fromDate(due),
		everyMonths: months > 0 ? months : deleteField(),
		provider: provider ? { id: provider.id, name: provider.name } : deleteField(),
		notes: notes.trim() || deleteField(),
		...(stillDone ? {} : { lastDoneAt: deleteField() }),
		updatedAt: now,
		updatedBy: uid,
		...(editing ? {} : { createdAt: now, createdBy: uid }),
	}, { merge: true });
	logActivity(batch, props.id, {
		area: 'obligation',
		summary: `${editing ? 'Editó' : 'Añadió'} la obligación «${title.trim()}», vence el ${due.toLocaleDateString('es')}`,
		link: `/communities/${props.id}/obligations`,
	});
	void optimistic(batch.commit(), {
		done: editing ? 'Guardado' : 'Obligación añadida',
		failed: 'No se ha podido guardar',
		onError: () => {
			form.value = typed;
			editingId.value = editing ? id : undefined;
			if (!editing) {
				newObligationId.value = id;
			}
		},
	});
	if (!editing) {
		newObligationId.value = newId();
	}
	reset();
}

function focusForm() {
	formElement.value?.querySelector<HTMLElement>('input, button')?.focus();
}

useShortcut('n', focusForm, 'Nueva obligación');
useShortcut('mod+enter', () => formElement.value?.requestSubmit(), 'Guardar la obligación');
// Only while editing, so Escape stays free for anything else the rest of the time
useEventListener(window, 'keydown', (event) => {
	if (event.key === 'Escape' && editingId.value && !event.defaultPrevented) {
		reset();
	}
});

// The next one counts from when it was due, so doing it late doesn't shift the cycle, unless that's still in the past
function nextDueAt(obligation: Obligation) {
	if (!obligation.everyMonths) {
		return undefined;
	}
	const next = addMonths(obligation.dueAt.toDate(), obligation.everyMonths);
	// From midnight, like the dates the form saves
	return next >= today() ? next : addMonths(today(), obligation.everyMonths);
}

// The local write updates the list before a second click could move the due date forward twice
function markDone(obligation: Obligation) {
	const next = nextDueAt(obligation);
	const batch = writeBatch(db);
	batch.update(doc(obligationsRef, obligation.id), {
		lastDoneAt: serverTimestamp(),
		...(next ? { dueAt: Timestamp.fromDate(next) } : {}),
		updatedAt: serverTimestamp(),
		updatedBy: auth.currentUser!.uid,
	});
	logActivity(batch, props.id, {
		area: 'obligation',
		summary: `Marcó como hecha «${obligation.title}»${next ? `, la próxima vence el ${next.toLocaleDateString('es')}` : ''}`,
		link: `/communities/${props.id}/obligations`,
	});
	void optimistic(batch.commit(), { done: 'Marcada como hecha', failed: 'No se ha podido marcar como hecha', revert: async () => unmarkDone(obligation) });
}

// Undoes markDone with the dates it had before
async function unmarkDone({ id, title, dueAt, lastDoneAt }: Obligation) {
	const batch = writeBatch(db);
	batch.update(doc(obligationsRef, id), {
		lastDoneAt: lastDoneAt ?? deleteField(),
		dueAt,
		updatedAt: serverTimestamp(),
		updatedBy: auth.currentUser!.uid,
	});
	logActivity(batch, props.id, { area: 'obligation', summary: `Desmarcó como hecha «${title}»`, link: `/communities/${props.id}/obligations` });
	await batch.commit();
}

function remove(obligation: Obligation) {
	// eslint-disable-next-line no-alert
	if (!window.confirm(`¿Borrar «${obligation.title}»?`)) {
		return;
	}
	const batch = writeBatch(db);
	batch.delete(doc(obligationsRef, obligation.id));
	logActivity(batch, props.id, { area: 'obligation', summary: `Borró la obligación «${obligation.title}»` });
	void optimistic(batch.commit(), { done: 'Obligación borrada', failed: 'No se ha podido borrar', revert: async () => restore(obligation) });
	if (editingId.value === obligation.id) {
		reset();
	}
}

// Undoes remove with the data it had, kept from the list
async function restore({ id, ...obligation }: Obligation) {
	const batch = writeBatch(db);
	batch.set(doc(obligationsRef, id), obligation);
	logActivity(batch, props.id, { area: 'obligation', summary: `Restauró la obligación «${obligation.title}»`, link: `/communities/${props.id}/obligations` });
	await batch.commit();
}

function icsText(text: string) {
	return text.replace(ICS_SPECIAL, match => `\\${match}`).replace(NEWLINES, '\\n');
}

function icsDate(date: Date) {
	return toInputDate(date).replaceAll('-', '');
}

/**
 * The free plan has no server to send reminders, so the admin's own calendar app does it: an all-day event on the due
 * date that warns a month and a day before
 */
function downloadIcs(obligation: Obligation) {
	const due = obligation.dueAt.toDate();
	const description = [obligation.provider && `Proveedor: ${obligation.provider.name}`, obligation.notes].filter(Boolean).join('\n');
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//gobernança//Obligaciones//ES',
		'BEGIN:VEVENT',
		`UID:${obligation.id}-${icsDate(due)}@gobernansa`,
		`DTSTAMP:${new Date().toISOString().replace(TIME_SEPARATORS, '').replace(MILLISECONDS, '')}`,
		`DTSTART;VALUE=DATE:${icsDate(due)}`,
		`DTEND;VALUE=DATE:${icsDate(new Date(due.getFullYear(), due.getMonth(), due.getDate() + 1))}`,
		`SUMMARY:${icsText(obligation.title)}`,
		...(description ? [`DESCRIPTION:${icsText(description)}`] : []),
		...['-P30D', '-P1D'].flatMap(trigger => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(obligation.title)}`, `TRIGGER:${trigger}`, 'END:VALARM']),
		'END:VEVENT',
		'END:VCALENDAR',
	];
	const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
	const link = document.createElement('a');
	link.href = url;
	link.download = `${obligation.title}.ics`;
	link.click();
	URL.revokeObjectURL(url);
}
</script>

<template>
	<header class="page-header">
		<BackButton :to="`/communities/${id}`" label="Volver a la comunidad" />
		<h1>Obligaciones</h1>
	</header>

	<section v-if="warningGroups.length" class="card attention" :class="warningGroups[0].key" aria-labelledby="attention-title">
		<header class="attention-header">
			<span class="tile"><LnxIcon :icon="warningGroups[0].key === 'overdue' ? 'lucide:triangle-alert' : 'lucide:bell-ring'" :size="20" /></span>
			<div>
				<h2 id="attention-title">
					Requieren atención
				</h2>
				<p class="tabular">
					{{ warningSummary }}
				</p>
			</div>
		</header>
		<div class="groups">
			<section v-for="group in warningGroups" :key="group.key" :class="group.key" :aria-labelledby="`attention-${group.key}`">
				<h3 :id="`attention-${group.key}`">
					{{ group.label }}
				</h3>
				<ul>
					<li v-for="obligation in group.items" :key="obligation.id" class="warning">
						<span class="tile"><LnxIcon :icon="obligationTypes[obligation.type]?.icon ?? 'lucide:calendar-check'" :size="16" /></span>
						<div class="warning-what">
							<strong>{{ obligation.title }}</strong>
							<small class="tabular">{{ group.key === 'overdue' ? 'Venció' : 'Vence' }} el {{ obligation.dueAt.toDate().toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' }) }}</small>
						</div>
						<div class="warning-end">
							<span class="pill tabular">{{ relativeDay.format(daysLeft(obligation), 'day') }}</span>
							<LnxButton mode="outline" size="small" shape="circle" :aria-label="`Marcar «${obligation.title}» como hecha`" title="Marcar como hecha" @click="markDone(obligation)">
								<LnxIcon icon="lucide:check" />
							</LnxButton>
						</div>
					</li>
				</ul>
			</section>
		</div>
	</section>

	<form ref="formElement" class="card" @submit.prevent="save()">
		<h2>{{ editingId ? 'Editar obligación' : 'Nueva obligación' }}</h2>
		<div class="fields">
			<LnxSelect
				v-model.convert="form.type"
				:options="typeOptions"
				:convert-fn="option => option.value"
				search-placeholder-text="Buscar..."
				@select="onTypeChange()"
			>
				Tipo
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ obligationTypes[value as ObligationType]?.label }}
				</template>
			</LnxSelect>
			<LnxInput v-model="form.title" required>
				Título
			</LnxInput>
			<DatePicker v-model="form.dueAt" required>
				Vence el
			</DatePicker>
			<LnxInput v-model="form.everyMonths" type="number" min="1" step="1">
				Se repite cada (meses)
			</LnxInput>
			<LnxSelect
				v-model.convert="form.providerId"
				:options="providerOptions"
				:convert-fn="option => option.value"
				search-placeholder-text="Buscar..."
				placeholder="Ninguno"
			>
				Proveedor
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ providerOptions.find(option => option.value === value)?.label }}
				</template>
			</LnxSelect>
			<LnxTextarea v-model="form.notes" rows="2" class="wide">
				Notas
			</LnxTextarea>
		</div>

		<footer class="form-actions">
			<LnxButton v-if="editingId" mode="clear" @click="reset()">
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

	<section class="card" :aria-busy="pending && !sorted.length">
		<h2>Calendario</h2>
		<p v-if="error" class="error" role="alert">
			No se han podido cargar: {{ error.message }}
		</p>

		<ul v-if="pending && !sorted.length" class="list">
			<li v-for="width in ['50%', '35%', '60%']" :key="width" class="item">
				<span class="skeleton-item skeleton-item--icon" />
				<div class="what">
					<span class="skeleton-item" :style="{ width }" />
					<span class="skeleton-item skeleton-item--small" style="width: 40%" />
				</div>
				<div class="item-actions">
					<span class="skeleton-item skeleton-item--title" style="width: 80px" />
				</div>
			</li>
		</ul>
		<TransitionGroup v-else-if="sorted.length" tag="ul" name="row" class="list ux-appear">
			<li v-for="obligation in sorted" :key="obligation.id" class="item">
				<LnxIcon class="type" :icon="obligationTypes[obligation.type]?.icon ?? 'lucide:calendar-check'" :size="20" :title="obligationTypes[obligation.type]?.label" />
				<div class="what">
					<strong>
						{{ obligation.title }}
						<span class="badge" :class="status(obligation)">{{ obligationStatusLabels[status(obligation)] }}</span>
					</strong>
					<small class="tabular">
						{{ obligation.dueAt.toDate().toLocaleDateString('es') }}<template v-if="!obligationDone(obligation)"> · {{ daysLabel(obligation) }}</template>
						<template v-if="obligation.everyMonths"> · Cada {{ obligation.everyMonths }} meses</template>
					</small>
					<small v-if="obligation.provider || obligation.lastDoneAt" class="tabular">
						<template v-if="obligation.provider">{{ obligation.provider.name }}</template>
						<template v-if="obligation.provider && obligation.lastDoneAt"> · </template>
						<template v-if="obligation.lastDoneAt">Última vez: {{ obligation.lastDoneAt.toDate().toLocaleDateString('es') }}</template>
					</small>
					<p v-if="obligation.notes">
						{{ obligation.notes }}
					</p>
				</div>
				<div class="item-actions">
					<LnxButton v-if="!obligationDone(obligation)" mode="outline" size="small" @click="markDone(obligation)">
						<LnxIcon icon="lucide:check" />
						Hecha
					</LnxButton>
					<LnxButton mode="clear" size="small" shape="circle" aria-label="Añadir al calendario" title="Añadir al calendario" @click="downloadIcs(obligation)">
						<LnxIcon icon="lucide:calendar-plus" />
					</LnxButton>
					<LnxButton mode="clear" size="small" shape="circle" aria-label="Editar" title="Editar" @click="edit(obligation)">
						<LnxIcon icon="lucide:pencil" />
					</LnxButton>
					<LnxButton mode="clear" size="small" shape="circle" variant="danger" aria-label="Borrar" title="Borrar" @click="remove(obligation)">
						<LnxIcon icon="lucide:trash-2" />
					</LnxButton>
				</div>
			</li>
		</TransitionGroup>
		<p v-else class="hint">
			Aún no hay obligaciones. Añade las inspecciones y revisiones de la comunidad para que avisemos antes de que venzan.
		</p>
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

// Red for overdue, amber for coming up, like the dashboard. Darkened for text, so it reads on its tint
.attention {
	&.overdue,
	.overdue {
		--tone: var(--color-secondary-accent);
	}

	&.soon,
	.soon {
		--tone: var(--color-issue-cat-amber-accent);
	}

	// On the banner and each group, so each mixes its own tone
	&,
	section {
		--tone-text: color-mix(in srgb, var(--tone) 70%, var(--color-gray-9));
		--tone-soft: color-mix(in srgb, var(--tone) 12%, var(--color-gray-0));
	}

	.tile {
		flex: none;
		width: 32px;
		height: 32px;
		border-radius: var(--lnx-radius-2);
		display: grid;
		place-items: center;
		background: var(--tone-soft);
		color: var(--tone-text);
	}
}

.attention-header {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-3);

	.tile {
		width: 40px;
		height: 40px;
		border-radius: var(--lnx-radius-3);
	}

	// Over the card's small caps, this is the banner's title
	h2 {
		font-size: var(--lnx-font-size-big);
		color: var(--color-gray-9);
		text-transform: none;
		letter-spacing: normal;
	}

	p {
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
	}
}

// Side by side when they fit, one under the other when not
.groups {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr));
	gap: var(--lnx-spacing-4) var(--lnx-spacing-6);

	h3 {
		margin-bottom: var(--lnx-spacing-1);
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-2);
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
		color: var(--color-gray-6);
		text-transform: uppercase;
		letter-spacing: .04em;

		&::before {
			content: '';
			width: 8px;
			height: 8px;
			border-radius: var(--lnx-radius-circle);
			background: var(--tone);
		}
	}
}

.warning {
	padding: var(--lnx-spacing-2) 0;
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto;
	align-items: center;
	gap: var(--lnx-spacing-3);

	& + & {
		border-top: 1px solid var(--color-gray-2);
	}

	// Under the title, so it keeps the width
	@media (width <= 640px) {
		grid-template-columns: auto minmax(0, 1fr);
		align-items: start;
		row-gap: var(--lnx-spacing-1);

		.warning-end {
			grid-column: 2;
		}
	}
}

.warning-end {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
}

.warning-what {
	display: flex;
	flex-direction: column;

	strong {
		font-weight: var(--lnx-font-weight-regular);
		color: var(--color-gray-9);
		text-wrap: pretty;
	}

	small {
		color: var(--color-gray-6);
	}
}

.pill {
	padding: 2px var(--lnx-spacing-2);
	border-radius: 999px;
	display: inline-block;
	background: var(--tone-soft);
	color: var(--tone-text);
	font-size: var(--lnx-font-size-small);
	font-weight: var(--lnx-font-weight-bold);
	white-space: nowrap;

	&::first-letter {
		text-transform: uppercase;
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
	position: relative;
	display: flex;
	flex-direction: column;
}

// Rows coming, going and reordering by due date. Transitions, so a change midway turns back from where it is
.row-move,
.row-enter-active,
.row-leave-active {
	transition: opacity var(--duration) var(--ease-out), translate var(--duration) var(--ease-out), transform var(--duration) var(--ease-out);
}

.row-enter-from,
.row-leave-to {
	opacity: 0;
	translate: 0 -4px;
}

// Out of the flow, so the rest move up into its place
.row-leave-active {
	position: absolute;
	inset-inline: 0;
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

	@media (width <= 640px) {
		grid-template-columns: auto minmax(0, 1fr);

		.item-actions {
			grid-column: 2;
		}
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

	p {
		margin-top: var(--lnx-spacing-1);
		font-size: var(--lnx-font-size-small);
		white-space: pre-line;
	}
}

.badge {
	margin-left: var(--lnx-spacing-2);
	padding: 2px var(--lnx-spacing-2);
	border-radius: var(--lnx-radius-2);
	font-size: var(--lnx-font-size-small);
	font-weight: normal;
	white-space: nowrap;

	&.overdue {
		background: var(--color-secondary-accent);
		color: var(--color-gray-0);
	}

	&.soon {
		border: 1px solid var(--color-secondary-accent);
		color: var(--color-secondary-accent);
	}

	&.ok {
		background: var(--color-gray-2);
		color: var(--color-gray-7);
	}
}

.item-actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
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
