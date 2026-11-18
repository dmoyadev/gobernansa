import type { ErrorGroup, ErrorSample } from '@gobernansa/shared/domain/errors.ts';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { URGENT_CODES } from '@gobernansa/shared/domain/errors.ts';
import { db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, collectionGroup, doc, getDoc, getDocs, limit, orderBy, query, startAfter, Timestamp, where, writeBatch } from 'firebase/firestore';

/*
 * Errores (MON-8, docs/fiabilidad.md): the groups the apps reported, read 25 at a time and once, not live, as each report
 * changes its group. Their samples, what the team does with them and the clean-up
 */

const PAGE_SIZE = 25;
const SAMPLES = 10;
// What a clean-up removes at most, so it doesn't take the day's quota of deletes
const CLEAN_ROUNDS = 10;
const CLEAN_BATCH = 500;
export const STALE_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

// 'all' and not '', which the page's select doesn't show
export const ALL = 'all';

export interface ErrorFilter { status: string; app: string; code: string; release: string }

const errorsRef = collection(db, 'errors');

// Each filter with the date needs its index (docs/setup.md#indices); Firestore merges them when there are several
function filters({ app, code, release }: ErrorFilter) {
	return [
		...(app !== ALL ? [where('app', '==', app)] : []),
		...(code !== ALL ? [where('code', '==', code)] : []),
		...(release !== ALL ? [where('firstRelease', '==', release)] : []),
	];
}

function toGroup(snapshot: QueryDocumentSnapshot) {
	return { ...snapshot.data(), id: snapshot.id } as ErrorGroup;
}

// ROB-2: the last backup, written by npm run backup. 1 read
export async function loadBackup() {
	return (await getDoc(doc(db, 'ops', 'backup'))).data() as { at?: Timestamp; documents: number } | undefined;
}

// A page of groups, the last seen first, after the last one loaded. 1 read per group
export async function loadErrorGroups(filter: ErrorFilter, after?: QueryDocumentSnapshot) {
	const page = await getDocs(query(errorsRef, ...(filter.status !== ALL ? [where('status', '==', filter.status)] : []), ...filters(filter), orderBy('lastSeen', 'desc'), ...(after ? [startAfter(after)] : []), limit(PAGE_SIZE)));
	return { groups: page.docs.map(toGroup), last: page.docs.at(-1), more: page.size === PAGE_SIZE };
}

// The pending ones that need doing something now (MON-2), so they go first even when they're not on the first page
export async function loadUrgentErrors(filter: ErrorFilter) {
	return (await getDocs(query(errorsRef, where('status', '==', 'new'), where('code', 'in', URGENT_CODES), ...filters(filter), orderBy('lastSeen', 'desc'), limit(PAGE_SIZE)))).docs.map(toGroup);
}

// All the groups merged into one, not only those loaded in the list, and the last samples of them all together
export async function loadGroupSamples(id: string) {
	const samplesOf = async (group: string) => getDocs(query(collection(db, 'errors', group, 'samples'), orderBy('at', 'desc'), limit(SAMPLES)));
	const [mergedDocs, own] = await Promise.all([getDocs(query(errorsRef, where('mergedInto', '==', id))), samplesOf(id)]);
	const merged = mergedDocs.docs.map(toGroup);
	const pages = [own, ...await Promise.all(merged.map(async item => samplesOf(item.id)))];
	return {
		merged,
		samples: pages.flatMap(page => page.docs.map(item => ({ ...item.data(), id: item.id }) as ErrorSample))
			.sort((a, b) => b.at.toMillis() - a.at.toMillis())
			.slice(0, SAMPLES),
	};
}

// The same change to a group and those merged into it, each with its own values. 1 write per group
export async function updateErrorGroups(ids: string[], values: (id: string) => Record<string, unknown>) {
	const batch = writeBatch(db);
	ids.forEach(id => batch.update(doc(db, 'errors', id), values(id)));
	await batch.commit();
}

/*
 * Samples are kept 30 days and groups resolved or ignored are kept until they've gone 180 days without coming back, to
 * know when they do. Removed from here, as Firestore's TTL needs setting up in the console (docs/setup.md#plazos)
 */
export async function cleanErrors() {
	let samples = 0;
	for (let round = 0; round < CLEAN_ROUNDS; round++) {
		const expired = await getDocs(query(collectionGroup(db, 'samples'), where('expiresAt', '<', Timestamp.now()), limit(CLEAN_BATCH)));
		if (expired.size) {
			const batch = writeBatch(db);
			expired.docs.forEach(sample => batch.delete(sample.ref));
			await batch.commit();
			samples += expired.size;
		}
		if (expired.size < CLEAN_BATCH) {
			break;
		}
	}

	// Their samples expired long before
	const stale = await getDocs(query(errorsRef, where('lastSeen', '<', Timestamp.fromMillis(Date.now() - STALE_DAYS * DAY_MS)), limit(CLEAN_BATCH)));
	const old = stale.docs.filter(group => (group.data() as ErrorGroup).status !== 'new');
	if (old.length) {
		const batch = writeBatch(db);
		old.forEach(group => batch.delete(group.ref));
		await batch.commit();
	}
	return { samples, old: old.length };
}
