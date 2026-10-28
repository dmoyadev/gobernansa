import type { Timestamp } from 'firebase/firestore';
import type { Datable } from '@/shared/domain/audit.ts';
import { normalize } from '@/shared/utils/helpers.ts';

const NON_PHONE_CHARS_REGEX = /[^\d+]/g;
const NON_DIGITS_REGEX = /\D/g;
const SPACES_REGEX = /\s/g;
const GROUPS_OF_4_REGEX = /(.{4})/g;

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
}

export type ContactType = 'admin' | 'president' | 'janitor' | 'insurance' | 'elevator' | 'cleaning' | 'gardening' | 'other';

export interface CommunityContact {
	type: ContactType;
	name: string;
	phone?: string;
	// Only when the contact uses WhatsApp, it may be a different number than the phone
	whatsapp?: string;
	email?: string;
}

export interface CommunityDocument {
	type: 'minutes' | 'statutes' | 'regulations';
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
