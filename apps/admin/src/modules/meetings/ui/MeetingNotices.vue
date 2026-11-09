<script setup lang="ts">
import type { Meeting, MeetingAttendance, MeetingVote } from '@gobernansa/shared/domain/meeting.ts';
import type { MeetingNotice, NoticeKind, NoticeOwner } from '@gobernansa/shared/domain/minutes.ts';
import type { Property } from '@gobernansa/shared/domain/property.ts';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { dissentAt, dissentDeadline, ownersOf } from '@gobernansa/shared/domain/minutes.ts';
import DatePicker from '@gobernansa/shared/ui/DatePicker.vue';
import { LnxButton, LnxIcon, LnxSelect } from 'lnxjs-components';
import { computed, ref, watch } from 'vue';
import { optimistic } from '@/app/ux/toast.ts';
import MailModeNote from '@/modules/mail/ui/MailModeNote.vue';
import { recordDissent, removeRecordedDissent, sendNotices } from '../application/useMeetings.ts';

const props = defineProps<{
	meeting: Meeting;
	kind: NoticeKind;
	notices: MeetingNotice[];
	properties: Property[];
	attendance: MeetingAttendance[];
	ballots: MeetingVote[];
	people: { id: string; name: string }[];
}>();

const dateFormat = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' });
const format = (timestamp?: { toDate: () => Date } | null) => timestamp ? dateFormat.format(timestamp.toDate()) : '';

// Absent: neither answered they'd attend or delegate, nor did any of their properties vote
function wasThere(owner: NoticeOwner) {
	return props.attendance.some(entry => entry.uid === owner.uid && entry.status !== 'absent')
		|| props.ballots.some(ballot => owner.propertyIds.includes(ballot.propertyId));
}

const sent = computed(() => props.notices.filter(notice => notice.kind === props.kind).sort((a, b) => a.name.localeCompare(b.name, 'es')));
// Those still without one, e.g. added to the census after sending
const pending = computed(() => {
	const ids = new Set(sent.value.map(notice => notice.id));
	const names = Object.fromEntries(props.people.map(person => [person.id, person.name]));
	return ownersOf(props.properties, names)
		.filter(owner => !ids.has(`${props.kind}_${owner.key}`))
		.map(owner => ({ ...owner, absent: !wasThere(owner) }));
});
const byPost = computed(() => sent.value.filter(notice => !notice.app));
const what = computed(() => props.kind === 'call' ? 'la convocatoria' : 'el acta');

const sending = ref(false);
async function send() {
	const owners = pending.value;
	// eslint-disable-next-line no-alert
	if (!window.confirm(`¿Notificar ${what.value} a ${owners.length} propietarios? No se puede deshacer.`)) {
		return;
	}
	sending.value = true;
	await optimistic(sendNotices(props.meeting, props.kind, owners), {
		done: `Notificada a ${owners.length} propietarios`,
		failed: 'No se ha podido notificar',
	});
	sending.value = false;
}

const items = computed(() => Object.fromEntries(props.meeting.agenda.map(item => [item.id, item.title])));

function inApp(notice: MeetingNotice) {
	if (!notice.app) {
		return 'Sin cuenta: enviar por correo';
	}
	if (notice.receivedAt) {
		return `Acusó recibo el ${format(notice.receivedAt)}`;
	}
	return notice.readAt ? `Leída el ${format(notice.readAt)}` : `Enviada el ${format(notice.sentAt)}`;
}

function dissent(notice: MeetingNotice) {
	if (!notice.absent) {
		return 'Asistió o se representó';
	}
	const dissented = [
		...Object.entries(notice.dissent).map(([id, at]) => `«${items.value[id] ?? id}» (en la app el ${format(at)})`),
		...Object.entries(notice.recordedDissent ?? {}).map(([id, { receivedOn }]) => `«${items.value[id] ?? id}» (recibida el ${format(receivedOn)})`),
	];
	if (dissented.length) {
		return `Discrepa de ${dissented.join(', ')}`;
	}
	const deadline = dissentDeadline(notice);
	return Date.now() < deadline.getTime() ? `Ausente, puede discrepar hasta el ${dateFormat.format(deadline)}` : 'No discrepó: cuenta a favor';
}

// A dissent received by post, burofax or in person, for an agreement the owner hasn't dissented from yet
const today = toDateString(new Date());
const recording = ref({ noticeId: '', itemId: '', receivedOn: today });
const recordable = computed(() => props.kind !== 'minutes'
	? []
	: sent.value
			.filter(notice => notice.absent)
			.map(notice => ({ notice, items: props.meeting.agenda.filter(item => notice.items.includes(item.id) && !dissentAt(notice, item.id)) }))
			.filter(entry => entry.items.length));
const ownerOptions = computed(() => recordable.value.map(({ notice }) => ({ value: notice.id, label: `${notice.name || 'Sin nombre'} (${notice.propertyNames.join(', ')})` })));
const itemOptions = computed(() => recordable.value.find(entry => entry.notice.id === recording.value.noticeId)?.items.map(item => ({ value: item.id, label: item.title })) ?? []);
watch(() => recording.value.noticeId, () => {
	recording.value.itemId = '';
});

