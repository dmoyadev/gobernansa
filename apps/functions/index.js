import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { getApp, initializeApp } from 'firebase-admin/app';
import { DocumentReference, FieldValue, GeoPoint, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { info } from 'firebase-functions/logger';
import * as v1 from 'firebase-functions/v1';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onDocumentWrittenWithAuthContext } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { changeKeep, purge, purgeMedia } from './retention.js';

/*
 * El historial del superadmin: every change to every document goes to audit/{eventId} with what it was before and after
 * and who did it, and restoreVersion writes one of those states back. Needs Firebase's paid plan (Blaze)
 */

// Firestore triggers must run in the database's region: production's is in Madrid, and the demo's goes there too
// (docs/setup.md#functions).
// The admin calls restoreVersion here too
const REGION = 'europe-southwest1';
setGlobalOptions({ region: REGION });

initializeApp();
const db = getFirestore();

// Logs themselves, or telemetry: their writes would only repeat what's in them (errors' samples go with errors, and
// communities/{c}/activity is each community's own register)
const SKIPPED = new Set(['audit', 'actions', 'errors', 'vitals', 'ops', 'activity']);
// Their owner's alone, under users/{uid}, not copied anywhere: the key of the issues they report (a secret), their devices
// for push (the token is the id) and their documents' files (the list, users/{uid}/documents, has who, when, name and size)
const OWN = new Set(['keys', 'devices', 'documentFiles']);
// Who made a change when the event doesn't say, from the document itself, most telling first
const ACTOR_FIELDS = ['updatedBy', 'deletedBy', 'hiddenBy', 'resolvedBy', 'recordedBy', 'sentBy', 'by', 'voterId', 'authorId', 'createdBy', 'invitedBy', 'uid'];
// A document is at most 1 MiB: what's kept of before and after, with room for the rest
const MAX_STATES = 900_000;
// How long a restore waits for its own write to be recorded (restoreVersion)
const RESTORE_WINDOW_MS = 60_000;
const INVALID_ARGUMENT = 3;
const ALREADY_EXISTS = 6;

/*
 * Every document, at each depth there is: users/{uid}/documents/{id}, communities/{c}/issues/{i}/votes/{v}...
 * ponytail: the writes to the skipped collections also wake these up, only to stop; one trigger per collection if the
 * invocations show in the bill. Retried when they fail, or the change would be missing from the history: an entry is
 * written once whatever times its event comes
 */
export const auditTop = onDocumentWrittenWithAuthContext({ document: '{c1}/{d1}', retry: true }, record);
export const auditNested = onDocumentWrittenWithAuthContext({ document: '{c1}/{d1}/{c2}/{d2}', retry: true }, record);
export const auditDeep = onDocumentWrittenWithAuthContext({ document: '{c1}/{d1}/{c2}/{d2}/{c3}/{d3}', retry: true }, record);

