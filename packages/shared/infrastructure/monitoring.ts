import type { App } from 'vue';
import type { Router } from 'vue-router';
import type { ErrorApp, ErrorKind, ErrorSample } from '../domain/errors.ts';
import { onLog } from 'firebase/app';
import { onAuthStateChanged } from 'firebase/auth';
import { AggregateQuerySnapshot, arrayUnion, collection, doc, DocumentSnapshot, increment, QueryDocumentSnapshot, QuerySnapshot, serverTimestamp, Timestamp, writeBatch } from 'firebase/firestore';
import { ref, watch } from 'vue';
import { installed, isIos, updateReady } from '../application/pwa.ts';
import useAuth from '../application/useAuth.ts';
import { auth, db } from './firebase.ts';
import { remote } from './remoteConfig.ts';

/*
 * Errores de las apps (MON-1 and MON-2, docs/fiabilidad.md §3). Every error is cleaned of personal data, classified,
 * grouped by a fingerprint and sent to errors/{fingerprint} in one batch, with a sample of who and how the first time in
 * the session. 1 or 2 writes and no reads; at most one send per error every 10 minutes and 20 per session. It must never
 * fail in turn: everything is caught, its own errors aren't reported and nothing waits for the send
 */

// Sortable, from CI: build date and time (UTC) and commit, e.g. 2026.11.02-1530-ab12cd3
export const RELEASE = (import.meta.env.VITE_RELEASE as string | undefined) || 'local';
// MON-3: the day's Firestore quota is used up, until about 9:00 in Spain (midnight Pacific time)
export const quotaExhausted = ref(false);

// Production builds send, and so does working with the emulators, to try the panel. Working against the live project only logs
const SENDS = import.meta.env.PROD || import.meta.env.VITE_FIREBASE_EMULATORS === 'true';
const TRAIL_SIZE = 30;
const THROTTLE_MS = 10 * 60 * 1000;
const SESSION_SENDS = 20;
// Per device and day, so reloading over and over doesn't start the 20 again
const DAY_SENDS = 40;
const SENDS_KEY = 'monitoring:sends';
const SAMPLE_DAYS = 30;
const RELOADED_KEY = 'monitoring:reloaded';
const RELOAD_EVERY_MS = 10 * 60 * 1000;
const QUOTA_KEY = 'monitoring:quota';

