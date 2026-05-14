import type { CollectionReference, DocumentData, QueryConstraint } from 'firebase/firestore';
import type { ChipOption } from '../components/ChipsSelector.vue';
import type { Issue, IssueCategory, IssuesFilters, IssueSortingField, IssueStatus } from '../interfaces/issue';
import { getDocs, getFirestore, limit, orderBy, query, startAfter, where } from 'firebase/firestore';
import { computed, ref, watch } from 'vue';
import { communityCollection, mapFirestoreDoc } from './useFirestoreDocument.ts';
import { useUserCommunity } from './useUserCommunity.ts';

export const issuesCategories = [
	{ value: 'maintenance', label: '🛠️ Mantenimiento' },
	{ value: 'landscaping', label: '🏡 Jardinería' },
	{ value: 'cleaning', label: '🧹 Limpieza' },
	{ value: 'security', label: '🔒 Seguridad' },
	{ value: 'nuisance', label: '💥 Molestias' },
	{ value: 'other', label: '⚠️ Otros' },
] as const as ChipOption<IssueCategory>[];

export const issueStatus = [
	{ value: 'open', label: 'Notificada' },
	{ value: 'in_progress', label: 'Actuando' },
	{ value: 'resolved', label: 'Solucionada' },
	{ value: 'closed', label: 'Cerrada' },
] as const as ChipOption<IssueStatus>[];

const PAGE_SIZE = 10;

export function useIssues() {
	const db = getFirestore();

	const { userCommunity } = useUserCommunity();
	const communityId = computed(() => userCommunity.value?.id);

	const issues = ref<Issue[]>([]);
	const sortingField = ref<IssueSortingField>('createdAt');
	const loading = ref(false);
	const lastDoc = ref<DocumentData>();
	const hasMore = ref(true);

	const issuesCollection = computed<CollectionReference<Issue> | undefined>(() => {
		if (!communityId.value) {
			return;
		}

		return communityCollection<Issue>(
			db,
			communityId.value,
			'issues',
		);
	});

	const filters = ref<IssuesFilters>({});
	function buildQuery() {
		if (!issuesCollection.value) {
			return;
		}

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
			issuesCollection.value,
			...constraints,
		);
	}

	async function fetchIssues(reset = false) {
		if (loading.value || (!hasMore.value && !reset)) {
			return;
		}

		const q = buildQuery();
		if (!q) {
			return;
		}

		loading.value = true;

		if (reset) {
			issues.value = [];
			lastDoc.value = undefined;
			hasMore.value = true;
		}
		const snap = await getDocs(q);
		const newIssues = snap.docs.map(mapFirestoreDoc<Issue>);
		if (snap.docs.length < PAGE_SIZE) {
			hasMore.value = false;
		}
		lastDoc.value = snap.docs.at(-1);
		issues.value.push(...newIssues);

		loading.value = false;
	}

	watch(communityId, (value) => {
		if (!value) {
			return;
		}

		void fetchIssues(true);
	});

	watch([filters, sortingField], () => void fetchIssues(true), { deep: true });

	return {
		issues,
		filters,
		sortingField,
		loading,
		hasMore,
		fetchIssues,
	};
}
