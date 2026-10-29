import type { Booking } from '@gobernansa/shared/domain/booking.ts';
import type { Ref } from 'vue';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { bookingId } from '@gobernansa/shared/domain/booking.ts';
import { collection, deleteDoc, doc, getFirestore, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { computed } from 'vue';
import { useCollection } from 'vuefire';

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

	async function book(slot: { areaId: string; date: string; from: string; to: string }) {
		if (!user.value || !communityId.value) {
			throw new Error('The user must be signed in to book');
		}

		// Its id is the slot, so the rules turn down a second booking of it (a create on an existing document is an update)
		await setDoc(doc(db, 'communities', communityId.value, 'bookings', bookingId(slot.areaId, slot.date, slot.from)), {
			...slot,
			communityId: communityId.value,
			uid: user.value.id,
			name: user.value.name || '',
			createdAt: serverTimestamp(),
		});
	}

	async function cancel(booking: Booking) {
		if (!communityId.value) {
			throw new Error('The user must be signed in to cancel a booking');
		}

		await deleteDoc(doc(db, 'communities', communityId.value, 'bookings', booking.id));
	}

	return { dayBookings, myBookings, book, cancel };
}
