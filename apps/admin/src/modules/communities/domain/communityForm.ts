import type { Community, CommunityContact, CommunityDocument } from '@gobernansa/shared/domain/community.ts';
import { formatIban } from '@gobernansa/shared/domain/community.ts';
import { deleteField, Timestamp } from 'firebase/firestore';

const SPACES_REGEX = /\s/g;

// Each one edited on its own page, opened from the community's page
export type CommunitySection = 'info' | 'contacts' | 'documents' | 'locations' | 'finances';

// What the inputs edit: text as typed, and dates as the 'YYYY-MM-DD' of date inputs
export interface CommunityForm {
	name: string;
	address: string;
	constructionYear: string;
	monthlyVotes: string;
	// Comma separated, e.g. "Portal, Garaje, Piscina"
	commonAreas: string;
	cif: string;
	iban: string;
	bank: string;
	contacts: CommunityContact[];
	documents: (Omit<CommunityDocument, 'date'> & { date: string })[];
}

export function toCommunityForm(community?: Community): CommunityForm {
	return {
		name: community?.name ?? '',
		address: community?.address ?? '',
		constructionYear: community?.constructionYear?.toString() ?? '',
		monthlyVotes: community?.monthlyVotes?.toString() ?? '',
		commonAreas: community?.commonAreas?.join(', ') ?? '',
		cif: community?.cif ?? '',
		iban: community?.iban ? formatIban(community.iban) : '',
		bank: community?.bank ?? '',
		// Copies, so the form doesn't edit the community it was loaded from
		contacts: structuredClone(community?.contacts ?? []),
		documents: (community?.documents ?? []).map(document => ({ ...document, date: toInputDate(document.date.toDate()) })),
	};
}

// The mistakes the inputs can't catch by themselves
export function findFormError(form: CommunityForm) {
	const schedules = form.contacts.flatMap(contact => contact.schedule ?? []);
	if (schedules.some(schedule => !schedule.days.length)) {
		return 'Cada horario necesita al menos un día.';
	}
	if (schedules.some(schedule => schedule.from >= schedule.to)) {
		return 'En cada horario, la hora de inicio tiene que ser anterior a la de fin.';
	}
}

// The fields to save with a merge, so the ones left empty are removed and the rest of the document is kept
export function fromCommunityForm(form: CommunityForm) {
	const commonAreas = form.commonAreas.split(',').map(area => area.trim()).filter(Boolean);
	return {
		name: form.name.trim(),
		address: form.address.trim(),
		constructionYear: Number(form.constructionYear),
		monthlyVotes: form.monthlyVotes ? Number(form.monthlyVotes) : deleteField(),
		commonAreas: commonAreas.length ? commonAreas : deleteField(),
		cif: form.cif.trim().toUpperCase() || deleteField(),
		iban: form.iban.replace(SPACES_REGEX, '').toUpperCase() || deleteField(),
		bank: form.bank.trim() || deleteField(),
		contacts: form.contacts.map(contact => withoutEmptyFields(contact)),
		documents: form.documents.map(({ date, ...document }) => ({
			...withoutEmptyFields(document),
			// Local midnight, the day the admin picked wherever they are
			date: Timestamp.fromDate(new Date(`${date}T00:00`)),
		})),
	};
}

export function toInputDate(date: Date) {
	return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map(part => String(part).padStart(2, '0')).join('-');
}

// Firestore can't remove a field inside an array item, so empty ones are left out instead
function withoutEmptyFields<T extends object>(item: T): T {
	return Object.fromEntries(Object.entries(item as Record<string, unknown>)
		.map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])
		.filter(([, value]) => value !== '' && value !== undefined && !(Array.isArray(value) && !value.length))) as T;
}
