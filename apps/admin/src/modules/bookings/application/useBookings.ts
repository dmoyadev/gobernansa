import type { Booking } from '@gobernansa/shared/domain/booking.ts';
import type { CommonArea } from '@gobernansa/shared/domain/community.ts';
import type { Ref } from 'vue';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, deleteField, doc, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { computed } from 'vue';
import { useCollection } from 'vuefire';

// The bookings of the given days, of every area. A single 'in' filter, so no index is needed
export function useBookingsOf(communityId: string, dates: Ref<string[]>) {
	return useCollection<Booking>(computed(() => dates.value.length
		? query(collection(db, 'communities', communityId, 'bookings'), where('date', 'in', dates.value))
		: null));
}

// The whole list, in the new shape: the legacy bookableAreas go away once they're in commonAreas
export async function saveCommonAreas(communityId: string, areas: CommonArea[], summary: string) {
	const uid = auth.currentUser?.uid;
	if (!uid) {
		throw new Error('The admin must be signed in to change the common areas');
	}

	const batch = writeBatch(db);
	batch.update(doc(db, 'communities', communityId), { commonAreas: areas, bookableAreas: deleteField(), updatedAt: serverTimestamp(), updatedBy: uid });
	logActivity(batch, communityId, { area: 'booking', summary, link: `/communities/${communityId}/locations` });
	await batch.commit();
}

export async function cancelBooking(communityId: string, booking: Booking, areaName: string) {
	const batch = writeBatch(db);
	batch.delete(doc(db, 'communities', communityId, 'bookings', booking.id));
	logActivity(batch, communityId, {
		area: 'booking',
		summary: `Anuló la reserva de ${booking.name} en ${areaName} el ${booking.date} a las ${booking.from}`,
		link: `/communities/${communityId}/locations/${booking.areaId}`,
	});
	await batch.commit();
}
