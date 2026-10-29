<script setup lang="ts">
import type { AgendaItem, MeetingAttendance, VoteChoice } from '@gobernansa/shared/domain/meeting.ts';
import type { Property } from '@gobernansa/shared/domain/property.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { attendanceStatus, isApproved, meetingStatus, meetingTypes, tallyVotes, voteChoices } from '@gobernansa/shared/domain/meeting.ts';
import { formatCoefficient } from '@gobernansa/shared/domain/property.ts';
import { LnxButton, LnxIcon, LnxInput } from 'lnxjs-components';
import { computed, ref, watch } from 'vue';
import { useUserProperties } from '@/modules/community/application/useUserProperties.ts';
import MainLayout from '@/shared/ui/MainLayout.vue';
import TheToolbar from '@/shared/ui/TheToolbar.vue';
import { formatMeetingDate, useMeeting } from '../application/useMeetings.ts';

const props = defineProps<{ id: string }>();

const { user } = useAuth();
const { userProperties } = useUserProperties();
const { meeting, loading, attendance, ballots, answerAttendance, vote } = useMeeting(() => props.id);

const votableItems = computed(() => meeting.value?.agenda.filter(item => item.votable) ?? []);
const canVote = computed(() => !!meeting.value?.votingOpen && meeting.value.status !== 'cancelled' && !user.value?.blocked);

const error = ref<string>();
const busy = ref<string>();

// Each action shows its own error, and logs it to know why it failed (e.g. the security rules)
async function run(key: string, action: () => Promise<unknown>, errorMessage: string) {
	busy.value = key;
	error.value = undefined;
	try {
		await action();
	} catch (e) {
		// eslint-disable-next-line no-console
		console.error(e);
		error.value = errorMessage;
	} finally {
		busy.value = undefined;
	}
}

/* Attendance */
const delegating = ref(false);
const delegateName = ref('');
watch(attendance, (answer) => {
	delegating.value = answer?.status === 'delegated';
	delegateName.value = answer?.delegateName ?? '';
}, { immediate: true });

function answer(status: MeetingAttendance['status']) {
	if (status === 'delegated') {
		delegating.value = true;
		return;
	}
	delegating.value = false;
	void run(status, async () => answerAttendance(status), 'No se ha podido guardar tu respuesta. Inténtalo de nuevo.');
}

function delegate() {
	void run('delegated', async () => answerAttendance('delegated', delegateName.value.trim()), 'No se ha podido guardar la delegación. Inténtalo de nuevo.');
}

/* Votes */
function myChoice(item: AgendaItem, property: Property) {
	return ballots.value.find(ballot => ballot.itemId === item.id && ballot.propertyId === property.id)?.choice;
}

function onVote(item: AgendaItem, property: Property, choice: VoteChoice) {
	void run(`${item.id}_${property.id}_${choice}`, async () => vote(item, property, choice), 'No se ha podido votar. Revisa tu conexión e inténtalo de nuevo.');
}

function results(item: AgendaItem) {
	const tally = tallyVotes(ballots.value, item.id);
	return { tally, approved: isApproved(tally) };
}
</script>

