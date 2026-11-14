import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { CommunityForm } from '../domain/communityForm.ts';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { officeOf } from '@gobernansa/shared/domain/user.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { arrayUnion, collection, doc, getCountFromServer, getDoc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { computed, ref, watch } from 'vue';
import { useCollection } from 'vuefire';
import { onRevalidate } from '@/app/ux/navigation.ts';
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
	async function loadManaged(profile = user.value) {
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
			managedError.value = undefined;
		} catch (e) {
			// A failed reread keeps the ones shown
			if (!managed.value.length) {
				managedError.value = e as Error;
			}
		} finally {
			managedLoading.value = false;
		}
	}
	watch(user, loadManaged, { immediate: true });
	// Coming back to a page, they're read again while the last ones stay
	onRevalidate(loadManaged);

	const isSuperadmin = computed(() => user.value?.role === 'superadmin');
	// Sorted here and not by the query, which would leave out the ones without a name
	const sortedCommunities = computed(() => [...(isSuperadmin.value ? all.value : managed.value)].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'es')));

	return {
		// Archived ones (B4) are left out of every list and count
		communities: computed(() => sortedCommunities.value.filter(community => !community.archivedAt)),
		archived: computed(() => sortedCommunities.value.filter(community => community.archivedAt)),
		loading: computed(() => isSuperadmin.value ? all.pending.value : managedLoading.value),
		error: computed(() => isSuperadmin.value ? all.error.value : managedError.value),
	};
}

// Once, so nothing changes under the form while it's being edited
export async function loadCommunity(id: string) {
	const snapshot = await getDoc(doc(communitiesRef, id));
	return snapshot.exists() ? snapshot.data() as Community : undefined;
}

// Out of the office's lists and counts, or back in them (B4). Nothing is removed, it can still be exported
export async function setCommunityArchived(id: string, name: string, archived: boolean) {
	const uid = auth.currentUser!.uid;
	const communityRef = doc(communitiesRef, id);
	const batch = writeBatch(db);
	batch.update(communityRef, { archivedAt: archived ? serverTimestamp() : null, updatedAt: serverTimestamp(), updatedBy: uid });
	logActivity(batch, id, { area: 'community', summary: `${archived ? 'Archivó' : 'Recuperó'} la comunidad «${name}»`, link: `/communities/${id}` });
	await batch.commit();
}

// An aggregation is a single read, whatever the size of the community. Those whose profile is another community's, with a
// property here too (B10), are neighbours here whatever their role at home
export async function loadNeighbourCount(id: string) {
	const users = collection(db, 'users');
	const [home, others] = await Promise.all([
		getCountFromServer(query(users, where('communityId', '==', id), where('role', '==', 'user'))),
		getCountFromServer(query(users, where('otherCommunityIds', 'array-contains', id))),
	]);
	return home.data().count + others.data().count;
}

/**
 * Creates a community with its activity entry. gobernança's team creates it unassigned; an office (B4) marks it as its
 * own and assigns it to all its members in the same batch, the activity going after, once the rules see it as theirs
 */
export async function createCommunity(id: string, data: Record<string, unknown>, summary: string) {
	const uid = auth.currentUser?.uid;
	const { user } = useAuth();
	if (!uid || !user.value) {
		throw new Error('The admin must be signed in to create a community');
	}

	const now = serverTimestamp();
	const communityRef = doc(communitiesRef, id);
	// Merged, as the form clears the fields left empty (deleteField)
	const community = { ...data, createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid };
	const activity = { area: 'community' as const, summary, link: `/communities/${id}` };
	const batch = writeBatch(db);
	if (user.value.role === 'superadmin') {
		batch.set(communityRef, community, { merge: true });
		logActivity(batch, id, activity);
		return batch.commit();
	}

	const office = officeOf(user.value);
	const staff = await getDocs(query(collection(db, 'users'), where('officeId', '==', office), where('role', '==', 'admin')));
	batch.set(communityRef, { ...community, officeId: office }, { merge: true });
	for (const member of [office, ...staff.docs.map(profile => profile.id)]) {
		batch.update(doc(db, 'users', member), { communityIds: arrayUnion(id) });
	}
	await batch.commit();
	const log = writeBatch(db);
	logActivity(log, id, activity);
	await log.commit();
}

// Creates the community when `created`, with the id made when its form opened (newId), so sending it twice writes it once
export async function saveCommunity(id: string, form: CommunityForm, created = false) {
	const uid = auth.currentUser?.uid;
	if (!uid) {
		throw new Error('The admin must be signed in to save a community');
	}
	if (created) {
		return createCommunity(id, fromCommunityForm(form), `Creó la comunidad «${form.name.trim()}»`);
	}

	const communityRef = doc(communitiesRef, id);
	const batch = writeBatch(db);
	batch.set(communityRef, { ...fromCommunityForm(form), updatedAt: serverTimestamp(), updatedBy: uid }, { merge: true });
	logActivity(batch, communityRef.id, { area: 'community', summary: 'Editó los datos de la comunidad', link: `/communities/${communityRef.id}` });
	await batch.commit();
}
