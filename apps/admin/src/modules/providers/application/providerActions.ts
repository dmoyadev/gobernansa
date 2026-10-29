import type { Provider, ProviderCategory, ProviderRating } from '@gobernansa/shared/domain/provider.ts';
import { auth } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, doc, getDoc, getDocs, increment, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { providersRef } from './useProviders.ts';

export interface ProviderForm {
	name: string;
	category: ProviderCategory;
	phone: string;
	email: string;
	cif: string;
	notes: string;
	communityIds: string[];
}

function currentUid() {
	const uid = auth.currentUser?.uid;
	if (!uid) {
		throw new Error('The admin must be signed in to manage providers');
	}
	return uid;
}

// Creates the provider when there's no id
export async function saveProvider(id: string | undefined, form: ProviderForm) {
	const uid = currentUid();
	const now = serverTimestamp();
	const data = {
		name: form.name.trim(),
		category: form.category,
		phone: form.phone.trim(),
		email: form.email.trim(),
		cif: form.cif.trim(),
		notes: form.notes.trim(),
		communityIds: form.communityIds,
		updatedAt: now,
		updatedBy: uid,
	};
	if (id) {
		await updateDoc(doc(providersRef, id), data);
	} else {
		await setDoc(doc(providersRef), { ...data, ratingSum: 0, ratingCount: 0, createdAt: now, createdBy: uid });
	}
}

// ponytail: its ratings stay behind, as rules only let each author delete theirs; nothing reads them without the provider
// Along with its ratings, so none are left behind. ponytail: one batch, up to 499 ratings
export async function deleteProvider(id: string) {
	const ratings = await getDocs(ratingsRef(id));
	const batch = writeBatch(providersRef.firestore);
	ratings.docs.forEach(rating => batch.delete(rating.ref));
	batch.delete(doc(providersRef, id));
	await batch.commit();
}

function ratingsRef(providerId: string) {
	return collection(providersRef, providerId, 'ratings');
}

// Once, when the detail is opened, so the directory itself costs no reads per rating
export async function loadRatings(providerId: string) {
	const snapshot = await getDocs(ratingsRef(providerId));
	return snapshot.docs
		.map(rating => ({ ...rating.data(), id: rating.id }) as ProviderRating)
		.sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
}

// One per person: rating again replaces theirs, and the counters move by the difference
export async function rateProvider(provider: Pick<Provider, 'id'>, rating: { score: ProviderRating['score']; comment: string; communityId: string; authorName: string }) {
	const uid = currentUid();
	const ratingRef = doc(ratingsRef(provider.id), uid);
	const previous = await getDoc(ratingRef);
	const previousScore = previous.exists() ? (previous.data() as ProviderRating).score : 0;

	const batch = writeBatch(providersRef.firestore);
	batch.set(ratingRef, {
		score: rating.score,
		comment: rating.comment.trim(),
		communityId: rating.communityId,
		authorId: uid,
		authorName: rating.authorName,
		createdAt: serverTimestamp(),
	});
	batch.update(doc(providersRef, provider.id), {
		ratingSum: increment(rating.score - previousScore),
		ratingCount: increment(previous.exists() ? 0 : 1),
	});
	await batch.commit();
}
