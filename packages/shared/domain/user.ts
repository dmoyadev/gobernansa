import type { Timestamp } from 'firebase/firestore';

// 'superadmin' is gobernança's team, 'admin' an administrator with the communities assigned to them,
// 'manager' who runs the community they live in (e.g. its president) and 'user' a neighbour.
// All but neighbours can use the admin platform
export type Role = 'superadmin' | 'admin' | 'manager' | 'user';

export interface User {
	email: string;
	role: Role;
	// The community they live in, '' for administrators who don't live in one
	communityId: string;
	// Administrators only, the communities they manage
	communityIds?: string[];
	name: string;
}

// Sent from the admin platform, and turned into the profile of whoever it's for on their first sign-in
export interface Invitation extends Pick<User, 'email' | 'name' | 'role' | 'communityId' | 'communityIds'> {
	invitedBy: string;
	invitedAt: Timestamp;
}

export const roles: Record<Role, { label: string }> = {
	superadmin: { label: 'Equipo gobernança' },
	admin: { label: 'Administración' },
	manager: { label: 'Gestión' },
	user: { label: 'Vecino' },
};

// Mirrors manages() in firestore.rules, which is what enforces it
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
	if (user?.role === 'admin' && user.communityIds?.includes(communityId)) {
		return ['user', 'manager'];
	}
	if (user?.role === 'manager' && user.communityId === communityId) {
		return ['user'];
	}
	return [];
}
