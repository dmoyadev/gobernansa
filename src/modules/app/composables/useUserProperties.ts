import { computed } from 'vue';
import { useCollection } from 'vuefire';
import { collection, getFirestore, query, where } from 'firebase/firestore';
import useAuth from './useAuth';
import { Datable } from '../../../utils/interfaces.ts';

export interface Property extends Datable  {
	id: string;
	name: string;
	type: 'home' | 'parking' | 'storage' | 'other';
	communityId: string;
	ownerUid: string;
}

export function useUserProperties() {
	const {user} = useAuth();
	const db = getFirestore();

	const userPropertiesRef = computed(() => {
		if (!user.value?.communityId) return null;

		return query(
			collection(db, 'properties'),
			where('communityId', '==', user.value.communityId),
			where('ownerUid', '==', user.value.id)
		);
	});

	const userProperties = useCollection<Property>(userPropertiesRef);

	return {
		userProperties
	};
}