import type { Booking } from '@gobernansa/shared/domain/booking.ts';
import type { CommonArea } from '@gobernansa/shared/domain/community.ts';
import type { Timestamp } from 'firebase/firestore';
import type { Ref } from 'vue';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { getBookingFees } from '@gobernansa/shared/domain/community.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
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
	batch.update(doc(db, 'communities', communityId), { commonAreas: areas, bookingFees: getBookingFees(areas), bookableAreas: deleteField(), updatedAt: serverTimestamp(), updatedBy: uid });
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

// Puts back a cancelled one exactly as it was, from what was shown: the same id, so the slot is taken again
export async function restoreBooking(communityId: string, { id, ...booking }: Booking, areaName: string) {
	const batch = writeBatch(db);
	batch.set(doc(db, 'communities', communityId, 'bookings', id), booking);
	logActivity(batch, communityId, {
		area: 'booking',
		summary: `Restauró la reserva de ${booking.name} en ${areaName} el ${booking.date} a las ${booking.from}`,
		link: `/communities/${communityId}/locations/${booking.areaId}`,
	});
	await batch.commit();
}

// Fianzas still held, of every area and date. Few at a time, so kept live. Bookings without one lack the field and don't match
export function useHeldDeposits(communityId: string) {
	return useCollection<Booking>(query(collection(db, 'communities', communityId, 'bookings'), where('depositReturnedAt', '==', null)));
}

function signedUid() {
	const uid = auth.currentUser?.uid;
	if (!uid) {
		throw new Error('The admin must be signed in to change a booking');
	}
	return uid;
}

// Paid at the office or by transfer, or owed again. paidAt is given, so undoing puts back the exact date it had.
// Marking a payment from the app unpaid drops it, as with charges, and undoing it brings it back
export async function setBookingPaid(communityId: string, booking: Booking, paidAt: Timestamp | null, areaName: string) {
	const uid = signedUid();
	const batch = writeBatch(db);
	batch.update(doc(db, 'communities', communityId, 'bookings', booking.id), {
		paidAt,
		...(booking.payment ? { payment: paidAt ? booking.payment : deleteField() } : {}),
		updatedAt: serverTimestamp(),
		updatedBy: uid,
	});
	if (booking.payment) {
		batch.update(doc(db, 'communities', communityId, 'payments', booking.payment.id), paidAt
			? { revertedAt: deleteField(), revertedBy: deleteField() }
			: { revertedAt: serverTimestamp(), revertedBy: uid });
	}
	logActivity(batch, communityId, {
		area: 'booking',
		summary: `Marcó la reserva de ${booking.name} en ${areaName} el ${booking.date} a las ${booking.from} como ${paidAt ? 'pagada' : 'pendiente de pago'}`,
		link: `/communities/${communityId}/locations/${booking.areaId}`,
	});
	await batch.commit();
}

export async function setDepositReturned(communityId: string, booking: Booking, returnedAt: Timestamp | null, areaName: string) {
	const batch = writeBatch(db);
	batch.update(doc(db, 'communities', communityId, 'bookings', booking.id), { depositReturnedAt: returnedAt, updatedAt: serverTimestamp(), updatedBy: signedUid() });
	logActivity(batch, communityId, {
		area: 'booking',
		summary: `${returnedAt ? 'Devolvió' : 'Volvió a retener'} la fianza de ${formatCents(booking.deposit ?? 0)} de ${booking.name} en ${areaName} (${booking.date})`,
		link: `/communities/${communityId}/locations/${booking.areaId}`,
	});
	await batch.commit();
}
