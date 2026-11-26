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
	// Reported since it was last resolved, so the header can count those that came back (MON-9). Older groups lack it
	seenSinceResolved?: boolean;
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

export type ErrorSeverity = 'critical' | 'high' | 'medium' | 'low';

// The most severe first, the order of the Errores page
export const errorSeverities: Record<ErrorSeverity, { label: string; icon: string }> = {
	critical: { label: 'Crítico', icon: 'lucide:siren' },
	high: { label: 'Grave', icon: 'lucide:triangle-alert' },
	medium: { label: 'Moderado', icon: 'lucide:circle-alert' },
	low: { label: 'Leve', icon: 'lucide:info' },
};

const URGENT_REASONS: Record<string, string> = {
	'resource-exhausted': 'Se ha agotado la cuota de Firestore',
	'permission-denied': 'Las reglas rechazan lo que hace el código',
	'failed-precondition': 'Falta un índice de Firestore',
};
// Sessions that sent a sample, which errorSampleRate (ROB-5) can lower: a rough count of the people it hit
const MANY_SESSIONS = 10;
const SEVERAL_SESSIONS = 3;

/*
 * Gravedad, from what the group already has, so it costs no reads: the first rule that applies. What asks for doing
 * something now (MON-2), then how many people it hit. A screen that doesn't load for one or two is usually a tab opened
 * before a deploy
 */
export function errorSeverity(group: Pick<ErrorGroup, 'status' | 'resolvedAt' | 'lastSeen' | 'code' | 'kind' | 'count' | 'sessions'>): { level: ErrorSeverity; reason: string } {
	if (hasReturned(group)) {
		return { level: 'critical', reason: 'Ha vuelto después de resolverlo' };
	}
	if (URGENT_CODES.includes(group.code)) {
		return { level: 'critical', reason: URGENT_REASONS[group.code] };
	}
	if (group.sessions >= SEVERAL_SESSIONS) {
		return { level: group.sessions >= MANY_SESSIONS ? 'critical' : 'high', reason: `Afecta a ${group.sessions} sesiones` };
	}
	if (group.kind === 'carga') {
		return { level: 'low', reason: 'Suele ser una pestaña abierta antes de desplegar' };
	}
	return group.count > 1
		? { level: 'medium', reason: `Se ha repetido ${group.count} veces` }
		: { level: 'low', reason: 'Ha pasado una sola vez' };
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
