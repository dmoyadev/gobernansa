import type { Timestamp } from 'firebase/firestore';
import type { Datable } from './audit.ts';

// Juntas de propietarios, at communities/{communityId}/meetings. Neighbours see them once convened
export interface Meeting extends Datable {
	id: string;
	communityId: string;
	title: string;
	type: 'ordinary' | 'extraordinary';
	date: Timestamp;
	// Where it's held, a link to join online, or both
	place?: string;
	link?: string;
	agenda: AgendaItem[];
	status: MeetingStatus;
	// While true, owners can vote the votable items from the webapp
	votingOpen?: boolean;
}

export type MeetingStatus = 'draft' | 'convened' | 'held' | 'cancelled';

export interface AgendaItem {
	// Kept when the agenda is edited, votes point to it
	id: string;
	title: string;
	description?: string;
	votable: boolean;
}

// One per neighbour, stored with their uid as id
export interface MeetingAttendance {
	id: string;
	uid: string;
	name: string;
	status: 'attending' | 'absent' | 'delegated';
	// Who votes for them, by name as the delegation letter says
	delegateName?: string;
	updatedAt: Timestamp;
}

export type VoteChoice = 'yes' | 'no' | 'abstain';

// At meetings/{meetingId}/ballots (not votes, which the issue votes' collection group query would count), one per agenda item and
// property, stored as `${itemId}_${propertyId}`, so each property votes once with its coefficient
export interface MeetingVote {
	id: string;
	itemId: string;
	propertyId: string;
	propertyName: string;
	coefficient: number;
	choice: VoteChoice;
	// Who cast it: the owner from the webapp, or the administration recording it in the meeting (e.g. delegated votes)
	voterId: string;
	voterName: string;
	votedAt: Timestamp;
}

export const meetingTypes: Record<Meeting['type'], string> = {
	ordinary: 'Ordinaria',
	extraordinary: 'Extraordinaria',
};

export const meetingStatus: Record<MeetingStatus, string> = {
	draft: 'Borrador',
	convened: 'Convocada',
	held: 'Celebrada',
	cancelled: 'Desconvocada',
};

export const attendanceStatus: Record<MeetingAttendance['status'], string> = {
	attending: 'Asistiré',
	absent: 'No asistiré',
	delegated: 'Delego mi voto',
};

export const voteChoices: Record<VoteChoice, string> = {
	yes: 'A favor',
	no: 'En contra',
	abstain: 'Abstención',
};

export interface Tally {
	choice: VoteChoice;
	votes: number;
	coefficient: number;
}

// Votes of one item, weighted by coefficient as the Ley de Propiedad Horizontal counts them. Coefficients rounded to 2 decimals
export function tallyVotes(votes: Pick<MeetingVote, 'itemId' | 'choice' | 'coefficient'>[], itemId: string): Tally[] {
	return (Object.keys(voteChoices) as VoteChoice[]).map((choice) => {
		const cast = votes.filter(vote => vote.itemId === itemId && vote.choice === choice);
		return {
			choice,
			votes: cast.length,
			coefficient: Math.round(cast.reduce((sum, vote) => sum + vote.coefficient, 0) * 100) / 100,
		};
	});
}

// Passes with more owners and more coefficient in favour than against (simple majority). Other majorities are left to whoever writes the minutes
export function isApproved(tally: Tally[]) {
	const yes = tally.find(entry => entry.choice === 'yes')!;
	const no = tally.find(entry => entry.choice === 'no')!;
	return yes.votes > no.votes && yes.coefficient > no.coefficient;
}