<template>
	<TheToolbar :title="meeting?.title || 'Junta'" back="/neighborhood/meetings" />

	<MainLayout class="meeting">
		<template v-if="meeting">
			<header>
				<small>{{ meetingTypes[meeting.type] }} · {{ meetingStatus[meeting.status] }}</small>
				<h1>{{ meeting.title }}</h1>
			</header>

			<p v-if="meeting.status === 'cancelled'" class="notice">
				<LnxIcon icon="lucide:calendar-x" :size="16" />
				Esta junta se ha desconvocado.
			</p>

			<section class="panel">
				<dl class="details">
					<div>
						<dt>
							<LnxIcon icon="lucide:calendar" :size="16" />
							Fecha
						</dt>
						<dd>{{ formatMeetingDate(meeting.date) }}</dd>
					</div>
					<div v-if="meeting.place">
						<dt>
							<LnxIcon icon="lucide:map-pin" :size="16" />
							Lugar
						</dt>
						<dd>{{ meeting.place }}</dd>
					</div>
					<div v-if="meeting.link">
						<dt>
							<LnxIcon icon="lucide:video" :size="16" />
							En línea
						</dt>
						<dd>
							<a :href="meeting.link" target="_blank" rel="noopener">Unirse a la junta</a>
						</dd>
					</div>
				</dl>
			</section>

			<section v-if="meeting.status === 'convened'" class="panel attendance">
				<h2>¿Vas a asistir?</h2>
				<div class="choices">
					<LnxButton
						v-for="(label, status) in attendanceStatus"
						:key="status"
						:mode="(status === 'delegated' ? delegating : attendance?.status === status && !delegating) ? 'solid' : 'outline'"
						size="small"
						:is-loading="busy === status"
						:disabled="!!busy || !!user?.blocked"
						:aria-pressed="attendance?.status === status"
						@click="answer(status)"
					>
						{{ label }}
					</LnxButton>
				</div>
				<form v-if="delegating" class="delegate" @submit.prevent="delegate()">
					<LnxInput v-model="delegateName" required maxlength="100" :disabled="!!user?.blocked">
						¿En quién delegas tu voto?
					</LnxInput>
					<LnxButton type="submit" size="small" :is-loading="busy === 'delegated'" :disabled="!!busy || !delegateName.trim() || !!user?.blocked">
						Guardar delegación
					</LnxButton>
				</form>
				<small class="hint">
					<template v-if="attendance">
						Tu respuesta: {{ attendanceStatus[attendance.status] }}{{ attendance.delegateName ? ` en ${attendance.delegateName}` : '' }}.
					</template>
					Recuerda entregar la carta de delegación firmada si delegas tu voto.
				</small>
			</section>

			<section>
				<h2>Orden del día</h2>
				<ol class="agenda">
					<li v-for="(item, index) in meeting.agenda" :key="item.id" class="panel">
						<div class="item-header">
							<strong>{{ index + 1 }}. {{ item.title }}</strong>
							<span v-if="item.votable" class="tag">Se vota</span>
						</div>
						<p v-if="item.description">
							{{ item.description }}
						</p>

						<!-- Each property votes with its coefficient -->
						<div v-if="item.votable && canVote" class="ballots">
							<div v-for="property in userProperties" :key="property.id" class="ballot">
								<small>{{ property.name }} · {{ property.coefficient ?? 0 }} %</small>
								<div class="choices">
									<LnxButton
										v-for="(label, choice) in voteChoices"
										:key="choice"
										:mode="myChoice(item, property) === choice ? 'solid' : 'outline'"
										size="small"
										:aria-pressed="myChoice(item, property) === choice"
										:is-loading="busy === `${item.id}_${property.id}_${choice}`"
										:disabled="!!busy"
										@click="onVote(item, property, choice)"
									>
										{{ label }}
									</LnxButton>
								</div>
							</div>
							<small v-if="!userProperties.length" class="hint">
								No tienes propiedades registradas a tu nombre con las que votar.
							</small>
						</div>

						<table v-if="item.votable && meeting.status === 'held'" class="results">
							<caption>
								{{ results(item).approved ? 'Aprobado' : 'No aprobado' }}
							</caption>
							<thead>
								<tr>
									<th scope="col">
										Voto
									</th>
									<th scope="col">
										Propiedades
									</th>
									<th scope="col">
										Coeficiente
									</th>
								</tr>
							</thead>
							<tbody>
								<tr v-for="row in results(item).tally" :key="row.choice">
									<th scope="row">
										{{ voteChoices[row.choice] }}
									</th>
									<td>{{ row.votes }}</td>
									<td>{{ formatCoefficient(row.coefficient) }}</td>
								</tr>
							</tbody>
						</table>
					</li>
				</ol>
				<small v-if="meeting.votingOpen && votableItems.length && user?.blocked" class="hint">
					Tu cuenta no puede votar ahora mismo.
				</small>
			</section>

			<p v-if="error" class="error" role="alert">
				<LnxIcon icon="lucide:circle-alert" :size="16" />
				{{ error }}
			</p>
		</template>

		<template v-else-if="loading">
			<span class="skeleton-item skeleton-item--title" />
			<span class="skeleton-item" />
			<span class="skeleton-item" style="width: 70%" />
		</template>

		<div v-else class="empty">
			<LnxIcon icon="lucide:search-x" :size="32" />
			<h3>Junta no encontrada</h3>
			<LnxButton mode="clear" to="/neighborhood/meetings">
				Ver juntas
			</LnxButton>
		</div>
	</MainLayout>
