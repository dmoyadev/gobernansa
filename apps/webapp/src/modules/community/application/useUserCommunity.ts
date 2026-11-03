import type { Community } from '@gobernansa/shared/domain/community.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { doc, getFirestore } from 'firebase/firestore';
import { computed, effectScope } from 'vue';
import { useDocument } from 'vuefire';

// Shared by every caller so the community document is listened to only once
let shared: ReturnType<typeof createUserCommunity> | undefined;

export function useUserCommunity() {
	shared ??= effectScope(true).run(createUserCommunity)!;
	return shared;
}

function createUserCommunity() {
	const { user } = useAuth();
	const db = getFirestore();

	// The id first: the profile is a new object on each change to it, and a new reference would listen again
	const communityId = computed(() => user.value?.communityId);
	const communityRef = computed(() => communityId.value ? doc(db, 'communities', communityId.value) : null);

	const userCommunity = useDocument<Community>(communityRef);

	return {
		userCommunity,
	};
}
