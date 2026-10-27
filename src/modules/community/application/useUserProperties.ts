import type { Property } from '../domain/property.ts';
import { collection, getFirestore, query, where } from 'firebase/firestore';
import { computed, ref, watch } from 'vue';
import { useCollection } from 'vuefire';
import useAuth from '@/modules/auth/application/useAuth.ts';

const selectedProperty = ref<Property>();

export function useUserProperties() {
	const { user } = useAuth();
	const db = getFirestore();

	const userPropertiesRef = computed(() => {
		if (!user.value?.communityId) {
			return null;
		}

		return query(
			collection(db, 'properties'),
			where('communityId', '==', user.value.communityId),
			where('ownerUid', '==', user.value.id),
		);
	});

	const userProperties = useCollection<Property>(userPropertiesRef, { ssrKey: 'userProperties' });
	watch(userProperties, (properties) => {
		if (!properties.length) {
			selectedProperty.value = undefined;
			return;
		}

		selectedProperty.value = properties[0];
	});

	return {
		userProperties,
		selectedProperty,
	};
}
