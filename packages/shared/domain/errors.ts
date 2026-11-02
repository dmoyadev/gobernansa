import type { Timestamp } from 'firebase/firestore';

/*
 * Errores de las apps (MON-1, docs/fiabilidad.md): each failure is one group at errors/{fingerprint}, reported by the
 * browsers that hit it, with samples of who and how at errors/{fingerprint}/samples/{id}. Only the team reads them (MON-8)
 */
export type ErrorApp = 'admin' | 'webapp';

export type ErrorKind = 'js' | 'firebase' | 'carga';

export type ErrorStatus = 'new' | 'resolved' | 'ignored';

export interface ErrorGroup {
	id: string;
	app: ErrorApp;
	kind: ErrorKind;
	// Firebase's code, or the kind for the rest ('js', 'carga'), so one filter takes them all
	code: string;
	// Numbers, ids, emails and quoted texts as markers, so the same failure reads the same
	message: string;
	// The first file of ours in the stack, without Vite's hash
	file: string;
	count: number;
	// Sessions that sent a sample, a rough count of the people it hit
	sessions: number;
	firstSeen: Timestamp;
	lastSeen: Timestamp;
	firstRelease: string;
	lastRelease: string;
	// At most 20 each, the first ones seen
	releases: string[];
	routes: string[];
	status: ErrorStatus;
	resolvedAt?: Timestamp;
	resolvedBy?: string;
	// The release that has the fix
	resolvedIn?: string;
	note?: string;
	// The same failure as that group, which shows both together
	mergedInto?: string;
}

export interface ErrorSample {
	id: string;
	at: Timestamp;
	expiresAt: Timestamp;
	release: string;
	app: ErrorApp;
	route: string;
	communityId: string;
	uid: string;
	role: string;
	browser: string;
	os: string;
	// The installed app
	standalone: boolean;
	online: boolean;
	message: string;
	stack: string;
	// What the user did just before, oldest first
	trail: string[];
	// Where it was caught ('vue', 'window', 'promise', 'router', 'action'…), the admin action it broke and Vue's hint
	context: { source: string; action?: string; code?: string; info?: string };
}

// MON-2: what asks for doing something now. A broken deploy or rules out of step with the code, a missing index, the quota
export const URGENT_CODES = ['resource-exhausted', 'permission-denied', 'failed-precondition'];

// Resolved, and seen again after that
export function hasReturned(group: Pick<ErrorGroup, 'status' | 'resolvedAt' | 'lastSeen'>) {
	return group.status === 'resolved' && !!group.resolvedAt && !!group.lastSeen && group.lastSeen.toMillis() > group.resolvedAt.toMillis();
}

// The rest of the failures are urgent only once they come back after being resolved
export function isUrgent(group: Pick<ErrorGroup, 'status' | 'resolvedAt' | 'lastSeen' | 'code'>) {
	return hasReturned(group) || (group.status === 'new' && URGENT_CODES.includes(group.code));
}

export const errorStatus: Record<ErrorStatus, { label: string; icon: string }> = {
	new: { label: 'Nuevo', icon: 'lucide:circle-dot' },
	resolved: { label: 'Resuelto', icon: 'lucide:check' },
	ignored: { label: 'Ignorado', icon: 'lucide:eye-off' },
};

export const errorKinds: Record<ErrorKind, string> = {
	js: 'Error de código',
	firebase: 'Firebase',
	carga: 'Pantalla que no carga',
};

export const errorApps: Record<ErrorApp, string> = {
	admin: 'Admin',
	webapp: 'Webapp',
};
