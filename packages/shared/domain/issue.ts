import type { Timestamp } from 'firebase/firestore';
import type { Datable, Deletable } from './audit.ts';
import type { User } from './user.ts';

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
	// Who the administration sent, and when they expect it to be done. Neighbours see both
	provider?: { id: string; name: string };
	expectedAt?: Timestamp;
	// When it was last marked as resolved, to know how long issues take
	resolvedAt?: Timestamp;
	// Only that there's a claim, its details are in IssuePrivate
	insuranceClaim?: boolean;

	votesScore: number;
	votesCount: number;
	// Only messages, not status changes. Missing on issues reported before comments existed
	commentsCount?: number;

	assets?: string[];

	location?: {
		type: 'property' | 'common_area';
		propertyId?: string;
		reference?: string;
	};
}

export interface IssueComment extends Datable, Deletable {
	id: string;

	authorId: string;
	// Kept with the comment, so showing it doesn't need to read every author
	authorName?: string;
	// Only for the administration, to tell their answers apart
	authorRole?: Exclude<User['role'], 'user'>;
	// A status change is listed with the messages, as the issue's history
	type?: 'message' | 'status';
	status?: IssueStatus;
	message: string;
	// Hidden by the administration, it stays for them but neighbours don't see it
	hiddenAt?: Timestamp | null;
	hiddenBy?: string;
}

// What only the administration sees of an issue, at communities/{communityId}/issues/{issueId}/private/admin
export interface IssuePrivate {
	note?: string;
	claim?: InsuranceClaim;
	updatedAt?: Timestamp;
	updatedBy?: string;
}

export type ClaimStatus = 'opened' | 'expert' | 'accepted' | 'rejected' | 'paid' | 'closed';

export interface InsuranceClaim {
	insurer: string;
	// Número de siniestro, given by the insurer
	number: string;
	status: ClaimStatus;
	openedAt: Timestamp;
	// Each status change with what happened, oldest first
	history: { at: Timestamp; status: ClaimStatus; note?: string }[];
}

export const claimStatus: Record<ClaimStatus, { label: string; icon: string }> = {
	opened: { label: 'Parte abierto', icon: 'lucide:file-plus' },
	expert: { label: 'Visita del perito', icon: 'lucide:clipboard-list' },
	accepted: { label: 'Aceptado', icon: 'lucide:circle-check' },
	rejected: { label: 'Rechazado', icon: 'lucide:circle-x' },
	paid: { label: 'Indemnizado', icon: 'lucide:banknote' },
	closed: { label: 'Cerrado', icon: 'lucide:archive' },
};

// Stored as `${issueId}_${voterId}`, so each neighbour has one vote per issue
export interface IssueVote {
	id: string;

	voterId: string;
	score: 1 | -1;
	// When it was last cast, it uses one of that month's votes. Missing on votes from before the monthly limit
	votedAt?: Timestamp;
}

// Votes each neighbour gets every month to spend on what matters most to them. A community can change it (monthlyVotes)
export const DEFAULT_MONTHLY_VOTES = 5;

// shortcut: months follow the device's time zone, fine while neighbours live where the community is
export function getVotingMonth(now = new Date()) {
	return {
		start: new Date(now.getFullYear(), now.getMonth(), 1),
		renewsOn: new Date(now.getFullYear(), now.getMonth() + 1, 1),
	};
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
