<script setup lang="ts">
import type { AgendaItem, Meeting, MeetingAttendance, MeetingStatus, MeetingVote, VoteChoice } from '@gobernansa/shared/domain/meeting.ts';
import type { Property } from '@gobernansa/shared/domain/property.ts';
import { attendanceStatus, meetingStatus, meetingTypes, tallyVotes, voteChoices } from '@gobernansa/shared/domain/meeting.ts';
import { totalCoefficient } from '@gobernansa/shared/domain/property.ts';
import DatePicker from '@gobernansa/shared/ui/DatePicker.vue';
import LnxCheckbox from '@gobernansa/shared/ui/LnxCheckbox.vue';
import LnxTextarea from '@gobernansa/shared/ui/LnxTextarea.vue';
import { LnxButton, LnxIcon, LnxInput, LnxSelect } from 'lnxjs-components';
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import BackButton from '@/app/ux/BackButton.vue';
import Kbd from '@/app/ux/Kbd.vue';
import { newId, onRevalidate } from '@/app/ux/navigation.ts';
import { useShortcut } from '@/app/ux/shortcuts.ts';
import { optimistic, toast } from '@/app/ux/toast.ts';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { usePeople } from '@/modules/people/application/usePeople.ts';
import {
	deleteMeeting,
	describeResult,
	formatPercent,
	loadProperties,
	recordAttendance,
	recordBallot,
	removeAttendance,
	removeBallot,
	restoreBallot,
	restoreMeeting,
	saveMeeting,
	setMeetingStatus,
	setVotingOpen,
	toMeetingForm,
	useMeeting,
} from '../application/useMeetings.ts';

const props = defineProps<{ id: string; meetingId: string }>();

const router = useRouter();
const isNew = computed(() => props.meetingId === 'new');
const { meeting, attendance, ballots } = useMeeting(props.id, () => props.meetingId);
const listenError = computed(() => (meeting.error.value ?? attendance.error.value ?? ballots.error.value)?.message);
// Undefined until it's read, null when it doesn't exist
const loading = computed(() => !isNew.value && meeting.value === undefined && !listenError.value);
const { people } = usePeople(props.id);

const typeOptions = Object.entries(meetingTypes).map(([value, label]) => ({ value: value as Meeting['type'], label }));
const attendanceOptions = Object.entries(attendanceStatus).map(([value, label]) => ({ value: value as MeetingAttendance['status'], label }));
const choices = Object.keys(voteChoices) as VoteChoice[];
const dateFormat = new Intl.DateTimeFormat('es-ES', { dateStyle: 'full', timeStyle: 'short' });

// The census and the community's name, once, and again when coming back while showing the last
const properties = ref<Property[]>([]);
const communityName = ref('');
const loadError = ref<string>();
async function load() {
	try {
		const [census, community] = await Promise.all([loadProperties(props.id), loadCommunity(props.id)]);
		properties.value = census.sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
		communityName.value = community?.name ?? '';
		loadError.value = undefined;
	} catch (e) {
		loadError.value = `No se ha podido cargar el censo: ${(e as Error).message}`;
	}
}
onMounted(load);
onRevalidate(load);
const total = computed(() => totalCoefficient(properties.value));
// What each owner weighs, adding up all their properties
const coefficientByOwner = computed(() => {
	const byOwner: Record<string, number> = {};
	for (const property of properties.value) {
		if (property.ownerUid) {
			byOwner[property.ownerUid] = (byOwner[property.ownerUid] ?? 0) + (property.coefficient ?? 0);
		}
	}
	return byOwner;
});

// The form

const form = ref(toMeetingForm());
// Filled once when the meeting loads, so changes made elsewhere don't overwrite what's being typed
watch(meeting, (loaded, before) => {
	if (loaded && !before) {
		form.value = toMeetingForm(loaded);
	}
}, { immediate: true });

function addItem() {
	form.value.agenda.push({ id: crypto.randomUUID(), title: '', description: '', votable: true });
}

function moveItem(index: number, offset: number) {
	const agenda = form.value.agenda;
	[agenda[index], agenda[index + offset]] = [agenda[index + offset]!, agenda[index]!];
}

// The new draft's id, made with its form, so sending it twice writes it once
let draftId = newId();

