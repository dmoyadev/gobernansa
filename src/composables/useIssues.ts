import type { DocumentData, QueryConstraint } from 'firebase/firestore';
import type { Ref } from 'vue';
import type { Datable, Deletable } from '../utils/interfaces.ts';
import type { Community } from './useUserCommunity.ts';
import {
	collection,
	getDocs,
	getFirestore,
	limit,
	orderBy,
	query,
	startAfter,
	where,
} from 'firebase/firestore';
import { computed, ref, watch } from 'vue';

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

export interface IssuesFilters {
	status?: IssueStatus;
	category?: IssueCategory;
	assignedTo?: string;
}

export const issuesCategories = [
	{ value: 'maintenance', label: '🛠️ Mantenimiento' },
	{ value: 'landscaping', label: '🏡 Jardinería' },
	{ value: 'cleaning', label: '🧹 Limpieza' },
	{ value: 'security', label: '🔒 Seguridad' },
	{ value: 'nuisance', label: '💥 Molestias' },
	{ value: 'other', label: '⚠️ Otros' },
] as const as { value: IssueCategory; label: string }[];

export const issueStatus = [
	{ value: 'open', label: 'Notificada' },
	{ value: 'in_progress', label: 'Actuando' },
	{ value: 'resolved', label: 'Solucionada' },
	{ value: 'closed', label: 'Cerrada' },
] as const as { value: IssueStatus; label: string }[];

const PAGE_SIZE = 10;

export function useIssues(community: Ref<Community>) {
	const communityId = computed<string>(() => community.value?.id);
	const db = getFirestore();

	const issues = ref<Issue[]>([]);
	const sortingField = ref<IssueSortingField>('createdAt');
	const loading = ref(false);
	const lastDoc = ref<DocumentData>();
	const hasMore = ref(true);

	const filters = ref<IssuesFilters>({});

	function buildQuery() {
		const constraints: QueryConstraint[] = [
			where('deletedAt', '==', null),
			orderBy(sortingField.value, 'desc'),
			limit(PAGE_SIZE),
		];

		if (filters.value.status) {
			constraints.push(where('status', '==', filters.value.status));
		}
		if (filters.value.category) {
			constraints.push(where('category', '==', filters.value.category));
		}
		if (filters.value.assignedTo) {
			constraints.push(where('assignedTo', '==', filters.value.assignedTo));
		}
		if (lastDoc.value) {
			constraints.push(startAfter(lastDoc.value));
		}

		return query(
			collection(db, 'communities', communityId.value, 'issues'),
			...constraints,
		);
	}

	async function fetchIssues(reset = false) {
		if (loading.value || (!hasMore.value && !reset)) {
			return;
		}

		loading.value = true;

		if (reset) {
			issues.value = [];
			lastDoc.value = undefined;
			hasMore.value = true;
		}

		const q = buildQuery();
		const snap = await getDocs(q);

		const newIssues = snap.docs.map(doc => ({
			id: doc.id,
			...doc.data(),
		})) as Issue[];

		if (snap.docs.length < PAGE_SIZE) {
			hasMore.value = false;
		}

		lastDoc.value = snap.docs.at(-1) || undefined;

		issues.value.push(...newIssues);

		loading.value = false;
	}

	watch(communityId, (value) => {
		if (value) {
			void fetchIssues();
		}
	});
	watch(filters, () => {
		console.log('fetching issues!');
		void fetchIssues(true);
	}, { deep: true });

	return {
		issues,
		loading,
		hasMore,
		filters,
		sortingField,
		fetchIssues,
	};
}
