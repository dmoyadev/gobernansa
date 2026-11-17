import { bookingId, bookingTotal, getSlots } from '../../../packages/shared/domain/booking.ts';
import { getBookingFees } from '../../../packages/shared/domain/community.ts';
import { commonAreas, days, isoDate, now, properties, uids, userById } from './cast.js';

const today = now.getDay() || 7;

// Days from today of an ISO weekday in a week, 0 this one, so each neighbour's maxPerWeek holds whatever today is
const offset = (week, weekday) => week * 7 + weekday - today;
// The office opens Monday to Friday, as its comunicado on office hours says
const weekend = n => [0, 6].includes(days(n).getDay());

// Booked by the office for owners without an account, who call or come by: no uid, as in the census
const noAccount = { francisco: 'prop10', antonia: 'c2prop1' };

function person(who) {
	if (noAccount[who]) {
		return { uid: '', name: properties.find(property => property.id === noAccount[who]).ownerName };
	}
	return { uid: uids[who], name: userById(uids[who]).name };
}

/*
 * [area, week, ISO weekday, from, who, how it was paid]. Free areas take no payment; one with a price or fianza is
 * owed without it. paid: 'card' online when booking, 'bizum' online the day after, 'office' at the office the day
 * after (a weekday), 'reverted' online but annulled by the office (owed again). returned: days after it that the fianza
 * came back, landing on a weekday.
 * Online only for upcoming ones booked in the last days, whose gateway payout isn't due yet: the bank's payouts
 * (charges group) only carry the charges' payments
 */
const bookings = {
	comm1: [
		// Before Andrés was blocked
		['padel', -2, 1, '19:30', 'andres'],
		['padel', -2, 3, '18:00', 'lucia'],
		['padel', -2, 5, '19:30', 'javier'],
		['padel', -2, 6, '10:30', 'rosa'],
		['padel', -1, 1, '18:00', 'lucia'],
		['padel', -1, 2, '19:30', 'javier'],
		['padel', -1, 3, '18:00', 'lucia'],
		['padel', -1, 4, '09:00', 'carmen'],
		['padel', -1, 6, '10:30', 'rosa'],
		['padel', -1, 6, '18:00', 'javier'],
		['padel', -1, 7, '12:00', 'maria'],
		['padel', 0, 1, '18:00', 'lucia'],
		['padel', 0, 2, '19:30', 'javier'],
		['padel', 0, 3, '19:30', 'lucia'],
		['padel', 0, 4, '09:00', 'carmen'],
		['padel', 0, 5, '18:00', 'rosa'],
		['padel', 0, 6, '10:30', 'javier'],
		['padel', 0, 7, '12:00', 'maria'],
		// Today's, so the day the app opens on has a taken slot
		['padel', 0, today, '16:30', 'rosa'],
		// Lucía's three: the most she can book that week
		['padel', 1, 2, '18:00', 'lucia'],
		['padel', 1, 4, '18:00', 'lucia'],
		['padel', 1, 6, '10:30', 'lucia'],
		['padel', 1, 1, '19:30', 'javier'],
		['padel', 1, 3, '19:30', 'javier'],
		['padel', 1, 5, '18:00', 'rosa'],
		['padel', 1, 7, '10:30', 'carmen'],
		['padel', 2, 1, '19:30', 'javier'],
		['padel', 2, 3, '18:00', 'rosa'],
		['padel', 2, 6, '12:00', 'lucia'],

		['sala', -2, 6, '18:00', 'lucia', { paid: 'office', returned: 2 }],
		['sala', -2, 5, '14:00', 'javier', { paid: 'office', returned: 3 }],
		// She called the office, and paid there: the fianza is still to give back
		['sala', -1, 6, '14:00', 'rosa', { paid: 'office' }],
		// The debtor didn't pay this one either
		['sala', -1, 7, '18:00', 'maria'],
		['sala', 0, 6, '10:00', 'francisco', { paid: 'office' }],
		['sala', 1, 5, '18:00', 'carmen', { paid: 'bizum', pay: 'pay_booking_sala_carmen' }],
		['sala', 1, 6, '14:00', 'lucia'],
		['sala', 2, 5, '14:00', 'maria', { paid: 'reverted', pay: 'pay_booking_sala_maria' }],
		['sala', 2, 6, '18:00', 'javier', { paid: 'card', pay: 'pay_booking_sala_javier' }],

		['barbacoa', -2, 7, '12:00', 'javier', { paid: 'office', returned: 1 }],
		['barbacoa', -2, 7, '17:00', 'lucia', { paid: 'office', returned: 2 }],
		// The grill was left dirty: the office holds the fianza
		['barbacoa', -1, 7, '17:00', 'carmen', { paid: 'office' }],
		['barbacoa', 1, 6, '17:00', 'javier', { paid: 'bizum', pay: 'pay_booking_barbacoa_javier' }],
		['barbacoa', 1, 7, '12:00', 'rosa'],
		['barbacoa', 2, 7, '12:00', 'lucia', { paid: 'card', pay: 'pay_booking_barbacoa_lucia' }],
	],
	comm2: [
		['sala', -2, 2, '18:00', 'elena'],
		['sala', -1, 1, '19:00', 'tomas'],
		['sala', -1, 4, '17:00', 'pablo'],
		['sala', -1, 4, '18:00', 'elena'],
		['sala', 0, 3, '18:00', 'pablo'],
		['sala', 0, today, '12:00', 'tomas'],
		['sala', 1, 2, '19:00', 'elena'],
		['sala', 1, 4, '10:00', 'antonia'],
		['sala', 1, 5, '18:00', 'pablo'],
		['sala', 2, 1, '18:00', 'tomas'],
	],
};

