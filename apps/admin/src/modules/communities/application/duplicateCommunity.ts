import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { Obligation } from '@gobernansa/shared/domain/obligation.ts';
import type { CommunityForm } from '../domain/communityForm.ts';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { getBookingFees, getCommonAreas } from '@gobernansa/shared/domain/community.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { arrayUnion, collection, doc, FieldValue, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { providersRef } from '@/modules/providers/application/useProviders.ts';
import { fromCommunityForm } from '../domain/communityForm.ts';

/**
 * Creates a community from the form, prefilled from another one used as a template, plus what the form doesn't edit:
 * its common areas, obligations and providers. The source comes already loaded by the form. The new id is made when the
 * form opens (newId), and each obligation keeps its source's id, so sending it twice doesn't duplicate anything
 */
export async function duplicateCommunity(id: string, newId: string, form: CommunityForm, source: Community | undefined) {
	const uid = auth.currentUser?.uid;
	if (!uid) {
		throw new Error('The admin must be signed in to duplicate a community');
	}
	if (!source) {
		throw new Error('La comunidad ya no existe.');
	}

	const [obligations, providers] = await Promise.all([
		getDocs(collection(db, 'communities', id, 'obligations')),
		getDocs(query(providersRef, where('communityIds', 'array-contains', id))),
	]);

	const batch = writeBatch(db);
	const communityRef = doc(collection(db, 'communities'), newId);
	const now = serverTimestamp();
	const audit = { createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid };
	// The form's empty fields come as deleteField(), only valid when merging, and a new document has nothing to remove
	const fields = Object.fromEntries(Object.entries(fromCommunityForm(form)).filter(([, value]) => !(value instanceof FieldValue)));

	const commonAreas = getCommonAreas(source);
	batch.set(communityRef, withoutUndefined({
		...fields,
		commonAreas,
		// What the rules check a booking's price against, kept along with the areas
		bookingFees: getBookingFees(commonAreas),
		...audit,
	}));

	for (const snapshot of obligations.docs) {
		const { type, title, dueAt, everyMonths, provider, notes } = snapshot.data() as Obligation;
		batch.set(doc(collection(communityRef, 'obligations'), snapshot.id), withoutUndefined({
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

	logActivity(batch, communityRef.id, { area: 'community', summary: `Creó la comunidad «${form.name.trim()}» a partir de «${source.name}»`, link: `/communities/${communityRef.id}` });
	// ponytail: a batch takes 500 writes, more obligations and providers than that would need several
	await batch.commit();
}

// Firestore rejects undefined, and optional fields the source doesn't have are left out
function withoutUndefined<T extends object>(data: T) {
	return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) as T;
}
