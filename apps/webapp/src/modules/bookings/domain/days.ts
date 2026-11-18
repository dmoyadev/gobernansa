// A booking's day, as a neighbour reads it: «sábado, 22 de noviembre»
export function formatDay(day: string) {
	return new Date(`${day}T00:00`).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
}

// Weekday, day and month apart, for a booking's date block
export function dateParts(day: string) {
	const value = new Date(`${day}T00:00`);
	return {
		weekday: value.toLocaleDateString('es', { weekday: 'short' }),
		number: value.getDate(),
		month: value.toLocaleDateString('es', { month: 'short' }),
	};
}
