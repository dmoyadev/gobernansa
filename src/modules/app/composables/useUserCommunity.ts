import { computed } from 'vue';
import { useDocument } from 'vuefire';
import { doc, getFirestore } from 'firebase/firestore';
import useAuth from './useAuth';
import { Datable } from '../../../utils/interfaces.ts';

export interface Community extends Datable {
	name: string;
	address: string;
}

export function useUserCommunity() {
	const { user } = useAuth();
	const db = getFirestore();

	const communityRef = computed(() => {
		if (!user.value?.communityId) return null;
		return doc(db, 'communities', user.value.communityId);
	});

	const userCommunity = useDocument<Community>(communityRef);

	return {
		userCommunity
	};
}