function record() {
	const { noticeId, itemId, receivedOn } = recording.value;
	const notice = sent.value.find(entry => entry.id === noticeId)!;
	const item = props.meeting.agenda.find(entry => entry.id === itemId)!;
	void optimistic(recordDissent(props.meeting, notice, item, new Date(`${receivedOn}T00:00`)), {
		done: 'Discrepancia anotada',
		failed: 'No se ha podido anotar la discrepancia',
		revert: async () => removeRecordedDissent(props.meeting, notice, item),
	});
	recording.value = { noticeId: '', itemId: '', receivedOn: today };
}
</script>

<template>
	<section class="card" :class="{ 'screen-only': !sent.length }">
		<header class="header">
			<h2>Notificación de {{ what }}</h2>
			<LnxButton v-if="pending.length" class="screen-only size-small" :is-loading="sending" @click="send()">
				<LnxIcon icon="lucide:send" />
				{{ sent.length ? `Notificar a ${pending.length} que faltan` : kind === 'call' ? 'Notificar convocatoria' : 'Notificar a los propietarios' }}
			</LnxButton>
		</header>
		<p class="hint screen-only">
			Cada propietario con cuenta la recibe en la app, donde acusa recibo, por email si el censo tiene el suyo, y todos por correo certificado.
			<span class="chip">Modo de prueba</span> El correo certificado no se envía y su referencia es inventada.
		</p>
		<MailModeNote class="screen-only" />
		<p v-if="byPost.length" class="hint screen-only">
			{{ byPost.length }} sin cuenta en la app: imprime {{ what }} y envíaselo por correo.
		</p>

		<div v-if="sent.length" class="table">
			<table>
				<thead>
					<tr>
						<th>Propietario</th>
						<th>En la app</th>
						<th>Correo certificado (prueba)</th>
						<th v-if="kind === 'minutes'">
							Discrepancia (art. 17.8 LPH)
						</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="notice in sent" :key="notice.id">
						<td>
							<strong>{{ notice.name || 'Sin nombre' }}</strong>
							<small>{{ notice.propertyNames.join(', ') }}</small>
						</td>
						<td>
							<span :class="{ chip: !notice.app }">{{ inApp(notice) }}</span>
						</td>
						<td class="tabular">
							{{ notice.certified.reference }}
						</td>
						<td v-if="kind === 'minutes'">
							{{ dissent(notice) }}
						</td>
					</tr>
				</tbody>
			</table>
		</div>
		<p v-else-if="!pending.length" class="hint">
			No hay propietarios en el censo.
		</p>

		<form v-if="recordable.length" class="record screen-only" @submit.prevent="record()">
			<p class="hint">
				¿Te ha llegado una discrepancia por correo, burofax o en mano? Anótala con el día en que se recibió: cuenta en contra como la hecha en la app.
			</p>
			<div class="fields">
				<LnxSelect
					v-model.convert="recording.noticeId"
					:options="ownerOptions"
					:convert-fn="option => option.value"
					search-placeholder-text="Buscar..."
					required
				>
					Propietario ausente
					<template #option="{ option }">
						{{ option.label }}
					</template>
					<template #optionInput="{ value }">
						{{ ownerOptions.find(option => option.value === value)?.label }}
					</template>
				</LnxSelect>
				<LnxSelect
					v-model.convert="recording.itemId"
					:options="itemOptions"
					:convert-fn="option => option.value"
					search-placeholder-text="Buscar..."
					required
				>
					Acuerdo
					<template #option="{ option }">
						{{ option.label }}
					</template>
					<template #optionInput="{ value }">
						{{ itemOptions.find(option => option.value === value)?.label }}
					</template>
				</LnxSelect>
				<DatePicker v-model="recording.receivedOn" :max="today" required>
					Recibida el
				</DatePicker>
				<LnxButton type="submit" class="size-small" :disabled="!recording.noticeId || !recording.itemId || !recording.receivedOn">
					<LnxIcon icon="lucide:file-x" />
					Anotar discrepancia
				</LnxButton>
			</div>
		</form>
	</section>
</template>

<style lang="scss" scoped>
.card {
	margin-bottom: var(--lnx-spacing-5);
	padding: var(--lnx-spacing-5);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);

	h2 {
		flex: 1;
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
		color: var(--color-gray-6);
		text-transform: uppercase;
		letter-spacing: .04em;
	}
}

.header {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--lnx-spacing-2);
}

.table {
	overflow-x: auto;
}

.record {
	padding-top: var(--lnx-spacing-3);
	border-top: 1px solid var(--color-gray-3);
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
}

.fields {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr));
	align-items: end;
	gap: var(--lnx-spacing-3) var(--lnx-spacing-4);
}

table {
	width: 100%;
	border-collapse: collapse;
	font-size: var(--lnx-font-size-small);

	th,
	td {
		padding: var(--lnx-spacing-2);
		border-bottom: 1px solid var(--color-gray-3);
		text-align: left;
		vertical-align: top;
	}

	th {
		color: var(--color-gray-6);
		font-weight: var(--lnx-font-weight-regular);
	}

	small {
		display: block;
		color: var(--color-gray-6);
	}
}

.chip {
	padding: 2px var(--lnx-spacing-2);
	border-radius: 999px;
	background: var(--color-gray-2);
	color: var(--color-gray-7);
	white-space: nowrap;
}

.hint {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

@media print {
	.screen-only {
		display: none !important;
	}

	.card {
		border: 0;
		padding: 0;
		box-shadow: none;
	}
}
</style>
