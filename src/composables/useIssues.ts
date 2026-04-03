import type { Datable, Deletable } from '../utils/interfaces.ts';

export type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type IssueCategory = 'maintenance' | 'landscaping' | 'cleaning' | 'security' | 'nuisance' | 'other';

export interface Issue extends Datable, Deletable {
	id: string;

	title: string;
	description: string;

	status: IssueStatus;
	category: IssueCategory;

	communityId: string;
	assignedTo?: string;
	votesScore: number;
	votesCount: number;

	images?: string[];

	location?: {
		type: 'property' | 'common_area';
		propertyId?: string; // only if the type is 'property', id of the property where the issue is located
		reference?: string; // ex: "portal 2", "garaje plaza 14"
	};
}

export interface IssueComment extends Datable, Deletable {
	id: string;
	issueId: string;

	authorId: string;
	message: string;
}

export interface IssueVote {
	id: string;
	issueId: string;
	voterId: string;
	score: number; // 1 for upvote, -1 for downvote
}

export function useIssues() {

}

export function useIssue(id: string) {

}
