import type { Datable } from '../utils/interfaces.ts';
import { doc, getFirestore } from 'firebase/firestore';
import { computed } from 'vue';
import { useDocument } from 'vuefire';
import useAuth from './useAuth.ts';

export interface Community extends Datable {
	name: string;
	address: string;
	constructionYear: number;
}

export function useUserCommunity() {
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