// The user's connection, not a failure of ours: only goes to the trail
const CONNECTION_CODES = ['unavailable', 'deadline-exceeded', 'auth/network-request-failed'];
const NETWORK_ERROR = /Failed to fetch|NetworkError|Load failed|Network request failed|network error/i;
// A part of the app that doesn't load, usually a tab opened before a deploy
const LOAD_ERROR = /dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading (?:CSS )?chunk/i;
// Browser extensions and the browser's own noise, nothing to do with the app
const NOISE = /-extension:\/\/|webkit-masked-url:|^Script error\.?$|ResizeObserver loop/;
// Caught by the app as a whole; the rest are caught by a page, which shows them
const GLOBAL_SOURCES = ['vue', 'window', 'promise', 'router'];
const FIREBASE_CODE = /^(?:[a-z]+\/)?[a-z]+(?:-[a-z]+)*$/;
const FRAME_SEPARATORS = /[\s()]+/;
const LINE_COLUMN = /(?::\d+){1,2}$/;
const BROWSERS: [RegExp, string][] = [
	[/Edg\/(\d+)/, 'Edge'],
	[/OPR\/(\d+)/, 'Opera'],
	[/SamsungBrowser\/(\d+)/, 'Samsung Internet'],
	[/(?:Firefox|FxiOS)\/(\d+)/, 'Firefox'],
	[/(?:Chrome|CriOS)\/(\d+)/, 'Chrome'],
	[/Version\/(\d+)/, 'Safari'],
];
const SYSTEMS: [RegExp, string][] = [[/Windows/, 'Windows'], [/Mac OS X/, 'macOS'], [/Linux/, 'Linux']];
const IOS_VERSION = /OS (\d+)[._](\d+)/;
const ANDROID_VERSION = /Android (\d+)/;
const SPACES = /\s+/g;
const QUOTED = /(["'`])(?:(?!\1).)*\1|«[^»]*»|“[^”]*”/g;
const ID = /\b(?=[\w-]*\d)[\w-]{12,}\b/g;
const NUMBER = /\d+/g;
const VITE_HASH = /-[\w-]{8}(?=\.(?:js|css)\b)/g;
// Minified names change from one build to the next: e.map is not a function
const MINIFIED = /[\w$.]+(?= is not (?:a function|iterable|defined)| is (?:undefined|null)\b)/g;
const PERSONAL_DATA: [RegExp, string][] = [
	[/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<email>'],
	[/\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]{4}){3,7}(?:[ -]?[A-Z0-9]{1,3})?\b/g, '<iban>'],
	[/\b[XYZ]?\d{7,8}[ -]?[A-Z]\b/gi, '<nif>'],
	[/\b[A-HJNP-SUVW]\d{7}[0-9A-J]\b/g, '<nif>'],
	[/(?:(?:\+|00)34[ -]?|\b)[6-9](?:[ -]?\d){8}\b/g, '<tel>'],
];

interface Context {
	// What was being done, e.g. the admin action's failure text
	action?: string;
	source?: string;
	info?: string;
}

interface Group {
	unsent: number;
	lastSent: number;
	routes: Set<string>;
	// Of its first time in the session, until sent. Whose is added then
	sample?: Omit<ErrorSample, 'id' | 'at' | 'uid' | 'role'>;
	sampled: boolean;
	timer?: ReturnType<typeof setTimeout>;
	data: { app: ErrorApp; kind: ErrorKind; code: string; message: string; file: string };
}

let appName: ErrorApp = 'webapp';
let currentRouter: Router | undefined;
let sends = 0;
let navigating = false;
// Loading the new version: what fails meanwhile is only that
let reloading = false;
let sending = Promise.resolve();
const trail: string[] = [];
const groups = new Map<string, Group>();
// The same error can reach several hooks, e.g. a failed navigation nobody caught
const reported = new WeakSet<object>();

export function installMonitoring(app: App, router: Router, name: ErrorApp) {
	appName = name;
	currentRouter = router;

	app.config.errorHandler = (error, instance, info) => reportError(error, { source: 'vue', info: [info, instance?.$options.__name].filter(Boolean).join(' en ') });
	window.addEventListener('error', event => reportError(event.error ?? event.message, { source: 'window' }));
	window.addEventListener('unhandledrejection', event => reportError(event.reason, { source: 'promise' }));
	router.beforeEach(() => {
		navigating = true;
	});
	router.onError((error) => {
		navigating = false;
		reportError(error, { source: 'router' });
	});
	router.afterEach((to, _from, failure) => {
		navigating = false;
		if (!failure) {
			addToTrail('pantalla', String(to.name ?? to.matched.at(-1)?.path ?? ''));
		}
	});
	// A tab opened before a deploy asks for parts that no longer exist: loading the new version fixes it. Only when going
	// to a screen (not when the admin loads one ahead), only if it's a part that didn't load (not one that failed when it
	// ran) and at most every 10 minutes, so it doesn't loop. Otherwise it goes on to the router, which reports it
	window.addEventListener('vite:preloadError', (event) => {
		safely(() => {
			const last = Number(sessionStorage.getItem(RELOADED_KEY));
			if (navigating && navigator.onLine && LOAD_ERROR.test(String(event.payload?.message)) && Date.now() - last > RELOAD_EVERY_MS) {
				sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
				reloading = true;
				event.preventDefault();
				window.location.reload();
			}
		});
	});

	// The trail: buttons and links by their visible text, never what's typed in a field
	document.addEventListener('click', (event) => {
		const target = event.target instanceof Element ? event.target.closest('button, a, summary, label, [role="button"], [role="tab"]') : null;
		if (target) {
			addToTrail('clic', target.getAttribute('aria-label') || target.textContent || target.getAttribute('title') || target.tagName.toLowerCase());
		}
	}, { capture: true, passive: true });
	window.addEventListener('offline', () => addToTrail('conexión', 'Sin conexión'));
	window.addEventListener('online', () => addToTrail('conexión', 'Conexión recuperada'));
	watch(updateReady, ready => ready && addToTrail('versión', 'Nueva versión disponible'));

	// Firestore doesn't fail the reads and writes with the quota used up, it retries them: it only logs it
	onLog(({ message }) => message.includes('resource-exhausted') && exhaustQuota(), { level: 'error' });
	// Errors before the session is restored, or on the sign-in page, wait for it: only signed in users report
	onAuthStateChanged(auth, user => user && flushAll());
	// What built up while waiting its 10 minutes goes when the page is hidden, which is before it's closed and when the
	// installed app goes to the background. Closing, Firestore keeps the write in the browser and sends it the next time.
	// Shown again, the quota may be back
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') {
			flushAll();
		} else {
			reportExhaustedQuota();
		}
	});
	reportExhaustedQuota();

	if (import.meta.env.DEV) {
		countReads();
	}
}

