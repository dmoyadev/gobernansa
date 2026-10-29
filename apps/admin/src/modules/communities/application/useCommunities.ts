import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { CommunityForm } from '../domain/communityForm.ts';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, doc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { computed, ref, watch } from 'vue';
import { useCollection } from 'vuefire';
import { fromCommunityForm } from '../domain/communityForm.ts';

const communitiesRef = collection(db, 'communities');

// The ones the user manages. Reads each community once per visit
export function useCommunities() {
	const { user } = useAuth();
	// Rules aren't filters: only gobernança's team can query the whole collection, live so one saved in another tab shows up
	const all = useCollection<Community>(computed(() => user.value?.role === 'superadmin' ? communitiesRef : null));
	// The rest load theirs by id, again whenever their assigned ones change
	const managed = ref<Community[]>([]);
	const managedLoading = ref(true);
	const managedError = ref<Error>();
	watch(user, async (profile) => {
		if (!profile || profile.role === 'superadmin') {
			return;
		}

		const ids = profile.role === 'admin' ? profile.communityIds ?? [] : [profile.communityId];
		try {
			const communities = await Promise.all(ids.filter(Boolean).map(async (id) => {
				const community = await loadCommunity(id);
				return community && { ...community, id };
			}));
			// Removed ones may still be assigned
			managed.value = communities.filter((community): community is Community => !!community);
		} catch (e) {
			managedError.value = e as Error;
		} finally {
			managedLoading.value = false;
		}
	}, { immediate: true });

	const isSuperadmin = computed(() => user.value?.role === 'superadmin');
	// Sorted here and not by the query, which would leave out the ones without a name
	const sortedCommunities = computed(() => [...(isSuperadmin.value ? all.value : managed.value)].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'es')));

	return {
		communities: sortedCommunities,
		loading: computed(() => isSuperadmin.value ? all.pending.value : managedLoading.value),
		error: computed(() => isSuperadmin.value ? all.error.value : managedError.value),
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
	const batch = writeBatch(db);
	batch.set(communityRef, {
		...fromCommunityForm(form),
		updatedAt: now,
		updatedBy: uid,
		...(id ? {} : { createdAt: now, createdBy: uid }),
	}, { merge: true });
	logActivity(batch, communityRef.id, {
		area: 'community',
		summary: id ? `Editó los datos de la comunidad` : `Creó la comunidad «${form.name.trim()}»`,
		link: `/communities/${communityRef.id}`,
	});
	await batch.commit();

	return communityRef.id;
}
