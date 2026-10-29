<script setup lang="ts">
import type { Obligation, ObligationType } from '@gobernansa/shared/domain/obligation.ts';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { obligationStatus, obligationStatusLabels, obligationTypes } from '@gobernansa/shared/domain/obligation.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, deleteField, doc, serverTimestamp, Timestamp, writeBatch } from 'firebase/firestore';
import { LnxButton, LnxIcon, LnxInput } from 'lnxjs-components';
import { computed, ref } from 'vue';
import { useCollection } from 'vuefire';
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

const warnings = computed(() => sorted.value.filter(obligation => status(obligation) !== 'ok'));

const { providers } = useProviders(() => props.id);

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
const saving = ref(false);
const formError = ref<string>();

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

async function save() {
	saving.value = true;
	formError.value = undefined;
	try {
		const uid = auth.currentUser!.uid;
		const { type, title, dueAt, everyMonths, providerId, notes } = form.value;
		const months = Number.parseInt(everyMonths, 10);
		// Kept when it's no longer shared with this community, so editing something else doesn't drop it
		const provider = providers.value.find(item => item.id === providerId)
			?? obligations.value.find(item => item.id === editingId.value && item.provider?.id === providerId)?.provider;
		const obligationRef = editingId.value ? doc(obligationsRef, editingId.value) : doc(obligationsRef);
		const now = serverTimestamp();
		const batch = writeBatch(db);
		// Merged, so the optional fields left empty are removed
		batch.set(obligationRef, {
			communityId: props.id,
			type,
			title: title.trim(),
			dueAt: Timestamp.fromDate(new Date(`${dueAt}T00:00`)),
			everyMonths: months > 0 ? months : deleteField(),
			provider: provider ? { id: provider.id, name: provider.name } : deleteField(),
			notes: notes.trim() || deleteField(),
			updatedAt: now,
			updatedBy: uid,
			...(editingId.value ? {} : { createdAt: now, createdBy: uid }),
		}, { merge: true });
		logActivity(batch, props.id, {
			area: 'obligation',
			summary: `${editingId.value ? 'Editó' : 'Añadió'} la obligación «${title.trim()}», vence el ${new Date(`${dueAt}T00:00`).toLocaleDateString('es')}`,
			link: `/communities/${props.id}/obligations`,
		});
		await batch.commit();
		reset();
	} catch (e) {
		formError.value = `No se ha podido guardar: ${(e as Error).message}`;
	} finally {
		saving.value = false;
	}
}

const actionError = ref<string>();

async function run(action: () => Promise<void>, failure: string) {
	actionError.value = undefined;
	try {
		await action();
	} catch (e) {
		actionError.value = `${failure}: ${(e as Error).message}`;
	}
}

// The next one counts from when it was due, so doing it late doesn't shift the cycle, unless that's still in the past
function nextDueAt(obligation: Obligation) {
	if (!obligation.everyMonths) {
		return undefined;
	}
	const next = addMonths(obligation.dueAt.toDate(), obligation.everyMonths);
	// From midnight, like the dates the form saves
	return next >= today() ? next : addMonths(today(), obligation.everyMonths);
}

// A second click before the list updates would move the due date forward twice
const marking = ref<string>();

async function markDone(obligation: Obligation) {
	const next = nextDueAt(obligation);
	marking.value = obligation.id;
	await run(async () => {
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
		await batch.commit();
	}, 'No se ha podido marcar como hecha');
	marking.value = undefined;
}

