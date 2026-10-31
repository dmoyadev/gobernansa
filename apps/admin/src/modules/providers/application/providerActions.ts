import type { Provider, ProviderCategory, ProviderRating } from '@gobernansa/shared/domain/provider.ts';
import type { User } from '@gobernansa/shared/domain/user.ts';
import { isValidIban, isValidNif, normalizeIban, normalizeTaxId } from '@gobernansa/shared/domain/fiscal.ts';
import { managesCommunity } from '@gobernansa/shared/domain/user.ts';
import { auth } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, doc, getDoc, getDocs, increment, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { providersRef } from './useProviders.ts';

export interface ProviderForm {
	name: string;
	category: ProviderCategory;
	phone: string;
	email: string;
	cif: string;
	fiscalName: string;
	address: string;
	iban: string;
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

// What's wrong with the fiscal data, if anything. Both are optional, but checked when given and changed, so a provider
// saved before they were checked can still be edited
export function findProviderError(form: ProviderForm, original?: Provider) {
	if (form.cif.trim() && normalizeTaxId(form.cif) !== normalizeTaxId(original?.cif ?? '') && !isValidNif(form.cif)) {
		return 'Revisa el NIF/CIF: la letra o el dígito de control no cuadran.';
	}
	if (form.iban.trim() && normalizeIban(form.iban) !== original?.iban && !isValidIban(form.iban)) {
		return 'Revisa el IBAN: no es válido, p. ej. ES91 2100 0418 4502 0005 1332.';
	}
}

// Creates the provider when there's no id, as newId: made when its form opened, so sending twice writes it once
export async function saveProvider(id: string | undefined, form: ProviderForm, newId = doc(providersRef).id) {
	const uid = currentUid();
	const now = serverTimestamp();
	const data = {
		name: form.name.trim(),
		category: form.category,
		phone: form.phone.trim(),
		email: form.email.trim(),
		cif: normalizeTaxId(form.cif),
		fiscalName: form.fiscalName.trim(),
		address: form.address.trim(),
		iban: normalizeIban(form.iban),
		notes: form.notes.trim(),
		communityIds: form.communityIds,
		updatedAt: now,
		updatedBy: uid,
	};
	if (id) {
		await updateDoc(doc(providersRef, id), data);
	} else {
		await setDoc(doc(providersRef, newId), { ...data, ratingSum: 0, ratingCount: 0, createdAt: now, createdBy: uid });
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

// Undoes deleteProvider from the copy in memory, with its id. Only for one without ratings, created by the user and
// shared only with communities they manage: the rules let nobody bring back someone else's rating, nor create a
// provider with counters, for another author or shared beyond theirs
export function canRestoreProvider(provider: Provider, me: (User & { id: string }) | null | undefined) {
	return provider.ratingCount === 0 && provider.createdBy === me?.id && provider.communityIds.every(id => managesCommunity(me, id));
}

export async function restoreProvider(provider: Provider) {
	const { id, ...data } = provider;
	await setDoc(doc(providersRef, id), data);
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
