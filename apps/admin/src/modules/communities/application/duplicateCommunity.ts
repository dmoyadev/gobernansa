import type { Obligation } from '@gobernansa/shared/domain/obligation.ts';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { arrayUnion, collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { providersRef } from '@/modules/providers/application/useProviders.ts';
import { loadCommunity } from './useCommunities.ts';

/**
 * Creates a community from another one as a template: its areas, contacts, settings, obligations and providers.
 * The address and fiscal data belong to the building, so they're left for the admin to fill in. Returns the new id
 */
export async function duplicateCommunity(id: string): Promise<string> {
	const uid = auth.currentUser?.uid;
	if (!uid) {
		throw new Error('The admin must be signed in to duplicate a community');
	}

	const [source, obligations, providers] = await Promise.all([
		loadCommunity(id),
		getDocs(collection(db, 'communities', id, 'obligations')),
		getDocs(query(providersRef, where('communityIds', 'array-contains', id))),
	]);
	if (!source) {
		throw new Error('La comunidad ya no existe.');
	}

	const batch = writeBatch(db);
	const communityRef = doc(collection(db, 'communities'));
	const now = serverTimestamp();
	const name = `${source.name} (copia)`;
	const audit = { createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid };

	batch.set(communityRef, withoutUndefined({
		name,
		address: '',
		constructionYear: source.constructionYear,
		commonAreas: source.commonAreas,
		contacts: source.contacts,
		monthlyVotes: source.monthlyVotes,
		bookableAreas: source.bookableAreas,
		...audit,
	}));

	for (const snapshot of obligations.docs) {
		const { type, title, dueAt, everyMonths, provider, notes } = snapshot.data() as Obligation;
		batch.set(doc(collection(communityRef, 'obligations')), withoutUndefined({
			communityId: communityRef.id,
			type,
			title,
			dueAt,
			everyMonths,
			provider,
			notes,
			...audit,
		}));
	}

	for (const provider of providers.docs) {
		batch.update(provider.ref, { communityIds: arrayUnion(communityRef.id), updatedAt: now, updatedBy: uid });
	}

	logActivity(batch, communityRef.id, { area: 'community', summary: `Creó la comunidad a partir de «${source.name}»`, link: `/communities/${communityRef.id}` });
	// ponytail: a batch takes 500 writes, more obligations and providers than that would need several
	await batch.commit();

	return communityRef.id;
}

// Firestore rejects undefined, and optional fields the source doesn't have are left out
function withoutUndefined<T extends object>(data: T) {
	return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) as T;
}
