import type { Ref } from 'vue';
import type { Issue, IssueStatus, IssueVote } from '../domain/issue.ts';
import { collection, doc, getDoc, getFirestore, increment, runTransaction, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { computed, ref, watch } from 'vue';
import useAuth from '@/modules/auth/application/useAuth.ts';
import { useUserCommunity } from '@/modules/community/application/useUserCommunity.ts';
import { communityDoc } from '@/shared/infrastructure/useFirestoreDocument.ts';
import { getVotingMonth } from '../domain/issue.ts';
import { updateListedIssue } from './useIssues.ts';
import { invalidateUserActivity, useUserActivity } from './useUserActivity.ts';

/**
 * What the user can do on an issue: vote it and, depending on who they are, change its status or remove it.
 * Without a backend, the counters of the issue are kept up to date along with each vote, in the same write.
 */
export function useIssueActions(issue: Ref<Issue | undefined>) {
	const db = getFirestore();
	const { user } = useAuth();
	const { userCommunity } = useUserCommunity();

	const isManager = computed(() => user.value?.role === 'admin' || user.value?.role === 'manager');
	const isAuthor = computed(() => !!user.value && issue.value?.createdBy === user.value.id);

	function getIssueRef() {
		if (!issue.value || !user.value || !userCommunity.value) {
			throw new Error('The issue, the user and their community must be loaded first');
		}

		// From the user's community, older issues don't have communityId
		return {
			issueRef: communityDoc(db, userCommunity.value.id, 'issues', issue.value.id),
			uid: user.value.id,
		};
	}

	function getVoteRef() {
		const { issueRef, uid } = getIssueRef();
		return doc(issueRef, 'votes', `${issueRef.id}_${uid}`);
	}

	/* Votes, a few each month */
	const { votesLeft, monthlyVotes, addVotesUsed } = useUserActivity();
	const myVote = ref<IssueVote['score'] | 0>(0);
	// Cast this month, so switching or taking it back doesn't use another of this month's votes
	const myVoteThisMonth = ref(false);
	const voting = ref(false);

	function isFromThisMonth(vote?: IssueVote) {
		return !!vote?.votedAt && vote.votedAt.toMillis() >= getVotingMonth().start.getTime();
	}

	watch(() => !!issue.value && !!user.value && !!userCommunity.value, async (ready) => {
		if (ready) {
			const vote = (await getDoc(getVoteRef())).data() as IssueVote | undefined;
			myVote.value = vote?.score ?? 0;
			myVoteThisMonth.value = isFromThisMonth(vote);
		}
	}, { immediate: true });

	// A new vote, or switching one from a past month, uses one of this month's votes
	function canVote(score: IssueVote['score']) {
		return score === myVote.value || myVoteThisMonth.value || votesLeft.value !== 0;
	}

	// Voting the same again takes the vote back, and gives this month's vote back if it was cast this month
	async function vote(score: IssueVote['score']) {
		const { issueRef, uid } = getIssueRef();
		const voteRef = getVoteRef();
		voting.value = true;

		try {
			const { previous, next, used } = await runTransaction(db, async (transaction) => {
				const previousVote = (await transaction.get(voteRef)).data() as IssueVote | undefined;
				const previous = previousVote?.score ?? 0;
				const next = previous === score ? 0 : score;
				const used = Number(!!next) - Number(isFromThisMonth(previousVote));
				if (used > 0 && votesLeft.value === 0) {
					throw new Error('No votes left this month');
				}

				if (next) {
					transaction.set(voteRef, { voterId: uid, score: next, votedAt: serverTimestamp() });
				} else {
					transaction.delete(voteRef);
				}
				transaction.update(issueRef, {
					votesScore: increment(next - previous),
					votesCount: increment(Number(!!next) - Number(!!previous)),
				});

				return { previous, next, used } as const;
			});

			myVote.value = next;
			myVoteThisMonth.value = !!next;
			addVotesUsed(used);
			const changes = {
				votesScore: issue.value!.votesScore + next - previous,
				votesCount: issue.value!.votesCount + Number(!!next) - Number(!!previous),
			};
			Object.assign(issue.value!, changes);
			updateListedIssue(issue.value!.id, changes);
		} finally {
			voting.value = false;
		}
	}

	/* Status, only for the administration */
	async function changeStatus(status: IssueStatus) {
		const { issueRef, uid } = getIssueRef();
		const batch = writeBatch(db);
		batch.update(issueRef, {
			status,
			updatedAt: serverTimestamp(),
			updatedBy: uid,
		});
		// Listed with the comments, so everyone sees when and who changed it
		batch.set(doc(collection(issueRef, 'comments')), {
			type: 'status',
			status,
			message: '',
			authorId: uid,
			authorName: user.value!.name || '',
			authorRole: user.value!.role,
			createdAt: serverTimestamp(),
			updatedAt: serverTimestamp(),
			createdBy: uid,
			updatedBy: uid,
			deletedAt: null,
		});
		await batch.commit();

		Object.assign(issue.value!, { status });
		updateListedIssue(issue.value!.id, { status });
		invalidateUserActivity();
	}

	/* Removal, for whoever reported it and the administration */
	async function deleteIssue() {
		const { issueRef, uid } = getIssueRef();
		await updateDoc(issueRef, { deletedAt: serverTimestamp(), deletedBy: uid });

		updateListedIssue(issueRef.id, null);
		invalidateUserActivity();
	}

	return {
		isManager,
		isAuthor,
		myVote,
		voting,
		votesLeft,
		monthlyVotes,
		canVote,
		vote,
		changeStatus,
		deleteIssue,
	};
}
