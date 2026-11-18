import type { Activity } from '@gobernansa/shared/domain/activity.ts';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, endBefore, getDocs, limit, orderBy, query, startAfter } from 'firebase/firestore';

const PAGE_SIZE = 30;

function page(snapshot: { docs: QueryDocumentSnapshot[]; size: number }) {
	return { entries: snapshot.docs.map(entry => ({ ...entry.data(), id: entry.id }) as Activity), first: snapshot.docs[0], last: snapshot.docs.at(-1), full: snapshot.size === PAGE_SIZE };
}

// A page of a community's activity, newest first, after the last one loaded. 1 read per entry
export async function loadActivity(communityId: string, after?: QueryDocumentSnapshot) {
	return page(await getDocs(query(collection(db, 'communities', communityId, 'activity'), orderBy('at', 'desc'), ...(after ? [startAfter(after)] : []), limit(PAGE_SIZE))));
}

// What happened since the newest one loaded, a page at most: full when there's more than that
export async function loadNewerActivity(communityId: string, before: QueryDocumentSnapshot) {
	return page(await getDocs(query(collection(db, 'communities', communityId, 'activity'), orderBy('at', 'desc'), endBefore(before), limit(PAGE_SIZE))));
}
