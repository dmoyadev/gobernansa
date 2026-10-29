import type { Timestamp } from 'firebase/firestore';
import type { BookableArea } from './community.ts';

// At communities/{communityId}/bookings, stored as `${areaId}_${date}_${from}` so a slot can only be booked once
export interface Booking {
	id: string;
	communityId: string;
	areaId: string;
	// 'YYYY-MM-DD' and 'HH:MM', in the community's time
	date: string;
	from: string;
	to: string;
	uid: string;
	name: string;
	createdAt: Timestamp;
}

export function bookingId(areaId: string, date: string, from: string) {
	return `${areaId}_${date}_${from}`;
}

function toMinutes(time: string) {
	const [hours, minutes] = time.split(':').map(Number);
	return hours * 60 + minutes;
}

function toTime(minutes: number) {
	return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

// The slots of a day, none when the area is closed that weekday. date is 'YYYY-MM-DD'
export function getSlots(area: Pick<BookableArea, 'days' | 'opens' | 'closes' | 'slotMinutes'>, date: string) {
	const weekday = new Date(`${date}T00:00`).getDay() || 7;
	if (!area.days.includes(weekday) || area.slotMinutes <= 0) {
		return [];
	}

	const slots: { from: string; to: string }[] = [];
	for (let start = toMinutes(area.opens); start + area.slotMinutes <= toMinutes(area.closes); start += area.slotMinutes) {
		slots.push({ from: toTime(start), to: toTime(start + area.slotMinutes) });
	}
	return slots;
}

// Monday to Sunday of the week a date is in, as 'YYYY-MM-DD', to count each neighbour's bookings against maxPerWeek
export function getWeek(date: string) {
	const day = new Date(`${date}T00:00`);
	const monday = new Date(day.getFullYear(), day.getMonth(), day.getDate() - ((day.getDay() || 7) - 1));
	const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
	return { from: toDateString(monday), to: toDateString(sunday) };
}

export function toDateString(date: Date) {
	return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map(part => String(part).padStart(2, '0')).join('-');
}