async function record(event) {
	const segments = event.document.split('/');
	if (SKIPPED.has(segments[0]) || SKIPPED.has(segments.at(-2)) || (segments[0] === 'users' && OWN.has(segments[2])) || !event.data) {
		return;
	}

	const before = event.data.before.exists ? event.data.before.data() : null;
	const after = event.data.after.exists ? event.data.after.data() : null;
	const op = !before ? 'create' : !after ? 'delete' : 'update';
	const changed = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])]
		.filter(key => !isDeepStrictEqual(before?.[key], after?.[key]))
		.sort();
	if (op === 'update' && !changed.length) {
		return;
	}

	// A user of the apps: 'app_user' with their uid, which Eventarc's docs list and firebase-functions' types don't yet.
	// Any other id that isn't an email (service accounts are) is taken as a uid too
	const { authType = 'unknown', authId } = event;
	const userId = authId && !authId.includes('@') && !['system', 'api_key', 'service_account'].includes(authType) ? authId : undefined;
	// Written by restoreVersion (with the functions' service account; 'unknown' in the emulators): whoever asked for it
	const restore = !userId && ['service_account', 'unknown'].includes(authType) ? await restoreMarker(event.document, event.time) : undefined;
	// Otherwise, for an unknown principal (every write in the emulators), the document may say, but only through a field
	// this write set: one it left as it was names an earlier writer, as the office's createdBy on a provider's report.
	// Never for service accounts, or without a session, where there's no user to name
	const inferred = !userId && !restore && authType === 'unknown' && op !== 'delete'
		? ACTOR_FIELDS.find(key => typeof after[key] === 'string' && after[key] && (op === 'create' || changed.includes(key)))
		: undefined;
	const actorId = userId ?? restore?.uid ?? (inferred && after[inferred]) ?? null;
	const actor = restore ?? (actorId ? await person(actorId) : { name: '', email: '' });
	// The community it's in, or the one it says outside them (properties, events, invitations, work orders, mail, users),
	// so filtering by community shows those too
	const said = (after ?? before)?.communityId;
	const communityId = segments[0] === 'communities' ? segments[1] : typeof said === 'string' && said ? said.slice(0, 100) : undefined;

	const entry = {
		path: event.document,
		collection: segments.at(-2),
		docId: segments.at(-1),
		...(communityId ? { communityId } : {}),
		op,
		changed,
		...fit(before, after, changed),
		authType,
		authId: authId ?? null,
		actorId,
		actorName: actor.name || null,
		actorEmail: actor.email || null,
		...(inferred ? { actorInferred: true } : {}),
		...(restore ? { restoredFrom: restore.auditId } : {}),
		// How long it's kept (retention.js)
		keep: changeKeep(segments.at(-2)),
		at: Timestamp.fromDate(new Date(event.time)),
	};

	// Created, never overwritten: the same event can come more than once
	const save = (data) => {
		const batch = db.batch();
		batch.create(db.collection('audit').doc(event.id), data);
		if (restore) {
			batch.delete(restore.ref);
		}
		return batch.commit();
	};
	try {
		await save(entry);
	} catch (error) {
		if (error.code === ALREADY_EXISTS) {
			return;
		}
		// Refused for good, not worth retrying: deeper than Firestore's 20 levels once under before and after, or over 1 MiB
		// with the names of what changed. Kept without its states, as a document too big (anyone can write such a one in
		// users/{uid}/documents)
		if (error.code !== undefined && error.code !== INVALID_ARGUMENT) {
			throw error;
		}
		await save({ ...entry, before: null, after: null, changed: changed.slice(0, 200), truncated: true }).catch((retried) => {
			if (retried.code !== ALREADY_EXISTS) {
				throw retried;
			}
		});
	}
}

// Name and email of whoever made a change, read once per instance; not kept while they have no profile, as on their first
// sign-in. ponytail: a renamed user keeps the old name until the instance is recycled, a TTL if that matters
const people = new Map();
async function person(uid) {
	if (!people.has(uid)) {
		people.set(uid, (async () => {
			const profile = await db.collection('users').doc(uid).get();
			if (!profile.exists) {
				people.delete(uid);
			}
			return { name: String(profile.get('name') ?? ''), email: String(profile.get('email') ?? '') };
		})().catch(() => {
			people.delete(uid);
			return { name: '', email: '' };
		}));
	}
	return people.get(uid);
}

// The size Firestore gives a value, near enough (https://firebase.google.com/docs/firestore/storage-size)
function sizeOf(value) {
	if (value === null || value === undefined || typeof value === 'boolean') {
		return 1;
	}
	if (typeof value === 'number' || value instanceof Timestamp) {
		return 8;
	}
	if (typeof value === 'string') {
		return Buffer.byteLength(value) + 1;
	}
	if (value instanceof Uint8Array) {
		return value.length;
	}
	if (value instanceof DocumentReference) {
		return Buffer.byteLength(value.path) + 16;
	}
	if (value instanceof GeoPoint) {
		return 16;
	}
	if (Array.isArray(value)) {
		return value.reduce((total, item) => total + sizeOf(item), 0);
	}
	return Object.entries(value).reduce((total, [key, item]) => total + Buffer.byteLength(key) + 1 + sizeOf(item), 0);
}