function save() {
	if (!isNew.value) {
		void optimistic(saveMeeting(props.id, props.meetingId, form.value), { done: 'Guardado', failed: 'No se ha podido guardar' });
		return;
	}
	const meetingId = draftId;
	const typed = form.value;
	void optimistic(saveMeeting(props.id, meetingId, typed, true), {
		done: 'Borrador creado',
		failed: 'No se ha podido crear',
		// Back to the form as it was typed, to send it again with the same id
		onError: () => {
			draftId = meetingId;
			form.value = typed;
			void router.replace(`/communities/${props.id}/meetings/new`);
		},
	});
	// Already in the local cache, so it opens at once. This page stays kept alive, empty for the next one
	draftId = newId();
	form.value = toMeetingForm();
	void router.replace(`/communities/${props.id}/meetings/${meetingId}`);
}

const statusDone: Record<MeetingStatus, string> = {
	draft: 'Junta en borrador',
	convened: 'Junta convocada',
	held: 'Junta celebrada',
	cancelled: 'Junta desconvocada',
};

function setStatus(status: MeetingStatus) {
	const current = meeting.value!;
	const { status: before, votingOpen } = current;
	void optimistic(setMeetingStatus(current, status), {
		done: statusDone[status],
		failed: 'No se ha podido cambiar el estado',
		revert: async () => setMeetingStatus(current, before, votingOpen ?? false),
	});
}

function toggleVoting() {
	const current = meeting.value!;
	const open = !current.votingOpen;
	void optimistic(setVotingOpen(current, open), {
		done: open ? 'Votación abierta' : 'Votación cerrada',
		failed: 'No se ha podido cambiar la votación',
		revert: async () => setVotingOpen(current, !open),
	});
}

function remove() {
	// eslint-disable-next-line no-alert
	if (window.confirm('¿Borrar este borrador de junta?')) {
		// Kept to bring it back as it was
		const deleted = meeting.value!;
		void optimistic(deleteMeeting(deleted), { done: 'Borrador borrado', failed: 'No se ha podido borrar', revert: async () => restoreMeeting(deleted) });
		void router.push(`/communities/${props.id}/meetings`);
	}
}

const formElement = ref<HTMLFormElement>();
// The form being typed in, the attendance one too, or else the meeting's
useShortcut('mod+enter', () => {
	const typingIn = document.activeElement?.closest('form');
	(typingIn ?? formElement.value)?.requestSubmit();
}, 'Guardar');

// Attendance

const sortedAttendance = computed(() => [...attendance.value].sort((a, b) => a.name.localeCompare(b.name, 'es')));
const present = computed(() => sortedAttendance.value.filter(entry => entry.status === 'attending'));
const represented = computed(() => sortedAttendance.value.filter(entry => entry.status === 'delegated'));
const sumCoefficient = (entries: MeetingAttendance[]) => Math.round(entries.reduce((sum, entry) => sum + (coefficientByOwner.value[entry.uid] ?? 0), 0) * 100) / 100;
const share = (coefficient: number) => formatPercent(total.value ? coefficient / total.value * 100 : 0);

const personOptions = computed(() => [...people.value]
	.sort((a, b) => a.name.localeCompare(b.name, 'es'))
	.map(person => ({ value: person.id, label: person.name })));
const attendanceForm = ref({ uid: '', status: 'attending' as MeetingAttendance['status'], delegateName: '' });

function addAttendance() {
	const person = people.value.find(entry => entry.id === attendanceForm.value.uid);
	if (!person) {
		return;
	}

	// The row shows at once, so no toast; only back to what was chosen if it fails
	const typed = attendanceForm.value;
	attendanceForm.value = { uid: '', status: 'attending', delegateName: '' };
	void optimistic(recordAttendance(meeting.value!, person, typed.status, typed.delegateName), {
		failed: 'No se ha podido anotar',
		onError: () => {
			attendanceForm.value = typed;
		},
	});
}

function unrecordAttendance(entry: MeetingAttendance) {
	const current = meeting.value!;
	void optimistic(removeAttendance(current, entry), {
		done: 'Asistencia quitada',
		failed: 'No se ha podido quitar',
		revert: async () => recordAttendance(current, { id: entry.id, name: entry.name }, entry.status, entry.delegateName ?? ''),
	});
}

// Votes

const votableItems = computed(() => meeting.value?.agenda.filter(item => item.votable) ?? []);
const ownerNames = computed(() => Object.fromEntries(people.value.map(person => [person.id, person.name])));
const ballotsById = computed(() => Object.fromEntries(ballots.value.map(ballot => [ballot.id, ballot])));

