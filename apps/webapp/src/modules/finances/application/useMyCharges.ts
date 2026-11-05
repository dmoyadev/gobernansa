import type { Charge } from '@gobernansa/shared/domain/finance.ts';
import type { CardSummary, OnlinePaymentMethod, PaymentRef } from '@gobernansa/shared/domain/payment.ts';
import type { Firestore } from 'firebase/firestore';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { outstanding } from '@gobernansa/shared/domain/finance.ts';
import { collection, doc, getDoc, getDocs, getFirestore, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { computed } from 'vue';
import { useCollection } from 'vuefire';

// What the test checkout gives back, only the card's brand and last digits
export interface Checkout {
	method: OnlinePaymentMethod;
	card?: CardSummary;
}

/**
 * The payment record of a charge or booking paid from the app, and the reference it keeps. Its id is made here, so it's
 * written in the same batch as what it pays (the rules check one against the other)
 */
export function preparePayment(db: Firestore, communityId: string, uid: string, amount: number, target: { chargeId: string } | { bookingId: string }, { method, card }: Checkout) {
	const ref = doc(collection(db, 'communities', communityId, 'payments'));
	const payment: PaymentRef = { id: ref.id, mode: 'test', method, ...(card ? { card } : {}) };
	const data = { communityId, mode: 'test', method, amount, uid, ...target, ...(card ? { card } : {}), createdAt: serverTimestamp() };
	return { ref, data, payment };
}

function chargesRef(db: Firestore, communityId: string) {
	return collection(db, 'communities', communityId, 'charges');
}

// The user's charges: the unpaid ones live (few, and they change when paid), the paid history read on demand.
// The rules only let owners read theirs, so every query filters by ownerUid
export function useMyCharges() {
	const { user } = useAuth();
	const db = getFirestore();
	const communityId = computed(() => user.value?.communityId);

	const unpaid = useCollection<Charge>(computed(() => communityId.value && user.value
		? query(chargesRef(db, communityId.value), where('ownerUid', '==', user.value.id), where('paidAt', '==', null))
		: null));

	async function loadPaid() {
		if (!communityId.value || !user.value) {
			return [];
		}
		const snapshot = await getDocs(query(chargesRef(db, communityId.value), where('ownerUid', '==', user.value.id)));
		return snapshot.docs.map(charge => ({ ...charge.data(), id: charge.id }) as Charge)
			.filter(charge => charge.paidAt)
			.sort((a, b) => b.paidAt!.toMillis() - a.paidAt!.toMillis());
	}

	return { unpaid, loadPaid };
}

// What's left of it, after any entregas a cuenta
export async function payMyCharge(communityId: string, uid: string, charge: Charge, checkout: Checkout) {
	const db = getFirestore();
	const { ref, data, payment } = preparePayment(db, communityId, uid, outstanding(charge), { chargeId: charge.id }, checkout);
	const batch = writeBatch(db);
	batch.set(ref, data);
	batch.update(doc(chargesRef(db, communityId), charge.id), { paidAt: serverTimestamp(), payment, updatedAt: serverTimestamp(), updatedBy: uid });
	await batch.commit();
	return payment;
}

// One of the user's charges, for its receipt or its entregas a cuenta
export async function loadMyCharge(communityId: string, chargeId: string) {
	const charge = await getDoc(doc(chargesRef(getFirestore(), communityId), chargeId));
	return charge.exists() ? { ...charge.data(), id: charge.id } as Charge : undefined;
}
