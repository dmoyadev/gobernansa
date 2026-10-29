import type { Invitation, Role, User } from '@gobernansa/shared/domain/user.ts';
import type { MaybeRefOrGetter } from 'vue';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { arrayRemove, arrayUnion, collection, deleteDoc, doc, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { computed, toValue } from 'vue';
import { useCollection } from 'vuefire';

const usersRef = collection(db, 'users');
const invitationsRef = collection(db, 'invitations');

// A community's accounts and pending invitations or, with communityId '', the administrators'. Live, so each change shows up as it's made
export function usePeople(communityId: string) {
	const people = useCollection<User>(communityId
		? query(usersRef, where('communityId', '==', communityId))
		: query(usersRef, where('role', 'in', ['admin', 'superadmin'])));
	const invitations = useCollection<Invitation>(query(invitationsRef, where('communityId', '==', communityId)));

	return {
		people,
		invitations,
		loading: people.pending,
		error: computed(() => people.error.value ?? invitations.error.value),
	};
}

// Who a neighbour can ask for access: the managers and administrators of their community. Nobody without one
export function useCommunityManagers(communityId: MaybeRefOrGetter<string | undefined>) {
	const managers = useCollection<User>(computed(() => {
		const id = toValue(communityId);
		return id ? query(usersRef, where('communityId', '==', id), where('role', '==', 'manager')) : null;
	}));
	// Only administrators are assigned communities
	const admins = useCollection<User>(computed(() => {
		const id = toValue(communityId);
		return id ? query(usersRef, where('communityIds', 'array-contains', id)) : null;
	}));

	return computed(() => [...managers.value, ...admins.value.filter(person => person.role === 'admin')]);
}

// Its id is the email in lowercase, as sign-in tokens have it. Fails when that email already has one
export async function invite({ email, name, role, communityId, communityIds }: Pick<Invitation, 'email' | 'name' | 'role' | 'communityId' | 'communityIds'>) {
	const id = email.trim().toLowerCase();
	await setDoc(doc(invitationsRef, id), {
		email: id,
		name: name.trim(),
		role,
		communityId,
		...(role === 'admin' ? { communityIds: communityIds ?? [] } : {}),
		invitedBy: auth.currentUser!.uid,
		invitedAt: serverTimestamp(),
	});
}

export async function cancelInvitation(email: string) {
	await deleteDoc(doc(invitationsRef, email));
}

export async function setRole(uid: string, role: Role) {
	await updateDoc(doc(usersRef, uid), { role });
}

// Their sign-in account stays, a new invitation gives them a profile again
export async function removePerson(uid: string) {
	await deleteDoc(doc(usersRef, uid));
}

export async function setCommunityAssigned(uid: string, communityId: string, assigned: boolean) {
	await updateDoc(doc(usersRef, uid), { communityIds: assigned ? arrayUnion(communityId) : arrayRemove(communityId) });
}