function ballotOf(item: AgendaItem, property: Property): MeetingVote | undefined {
	return ballotsById.value[`${item.id}_${property.id}`];
}

function vote(item: AgendaItem, property: Property, choice: VoteChoice) {
	void optimistic(recordBallot(meeting.value!, item, property, choice), { failed: 'No se ha podido anotar el voto' });
}

function annulBallot(item: AgendaItem, ballot: MeetingVote) {
	const current = meeting.value!;
	void optimistic(removeBallot(current, item, ballot), {
		done: 'Voto anulado',
		failed: 'No se ha podido anular',
		revert: async () => restoreBallot(current, item, ballot),
	});
}

function result(item: AgendaItem) {
	return describeResult(tallyVotes(ballots.value, item.id), total.value);
}

// The minutes

const minutes = ref<HTMLElement>();
const copied = ref(false);

async function copyMinutes() {
	try {
		// innerText keeps the line breaks between paragraphs and items, textContent would run them together
		// eslint-disable-next-line unicorn/prefer-dom-node-text-content
		await navigator.clipboard.writeText(minutes.value!.innerText);
		copied.value = true;
	} catch (e) {
		toast(`No se ha podido copiar: ${(e as Error).message}`, { tone: 'error' });
	}
}

function print() {
	window.print();
}
</script>