// For the errors a page catches and shows: they're logged as before and also reported
export function reportError(error: unknown, context: Context = {}) {
	// The browser already logs what it caught itself
	if (context.source !== 'window' && context.source !== 'promise') {
		// eslint-disable-next-line no-console
		console.error(error, ...(context.info ? [context.info] : []));
	}

	safely(() => {
		if (reloading || !error || (typeof error === 'object' && reported.has(error))) {
			return;
		}
		if (typeof error === 'object') {
			reported.add(error);
		}

		const failure = error as { code?: unknown; message?: unknown; stack?: unknown } | undefined;
		const message = typeof error === 'string' ? error : typeof failure?.message === 'string' ? failure.message : safely(() => JSON.stringify(error)) ?? String(error);
		const stack = typeof failure?.stack === 'string' ? failure.stack : '';
		const firebaseCode = typeof failure?.code === 'string' && FIREBASE_CODE.test(failure.code) ? failure.code : '';
		const kind: ErrorKind = firebaseCode ? 'firebase' : LOAD_ERROR.test(message) ? 'carga' : 'js';

		// MON-2: what is worth a group
		if (firebaseCode === 'resource-exhausted') {
			exhaustQuota();
			return;
		}
		if (CONNECTION_CODES.includes(firebaseCode) || (NETWORK_ERROR.test(message) && kind !== 'carga') || (kind === 'carga' && !navigator.onLine)) {
			addToTrail('conexión', message);
			return;
		}
		if (NOISE.test(message) || NOISE.test(stack)) {
			return;
		}
		// A message of the app's own that a page throws to show it, e.g. a NIF that isn't valid: not a failure
		if (!GLOBAL_SOURCES.includes(context.source ?? '') && !firebaseCode && Object.getPrototypeOf(error) === Error.prototype) {
			addToTrail('aviso', message);
			return;
		}

		quietly(queue({ kind, code: firebaseCode || kind, message, stack, context: { ...context, ...(firebaseCode ? { code: firebaseCode } : {}) } }));
	});
}

// Something the user did, kept for the next error's sample
export function addToTrail(kind: string, text: string) {
	safely(() => {
		const time = new Date().toLocaleTimeString('es', { hour12: false });
		trail.push(`${time} ${kind}: ${clean(text.replace(SPACES, ' ').trim().slice(0, 300)).slice(0, 120)}`);
		if (trail.length > TRAIL_SIZE) {
			trail.shift();
		}
	});
}