async function remove(obligation: Obligation) {
	// eslint-disable-next-line no-alert
	if (!window.confirm(`¿Borrar «${obligation.title}»?`)) {
		return;
	}
	await run(async () => {
		const batch = writeBatch(db);
		batch.delete(doc(obligationsRef, obligation.id));
		logActivity(batch, props.id, { area: 'obligation', summary: `Borró la obligación «${obligation.title}»` });
		await batch.commit();
		if (editingId.value === obligation.id) {
			reset();
		}
	}, 'No se ha podido borrar');
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
		<LnxButton :to="`/communities/${id}`" mode="clear" shape="circle" aria-label="Volver a la comunidad">
			<LnxIcon icon="lucide:arrow-left" />
		</LnxButton>
		<h1>Obligaciones</h1>
	</header>

	<section v-if="warnings.length" class="banner" role="status">
		<LnxIcon icon="lucide:bell-ring" :size="20" />
		<ul>
			<li v-for="obligation in warnings" :key="obligation.id">
				<strong>{{ obligation.title }}</strong>: {{ daysLabel(obligation).toLowerCase() }}
			</li>
		</ul>
	</section>

	<form class="card" @submit.prevent="save()">
		<h2>{{ editingId ? 'Editar obligación' : 'Nueva obligación' }}</h2>
		<div class="fields">
			<label class="native">
				Tipo
				<select v-model="form.type" @change="onTypeChange()">
					<option v-for="(type, value) in obligationTypes" :key="value" :value="value">
						{{ type.label }}
					</option>
				</select>
			</label>
			<LnxInput v-model="form.title" required>
				Título
			</LnxInput>
			<LnxInput v-model="form.dueAt" type="date" required>
				Vence el
			</LnxInput>
			<LnxInput v-model="form.everyMonths" type="number" min="1" step="1">
				Se repite cada (meses)
			</LnxInput>
			<label class="native">
				Proveedor
				<select v-model="form.providerId">
					<option value="">Ninguno</option>
					<option v-for="provider in providers" :key="provider.id" :value="provider.id">
						{{ provider.name }}
					</option>
				</select>
			</label>
			<label class="native wide">
				Notas
				<textarea v-model="form.notes" rows="2" />
			</label>
		</div>

		<footer class="form-actions">
			<p v-if="formError" class="error" role="alert">
				{{ formError }}
			</p>
			<LnxButton v-if="editingId" mode="clear" @click="reset()">
				Cancelar
			</LnxButton>
			<LnxButton type="submit" :is-loading="saving">
				<LnxIcon :icon="editingId ? 'lucide:save' : 'lucide:plus'" />
				{{ editingId ? 'Guardar cambios' : 'Añadir' }}
			</LnxButton>
		</footer>
	</form>

	<section class="card">
		<h2>Calendario</h2>
		<p v-if="error" class="error" role="alert">
			No se han podido cargar: {{ error.message }}
		</p>
		<p v-if="actionError" class="error" role="alert">
			{{ actionError }}
		</p>

		<span v-if="pending && !sorted.length" class="skeleton-item" />
		<ul v-else-if="sorted.length" class="list">
			<li v-for="obligation in sorted" :key="obligation.id" class="item">
				<LnxIcon class="type" :icon="obligationTypes[obligation.type]?.icon ?? 'lucide:calendar-check'" :size="20" />
				<div class="what">
					<strong>
						{{ obligation.title }}
						<span class="badge" :class="status(obligation)">{{ obligationStatusLabels[status(obligation)] }}</span>
					</strong>
					<small>
						{{ obligation.dueAt.toDate().toLocaleDateString('es') }} · {{ daysLabel(obligation) }}
						<template v-if="obligation.everyMonths"> · Cada {{ obligation.everyMonths }} meses</template>
					</small>
					<small v-if="obligation.provider || obligation.lastDoneAt">
						<template v-if="obligation.provider">{{ obligation.provider.name }}</template>
						<template v-if="obligation.provider && obligation.lastDoneAt"> · </template>
						<template v-if="obligation.lastDoneAt">Última vez: {{ obligation.lastDoneAt.toDate().toLocaleDateString('es') }}</template>
					</small>
					<p v-if="obligation.notes">
						{{ obligation.notes }}
					</p>
				</div>
				<div class="item-actions">
					<LnxButton mode="outline" size="small" :is-loading="marking === obligation.id" :disabled="!!marking" @click="markDone(obligation)">
						<LnxIcon icon="lucide:check" />
						Hecha
					</LnxButton>
					<LnxButton mode="clear" size="small" shape="circle" aria-label="Añadir al calendario" title="Añadir al calendario" @click="downloadIcs(obligation)">
						<LnxIcon icon="lucide:calendar-plus" />
					</LnxButton>
					<LnxButton mode="clear" size="small" shape="circle" aria-label="Editar" @click="edit(obligation)">
						<LnxIcon icon="lucide:pencil" />
					</LnxButton>
					<LnxButton mode="clear" size="small" shape="circle" variant="danger" aria-label="Borrar" @click="remove(obligation)">
						<LnxIcon icon="lucide:trash-2" />
					</LnxButton>
				</div>
			</li>
		</ul>
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

.banner {
	margin-bottom: var(--lnx-spacing-5);
	padding: var(--lnx-spacing-4);
	border: 1px solid var(--color-secondary-accent);
	border-radius: var(--lnx-radius-3);
	display: flex;
	align-items: flex-start;
	gap: var(--lnx-spacing-3);
	color: var(--color-secondary-accent);

	ul {
		display: flex;
		flex-direction: column;
		gap: var(--lnx-spacing-1);
		color: var(--color-gray-7);
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

.native {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-1);
	font-size: var(--lnx-font-size-small);

	:is(select, textarea) {
		min-height: 40px;
		padding: var(--lnx-spacing-2) var(--lnx-spacing-3);
		border: 1px solid var(--color-gray-4);
		border-radius: var(--lnx-radius-2);
		background: var(--color-gray-0);
		font: inherit;
		font-size: var(--lnx-font-size-body);

		&:focus-visible {
			outline: 2px solid var(--color-primary);
			outline-offset: 1px;
		}
	}

	textarea {
		resize: vertical;
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