<template>
	<header class="page-header screen-only">
		<BackButton :to="`/communities/${id}/meetings`" label="Volver a juntas" />
		<h1 :style="isNew ? undefined : { viewTransitionName: `meeting-${meetingId}` }">
			{{ isNew ? 'Nueva junta' : meeting?.title || 'Junta' }}
		</h1>
		<span v-if="meeting" class="status" :class="`status--${meeting.status}`">{{ meetingStatus[meeting.status] }}</span>
		<!-- The ordinary one approves the accounts of the year before: the liquidación to attach to the convocatoria -->
		<LnxButton v-if="meeting?.type === 'ordinary'" mode="outline" size="small" @click="router.push(`/communities/${id}/annual-report?year=${meeting.date.toDate().getFullYear() - 1}`)">
			<LnxIcon icon="lucide:file-chart-column" />
			Liquidación {{ meeting.date.toDate().getFullYear() - 1 }}
		</LnxButton>
	</header>

	<p v-if="listenError" class="error screen-only" role="alert">
		No se ha podido cargar la junta: {{ listenError }}
	</p>
	<p v-if="loadError" class="error screen-only" role="alert">
		{{ loadError }}
	</p>
	<p v-if="!isNew && meeting === null" class="hint">
		Esta junta no existe o se ha borrado.
	</p>

	<div v-else-if="loading" class="screen-only" aria-busy="true">
		<section class="card">
			<span class="skeleton-item skeleton-item--small" style="width: 25%" />
			<span class="skeleton-item skeleton-item--title" style="width: 100%" />
			<div class="fields">
				<span v-for="field in 5" :key="field" class="skeleton-item skeleton-item--title" />
			</div>
			<span class="skeleton-item skeleton-item--small" style="width: 30%" />
			<span v-for="width in ['70%', '55%', '62%']" :key="width" class="skeleton-item" :style="{ width }" />
		</section>
		<section class="card">
			<span class="skeleton-item skeleton-item--small" style="width: 20%" />
			<span class="skeleton-item" style="width: 60%" />
			<div class="actions">
				<span v-for="width in ['110px', '150px']" :key="width" class="skeleton-item skeleton-item--title" :style="{ width }" />
			</div>
		</section>
	</div>

	<template v-else>
		<form ref="formElement" class="card screen-only" @submit.prevent="save()">
			<h2>Convocatoria</h2>
			<div class="fields">
				<LnxInput v-model="form.title" class="wide" placeholder="Junta ordinaria 2026" required>
					Título
				</LnxInput>
				<LnxSelect
					v-model.convert="form.type"
					:options="typeOptions"
					:convert-fn="option => option.value"
					search-placeholder-text="Buscar..."
				>
					Tipo
					<template #option="{ option }">
						{{ option.label }}
					</template>
					<template #optionInput="{ value }">
						{{ meetingTypes[value as Meeting['type']] }}
					</template>
				</LnxSelect>
				<DatePicker v-model="form.date" required>
					Fecha
				</DatePicker>
				<LnxInput v-model="form.time" type="time" required>
					Hora
				</LnxInput>
				<LnxInput v-model="form.place" placeholder="Portal, sala de reuniones…">
					Lugar
				</LnxInput>
				<LnxInput v-model="form.link" type="url" placeholder="https://…">
					Enlace para unirse
				</LnxInput>
			</div>

			<h2>Orden del día</h2>
			<TransitionGroup v-if="form.agenda.length" tag="ol" name="row" class="agenda">
				<li v-for="(item, index) in form.agenda" :key="item.id" class="agenda-item">
					<div class="fields">
						<LnxInput v-model="item.title" class="wide" required>
							{{ index + 1 }}. Punto
						</LnxInput>
						<LnxTextarea v-model="item.description" rows="2" class="wide">
							Descripción
						</LnxTextarea>
					</div>
					<div class="item-actions">
						<LnxCheckbox v-model="item.votable" class="check">
							Se vota
						</LnxCheckbox>
						<LnxButton type="button" mode="clear" size="small" shape="circle" aria-label="Subir" title="Subir" :disabled="index === 0" @click="moveItem(index, -1)">
							<LnxIcon icon="lucide:arrow-up" />
						</LnxButton>
						<LnxButton type="button" mode="clear" size="small" shape="circle" aria-label="Bajar" title="Bajar" :disabled="index === form.agenda.length - 1" @click="moveItem(index, 1)">
							<LnxIcon icon="lucide:arrow-down" />
						</LnxButton>
						<LnxButton type="button" mode="clear" size="small" shape="circle" variant="danger" aria-label="Quitar punto" title="Quitar punto" @click="form.agenda.splice(index, 1)">
							<LnxIcon icon="lucide:trash-2" />
						</LnxButton>
					</div>
				</li>
			</TransitionGroup>
			<p v-else class="hint">
				Aún no hay puntos.
			</p>

			<footer class="form-actions">
				<LnxButton type="button" mode="outline" @click="addItem()">
					<LnxIcon icon="lucide:plus" />
					Añadir punto
				</LnxButton>
				<LnxButton type="submit">
					<LnxIcon icon="lucide:save" />
					{{ isNew ? 'Crear borrador' : 'Guardar cambios' }}
					<Kbd combo="mod+enter" />
				</LnxButton>
			</footer>
		</form>

		<template v-if="meeting">
			<section class="card screen-only">
				<h2>Estado</h2>
				<p class="hint">
					{{ meeting.status === 'draft' ? 'Los vecinos aún no la ven. Al convocarla aparecerá en la app.' : 'Los vecinos la ven en la app.' }}
				</p>
				<div class="actions">
					<template v-if="meeting.status === 'draft'">
						<LnxButton @click="setStatus('convened')">
							<LnxIcon icon="lucide:send" />
							Convocar
						</LnxButton>
						<LnxButton mode="clear" variant="danger" @click="remove()">
							<LnxIcon icon="lucide:trash-2" />
							Borrar borrador
						</LnxButton>
					</template>
					<template v-else-if="meeting.status === 'convened'">
						<LnxButton :mode="meeting.votingOpen ? 'outline' : undefined" @click="toggleVoting()">
							<LnxIcon :icon="meeting.votingOpen ? 'lucide:lock' : 'lucide:vote'" />
							{{ meeting.votingOpen ? 'Cerrar votación' : 'Abrir votación en la app' }}
						</LnxButton>
						<LnxButton mode="outline" @click="setStatus('held')">
							<LnxIcon icon="lucide:check" />
							Marcar como celebrada
						</LnxButton>
						<LnxButton mode="clear" variant="danger" @click="setStatus('cancelled')">
							<LnxIcon icon="lucide:x" />
							Desconvocar
						</LnxButton>
					</template>
					<LnxButton v-else mode="outline" @click="setStatus('convened')">
						<LnxIcon icon="lucide:rotate-ccw" />
						Volver a convocada
					</LnxButton>
				</div>
				<p v-if="meeting.votingOpen" class="hint">
					Los propietarios pueden votar desde la app los puntos que se votan.
				</p>
			</section>

			<section class="card screen-only">
				<h2>Asistencia</h2>
				<p class="summary counters">
					<span><strong>{{ present.length }}</strong> asistirán</span>
					<span><strong>{{ represented.length }}</strong> delegan su voto</span>
					<span><strong>{{ sortedAttendance.length - present.length - represented.length }}</strong> no asistirán</span>
					<span><strong>{{ share(sumCoefficient([...present, ...represented])) }}</strong> del coeficiente presente o representado</span>
				</p>

				<TransitionGroup v-if="sortedAttendance.length" tag="ul" name="row" class="list">
					<li v-for="entry in sortedAttendance" :key="entry.id" class="item">
						<div class="what">
							<strong>{{ entry.name }}</strong>
							<small class="tabular">
								{{ attendanceStatus[entry.status] }}<template v-if="entry.status === 'delegated' && entry.delegateName"> en {{ entry.delegateName }}</template>
								· {{ formatPercent(coefficientByOwner[entry.uid] ?? 0) }}
							</small>
						</div>
						<LnxButton mode="clear" size="small" shape="circle" variant="danger" aria-label="Quitar" title="Quitar" @click="unrecordAttendance(entry)">
							<LnxIcon icon="lucide:x" />
						</LnxButton>
					</li>
				</TransitionGroup>
				<p v-else class="hint">
					Nadie ha respondido aún.
				</p>

				<form class="fields" @submit.prevent="addAttendance()">
					<LnxSelect
						v-model.convert="attendanceForm.uid"
						:options="personOptions"
						:convert-fn="option => option.value"
						search-placeholder-text="Buscar..."
					>
						Vecino
						<template #option="{ option }">
							{{ option.label }}
						</template>
						<template #optionInput="{ value }">
							{{ personOptions.find(option => option.value === value)?.label }}
						</template>
					</LnxSelect>
					<LnxSelect
						v-model.convert="attendanceForm.status"
						:options="attendanceOptions"
						:convert-fn="option => option.value"
						search-placeholder-text="Buscar..."
					>
						Respuesta
						<template #option="{ option }">
							{{ option.label }}
						</template>
						<template #optionInput="{ value }">
							{{ attendanceStatus[value as MeetingAttendance['status']] }}
						</template>
					</LnxSelect>
					<LnxInput v-if="attendanceForm.status === 'delegated'" v-model="attendanceForm.delegateName" required>
						Delega en
					</LnxInput>
					<LnxButton type="submit" mode="outline" :disabled="!attendanceForm.uid">
						<LnxIcon icon="lucide:user-check" />
						Anotar
					</LnxButton>
				</form>
			</section>

			<section v-if="votableItems.length" class="card screen-only">
				<h2>Votaciones</h2>
				<p class="hint">
					Anota el voto de cada propiedad presente o representada. Los que se emiten desde la app aparecen aquí al momento.
				</p>
				<details v-for="item in votableItems" :key="item.id" class="vote-item">
					<summary>
						<strong>{{ item.title }}</strong>
						<small class="tabular">{{ result(item) }}</small>
					</summary>
					<ul class="list">
						<li v-for="property in properties" :key="property.id" class="ballot">
							<div class="what">
								<strong class="tabular">{{ property.name }} · {{ formatPercent(property.coefficient ?? 0) }}</strong>
								<small>
									{{ property.ownerName || ownerNames[property.ownerUid] || 'Sin propietario' }}
									<template v-if="ballotOf(item, property)"> · votó {{ ballotOf(item, property)!.voterName }}</template>
								</small>
							</div>
							<div class="item-actions">
								<LnxButton
									v-for="choice in choices"
									:key="choice"
									size="small"
									:mode="ballotOf(item, property)?.choice === choice ? undefined : 'outline'"
									@click="vote(item, property, choice)"
								>
									{{ voteChoices[choice] }}
								</LnxButton>
								<LnxButton
									v-if="ballotOf(item, property)"
									mode="clear"
									size="small"
									shape="circle"
									variant="danger"
									aria-label="Anular voto"
									title="Anular voto"
									@click="annulBallot(item, ballotOf(item, property)!)"
								>
									<LnxIcon icon="lucide:x" />
								</LnxButton>
							</div>
						</li>
					</ul>
				</details>
			</section>

			<section class="card">
				<header class="minutes-header screen-only">
					<h2>Acta</h2>
					<LnxButton mode="outline" size="small" @click="copyMinutes()">
						<LnxIcon :icon="copied ? 'lucide:check' : 'lucide:copy'" />
						{{ copied ? 'Copiado' : 'Copiar texto' }}
					</LnxButton>
					<LnxButton size="small" @click="print()">
						<LnxIcon icon="lucide:printer" />
						Imprimir o guardar PDF
					</LnxButton>
				</header>

				<article ref="minutes" class="minutes">
					<h3>Acta de la junta {{ meetingTypes[meeting.type].toLowerCase() }} de propietarios</h3>
					<p>
						<strong>Comunidad:</strong> {{ communityName }}<br>
						<strong>Fecha:</strong> {{ dateFormat.format(meeting.date.toDate()) }}<br>
						<template v-if="meeting.place">
							<strong>Lugar:</strong> {{ meeting.place }}<br>
						</template>
						<template v-if="meeting.link">
							<strong>Enlace:</strong> {{ meeting.link }}
						</template>
					</p>

					<h4>Asistentes</h4>
					<p v-if="!present.length && !represented.length">
						No consta asistencia.
					</p>
					<template v-else>
						<p v-if="present.length">
							Presentes: {{ present.map(entry => `${entry.name} (${formatPercent(coefficientByOwner[entry.uid] ?? 0)})`).join(', ') }}.
						</p>
						<p v-if="represented.length">
							Representados: {{ represented.map(entry => `${entry.name}${entry.delegateName ? `, representado por ${entry.delegateName}` : ''} (${formatPercent(coefficientByOwner[entry.uid] ?? 0)})`).join(', ') }}.
						</p>
						<p>
							En total, {{ present.length + represented.length }} propietarios presentes o representados, que suman el {{ share(sumCoefficient([...present, ...represented])) }} de las cuotas de participación.
						</p>
					</template>

					<h4>Orden del día y acuerdos</h4>
					<ol>
						<li v-for="item in meeting.agenda" :key="item.id">
							<strong>{{ item.title }}</strong>
							<p v-if="item.description">
								{{ item.description }}
							</p>
							<p>{{ item.votable ? result(item) : 'Punto informativo, sin votación.' }}</p>
						</li>
					</ol>
				</article>
			</section>
		</template>
	</template>