async function queue({ kind, code, message, stack, context, route = routeName() }: { kind: ErrorKind; code: string; message: string; stack: string; context: Context & { code?: string }; route?: string }) {
	const file = ownFile(stack);
	const normalized = normalize(message);
	// With the action too: Firebase's errors come from its own code, so without it every permission-denied would be one
	const id = await fingerprint([appName, kind === 'firebase' ? `firebase:${code}` : kind, normalized, file, normalize(context.action ?? '')]);
	const group = groups.get(id) ?? { unsent: 0, lastSent: 0, routes: new Set(), sampled: false, data: { app: appName, kind, code, message: normalized, file } };
	groups.set(id, group);
	group.unsent++;
	group.routes.add(route.slice(0, 80));
	if (!group.sampled) {
		group.sampled = true;
		// errorSampleRate (ROB-5) lowers the writes when there are too many errors
		if (Math.random() < remote.errorSampleRate) {
			group.sample = sample(message, stack, route, context);
		}
	}

	const wait = group.lastSent + THROTTLE_MS - Date.now();
	if (wait <= 0) {
		send(id);
	} else {
		group.timer ??= setTimeout(() => {
			group.timer = undefined;
			send(id);
		}, wait);
	}
}

async function flush(id: string) {
	const group = groups.get(id);
	const { currentUser } = auth;
	if (!SENDS || !remote.errorReporting || !group?.unsent || !currentUser || quotaExhausted.value || sends >= SESSION_SENDS) {
		return;
	}
	const today = new Date().toDateString();
	const sentToday = safely(() => JSON.parse(localStorage.getItem(SENDS_KEY) ?? 'null') as { day: string; count: number } | null);
	const todayCount = sentToday?.day === today ? sentToday.count : 0;
	if (todayCount >= DAY_SENDS) {
		return;
	}
	safely(() => localStorage.setItem(SENDS_KEY, JSON.stringify({ day: today, count: todayCount + 1 })));

	clearTimeout(group.timer);
	group.timer = undefined;
	sends++;
	group.lastSent = Date.now();
	const count = Math.min(group.unsent, 100);
	const routes = [...group.routes];
	// Who, now that the session is there: an error while the app opens comes before it's restored
	const profile = safely(() => useAuth().user.value);
	const sample = group.sample && {
		...group.sample,
		uid: currentUser.uid,
		role: (profile?.role ?? '').slice(0, 20),
		communityId: (group.sample.communityId || profile?.communityId || '').slice(0, 40),
	};
	// Above 100, the rest go next time
	group.unsent -= count;
	group.routes.clear();
	group.sample = undefined;

	// No reads: an update, and only if it doesn't exist yet a create
	const groupRef = doc(db, 'errors', id);
	const write = async (mode: 'update' | 'create' | 'lean' | 'bare') => {
		const batch = writeBatch(db);
		const withSample = sample && mode !== 'bare';
		if (mode === 'create') {
			batch.set(groupRef, { ...group.data, count, sessions: sample ? 1 : 0, firstSeen: serverTimestamp(), lastSeen: serverTimestamp(), firstRelease: RELEASE, lastRelease: RELEASE, releases: [RELEASE], routes: routes.slice(0, 20), status: 'new' });
		} else {
			batch.update(groupRef, {
				count: increment(count),
				lastSeen: serverTimestamp(),
				lastRelease: RELEASE,
				// MON-9: once resolved, seen again. Resolving sets it back to false
				seenSinceResolved: true,
				...(withSample ? { sessions: increment(1) } : {}),
				...(mode === 'update' ? { releases: arrayUnion(RELEASE), routes: arrayUnion(...routes) } : {}),
			});
		}
		if (withSample) {
			batch.set(doc(collection(groupRef, 'samples')), { ...sample, at: serverTimestamp() });
		}
		await batch.commit();
	};

	// Turned down the first time anyone sees it, then it's created. Turned down again, its lists of releases and screens are
	// full, so it goes without adding to them; and last without the sample, in case that's what doesn't fit
	try {
		await write('update');
	} catch {
		await write('create').catch(async () => write('lean')).catch(async () => write('bare'));
	}
}

