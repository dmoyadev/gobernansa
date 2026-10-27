import type { Datable } from '../utils/interfaces.ts';
import { doc, getFirestore } from 'firebase/firestore';
import { computed, effectScope } from 'vue';
import { useDocument } from 'vuefire';
import useAuth from './useAuth.ts';

export interface Community extends Datable {
	id: string;
	name: string;
	address: string;
	constructionYear: number;
}

// Shared by every caller so the community document is listened to only once
let shared: ReturnType<typeof createUserCommunity> | undefined;

export function useUserCommunity() {
	shared ??= effectScope(true).run(createUserCommunity)!;
	return shared;
}

function createUserCommunity() {
	const { user } = useAuth();
	const db = getFirestore();

	const communityRef = computed(() => {
		if (!user.value?.communityId) {
			return null;
		}
		return doc(db, 'communities', user.value.communityId);
	});

	const userCommunity = useDocument<Community>(communityRef);

	return {
		userCommunity,
	};
}
