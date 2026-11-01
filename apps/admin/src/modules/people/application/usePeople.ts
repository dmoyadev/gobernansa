import type { Invitation, Role, User } from '@gobernansa/shared/domain/user.ts';
import type { WriteBatch } from 'firebase/firestore';
import type { MaybeRefOrGetter } from 'vue';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { roles } from '@gobernansa/shared/domain/user.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { arrayRemove, arrayUnion, collection, doc, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { computed, toValue } from 'vue';
import { useCollection } from 'vuefire';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { invitationMail, queueMail } from '@/modules/mail/application/mail.ts';

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

// Each community's name, read once per session, so inviting a whole census doesn't read it once per owner
const communityNames = new Map<string, Promise<string>>();
async function communityName(communityId: string) {
	if (!communityNames.has(communityId)) {
		communityNames.set(communityId, loadCommunity(communityId).then(community => community?.name ?? '', (error: unknown) => {
			communityNames.delete(communityId);
			throw error;
		}));
	}
	return communityNames.get(communityId)!;
}

// The invitation email, with the link to the app they'll use
async function invitationEmail({ email, name, role, communityId }: Pick<Invitation, 'email' | 'name' | 'role' | 'communityId'>) {
	const community = communityId ? await communityName(communityId) : '';
	return (batch: WriteBatch) => queueMail(batch, {
		...invitationMail({ name: name.trim(), email, role }, community, useAuth().user.value?.name || auth.currentUser?.email || ''),
		to: email,
		communityId,
		kind: 'invitation',
		link: communityId ? `/communities/${communityId}/people` : '/admins',
	});
}

// Its id is the email in lowercase, as sign-in tokens have it. Fails when that email already has one. byEmail also queues
// the invitation email
export async function invite({ email, name, role, communityId, communityIds }: Pick<Invitation, 'email' | 'name' | 'role' | 'communityId' | 'communityIds'>, summary?: string, byEmail = false) {
	const id = email.trim().toLowerCase();
	const mail = byEmail ? await invitationEmail({ email: id, name, role, communityId }) : undefined;
	await commit(communityId, summary ?? `Invitó a ${name.trim()} como ${roles[role].label.toLowerCase()}${byEmail ? ' y le envió la invitación por email' : ''}`, (batch) => {
		batch.set(doc(invitationsRef, id), {
			email: id,
			name: name.trim(),
			role,
			communityId,
			...(role === 'admin' ? { communityIds: communityIds ?? [] } : {}),
			invitedBy: auth.currentUser!.uid,
			invitedAt: serverTimestamp(),
		});
		mail?.(batch);
	});
}

// The same email again for a pending one, e.g. invited without it or lost in their inbox
export async function resendInvitation(invitation: Invitation & { id: string }) {
	const mail = await invitationEmail({ ...invitation, email: invitation.id });
	await commit(invitation.communityId, `Volvió a enviar por email la invitación de ${invitation.name}`, mail);
}

export async function cancelInvitation(email: string, communityId?: string, name = email) {
	await commit(communityId, `Canceló la invitación de ${name}`, batch => batch.delete(doc(invitationsRef, email)));
}

// Undoes cancelInvitation with what the page had of it. The rules only let it be sent again, so it's signed and dated anew
export async function restoreInvitation(invitation: Invitation) {
	await invite(invitation, `Restauró la invitación de ${invitation.name}`);
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