// One at a time: a write the rules turn down (the first report of a new error) restarts Firestore's stream of writes, and
// what went out with it is sent again
function send(id: string) {
	sending = sending.then(async () => flush(id)).catch(() => undefined);
}

function flushAll() {
	for (const id of groups.keys()) {
		send(id);
	}
}

function sample(message: string, stack: string, route: string, context: Context & { code?: string }): NonNullable<Group['sample']> {
	const current = currentRouter?.currentRoute.value;
	// In the admin the community is the page's, in the webapp the user's (added when sent)
	const pageCommunity = current?.path.startsWith('/communities/') && typeof current.params.id === 'string' ? current.params.id : '';
	return {
		expiresAt: Timestamp.fromMillis(Date.now() + SAMPLE_DAYS * 24 * 60 * 60 * 1000),
		release: RELEASE,
		app: appName,
		route: route.slice(0, 100),
		communityId: pageCommunity,
		...device(),
		standalone: installed.value,
		online: navigator.onLine,
		message: clean(message).slice(0, 500),
		stack: clean(stack).slice(0, 4096),
		trail: [...trail],
		context: Object.fromEntries(Object.entries({ source: context.source ?? 'manual', action: context.action, code: context.code, info: context.info })
			.filter(([, value]) => value)
			.map(([key, value]) => [key, clean(String(value)).slice(0, key === 'source' ? 20 : 200)])) as ErrorSample['context'],
	};
}

// The fingerprint: 16 characters of the SHA-1 of the app, the kind, the normalized message and the first file of ours
async function fingerprint(parts: string[]) {
	const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(parts.join('\n')));
	return [...new Uint8Array(digest)].slice(0, 8).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function normalize(message: string) {
	return clean(message)
		.replace(VITE_HASH, '')
		.replace(QUOTED, '<texto>')
		.replace(MINIFIED, '<x>')
		.replace(ID, '<id>')
		.replace(NUMBER, '<n>')
		.slice(0, 500);
}

// Emails, IBAN, NIF and phones out of what's sent
function clean(text: string) {
	return PERSONAL_DATA.reduce((result, [pattern, marker]) => result.replace(pattern, marker), text);
}

// Vite names each part after its page, with a hash that changes on each build: IssuesPage-a1b2c3d4.js is IssuesPage.js
function ownFile(stack: string) {
	for (const frame of stack.split(FRAME_SEPARATORS)) {
		const start = frame.indexOf('http');
		const parsed = start === -1 ? undefined : safely(() => new URL(frame.slice(start).replace(LINE_COLUMN, '')));
		if (parsed?.origin === window.location.origin && !parsed.pathname.includes('/node_modules/')) {
			return (parsed.pathname.split('/').pop() ?? '').replace(VITE_HASH, '').slice(0, 100);
		}
	}
	return '';
}

function routeName() {
	const current = currentRouter?.currentRoute.value;
	return String(current?.name ?? current?.matched.at(-1)?.path ?? '');
}

// The browser and system with their main version, from the user agent. In this order: Edge and Opera also say Chrome,
// and all of them Safari
function device() {
	const agent = navigator.userAgent;
	const browser = BROWSERS.map(([pattern, name]) => [name, agent.match(pattern)?.[1]]).find(([, version]) => version);
	const android = agent.match(ANDROID_VERSION)?.[1];
	const os = isIos
		? `iOS ${agent.match(IOS_VERSION)?.slice(1).join('.') ?? ''}`
		: android ? `Android ${android}` : SYSTEMS.find(([pattern]) => pattern.test(agent))?.[1] ?? 'Otro';
	return { browser: (browser ? browser.join(' ') : 'Otro').slice(0, 40), os: os.trim().slice(0, 40) };
}

