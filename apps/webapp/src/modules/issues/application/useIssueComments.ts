import type { Issue, IssueComment } from '@gobernansa/shared/domain/issue.ts';
import type { Ref } from 'vue';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { managesCommunity } from '@gobernansa/shared/domain/user.ts';
import { collection, doc, getFirestore, increment, orderBy, query, serverTimestamp, writeBatch } from 'firebase/firestore';
import { computed, watch } from 'vue';
import { useCollection } from 'vuefire';
import { useUserCommunity } from '@/modules/community/application/useUserCommunity.ts';
import { communityDoc } from '@/shared/infrastructure/useFirestoreDocument.ts';
import { updateListedIssue } from './useIssues.ts';

/**
 * The conversation of an issue, live while it's open. Status changes are listed too, as its history.
 */
export function useIssueComments(issue: Ref<Issue | undefined>) {
	const db = getFirestore();
	const { user } = useAuth();
	const { userCommunity } = useUserCommunity();

	// From the user's community, older issues don't have communityId
	const issueRef = computed(() => issue.value && userCommunity.value
		? communityDoc(db, userCommunity.value.id, 'issues', issue.value.id)
		: undefined);

	// shortcut: ordered by date only (no composite index needed) and removed ones are left out here, paginate if issues get hundreds of comments
	const commentsRef = computed(() => issueRef.value ? query(collection(issueRef.value, 'comments'), orderBy('createdAt')) : null);
	const allComments = useCollection<IssueComment>(commentsRef, { ssrKey: 'issueComments' });
	// Hidden ones are moderated from the admin platform, nobody sees them here
	const comments = computed(() => allComments.value.filter(comment => !comment.deletedAt && !comment.hiddenAt));
	// The listener fails silently otherwise, e.g. when the security rules don't allow it
	// eslint-disable-next-line no-console
	watch(allComments.error, error => error && console.error(error));

	function setCommentsCount(change: number) {
		const commentsCount = Math.max(0, (issue.value!.commentsCount ?? 0) + change);
		Object.assign(issue.value!, { commentsCount });
		updateListedIssue(issue.value!.id, { commentsCount });
	}

	async function addComment(message: string) {
		if (!issueRef.value || !user.value) {
			throw new Error('The issue and the user must be loaded first');
		}

		const batch = writeBatch(db);
		batch.set(doc(collection(issueRef.value, 'comments')), {
			type: 'message',
			message,
			authorId: user.value.id,
			authorName: user.value.name || '',
			...(managesCommunity(user.value, user.value.communityId) ? { authorRole: user.value.role } : {}),
			createdAt: serverTimestamp(),
			updatedAt: serverTimestamp(),
			createdBy: user.value.id,
			updatedBy: user.value.id,
			deletedAt: null,
		});
		batch.update(issueRef.value, { commentsCount: increment(1) });
		await batch.commit();
		setCommentsCount(1);
	}

	// Only their own, kept but hidden like everything else removed
	async function deleteComment(comment: IssueComment) {
		if (!issueRef.value || !user.value) {
			throw new Error('The issue and the user must be loaded first');
		}

		const batch = writeBatch(db);
		batch.update(doc(issueRef.value, 'comments', comment.id), {
			deletedAt: serverTimestamp(),
			deletedBy: user.value.id,
		});
		batch.update(issueRef.value, { commentsCount: increment(-1) });
		await batch.commit();
		setCommentsCount(-1);
	}

	return {
		comments,
		addComment,
		deleteComment,
	};
}
