import { newWorkOrderToken } from '@gobernansa/shared/domain/workOrder.ts';
import { doc, getDoc, getFirestore, setDoc } from 'firebase/firestore';

let cached: { uid: string; key: Promise<string> } | undefined;

/**
 * The user's secret key for the issues they report (Issue.authorKey), at users/{uid}/keys/issues: neighbours see it on
 * each issue but can't tell whose it is, so they never know who reported one. Only its owner reads it.
 * Made the first time it's needed, with the same 192 random bits as a parte's link, then read once per session
 */
export async function getAuthorKey(uid: string) {
	if (cached?.uid !== uid) {
		const key = readOrCreate(uid);
		cached = { uid, key };
		// Asked again next time, e.g. offline
		key.catch(() => cached = undefined);
	}
	return cached.key;
}

async function readOrCreate(uid: string) {
	const keyRef = doc(getFirestore(), 'users', uid, 'keys', 'issues');
	const saved = (await getDoc(keyRef)).data()?.key as string | undefined;
	if (saved) {
		return saved;
	}

	const key = newWorkOrderToken();
	try {
		await setDoc(keyRef, { key });
		return key;
	} catch (e) {
		// Never changed once made, so another tab may have made it meanwhile
		const other = (await getDoc(keyRef)).data()?.key as string | undefined;
		if (other) {
			return other;
		}
		throw e;
	}
}
