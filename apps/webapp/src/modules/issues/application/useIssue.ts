import type { Issue } from '@gobernansa/shared/domain/issue.ts';
import type { MaybeRefOrGetter } from 'vue';
import { getFirestore } from 'firebase/firestore';
import { computed, toValue } from 'vue';
import { communityDoc, useFirestoreDocument } from '@/app/infrastructure/useFirestoreDocument.ts';
import { useUserCommunity } from '@/modules/community/application/useUserCommunity.ts';

export function useIssue(issueId: MaybeRefOrGetter<string | undefined>) {
	const { userCommunity } = useUserCommunity();
	const db = getFirestore();
	const id = computed(() => toValue(issueId));

	const issueRef = computed(() => {
		if (!userCommunity.value?.id || !id.value) {
			return;
		}

		return communityDoc(
			db,
			userCommunity.value.id,
			'issues',
			id.value,
		);
	});

	return useFirestoreDocument<Issue>({
		path: issueRef,
		filter: issue => !issue.deletedAt,
	});
}
