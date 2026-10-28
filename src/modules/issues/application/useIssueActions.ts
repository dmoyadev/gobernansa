import type { Ref } from 'vue';
import type { Issue, IssueStatus, IssueVote } from '../domain/issue.ts';
import { collection, doc, getDoc, getFirestore, increment, runTransaction, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { computed, ref, watch } from 'vue';
import useAuth from '@/modules/auth/application/useAuth.ts';
import { useUserCommunity } from '@/modules/community/application/useUserCommunity.ts';
import { communityDoc } from '@/shared/infrastructure/useFirestoreDocument.ts';
import { updateListedIssue } from './useIssues.ts';
import { invalidateUserActivity } from './useUserActivity.ts';

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

	/* Votes */
	const myVote = ref<IssueVote['score'] | 0>(0);
	const voting = ref(false);

	watch(() => !!issue.value && !!user.value && !!userCommunity.value, async (ready) => {
		if (ready) {
			const snap = await getDoc(getVoteRef());
			myVote.value = (snap.data()?.score as IssueVote['score'] | undefined) ?? 0;
		}
	}, { immediate: true });

	// Voting the same again takes the vote back
	async function vote(score: IssueVote['score']) {
		const { issueRef, uid } = getIssueRef();
		const voteRef = getVoteRef();
		voting.value = true;

		try {
			const { previous, next } = await runTransaction(db, async (transaction) => {
				const snap = await transaction.get(voteRef);
				const previous = (snap.data()?.score as IssueVote['score'] | undefined) ?? 0;
				const next = previous === score ? 0 : score;

				if (next) {
					transaction.set(voteRef, { voterId: uid, score: next });
				} else {
					transaction.delete(voteRef);
				}
				transaction.update(issueRef, {
					votesScore: increment(next - previous),
					votesCount: increment(Number(!!next) - Number(!!previous)),
				});

				return { previous, next } as const;
			});

			myVote.value = next;
			const changes = {
				votesScore: issue.value!.votesScore + next - previous,
				votesCount: issue.value!.votesCount + Number(!!next) - Number(!!previous),
			};
			Object.assign(issue.value!, changes);
			updateListedIssue(issue.value!.id, changes);
			invalidateUserActivity();
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
		vote,
		changeStatus,
		deleteIssue,
	};
}
