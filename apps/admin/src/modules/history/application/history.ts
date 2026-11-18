import type { Query, QueryDocumentSnapshot } from 'firebase/firestore';
import type { Action, Change } from '../domain/history.ts';
import { db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, getDocs, limit, orderBy, query, startAfter, where } from 'firebase/firestore';

/*
 * Historial, for the team: every change to the data (audit, by the functions) and everything each user did (actions, by
 * the apps), newest first. 25 at a time and once, not live, as both grow with every write
 */

const PAGE_SIZE = 25;
// 'all' and not '', which the page's select doesn't show
export const ALL = 'all';

async function page<T>(base: Query, after?: QueryDocumentSnapshot) {
	const snapshot = await getDocs(query(base, ...(after ? [startAfter(after)] : []), limit(PAGE_SIZE)));
	return { items: snapshot.docs.map(entry => ({ ...entry.data(), id: entry.id }) as T), last: snapshot.docs.at(-1), more: snapshot.size === PAGE_SIZE };
}

// Each filter with the date needs its index (firestore.indexes.json); Firestore merges them when there are several. Every
// change to one document (path) whatever the other filters say. 1 read per change
export async function loadChanges(filter: { community: string; collection: string; op: string; person?: string; path?: string }, after?: QueryDocumentSnapshot) {
	const filters = filter.path
		? [where('path', '==', filter.path)]
		: [
				...(filter.community !== ALL ? [where('communityId', '==', filter.community)] : []),
				...(filter.collection !== ALL ? [where('collection', '==', filter.collection)] : []),
				...(filter.op !== ALL ? [where('op', '==', filter.op)] : []),
				...(filter.person ? [where('actorId', '==', filter.person)] : []),
			];
	return page<Change>(query(collection(db, 'audit'), ...filters, orderBy('at', 'desc')), after);
}

// What users did, with the same filters' rule. 1 read per action
export async function loadActions(filter: { person?: string; type: string; app: string }, after?: QueryDocumentSnapshot) {
	return page<Action>(query(
		collection(db, 'actions'),
		...(filter.person ? [where('uid', '==', filter.person)] : []),
		...(filter.type !== ALL ? [where('type', '==', filter.type)] : []),
		...(filter.app !== ALL ? [where('app', '==', filter.app)] : []),
		orderBy('at', 'desc'),
	), after);
}
