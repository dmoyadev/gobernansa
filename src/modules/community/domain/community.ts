import type { Timestamp } from 'firebase/firestore';
import type { Datable } from '@/shared/domain/audit.ts';
import { normalize } from '@/shared/utils/helpers.ts';

const NON_PHONE_CHARS_REGEX = /[^\d+]/g;
const NON_DIGITS_REGEX = /\D/g;
const SPACES_REGEX = /\s/g;
const GROUPS_OF_4_REGEX = /(.{4})/g;
const LEADING_ZERO_REGEX = /^0(?=\d)/;
const WEEKDAYS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];

export interface Community extends Datable {
	id: string;
	name: string;
	address: string;
	constructionYear: number;
	// Offered as places when reporting an issue, e.g. "Portal" or "Garaje"
	commonAreas?: string[];

	// Fiscal data, for neighbours paying fees or providers invoicing the community
	cif?: string;
	iban?: string;
	bank?: string;

	contacts?: CommunityContact[];
	documents?: CommunityDocument[];

	// Votes each neighbour gets every month, DEFAULT_MONTHLY_VOTES when missing
	monthlyVotes?: number;
}

export type ContactType = 'admin' | 'president' | 'janitor' | 'insurance' | 'elevator' | 'cleaning' | 'gardening' | 'other';

export interface CommunityContact {
	type: ContactType;
	name: string;
	phone?: string;
	// Only when the contact uses WhatsApp, it may be a different number than the phone
	whatsapp?: string;
	email?: string;
	// When they can be reached, e.g. the janitor's shifts. Several entries for split shifts or different weekend hours
	schedule?: ContactSchedule[];
}

export interface ContactSchedule {
	// ISO weekdays: 1 is Monday and 7 is Sunday
	days: number[];
	// 24 hour 'HH:MM', zero padded so they compare as text
	from: string;
	to: string;
}

export interface CommunityDocument {
	type: 'minutes' | 'statutes' | 'regulations' | 'insurance';
	title: string;
	url: string;
	date: Timestamp;
}

export const contactTypes: Record<ContactType, { label: string; icon: string }> = {
	admin: { label: 'Administración', icon: 'lucide:briefcase' },
	president: { label: 'Presidencia', icon: 'lucide:user-round-check' },
	janitor: { label: 'Conserjería', icon: 'lucide:key-round' },
	insurance: { label: 'Seguro', icon: 'lucide:shield-check' },
	elevator: { label: 'Ascensor', icon: 'lucide:arrow-down-up' },
	cleaning: { label: 'Limpieza', icon: 'lucide:brush-cleaning' },
	gardening: { label: 'Jardinería', icon: 'lucide:sprout' },
	other: { label: 'Otro', icon: 'lucide:phone' },
};

export function getPhoneLink(phone: string) {
	return `tel:${phone.replace(NON_PHONE_CHARS_REGEX, '')}`;
}

// shortcut: numbers without a country code are taken as Spanish, store them with it (e.g. +351…) for other countries
export function getWhatsappLink(phone: string) {
	const digits = phone.replace(NON_DIGITS_REGEX, '');
	return `https://wa.me/${digits.length === 9 ? `34${digits}` : digits}`;
}

// e.g. "lun–vie 8:00–15:00", runs of consecutive days are joined
export function formatSchedule({ days, from, to }: ContactSchedule) {
	const runs: number[][] = [];
	for (const day of [...days].sort((a, b) => a - b)) {
		const run = runs.at(-1);
		if (run && run.at(-1) === day - 1) {
			run.push(day);
		} else {
			runs.push([day]);
		}
	}

	const dayNames = runs.map(run => run.length > 1 ? `${WEEKDAYS[run[0] - 1]}–${WEEKDAYS[run.at(-1)! - 1]}` : WEEKDAYS[run[0] - 1]);
	return `${dayNames.join(', ')} ${from.replace(LEADING_ZERO_REGEX, '')}–${to.replace(LEADING_ZERO_REGEX, '')}`;
}

// shortcut: uses the device's time zone, fine while neighbours live where the community is
export function isWithinSchedule(schedule: ContactSchedule[], now = new Date()) {
	const day = now.getDay() || 7;
	const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
	return schedule.some(({ days, from, to }) => days.includes(day) && from <= time && time < to);
}

// Grouped by 4 as printed on bank documents, easier to read out and check
export function formatIban(iban: string) {
	return iban.replace(SPACES_REGEX, '').replace(GROUPS_OF_4_REGEX, '$1 ').trim();
}

// Each community names its areas freely, so the icon is guessed from the name (accents and case ignored)
// shortcut: unknown names get a generic building, store a type per area if that's not enough
const COMMON_AREA_ICONS: [RegExp, string][] = [
	[/portal|entrada|vestibulo|recibidor/, 'lucide:door-open'],
	[/escalera/, 'lucide:door-stairwell'],
	[/ascensor/, 'lucide:arrow-down-up'],
	[/garaje|parking|aparcamiento/, 'lucide:car'],
	[/piscina/, 'lucide:waves-ladder'],
	// Before gardens, so "parque infantil" isn't taken as one
	[/infantil|columpio/, 'lucide:baby'],
	[/jardin|parque|zona verde/, 'lucide:trees'],
	[/pista|tenis|padel|deporte/, 'lucide:volleyball'],
	[/gimnasio/, 'lucide:dumbbell'],
	[/trastero/, 'lucide:package'],
	[/azotea|terraza|tejado/, 'lucide:sun'],
	[/basura|contenedor|reciclaje/, 'lucide:trash-2'],
	[/buzon|correo/, 'lucide:mail'],
];

export function getCommonAreaIcon(name: string) {
	const normalized = normalize(name);
	return COMMON_AREA_ICONS.find(([pattern]) => pattern.test(normalized))?.[1] ?? 'lucide:building-2';
}
