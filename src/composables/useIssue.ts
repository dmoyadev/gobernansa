import type { MaybeRefOrGetter } from 'vue';
import type { Issue } from '../interfaces/issue';
import { getFirestore } from 'firebase/firestore';
import { computed, toValue } from 'vue';
import { communityDoc, useFirestoreDocument } from './useFirestoreDocument.ts';
import { useUserCommunity } from './useUserCommunity.ts';

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

	return useFirestoreDocument<Issue>({ path: issueRef });
}
