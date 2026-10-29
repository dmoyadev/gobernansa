import { DEFAULT_MONTHLY_VOTES, getVotingMonth } from '@gobernansa/shared/domain/issue.ts';
import { collectionGroup, getCountFromServer, getFirestore, query, where } from 'firebase/firestore';
import { computed, effectScope, ref, watch } from 'vue';
import { useCurrentUser } from 'vuefire';
import { useUserCommunity } from '@/modules/community/application/useUserCommunity.ts';
import { communityCollection } from '@/shared/infrastructure/useFirestoreDocument.ts';

// Counted again after this long, coming back home in between costs no reads
const STALE_AFTER_MS = 5 * 60_000;

let shared: ReturnType<typeof createUserActivity> | undefined;
let fetchedAt = 0;

/**
 * What the user has done in the community: issues reported, and votes used and left this month.
 * Only counts (one read each, whatever the number of documents), never the documents themselves.
 */
export function useUserActivity() {
	if (shared && Date.now() - fetchedAt > STALE_AFTER_MS) {
		void shared.fetch();
	}

	shared ??= effectScope(true).run(createUserActivity)!;
	return shared;
}

// Counts again next time, e.g. after reporting an issue
export function invalidateUserActivity() {
	fetchedAt = 0;
}

function createUserActivity() {
	const db = getFirestore();
	const user = useCurrentUser();
	const { userCommunity } = useUserCommunity();

	const issues = ref<{ total: number; active: number }>();

	const votesUsed = ref<number>();
	const monthlyVotes = computed(() => userCommunity.value?.monthlyVotes ?? DEFAULT_MONTHLY_VOTES);
	// Unknown (undefined) while loading or if counting fails, voting isn't blocked then
	const votesLeft = computed(() => votesUsed.value === undefined ? undefined : Math.max(0, monthlyVotes.value - votesUsed.value));

	// Only equality filters, so Firestore merges the single-field indexes it already has
	async function fetchIssues(uid: string, communityId: string) {
		const mine = query(
			communityCollection(db, communityId, 'issues'),
			where('createdBy', '==', uid),
			where('deletedAt', '==', null),
		);
		const [total, open, inProgress] = await Promise.all([
			getCountFromServer(mine),
			getCountFromServer(query(mine, where('status', '==', 'open'))),
			getCountFromServer(query(mine, where('status', '==', 'in_progress'))),
		]);
		issues.value = {
			total: total.data().count,
			active: open.data().count + inProgress.data().count,
		};
	}

	// Votes live under each issue, so they are counted across all of them (needs a collection group index on voterId and votedAt)
	async function fetchVotes(uid: string) {
		const snap = await getCountFromServer(query(
			collectionGroup(db, 'votes'),
			where('voterId', '==', uid),
			where('votedAt', '>=', getVotingMonth().start),
		));
		votesUsed.value = snap.data().count;
	}

	// After voting, without counting again
	function addVotesUsed(change: number) {
		if (votesUsed.value !== undefined) {
			votesUsed.value = Math.max(0, votesUsed.value + change);
		}
	}

	async function fetch() {
		const uid = user.value?.uid;
		const communityId = userCommunity.value?.id;
		if (!uid || !communityId) {
			return;
		}

		fetchedAt = Date.now();
		// Each one fails on its own, e.g. while its index is missing, and its stat shows empty
		const results = await Promise.allSettled([fetchIssues(uid, communityId), fetchVotes(uid)]);
		// eslint-disable-next-line no-console
		results.forEach(result => result.status === 'rejected' && console.error(result.reason));
	}

	watch([() => user.value?.uid, () => userCommunity.value?.id], fetch, { immediate: true });

	return {
		issues,
		votesUsed,
		monthlyVotes,
		votesLeft,
		addVotesUsed,
		fetch,
	};
}
