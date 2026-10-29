import type { Invitation, Role, User } from '@gobernansa/shared/domain/user.ts';
import type { WriteBatch } from 'firebase/firestore';
import type { MaybeRefOrGetter } from 'vue';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { roles } from '@gobernansa/shared/domain/user.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { arrayRemove, arrayUnion, collection, doc, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
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

// Changes in a community go to its activity log, the administrators' ('') have none
async function commit(communityId: string | undefined, summary: string, change: (batch: WriteBatch) => void) {
	const batch = writeBatch(db);
	change(batch);
	if (communityId) {
		logActivity(batch, communityId, { area: 'people', summary, link: `/communities/${communityId}/people` });
	}
	await batch.commit();
}

// Its id is the email in lowercase, as sign-in tokens have it. Fails when that email already has one
export async function invite({ email, name, role, communityId, communityIds }: Pick<Invitation, 'email' | 'name' | 'role' | 'communityId' | 'communityIds'>) {
	const id = email.trim().toLowerCase();
	await commit(communityId, `Invitó a ${name.trim()} como ${roles[role].label.toLowerCase()}`, batch => batch.set(doc(invitationsRef, id), {
		email: id,
		name: name.trim(),
		role,
		communityId,
		...(role === 'admin' ? { communityIds: communityIds ?? [] } : {}),
		invitedBy: auth.currentUser!.uid,
		invitedAt: serverTimestamp(),
	}));
}

export async function cancelInvitation(email: string, communityId?: string, name = email) {
	await commit(communityId, `Canceló la invitación de ${name}`, batch => batch.delete(doc(invitationsRef, email)));
}

export async function setRole(uid: string, role: Role, communityId?: string, name = '') {
	await commit(communityId, `Cambió el rol de ${name} a ${roles[role].label.toLowerCase()}`, batch => batch.update(doc(usersRef, uid), { role }));
}

// Their sign-in account stays, a new invitation gives them a profile again
export async function removePerson(uid: string, communityId?: string, name = '') {
	await commit(communityId, `Quitó a ${name} de la comunidad`, batch => batch.delete(doc(usersRef, uid)));
}

export async function setCommunityAssigned(uid: string, communityId: string, assigned: boolean, name = '') {
	await commit(communityId, `${assigned ? 'Asignó' : 'Desasignó'} la comunidad a ${name}`, batch => batch.update(doc(usersRef, uid), {
		communityIds: assigned ? arrayUnion(communityId) : arrayRemove(communityId),
	}));
}
