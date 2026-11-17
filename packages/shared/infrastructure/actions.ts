import type { Router } from 'vue-router';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { watch } from 'vue';
import useAuth from '../application/useAuth.ts';
import { auth, db, emulators } from './firebase.ts';
import { device, quotaExhausted } from './monitoring.ts';
import { remote } from './remoteConfig.ts';

/*
 * Acciones: what each user does that doesn't change a document, for the superadmin's Historial (the changes themselves
 * are recorded by the functions, apps/functions/index.js). One write each, in the shape the rules check (actions in
 * firestore.rules). Never in the way: nothing waits for it unless the page is about to go, and it never throws
 */

export type ActionType = 'signin' | 'signout' | 'page' | 'print' | 'download' | 'view-as' | 'view-as-exit' | 'password' | 'email' | 'restore';

// How long it's kept (apps/functions/retention.js): 90 days, 12 months or, the team's, 3 years
export type ActionKeep = 'short' | 'year' | 'admin';

interface Fields {
	path?: string;
	detail?: string;
	meta?: Record<string, unknown>;
	communityId?: string;
	// Of a screen: 12 months if it's a person's or a property's, 90 days the rest. Whatever else they do, 12 months
	keep?: ActionKeep;
}

// Like the errors: production builds and the emulators, not development against the live project
const SENDS = import.meta.env.PROD || emulators;
// What a page about to reload or sign out waits for its action at most
const LEAVING_MS = 1500;
// What an action waits for the user's profile at most, offline too
const PROFILE_MS = 10_000;

let appName: 'webapp' | 'admin' = 'webapp';
let currentRouter: Router | undefined;

// From installMonitoring: the screens each user opens, when the path changes (not its query), and what they print
export function installActions(router: Router, name: 'webapp' | 'admin') {
	appName = name;
	currentRouter = router;
	router.afterEach((to, from, failure) => {
		if (!failure && (to.path !== from.path || !from.matched.length)) {
			void logAction('page', { path: to.path, detail: String(to.name ?? ''), keep: to.params.uid || to.params.propertyId ? 'year' : 'short' });
		}
	});
	window.addEventListener('beforeprint', () => void logAction('print', { detail: document.title }));
}

export async function logAction(type: ActionType, fields: Fields = {}) {
	try {
		await auth.authStateReady();
		const account = auth.currentUser;
		if (!SENDS || !account || quotaExhausted.value || !remote.actionsLog) {
			return;
		}
		const { user, viewingAs } = useAuth();
		// The team's 3 years come from the profile, not loaded yet right after signing in or a reload. Null without one
		if (user.data.value === undefined) {
			await new Promise<void>((resolve) => {
				const stop = watch(() => user.data.value, (profile) => {
					if (profile !== undefined) {
						stop();
						resolve();
					}
				});
				setTimeout(() => {
					stop();
					resolve();
				}, PROFILE_MS);
			});
		}
		const route = currentRouter?.currentRoute.value;
		// In the admin the page's community, in the webapp the user's (the one viewed as, too)
		const communityId = fields.communityId
			?? (route?.path.startsWith('/communities/') && typeof route.params.id === 'string' ? route.params.id : undefined)
			?? (appName === 'webapp' ? user.value?.communityId : undefined);
		const { browser, os } = device();
		await addDoc(collection(db, 'actions'), {
			uid: account.uid,
			// The rules compare it with the token's, when there is one
			...(account.email ? { email: account.email } : {}),
			name: (user.value?.name ?? '').slice(0, 200),
			app: appName,
			type,
			path: (fields.path ?? location.pathname).slice(0, 500),
			...(fields.detail ? { detail: fields.detail.slice(0, 2000) } : {}),
			...(fields.meta ? { meta: fields.meta } : {}),
			...(communityId ? { communityId: communityId.slice(0, 100) } : {}),
			...(viewingAs.value ? { viewAs: viewingAs.value.slice(0, 200) } : {}),
			device: `${browser} · ${os}`.slice(0, 300),
			// Their own profile, not the one viewed as
			keep: user.data.value?.role === 'superadmin' ? 'admin' : fields.keep ?? 'year',
			at: serverTimestamp(),
		});
	} catch {}
}

// For a page that reloads or signs out next: its action is sent first, waiting a moment at most
export async function logActionBeforeLeaving(type: ActionType, fields?: Fields) {
	await Promise.race([logAction(type, fields), new Promise(resolve => setTimeout(resolve, LEAVING_MS))]);
}
