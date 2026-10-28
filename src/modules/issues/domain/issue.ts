import type { Datable, Deletable } from '@/shared/domain/audit.ts';

export type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type IssueCategory = 'maintenance' | 'landscaping' | 'cleaning' | 'services' | 'nuisance' | 'other';
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
	createdBy?: string;
}

// examples help to pick the right category, defaultTitle names an issue reported without a title
export const issuesCategories: { value: IssueCategory; label: string; icon: string; examples: string; defaultTitle: string }[] = [
	{ value: 'maintenance', label: 'Mantenimiento', icon: 'lucide:wrench', examples: 'Luces, puertas, ascensor, fugas…', defaultTitle: 'Avería' },
	{ value: 'cleaning', label: 'Limpieza', icon: 'lucide:brush-cleaning', examples: 'Suciedad, basura, manchas…', defaultTitle: 'Falta de limpieza' },
	{ value: 'nuisance', label: 'Molestias', icon: 'lucide:volume-2', examples: 'Ruidos, olores…', defaultTitle: 'Molestias' },
	{ value: 'landscaping', label: 'Jardinería', icon: 'lucide:sprout', examples: 'Plantas, césped, riego…', defaultTitle: 'Problema de jardinería' },
	{ value: 'services', label: 'Servicios', icon: 'lucide:waves-ladder', examples: 'Piscina, pistas de tenis, seguridad…', defaultTitle: 'Fallo de servicio' },
	{ value: 'other', label: 'Otros', icon: 'lucide:triangle-alert', examples: 'Cualquier otra cosa', defaultTitle: 'Aviso' },
];

export const issueStatus: { value: IssueStatus; label: string }[] = [
	{ value: 'open', label: 'Notificada' },
	{ value: 'in_progress', label: 'Actuando' },
	{ value: 'resolved', label: 'Solucionada' },
	{ value: 'closed', label: 'Cerrada' },
];

export const issueLifecycle = issueStatus.filter(status => status.value !== 'closed');

// Closed issues leave the lifecycle, so they count as having gone through every step
export function getIssueStep(status: IssueStatus) {
	return status === 'closed'
		? issueLifecycle.length
		: issueLifecycle.findIndex(lifecycleStatus => lifecycleStatus.value === status) + 1;
}

export const issueLocationTypes: Record<NonNullable<Issue['location']>['type'], string> = {
	property: 'Propiedad',
	common_area: 'Zona común',
};
