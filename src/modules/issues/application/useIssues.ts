import type { CollectionReference, DocumentData, QueryConstraint } from 'firebase/firestore';
import type { Issue, IssuesFilters, IssueSortingField } from '../domain/issue.ts';
import { addDoc, getDocs, getFirestore, limit, orderBy, query, serverTimestamp, startAfter, where } from 'firebase/firestore';
import { computed, effectScope, ref, watch } from 'vue';
import { useCurrentUser } from 'vuefire';
import { useUserCommunity } from '@/modules/community/application/useUserCommunity.ts';
import { communityCollection, mapFirestoreDoc } from '@/shared/infrastructure/useFirestoreDocument.ts';
import { invalidateUserActivity } from './useUserActivity.ts';

const PAGE_SIZE = 10;
// shortcut: other neighbours' changes only show after this long (or a reload), switch to a realtime listener if that's too slow
const STALE_AFTER_MS = 5 * 60_000;

// Shared so the list, its filters and pages survive leaving the page and coming back:
// coming back from an issue shows it straight away (no reads) for the photo to morph into
let shared: ReturnType<typeof createIssues> | undefined;
let fetchedAt = 0;

// The issue last opened from the list, whose photo morphs into the detail page and back
export const openedIssueId = ref<string>();
// Outside the list so other pages can open it filtered (e.g. by the user's issues) without loading it unfiltered first
export const issuesFilters = ref<IssuesFilters>({});

export function useIssues() {
	if (shared && Date.now() - fetchedAt > STALE_AFTER_MS) {
		void shared.fetchIssues(true);
	}

	shared ??= effectScope(true).run(createIssues)!;
	return shared;
}

export function useCreateIssue() {
	const db = getFirestore();
	const user = useCurrentUser();
	const { userCommunity } = useUserCommunity();

	async function createIssue(issue: Pick<Issue, 'title' | 'description' | 'category' | 'location'>) {
		const communityId = userCommunity.value?.id;
		if (!communityId || !user.value) {
			throw new Error('The user has no community to report the issue to');
		}

		const { id } = await addDoc(communityCollection(db, communityId, 'issues'), {
			...issue,
			status: 'open',
			communityId,
			votesScore: 0,
			votesCount: 0,
			createdBy: user.value.uid,
			updatedBy: user.value.uid,
			createdAt: serverTimestamp(),
			updatedAt: serverTimestamp(),
			// The list only shows issues whose deletedAt is null, a missing field wouldn't match
			deletedAt: null,
		});

		// The list and the user's stats fetch again next time they're shown, so the new issue shows up
		fetchedAt = 0;
		invalidateUserActivity();
		return id;
	}

	return { createIssue };
}

function createIssues() {
	const db = getFirestore();

	const { userCommunity } = useUserCommunity();
	const communityId = computed(() => userCommunity.value?.id);

	const issues = ref<Issue[]>([]);
	const sortingField = ref<IssueSortingField>('createdAt');
	const loading = ref(false);
	const lastDoc = ref<DocumentData>();
	const hasMore = ref(true);
	const error = ref<unknown>();

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

	const filters = issuesFilters;
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
		if (filters.value.createdBy) {
			constraints.push(where('createdBy', '==', filters.value.createdBy));
		}
		if (lastDoc.value) {
			constraints.push(startAfter(lastDoc.value));
		}

		return query(
			issuesCollection.value,
			...constraints,
		);
	}

	let lastRequestId = 0;
	async function fetchIssues(reset = false) {
		if (!reset && (loading.value || !hasMore.value)) {
			return;
		}

		// Reset before building the query so it doesn't start after the previous page
		if (reset) {
			issues.value = [];
			lastDoc.value = undefined;
			hasMore.value = true;
		}

		const q = buildQuery();
		if (!q) {
			return;
		}

		const requestId = ++lastRequestId;
		loading.value = true;
		error.value = undefined;
		if (reset) {
			fetchedAt = Date.now();
		}

		try {
			const snap = await getDocs(q);
			// A reset started while this request was loading, so its results are stale
			if (requestId !== lastRequestId) {
				return;
			}

			const newIssues = snap.docs.map(mapFirestoreDoc<Issue>);
			if (snap.docs.length < PAGE_SIZE) {
				hasMore.value = false;
			}
			lastDoc.value = snap.docs.at(-1);
			issues.value.push(...newIssues);
		} catch (e) {
			// e.g. a filter whose index is missing, Firestore logs the link to create it
			// eslint-disable-next-line no-console
			console.error(e);
			if (requestId === lastRequestId) {
				error.value = e;
				hasMore.value = false;
			}
		} finally {
			if (requestId === lastRequestId) {
				loading.value = false;
			}
		}
	}

	watch(communityId, (value) => {
		if (!value) {
			return;
		}

		void fetchIssues(true);
	}, { immediate: true });

	watch([filters, sortingField], () => void fetchIssues(true), { deep: true });

	return {
		issues,
		filters,
		sortingField,
		loading,
		hasMore,
		error,
		fetchIssues,
	};
}