</template>

<style lang="scss" scoped>
.page-header {
	margin-bottom: var(--lnx-spacing-5);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);

	h1 {
		flex: 1;
		font-size: var(--lnx-font-size-title);
	}
}

.status {
	padding: var(--lnx-spacing-1) var(--lnx-spacing-2);
	border-radius: var(--lnx-radius-2);
	background: var(--color-gray-2);
	color: var(--color-gray-7);
	font-size: var(--lnx-font-size-small);

	&--convened {
		background: var(--color-primary);
		color: var(--color-gray-0);
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
	grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr));
	align-items: end;
	gap: var(--lnx-spacing-3) var(--lnx-spacing-4);

	.wide {
		grid-column: 1 / -1;
	}
}

.agenda {
	position: relative;
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
}

.agenda-item {
	padding: var(--lnx-spacing-3);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-2);
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);
}

.check {
	margin-right: auto;
}

.form-actions,
.actions,
.minutes-header {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--lnx-spacing-2);
}

.form-actions {
	justify-content: flex-end;
}

.minutes-header h2 {
	flex: 1;
}

.summary {
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-2) var(--lnx-spacing-5);
	font-size: var(--lnx-font-size-small);
}

.list {
	position: relative;
	display: flex;
	flex-direction: column;
}

// Rows coming, going and moving. Transitions, so a change midway turns back from where it is
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

