import { DEFAULT_MONTHLY_VOTES, getVotingMonth } from '@gobernansa/shared/domain/issue.ts';
import { reportError } from '@gobernansa/shared/infrastructure/monitoring.ts';
import { collectionGroup, getCountFromServer, getDocs, getFirestore, query, where } from 'firebase/firestore';
import { computed, effectScope, ref, watch } from 'vue';
import { useCurrentUser } from 'vuefire';
import { useUserCommunity } from '@/modules/community/application/useUserCommunity.ts';
import { useUserProperties } from '@/modules/community/application/useUserProperties.ts';
import { communityCollection } from '@/shared/infrastructure/useFirestoreDocument.ts';
import { getAuthorKey } from './authorKey.ts';

// Counted again after this long, coming back home in between costs no reads
const STALE_AFTER_MS = 5 * 60_000;

let shared: ReturnType<typeof createUserActivity> | undefined;
let fetchedAt = 0;

/**
 * What the user has done in the community: issues reported, and votes used and left this month by the property they
 * have selected (properties vote, not people). Issues are only counted (one read each, whatever the number of documents);
 * votes are read, as few as the month's votes of their properties.
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

	const { userProperties, selectedProperty } = useUserProperties();
	// Only owners vote, with the property they have selected
	const votingProperty = selectedProperty;
	const canVoteAsOwner = computed(() => !!userProperties.value.length);

	// This month's votes of each of the user's properties
	const votesByProperty = ref<Record<string, number>>();
	const votesUsed = computed(() => votesByProperty.value && votingProperty.value ? votesByProperty.value[votingProperty.value.id] ?? 0 : undefined);
	const monthlyVotes = computed(() => userCommunity.value?.monthlyVotes ?? DEFAULT_MONTHLY_VOTES);
	// Unknown (undefined) while loading, without a property or if counting fails, voting isn't blocked then
	const votesLeft = computed(() => votesUsed.value === undefined ? undefined : Math.max(0, monthlyVotes.value - votesUsed.value));

	// Only equality filters, so Firestore merges the single-field indexes it already has
	async function fetchIssues(uid: string, communityId: string) {
		const mine = query(
			communityCollection(db, communityId, 'issues'),
			where('authorKey', '==', await getAuthorKey(uid)),
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

	// Votes live under each issue, so they are read across all of them (needs a collection group index on voterId and
	// votedAt) and told apart by property here: a few documents, never more than the month's votes of each property
	async function fetchVotes(uid: string) {
		const snap = await getDocs(query(
			collectionGroup(db, 'votes'),
			where('voterId', '==', uid),
			where('votedAt', '>=', getVotingMonth().start),
		));
		const counts: Record<string, number> = {};
		snap.docs.forEach((vote) => {
			const { propertyId } = vote.data() as { propertyId?: string };
			if (propertyId) {
				counts[propertyId] = (counts[propertyId] ?? 0) + 1;
			}
		});
		votesByProperty.value = counts;
	}

	// After voting, without counting again
	function addVotesUsed(propertyId: string, change: number) {
		if (votesByProperty.value) {
			votesByProperty.value[propertyId] = Math.max(0, (votesByProperty.value[propertyId] ?? 0) + change);
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
		results.forEach(result => result.status === 'rejected' && reportError(result.reason, { action: 'Contar las incidencias y los votos' }));
	}

	watch([() => user.value?.uid, () => userCommunity.value?.id], fetch, { immediate: true });

	return {
		issues,
		votingProperty,
		canVoteAsOwner,
		votesUsed,
		monthlyVotes,
		votesLeft,
		addVotesUsed,
		fetch,
	};
}
