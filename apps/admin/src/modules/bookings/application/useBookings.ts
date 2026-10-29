import type { Booking } from '@gobernansa/shared/domain/booking.ts';
import type { BookableArea } from '@gobernansa/shared/domain/community.ts';
import type { Ref } from 'vue';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, doc, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { computed } from 'vue';
import { useCollection } from 'vuefire';

// The bookings of one day, of every area. Equality only, so no index is needed
export function useDayBookings(communityId: string, date: Ref<string>) {
	return useCollection<Booking>(computed(() => date.value
		? query(collection(db, 'communities', communityId, 'bookings'), where('date', '==', date.value))
		: null));
}

export async function saveBookableAreas(communityId: string, areas: BookableArea[]) {
	const uid = auth.currentUser?.uid;
	if (!uid) {
		throw new Error('The admin must be signed in to change the bookable areas');
	}

	const batch = writeBatch(db);
	batch.update(doc(db, 'communities', communityId), { bookableAreas: areas, updatedAt: serverTimestamp(), updatedBy: uid });
	logActivity(batch, communityId, {
		area: 'booking',
		summary: areas.length ? `Actualizó las zonas reservables: ${areas.map(area => area.name).join(', ')}` : 'Quitó todas las zonas reservables',
		link: `/communities/${communityId}/bookings`,
	});
	await batch.commit();
}

export async function cancelBooking(communityId: string, booking: Booking, areaName: string) {
	const batch = writeBatch(db);
	batch.delete(doc(db, 'communities', communityId, 'bookings', booking.id));
	logActivity(batch, communityId, {
		area: 'booking',
		summary: `Anuló la reserva de ${booking.name} en ${areaName} el ${booking.date} a las ${booking.from}`,
		link: `/communities/${communityId}/bookings`,
	});
	await batch.commit();
}