.item,
.ballot {
	padding: var(--lnx-spacing-2) 0;
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--lnx-spacing-3);

	& + & {
		border-top: 1px solid var(--color-gray-3);
	}
}

.what {
	flex: 1;
	display: flex;
	flex-direction: column;
	min-width: 180px;

	small {
		color: var(--color-gray-6);
	}
}

.item-actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--lnx-spacing-1);
}

.vote-item {
	border-top: 1px solid var(--color-gray-3);

	summary {
		padding: var(--lnx-spacing-3) 0;
		cursor: pointer;

		strong {
			text-wrap: balance;
			transition: color var(--duration) var(--ease-out);
		}

		&:hover strong {
			color: var(--color-primary);
		}

		small {
			display: block;
			color: var(--color-gray-6);
		}
	}
}

.minutes {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);
	line-height: 1.5;

	h3 {
		font-size: var(--lnx-font-size-subtitle, 1.25rem);
	}

	h4 {
		margin-top: var(--lnx-spacing-2);
		font-weight: var(--lnx-font-weight-bold);
	}

	ol {
		padding-left: var(--lnx-spacing-5);
		list-style: decimal;
		display: flex;
		flex-direction: column;
		gap: var(--lnx-spacing-2);
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

// Only the minutes, as a plain document
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