/*
 * MON-3. With the quota used up nothing is sent, so as not to fill Firestore's queue of pending writes. It's kept and
 * reported once it's back, from the next day in Pacific time, when Firestore resets it
 */
function exhaustQuota() {
	if (quotaExhausted.value) {
		return;
	}
	quotaExhausted.value = true;
	addToTrail('cuota', 'Cuota de Firestore agotada');
	safely(() => localStorage.setItem(QUOTA_KEY, JSON.stringify({ at: Date.now(), route: routeName() })));
}

function reportExhaustedQuota() {
	safely(() => {
		const pending = JSON.parse(localStorage.getItem(QUOTA_KEY) ?? 'null') as { at: number; route: string } | null;
		const pacificDay = (time: number) => new Date(time).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
		if (pending && pacificDay(pending.at) !== pacificDay(Date.now())) {
			localStorage.removeItem(QUOTA_KEY);
			quotaExhausted.value = false;
			quietly(queue({ kind: 'firebase', code: 'resource-exhausted', message: 'Cuota diaria de Firestore agotada', stack: '', route: pending.route, context: { source: 'quota', code: 'resource-exhausted', info: `Agotada el ${new Date(pending.at).toLocaleString('es')}` } }));
		}
	});
}

/*
 * MON-3 and INF-2, only while developing: the documents each screen reads that don't come from the cache, in the
 * console. Firestore has no hook for it, so it counts each snapshot the first time the app looks into it. Listeners
 * count what changed and the rest what they brought, which is about what Firestore charges
 */
function countReads() {
	const totals = new Map<string, number>();
	const counted = new WeakSet<object>();
	let timer: ReturnType<typeof setTimeout> | undefined;

	const count = (snapshot: object, documents: () => number) => {
		if (counted.has(snapshot) || (snapshot as { metadata?: { fromCache: boolean } }).metadata?.fromCache) {
			return;
		}
		counted.add(snapshot);
		const route = routeName() || '(sin pantalla)';
		totals.set(route, (totals.get(route) ?? 0) + documents());
		clearTimeout(timer);
		timer = setTimeout(() => {
			// eslint-disable-next-line no-console
			console.info('Documentos leídos de Firestore por pantalla, sin contar la caché');
			// eslint-disable-next-line no-console
			console.table(Object.fromEntries([...totals].sort(([, a], [, b]) => b - a)));
		}, 2000);
	};
	const wrap = <T extends object>(prototype: T, key: keyof T & string, documents: (snapshot: T) => number, skip?: (snapshot: T) => boolean) => {
		const descriptor: { get?: (this: T, ...args: unknown[]) => unknown; value?: (this: T, ...args: unknown[]) => unknown } | undefined = Object.getOwnPropertyDescriptor(prototype, key);
		const original = descriptor?.get ?? descriptor?.value;
		if (!descriptor || !original) {
			return;
		}
		const counting = function (this: T, ...args: unknown[]) {
			if (!skip?.(this)) {
				count(this, () => documents(this));
			}
			return original.apply(this, args);
		};
		Object.defineProperty(prototype, key, descriptor.get ? { ...descriptor, get: counting } : { ...descriptor, value: counting });
	};

	for (const key of ['docChanges', 'forEach', 'docs', 'size', 'empty'] as const) {
		// Counted already when it gets here again
		wrap(QuerySnapshot.prototype, key, snapshot => snapshot.docChanges().length);
	}
	// A query's documents are counted with it
	for (const key of ['data', 'exists', 'get'] as const) {
		wrap(DocumentSnapshot.prototype, key, () => 1, snapshot => snapshot instanceof QueryDocumentSnapshot);
	}
	wrap(AggregateQuerySnapshot.prototype, 'data', () => 1);
}

// Never in turn
function safely<T>(run: () => T) {
	try {
		return run();
	} catch {
		return undefined;
	}
}

function quietly(promise: Promise<unknown>) {
	promise.catch(() => undefined);
}
