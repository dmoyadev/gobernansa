import type { Ref } from 'vue';
import type { Issue } from '../interfaces/issue';
import { getFirestore } from 'firebase/firestore';
import { computed, ref } from 'vue';
import { communityDoc, useFirestoreDocument } from './useFirestoreDocument.ts';
import { useUserCommunity } from './useUserCommunity.ts';

export function useIssue(issueId: string | Ref<string | undefined>) {
	const { userCommunity } = useUserCommunity();
	const db = getFirestore();
	const id = ref(issueId);

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
