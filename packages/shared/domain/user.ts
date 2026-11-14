import type { Timestamp } from 'firebase/firestore';

// 'superadmin' is gobernança's team, 'admin' an administrator with the communities assigned to them,
// 'manager' who runs the community they live in (e.g. its president) and 'user' a neighbour.
// All but neighbours can use the admin platform
export type Role = 'superadmin' | 'admin' | 'manager' | 'user';

export interface User {
	email: string;
	role: Role;
	// The community they live in, '' for administrators who don't live in one. For managers, the one they manage
	communityId: string;
	// Neighbours with a home in more than one (a flat in one, a garage in another): the others, where they're neighbours
	otherCommunityIds?: string[];
	// Administrators only, the communities their office manages, the same in every member's profile
	communityIds?: string[];
	// Administrators who work in someone else's office: its id, the owner's uid. Without it, the office is their own
	officeId?: string;
	// What they do in it. Without it, they own it
	officeRole?: OfficeRole;
	name: string;
	// By whoever manages their community: they can still read, but not report, comment, vote or book
	blocked?: boolean;
	// Neighbours without email (B2.4): the printed code they signed in with. Their email is ''
	inviteCode?: string;
}

// Sent from the admin platform, and turned into the profile of whoever it's for on their first sign-in
export interface Invitation extends Pick<User, 'email' | 'name' | 'role' | 'communityId' | 'communityIds' | 'officeId' | 'officeRole'> {
	invitedBy: string;
	invitedAt: Timestamp;
	// For a neighbour without email (B2.4): the office prints it, and its id and email are the code
	byCode?: boolean;
}

// No 0, O, 1 or I to misread on paper. 32 letters, so each random byte gives one without bias: 10 of them are 50 bits,
// out of reach of guessing them one at a time
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newInviteCode() {
	return Array.from(crypto.getRandomValues(new Uint8Array(10)), byte => CODE_ALPHABET[byte % 32]).join('');
}

// As printed, in two halves
export function formatInviteCode(code: string) {
	return `${code.slice(0, 5)}-${code.slice(5)}`;
}

// As typed: in any case, with spaces or dashes
const NOT_IN_CODE = /[^A-Z0-9]/g;
export function parseInviteCode(typed: string) {
	return typed.toUpperCase().replace(NOT_IN_CODE, '');
}

export const roles: Record<Role, { label: string }> = {
	superadmin: { label: 'Equipo gobernança' },
	admin: { label: 'Administración' },
	manager: { label: 'Gestión' },
	user: { label: 'Vecino' },
};

// An office is its owner (titular) and whoever they invite to it, with what each one can do. Mirrors firestore.rules
export type OfficeRole = 'owner' | 'accountant' | 'clerk' | 'viewer';

export const officeRoles: Record<OfficeRole, { label: string; description: string }> = {
	owner: { label: 'Titular', description: 'Todo, también el equipo del despacho.' },
	accountant: { label: 'Contable', description: 'Todo en las comunidades, también cerrar el ejercicio y los honorarios.' },
	clerk: { label: 'Oficial', description: 'El día a día de las comunidades, sin cerrar ejercicios ni facturar honorarios.' },
	viewer: { label: 'Solo lectura', description: 'Ve todas las comunidades del despacho, sin cambiar nada.' },
};

// The office they work in, whose id is its owner's uid
export function officeOf(user: (User & { id: string }) | null | undefined) {
	return user?.officeId ?? user?.id ?? '';
}

export function officeRoleOf(user: User | null | undefined): OfficeRole {
	return user?.officeRole ?? 'owner';
}

// Closing and reopening a year, and the office's fees. Mirrors closesYears() and billsFees() in firestore.rules
export function keepsBooks(user: User | null | undefined) {
	return user?.role !== 'admin' || ['owner', 'accountant'].includes(officeRoleOf(user));
}

// Read-only members of an office: the rules turn down whatever they write
export function readsOnly(user: User | null | undefined) {
	return user?.role === 'admin' && officeRoleOf(user) === 'viewer';
}

// Every community they're a neighbour of, the one they live in first
export function homeCommunities(user: User | null | undefined) {
	return user?.communityId ? [user.communityId, ...user.otherCommunityIds ?? []] : [];
}

// Mirrors manages() in firestore.rules (which also keeps read-only members from writing), which is what enforces it
export function managesCommunity(user: User | null | undefined, communityId: string | undefined) {
	return user?.role === 'superadmin'
		|| (user?.role === 'admin' && !!communityId && !!user.communityIds?.includes(communityId))
		|| (user?.role === 'manager' && !!communityId && user.communityId === communityId);
}

// The roles the user can give in a community ('' for administrators). Mirrors canAssign() in firestore.rules
export function assignableRoles(user: User | null | undefined, communityId: string): Role[] {
	if (user?.role === 'superadmin') {
		return ['user', 'manager', 'admin', 'superadmin'];
	}
	if (user?.role === 'admin' && !readsOnly(user) && user.communityIds?.includes(communityId)) {
		return ['user', 'manager'];
	}
	if (user?.role === 'manager' && user.communityId === communityId) {
		return ['user'];
	}
	return [];
}

// Each person's documents are stored inside Firestore (1 MiB max each) to stay on the free plan, whose 1 GiB is shared by
// everything. A few per person, so they can't fill it. ponytail: checked by the apps, not the rules; a count on the profile if it's abused
export const MAX_DOCUMENT_SIZE = 1_000_000;
export const MAX_DOCUMENTS = 10;
