import type { Timestamp } from 'firebase/firestore';
import type { Datable, Deletable } from './audit.ts';
import type { User } from './user.ts';

// The same everywhere an issue is shown or reported: tab bar, home, lists
export const ISSUE_ICON = 'lucide:message-square-warning';

export type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type IssueSortingField = 'updatedAt' | 'createdAt' | 'votesCount';

// Who reported it is only known to the administration (IssueAuthor), so there's no createdBy. updatedBy is only set by them
export interface Issue extends Omit<Datable, 'createdBy' | 'updatedBy'>, Deletable {
	id: string;
	// The reporter's secret key (getAuthorKey()), for them to find theirs without telling the neighbours who they are.
	// Missing on the ones the administration reports
	authorKey?: string;
	updatedBy?: string;

	title: string;
	description: string;

	status: IssueStatus;
	// The id of one of the community's categories (getIssueCategories())
	category: string;

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
	// The token of the provider's parte de trabajo (workOrders/{token}), while it isn't revoked
	workOrder?: string;
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

// Who reported it, at communities/{communityId}/issues/{issueId}/private/author. Written with the issue and never changed.
// Only the administration reads it, neighbours never know who reported an issue
export interface IssueAuthor {
	uid: string;
}

// Each property votes, not each person: stored as `${issueId}_${propertyId}`, one vote per property and issue cast by
// its owner (voterId)
export interface IssueVote {
	id: string;

	propertyId: string;
	voterId: string;
	score: 1 | -1;
	// When it was last cast, it uses one of that month's votes of the property
	votedAt: Timestamp;
}

// Votes each property gets every month to spend on what matters most to its owner. A community can change it (monthlyVotes)
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
	category?: string;
	assignedTo?: string;
	// The user's authorKey, for their own
	authorKey?: string;
}

// Each one has its pair of tokens in the theme, --color-issue-cat-{color} and its -accent
export type IssueCategoryColor = 'amber' | 'green' | 'cyan' | 'blue' | 'purple' | 'rose' | 'gray';

export const issueCategoryColors: Record<IssueCategoryColor, string> = {
	amber: 'Ámbar',
	green: 'Verde',
	cyan: 'Turquesa',
	blue: 'Azul',
	purple: 'Morado',
	rose: 'Rosa',
	gray: 'Gris',
};

// Each community has its own, edited by the administration like the common areas. Issues point to one by its id, kept
// when it's renamed. examples help to pick the right one, defaultTitle names an issue reported without a title
export interface IssueCategory {
	id: string;
	name: string;
	icon: string;
	color: IssueCategoryColor;
	examples?: string;
	defaultTitle?: string;
}

// What the on-device suggestions know (writing.ts), the ids of the categories every community starts with
export type DefaultIssueCategory = 'maintenance' | 'landscaping' | 'cleaning' | 'services' | 'nuisance' | 'other';

export const DEFAULT_ISSUE_CATEGORIES: (IssueCategory & { id: DefaultIssueCategory })[] = [
	{ id: 'maintenance', name: 'Mantenimiento', icon: 'lucide:wrench', color: 'amber', examples: 'Luces, puertas, ascensor, fugas…', defaultTitle: 'Avería' },
	{ id: 'cleaning', name: 'Limpieza', icon: 'lucide:brush-cleaning', color: 'cyan', examples: 'Suciedad, basura, manchas…', defaultTitle: 'Falta de limpieza' },
	{ id: 'nuisance', name: 'Molestias', icon: 'lucide:volume-2', color: 'purple', examples: 'Ruidos, olores…', defaultTitle: 'Molestias' },
	{ id: 'landscaping', name: 'Jardinería', icon: 'lucide:sprout', color: 'green', examples: 'Plantas, césped, riego…', defaultTitle: 'Problema de jardinería' },
	{ id: 'services', name: 'Servicios', icon: 'lucide:waves-ladder', color: 'blue', examples: 'Piscina, pistas de tenis, seguridad…', defaultTitle: 'Fallo de servicio' },
	{ id: 'other', name: 'Otros', icon: 'lucide:triangle-alert', color: 'gray', examples: 'Cualquier otra cosa', defaultTitle: 'Aviso' },
];

// The icons an admin can pick for a category
export const issueCategoryIcons: { icon: string; label: string }[] = [
	...DEFAULT_ISSUE_CATEGORIES.map(({ icon, name }) => ({ icon, label: name })),
	{ icon: 'lucide:zap', label: 'Electricidad' },
	{ icon: 'lucide:droplets', label: 'Agua' },
	{ icon: 'lucide:arrow-down-up', label: 'Ascensor' },
	{ icon: 'lucide:key-round', label: 'Accesos' },
	{ icon: 'lucide:shield', label: 'Seguridad' },
	{ icon: 'lucide:flame', label: 'Incendios' },
	{ icon: 'lucide:bug', label: 'Plagas' },
	{ icon: 'lucide:car', label: 'Garaje' },
	{ icon: 'lucide:paint-roller', label: 'Pintura' },
	{ icon: 'lucide:wifi', label: 'Telecomunicaciones' },
	{ icon: 'lucide:recycle', label: 'Reciclaje' },
	{ icon: 'lucide:lightbulb', label: 'Propuesta' },
];

// The community's, or those every community starts with until the administration changes them
export function getIssueCategories(community?: { issueCategories?: IssueCategory[] } | null) {
	return community?.issueCategories ?? DEFAULT_ISSUE_CATEGORIES;
}

// An issue's category. One the administration removed keeps showing as the default it was, or as without category
export function findIssueCategory(categories: IssueCategory[], id: string | undefined): IssueCategory {
	return categories.find(category => category.id === id)
		?? DEFAULT_ISSUE_CATEGORIES.find(category => category.id === id)
		?? { id: id ?? '', name: 'Sin categoría', icon: 'lucide:triangle-alert', color: 'gray' };
}

// For the elements painted with the category's colors
export function issueCategoryStyle(category: Pick<IssueCategory, 'color'>) {
	return { '--cat-color': `var(--color-issue-cat-${category.color}-accent)`, '--cat-color-bg': `var(--color-issue-cat-${category.color})` };
}

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

// How long an issue has been waiting, counted from when it was reported while it's open or in progress.
// level: 0 nothing, 1 grey (2 days), 2 red (7), 3 two red (14), 4 three red (over 20)
export function getIssueAge(issue: Pick<Issue, 'createdAt' | 'status'>, now = Date.now()) {
	const days = issue.createdAt ? Math.floor((now - issue.createdAt.toMillis()) / 86_400_000) : 0;
	const waiting = issue.status === 'open' || issue.status === 'in_progress';
	const level = !waiting ? 0 : days > 20 ? 4 : days >= 14 ? 3 : days >= 7 ? 2 : days >= 2 ? 1 : 0;
	return { days, level };
}

export const issueLocationTypes: Record<NonNullable<Issue['location']>['type'], string> = {
	property: 'Propiedad',
	common_area: 'Zona común',
};
