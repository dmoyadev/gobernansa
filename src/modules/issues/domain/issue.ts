import type { Datable, Deletable } from '@/shared/domain/audit.ts';

export type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type IssueCategory = 'maintenance' | 'landscaping' | 'cleaning' | 'security' | 'nuisance' | 'other';
export type IssueSortingField = 'updatedAt' | 'createdAt' | 'votesCount';

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

	assets?: string[];

	location?: {
		type: 'property' | 'common_area';
		propertyId?: string;
		reference?: string;
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
	score: number;
}

export interface IssuesFilters {
	status?: IssueStatus;
	category?: IssueCategory;
	assignedTo?: string;
}

export const issuesCategories: { value: IssueCategory; label: string; icon: string }[] = [
	{ value: 'maintenance', label: 'Mantenimiento', icon: 'lucide:wrench' },
	{ value: 'landscaping', label: 'Jardinería', icon: 'lucide:sprout' },
	{ value: 'cleaning', label: 'Limpieza', icon: 'lucide:brush-cleaning' },
	{ value: 'security', label: 'Seguridad', icon: 'lucide:lock' },
	{ value: 'nuisance', label: 'Molestias', icon: 'lucide:volume-2' },
	{ value: 'other', label: 'Otros', icon: 'lucide:triangle-alert' },
];

export const issueStatus: { value: IssueStatus; label: string }[] = [
	{ value: 'open', label: 'Notificada' },
	{ value: 'in_progress', label: 'Actuando' },
	{ value: 'resolved', label: 'Solucionada' },
	{ value: 'closed', label: 'Cerrada' },
];
