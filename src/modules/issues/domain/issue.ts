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

export const issuesCategories: { value: IssueCategory; label: string }[] = [
	{ value: 'maintenance', label: '🛠️ Mantenimiento' },
	{ value: 'landscaping', label: '🏡 Jardinería' },
	{ value: 'cleaning', label: '🧹 Limpieza' },
	{ value: 'security', label: '🔒 Seguridad' },
	{ value: 'nuisance', label: '💥 Molestias' },
	{ value: 'other', label: '⚠️ Otros' },
];

export const issueStatus: { value: IssueStatus; label: string }[] = [
	{ value: 'open', label: 'Notificada' },
	{ value: 'in_progress', label: 'Actuando' },
	{ value: 'resolved', label: 'Solucionada' },
	{ value: 'closed', label: 'Cerrada' },
];
