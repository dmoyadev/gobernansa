import type { WriteBatch } from 'firebase/firestore';
import type { Activity } from '../domain/activity.ts';
import { collection, doc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../infrastructure/firebase.ts';
import useAuth from './useAuth.ts';

/**
 * Adds to the batch the entry of the community's activity log for a change made in it, so the change and who made it
 * are saved together or not at all. The rules require it to be dated by the server and signed by whoever makes it
 */
export function logActivity(batch: WriteBatch, communityId: string, entry: Pick<Activity, 'area' | 'summary' | 'link'>) {
	const uid = auth.currentUser?.uid;
	if (!uid) {
		throw new Error('The user must be signed in to change a community');
	}

	batch.set(doc(collection(db, 'communities', communityId, 'activity')), {
		...entry,
		...(entry.link ? {} : { link: null }),
		at: serverTimestamp(),
		by: uid,
		byName: useAuth().user.value?.name || auth.currentUser?.email || '',
	});
}