</template>

<style lang="scss" scoped>
.meeting {
	padding-top: calc(var(--toolbar-height) + var(--lnx-spacing-4));
}

header {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-1);

	small {
		color: var(--color-gray-6);
		font-size: .75rem;
		font-weight: var(--lnx-font-weight-bold);
		letter-spacing: .04em;
		text-transform: uppercase;
	}

	h1 {
		color: var(--color-gray-9);
		line-height: 1.2;
	}
}

section {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);
}

h2 {
	font-size: var(--lnx-font-size-small);
	font-weight: var(--lnx-font-weight-bold);
	color: var(--color-gray-6);
	text-transform: uppercase;
	letter-spacing: .04em;
}

.panel {
	padding: var(--lnx-spacing-4);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;
}

.details {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);

	div {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	dt {
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-2);
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
	}

	dd {
		padding-left: calc(16px + var(--lnx-spacing-2));
		color: var(--color-gray-9);

		&::first-letter {
			text-transform: uppercase;
		}
	}
}

.attendance {
	gap: var(--lnx-spacing-3);
}

.choices {
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-2);
}

.delegate {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);
}

.agenda {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);

	li {
		display: flex;
		flex-direction: column;
		gap: var(--lnx-spacing-2);
	}

	p {
		color: var(--color-gray-8);
		line-height: 1.5;
		white-space: pre-line;
	}
}

.item-header {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: var(--lnx-spacing-2);
}

.tag {
	flex-shrink: 0;
	padding: 0 var(--lnx-spacing-2);
	border-radius: var(--lnx-radius-4);
	background: var(--color-issue-cat-services);
	color: var(--color-issue-cat-services-accent);
	font-size: var(--lnx-font-size-small);
	font-weight: var(--lnx-font-weight-bold);
}

.ballots {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
	padding-top: var(--lnx-spacing-2);
	border-top: 1px solid var(--color-gray-2);
}

.ballot {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-1);

	small {
		color: var(--color-gray-6);
	}
}

.results {
	width: 100%;
	border-collapse: collapse;
	font-size: var(--lnx-font-size-small);

	caption {
		padding-bottom: var(--lnx-spacing-1);
		font-weight: var(--lnx-font-weight-bold);
		text-align: left;
	}

	th,
	td {
		padding: var(--lnx-spacing-1) 0;
		border-top: 1px solid var(--color-gray-2);
		text-align: left;
	}

	thead th {
		color: var(--color-gray-6);
		font-weight: var(--lnx-font-weight-regular);
	}

	td {
		text-align: right;
	}

	thead th:not(:first-child) {
		text-align: right;
	}
}

.notice,
.error {
	display: flex;
	align-items: flex-start;
	gap: var(--lnx-spacing-2);
	font-size: var(--lnx-font-size-small);
}

.notice {
	color: var(--color-gray-8);
}

.error {
	color: var(--lnx-color-danger);
}

.hint {
	color: var(--color-gray-6);
}

.empty {
	padding: calc(var(--lnx-spacing-8) * 2) var(--lnx-spacing-4) var(--lnx-spacing-8);
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: var(--lnx-spacing-2);
	text-align: center;
	color: var(--color-gray-6);

	h3 {
		color: var(--color-gray-8);
	}
}
</style>
