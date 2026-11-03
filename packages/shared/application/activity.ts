import type { DocumentData, DocumentReference } from 'firebase/firestore';
import type { Activity } from '../domain/activity.ts';
import { collection, doc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../infrastructure/firebase.ts';
import useAuth from './useAuth.ts';

// Bumped with each change logged here, so the pages kept alive know whether what they read once may be outdated
let changes = 0;
export const changeCount = () => changes;

/**
 * Adds to the batch the entry of the community's activity log for a change made in it, so the change and who made it
 * are saved together or not at all (a transaction's too). The rules require it to be dated by the server and signed by whoever makes it
 */
export function logActivity(batch: { set: (ref: DocumentReference, data: DocumentData) => unknown }, communityId: string, entry: Pick<Activity, 'area' | 'summary' | 'link'>) {
	const uid = auth.currentUser?.uid;
	if (!uid) {
		throw new Error('The user must be signed in to change a community');
	}

	changes++;
	batch.set(doc(collection(db, 'communities', communityId, 'activity')), {
		...entry,
		...(entry.link ? {} : { link: null }),
		at: serverTimestamp(),
		by: uid,
		byName: useAuth().user.value?.name || auth.currentUser?.email || '',
	});
}
