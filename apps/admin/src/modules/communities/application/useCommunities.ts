import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { CommunityForm } from '../domain/communityForm.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { computed } from 'vue';
import { useCollection } from 'vuefire';
import { fromCommunityForm } from '../domain/communityForm.ts';

const communitiesRef = collection(db, 'communities');

// Live, so a community saved in another tab shows up. Reads each community once per visit, then only the changes
export function useCommunities() {
	const communities = useCollection<Community>(communitiesRef);
	// Sorted here and not by the query, which would leave out the ones without a name
	const sortedCommunities = computed(() => [...communities.value].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'es')));

	return {
		communities: sortedCommunities,
		loading: communities.pending,
		error: communities.error,
	};
}

// Once, so nothing changes under the form while it's being edited
export async function loadCommunity(id: string) {
	const snapshot = await getDoc(doc(communitiesRef, id));
	return snapshot.exists() ? snapshot.data() as Community : undefined;
}

// Creates the community when there's no id. Returns its id
export async function saveCommunity(id: string | undefined, form: CommunityForm) {
	const uid = auth.currentUser?.uid;
	if (!uid) {
		throw new Error('The admin must be signed in to save a community');
	}

	const communityRef = id ? doc(communitiesRef, id) : doc(communitiesRef);
	const now = serverTimestamp();
	await setDoc(communityRef, {
		...fromCommunityForm(form),
		updatedAt: now,
		updatedBy: uid,
		...(id ? {} : { createdAt: now, createdBy: uid }),
	}, { merge: true });

	return communityRef.id;
}