const CREATED_AT = ['21:30', '09:40', '13:05', '18:20'];
const office = { updatedBy: uids.office };

export default {
	id: 'bookings',
	label: 'Reservas de zonas comunes',
	hint: 'Pádel, sala y barbacoa de las dos semanas pasadas y las dos próximas: gratis, pendientes, pagadas y fianzas',
	requires: ['core'],
	collections: [],
	communityCollections: ['bookings'],
	seed(set) {
		for (const [communityId, list] of Object.entries(bookings)) {
			const areas = commonAreas[communityId];
			const fees = getBookingFees(areas);
			list.forEach(([areaId, week, weekday, from, who, { paid, pay, returned } = {}], index) => {
				const settings = areas.find(area => area.id === areaId).booking;
				const n = offset(week, weekday);
				// Not bookable that far ahead when it was booked, yesterday at the latest
				if (n >= (settings.advanceDays ?? 14)) {
					return;
				}

				const date = isoDate(n);
				const slot = getSlots(settings, date).find(item => item.from === from);
				if (!slot) {
					throw new Error(`bookings: ${areaId} has no ${from} slot on ${date}`);
				}

				const id = bookingId(areaId, date, from);
				const { price = 0, deposit = 0 } = fees[areaId] ?? {};
				// Two days ago at the latest when it was paid or annulled the day after, so that day is over whenever it's seeded
				let created = Math.min(n - 2 - index % 6, paid && paid !== 'card' ? -2 : -1);
				// Earlier when the office booked it (for someone without an account) or took or annulled its payment on a weekend
				const onWeekend = day => (noAccount[who] && weekend(day)) || ((paid === 'office' || paid === 'reverted') && weekend(day + 1));
				while (onWeekend(created)) {
					created--;
				}
				const createdAt = days(created, CREATED_AT[index % 4]);
				// By Bizum whenever the neighbour got round to it, at the office during its hours
				const later = days(created + 1, paid === 'bizum' ? CREATED_AT[index % 4] : '11:20');
				const paidAt = paid === 'card' ? createdAt : paid === 'bizum' || paid === 'office' ? later : null;
				// All on a weekday of last week or before, so it's never in the future
				const depositReturnedAt = returned ? days(n + returned, '11:00') : null;
				const method = paid === 'bizum' ? 'bizum' : 'card';
				const booking = {
					communityId,
					areaId,
					date,
					from,
					to: slot.to,
					...person(who),
					createdAt,
					price: price || undefined,
					deposit: deposit || undefined,
					depositReturnedAt: deposit ? depositReturnedAt : undefined,
					paidAt: price + deposit ? paidAt : undefined,
					payment: pay && paidAt ? { id: pay, mode: 'test', method, card: method === 'card' ? { brand: 'Visa', last4: '4242' } : undefined } : undefined,
				};
				// What the office touched last: the payment it took or annulled, the fianza it gave back
				const touched = depositReturnedAt ?? (paid === 'office' ? paidAt : paid === 'reverted' ? later : null);
				set(`communities/${communityId}/bookings/${id}`, touched ? { ...booking, ...office, updatedAt: touched } : booking);

				if (pay) {
					const paidOnline = paid === 'reverted' ? createdAt : paidAt;
					set(`communities/${communityId}/payments/${pay}`, {
						communityId,
						mode: 'test',
						method,
						amount: bookingTotal({ price, deposit }),
						uid: booking.uid,
						bookingId: id,
						card: method === 'card' ? { brand: 'Visa', last4: '4242' } : undefined,
						createdAt: paidOnline,
						...(paid === 'reverted' ? { revertedAt: later, revertedBy: uids.office } : {}),
					});
				}
			});
		}
	},
};
