<script setup lang="ts">
import type { AgendaItem, Meeting, MeetingVote, VoteChoice } from '@gobernansa/shared/domain/meeting.ts';
import type { Property } from '@gobernansa/shared/domain/property.ts';
import { tallyVotes, voteChoices } from '@gobernansa/shared/domain/meeting.ts';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed } from 'vue';
import { optimistic } from '@/app/ux/toast.ts';
import { describeResult, formatPercent, recordBallot, removeBallot, restoreBallot } from '../application/useMeetings.ts';

// Each property's vote on each agenda item put to the vote, as recorded at the meeting or cast from the app
const props = defineProps<{ meeting: Meeting; properties: Property[]; ballots: MeetingVote[]; people: { id: string; name: string }[]; total: number }>();

const choices = Object.keys(voteChoices) as VoteChoice[];

const votableItems = computed(() => props.meeting.agenda.filter(item => item.votable));
const ownerNames = computed(() => Object.fromEntries(props.people.map(person => [person.id, person.name])));
const ballotsById = computed(() => Object.fromEntries(props.ballots.map(ballot => [ballot.id, ballot])));

function ballotOf(item: AgendaItem, property: Property): MeetingVote | undefined {
	return ballotsById.value[`${item.id}_${property.id}`];
}

function vote(item: AgendaItem, property: Property, choice: VoteChoice) {
	void optimistic(recordBallot(props.meeting, item, property, choice), { failed: 'No se ha podido anotar el voto' });
}

function annulBallot(item: AgendaItem, ballot: MeetingVote) {
	const current = props.meeting;
	void optimistic(removeBallot(current, item, ballot), {
		done: 'Voto anulado',
		failed: 'No se ha podido anular',
		revert: async () => restoreBallot(current, item, ballot),
	});
}

function result(item: AgendaItem) {
	return describeResult(tallyVotes(props.ballots, item.id), props.total);
}
</script>

<template>
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
							size="sm"
							:mode="ballotOf(item, property)?.choice === choice ? undefined : 'outline'"
							@click="vote(item, property, choice)"
						>
							{{ voteChoices[choice] }}
						</LnxButton>
						<LnxButton
							v-if="ballotOf(item, property)"
							mode="clear"
							size="sm"
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
</template>

<style lang="scss" scoped src="./meeting.scss" />