// Both states whole, so any of them can be restored with its dates and references as they were. Too big for one
// document (two versions of a long acta), only the fields that changed, each one cut if it doesn't fit: that can't be restored
function fit(before, after, changed) {
	if (sizeOf(before) + sizeOf(after) <= MAX_STATES) {
		return { before, after };
	}
	const room = MAX_STATES / (2 * Math.max(changed.length, 1));
	const only = state => state && Object.fromEntries(changed.filter(key => key in state).map((key) => {
		const size = sizeOf(state[key]);
		return [key, size > room ? `(${size.toLocaleString('es')} bytes, demasiado grande para guardarlo)` : state[key]];
	}));
	return { before: only(before), after: only(after), truncated: true };
}

/*
 * restoreVersion leaves who asked for it here, written with the document in one batch, and the change it makes takes it:
 * so the history says which superadmin restored it and from what, not the functions' account
 */
function restoreRef(path) {
	return db.collection('ops').doc(`restore-${createHash('sha1').update(path).digest('hex')}`);
}

async function restoreMarker(path, time) {
	const ref = restoreRef(path);
	const marker = await ref.get();
	const at = marker.get('at');
	return at instanceof Timestamp && Math.abs(new Date(time).getTime() - at.toMillis()) < RESTORE_WINDOW_MS
		? { ...marker.data(), ref }
		: undefined;
}

// A document of a user's profile, whose file (documentFiles) isn't copied
const PROFILE_DOCUMENT = /^users\/[^/]+\/documents\/[^/]+$/;

/*
 * The superadmin puts a document back as it was before or after a change of the history (audit/{auditId}): written
 * as it was, or removed if it didn't exist then. The write is itself a change, so it can be undone the same way
 */
export const restoreVersion = onCall(async (request) => {
	const uid = request.auth?.uid;
	if (!uid) {
		throw new HttpsError('unauthenticated', 'Inicia sesión para restaurar una versión.');
	}
	const caller = await db.collection('users').doc(uid).get();
	if (caller.get('role') !== 'superadmin') {
		throw new HttpsError('permission-denied', 'Solo el equipo de gobernança puede restaurar versiones.');
	}

	const { auditId, side } = request.data ?? {};
	if (typeof auditId !== 'string' || !auditId || auditId.includes('/') || !['before', 'after'].includes(side)) {
		throw new HttpsError('invalid-argument', 'Falta el cambio o la versión que restaurar.');
	}
	const entry = (await db.collection('audit').doc(auditId).get()).data();
	if (!entry) {
		throw new HttpsError('not-found', 'Ese cambio ya no está en el historial.');
	}
	if (entry.collection === 'auth' || typeof entry.path !== 'string') {
		throw new HttpsError('failed-precondition', 'Solo se pueden restaurar documentos, no cuentas.');
	}
	// Corrected with a rectificativa or an annulment, never put back: an older counter or end of the chain would repeat
	// numbers and break the Verifactu chain
	if (entry.path.startsWith('offices/')) {
		throw new HttpsError('failed-precondition', 'Las facturas, el registro Verifactu y los datos fiscales del despacho no se restauran: una factura se corrige con una rectificativa.');
	}
	if (entry.truncated) {
		throw new HttpsError('failed-precondition', 'Ese documento era demasiado grande y el historial no lo guardó entero: no se puede restaurar.');
	}

	const state = entry[side] ?? null;
	// Without its file, it would be listed and never open
	if (state && PROFILE_DOCUMENT.test(entry.path) && !(await db.doc(entry.path.replace('/documents/', '/documentFiles/')).get()).exists) {
		throw new HttpsError('failed-precondition', 'El archivo de ese documento ya no existe: no se puede recuperar.');
	}
	const target = db.doc(entry.path);
	const current = await target.get();
	if (isDeepStrictEqual(current.exists ? current.data() : null, state)) {
		throw new HttpsError('failed-precondition', state ? 'El documento ya está así.' : 'El documento ya no existe.');
	}

	const name = String(caller.get('name') ?? '');
	const email = request.auth.token.email ?? '';
	const batch = db.batch();
	if (state) {
		batch.set(target, state);
	} else {
		batch.delete(target);
	}
	batch.set(restoreRef(entry.path), { uid, name, email, auditId, side, at: FieldValue.serverTimestamp() });
	batch.set(db.collection('actions').doc(), {
		uid,
		...(email ? { email } : {}),
		name,
		app: 'admin',
		type: 'restore',
		path: entry.path,
		detail: state ? `Restauró la versión ${side === 'before' ? 'anterior al' : 'posterior al'} cambio` : 'Borró el documento, como estaba antes de crearlo',
		meta: { auditId, side },
		...(entry.communityId ? { communityId: entry.communityId } : {}),
		// The team's own: three years (retention.js)
		keep: 'admin',
		at: FieldValue.serverTimestamp(),
	});
	await batch.commit();
	return { path: entry.path, deleted: !state };
});

