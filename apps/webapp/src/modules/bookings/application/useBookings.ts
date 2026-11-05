import type { Booking } from '@gobernansa/shared/domain/booking.ts';
import type { BookingFee } from '@gobernansa/shared/domain/community.ts';
import type { Ref } from 'vue';
import type { Checkout } from '@/modules/finances/application/useMyCharges.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { bookingId, bookingTotal } from '@gobernansa/shared/domain/booking.ts';
import { collection, deleteDoc, doc, getDoc, getFirestore, query, serverTimestamp, setDoc, where, writeBatch } from 'firebase/firestore';
import { computed } from 'vue';
import { useCollection } from 'vuefire';
import { preparePayment } from '@/modules/finances/application/useMyCharges.ts';

// Equality filters only, so no composite index is needed
export function useBookings(date: Ref<string>, areaId: Ref<string | undefined>) {
	const { user } = useAuth();
	const db = getFirestore();
	const communityId = computed(() => user.value?.communityId);
	const bookingsRef = computed(() => communityId.value ? collection(db, 'communities', communityId.value, 'bookings') : null);

	// Live, so a slot someone else takes shows up as taken right away
	const dayBookings = useCollection<Booking>(computed(() => bookingsRef.value && date.value
		? query(bookingsRef.value, where('date', '==', date.value))
		: null));

	// All of the user's bookings of the area, to count them against maxPerWeek and list the upcoming ones
	// ponytail: past ones are read too, filter by date (needs an index) if a neighbour piles up hundreds
	const myBookings = useCollection<Booking>(computed(() => bookingsRef.value && user.value && areaId.value
		? query(bookingsRef.value, where('uid', '==', user.value.id), where('areaId', '==', areaId.value))
		: null));

	// An area with a price or fianza is booked owed (paidAt null), or paid at once with the test checkout
	async function book(slot: { areaId: string; date: string; from: string; to: string }, { price, deposit }: BookingFee, checkout?: Checkout) {
		if (!user.value || !communityId.value) {
			throw new Error('The user must be signed in to book');
		}

		const id = bookingId(slot.areaId, slot.date, slot.from);
		const total = price + deposit;
		const booking = {
			...slot,
			communityId: communityId.value,
			uid: user.value.id,
			name: user.value.name || '',
			createdAt: serverTimestamp(),
			...(price ? { price } : {}),
			...(deposit ? { deposit, depositReturnedAt: null } : {}),
			...(total ? { paidAt: null } : {}),
		};
		// Its id is the slot, so the rules turn down a second booking of it (a create on an existing document is an update)
		const ref = doc(db, 'communities', communityId.value, 'bookings', id);
		if (!total || !checkout) {
			await setDoc(ref, booking);
			return;
		}

		const payment = preparePayment(db, communityId.value, user.value.id, total, { bookingId: id }, checkout);
		const batch = writeBatch(db);
		batch.set(ref, { ...booking, paidAt: serverTimestamp(), payment: payment.payment });
		batch.set(payment.ref, payment.data);
		await batch.commit();
		return payment.payment;
	}

	// One booked owed, paid later from the app
	async function pay(booking: Booking, checkout: Checkout) {
		if (!user.value || !communityId.value) {
			throw new Error('The user must be signed in to pay');
		}

		const payment = preparePayment(db, communityId.value, user.value.id, bookingTotal(booking), { bookingId: booking.id }, checkout);
		const batch = writeBatch(db);
		batch.update(doc(db, 'communities', communityId.value, 'bookings', booking.id), { paidAt: serverTimestamp(), payment: payment.payment });
		batch.set(payment.ref, payment.data);
		await batch.commit();
		return payment.payment;
	}

	async function cancel(booking: Booking) {
		if (!communityId.value) {
			throw new Error('The user must be signed in to cancel a booking');
		}

		await deleteDoc(doc(db, 'communities', communityId.value, 'bookings', booking.id));
	}

	return { dayBookings, myBookings, book, pay, cancel };
}

// One booking, for its justificante
export async function loadBooking(communityId: string, id: string) {
	const booking = await getDoc(doc(getFirestore(), 'communities', communityId, 'bookings', id));
	return booking.exists() ? { ...booking.data(), id: booking.id } as Booking : undefined;
}