/*
 * Accounts, which aren't documents: created when someone signs in for the first time (or enters with a code) and
 * removed by the team or by a wrong code. Only in v1, the second generation has no such triggers
 */
const accounts = v1.region(REGION).auth.user();
export const auditAccountCreated = accounts.onCreate(async (account, context) => recordAccount(account, context, 'create'));
export const auditAccountDeleted = accounts.onDelete(async (account, context) => recordAccount(account, context, 'delete'));

async function recordAccount(account, context, op) {
	const state = {
		email: account.email ?? null,
		providers: account.providerData.map(provider => provider.providerId),
		anonymous: !account.providerData.length,
		disabled: account.disabled,
		createdAt: account.metadata.creationTime ?? null,
		lastSignInAt: account.metadata.lastSignInTime ?? null,
	};
	try {
		await db.collection('audit').doc(context.eventId).create({
			path: `auth/${account.uid}`,
			collection: 'auth',
			docId: account.uid,
			op,
			changed: Object.keys(state).sort(),
			before: op === 'delete' ? state : null,
			after: op === 'create' ? state : null,
			authType: 'system',
			authId: null,
			// Whoever signs in creates their own; who removed one isn't known
			actorId: op === 'create' ? account.uid : null,
			actorName: (op === 'create' && account.displayName) || null,
			actorEmail: (op === 'create' && account.email) || null,
			keep: changeKeep('auth'),
			at: Timestamp.fromDate(new Date(context.timestamp)),
		});
	} catch (error) {
		if (error.code !== ALREADY_EXISTS) {
			throw error;
		}
	}
}

/*
 * Plazos de conservación (retention.js): every night, what's expired of the Historial, the communities' activity and the
 * errors' samples is deleted. Up to 10.000 documents a night: a backlog goes over the following ones. In Belgium, as Cloud
 * Scheduler may not be in Madrid: not being a trigger, it can run outside the database's region
 */
export const purgeExpired = onSchedule({ schedule: 'every day 04:00', timeZone: 'Europe/Madrid', region: 'europe-west1', timeoutSeconds: 540 }, async () => {
	info('Borrado lo caducado', await purge(db));
});

// The photos and videos nobody sees anymore (retention.js), every Sunday. Without a bucket yet (docs/setup.md#storage),
// nothing to do
export const purgeOldMedia = onSchedule({ schedule: 'every sunday 05:00', timeZone: 'Europe/Madrid', region: 'europe-west1', timeoutSeconds: 540 }, async () => {
	const name = getApp().options.storageBucket;
	info('Borradas las fotos que ya no ve nadie', name ? await purgeMedia(db, getStorage().bucket(name)) : 'sin bucket');
});
