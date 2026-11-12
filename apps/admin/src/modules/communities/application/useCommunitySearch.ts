import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { Event } from '@gobernansa/shared/domain/event.ts';
import type { Expense } from '@gobernansa/shared/domain/finance.ts';
import type { Issue, IssueCategory } from '@gobernansa/shared/domain/issue.ts';
import type { Meeting } from '@gobernansa/shared/domain/meeting.ts';
import type { Obligation } from '@gobernansa/shared/domain/obligation.ts';
import type { Property } from '@gobernansa/shared/domain/property.ts';
import type { Provider } from '@gobernansa/shared/domain/provider.ts';
import type { User } from '@gobernansa/shared/domain/user.ts';
import type { Query } from 'firebase/firestore';
import type { MaybeRefOrGetter } from 'vue';
import { contactTypes, documentTypes, formatIban, getCommonAreas } from '@gobernansa/shared/domain/community.ts';
import { eventTypes } from '@gobernansa/shared/domain/event.ts';
import { DEFAULT_MONTHLY_VOTES, findIssueCategory, getIssueCategories } from '@gobernansa/shared/domain/issue.ts';
import { obligationTypes } from '@gobernansa/shared/domain/obligation.ts';
import { propertyTypeIcons, propertyTypeLabels } from '@gobernansa/shared/domain/property.ts';
import { providerCategories } from '@gobernansa/shared/domain/provider.ts';
import { roles } from '@gobernansa/shared/domain/user.ts';
import { db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { computed, ref, shallowRef, toValue } from 'vue';
import { findRanges, fold, searchWords } from '@/app/useSearchHighlight.ts';
import { workspaces } from '@/app/workspace/workspaces.ts';

export interface SearchEntry {
	section: string;
	icon: string;
	title: string;
	text: string;
	to: string;
}

export interface Segment {
	text: string;
	mark: boolean;
}

const MAX_RESULTS = 10;
const SNIPPET_BEFORE = 30;
const SNIPPET_LENGTH = 110;
const NON_ALPHANUMERIC_REGEX = /[^a-z0-9]/g;
// How long the rest of the community is reused before reading it again
const CACHE_TTL = 10 * 60 * 1000;

// The pages and sections of a community, findable by their name and what's done there: those of its workspaces, then the rest
const sections = [
	...Object.values(workspaces).flatMap(({ title, summary, sections }) => [
		...(summary ? [{ path: summary.key, title, icon: summary.icon, text: summary.description }] : []),
		...sections.flatMap(section => section.pages.map(page => ({ path: page.key, title: page.title, icon: page.icon ?? section.icon, text: page.description }))),
	]),
	{ path: 'issues', title: 'Incidencias', icon: 'lucide:message-square-warning', text: 'Estado y respuestas a los vecinos' },
	{ path: 'notifications', title: 'Avisos', icon: 'lucide:bell', text: 'Avisos y eventos de la comunidad' },
	{ path: 'meetings', title: 'Juntas', icon: 'lucide:gavel', text: 'Convocatorias, asistencia y votaciones' },
	{ path: 'obligations', title: 'Obligaciones', icon: 'lucide:calendar-check', text: 'IEE, ascensor, extintores, seguro…' },
	{ path: 'activity', title: 'Registro de actividad', icon: 'lucide:history', text: 'Quién cambió qué' },
	{ path: 'locations', title: 'Zonas comunes y reservas', icon: 'lucide:map-pin', text: 'Lugares de las incidencias, franjas y normas de reserva' },
];
const sectionTitles = Object.fromEntries(sections.map(section => [section.path, section.title]));
const sectionIcons = Object.fromEntries(sections.map(section => [section.path, section.icon]));

function join(...parts: (string | number | undefined | null | false)[]) {
	return parts.filter(part => part || part === 0).join(' · ');
}

async function load<T>(source: Query, toEntry: (item: T & { id: string }) => SearchEntry | undefined) {
	const snapshot = await getDocs(source);
	return snapshot.docs.map(item => toEntry({ ...item.data() as T, id: item.id })).filter((entry): entry is SearchEntry => !!entry);
}

// What's in the community doc, already loaded by the page
function communityEntries(community: Community, base: string): SearchEntry[] {
	const { name, address, constructionYear, contacts = [], documents = [], cif, bank, iban, monthlyVotes } = community;
	return [
		{ section: sectionTitles.info, icon: 'lucide:building-2', title: name, text: join(address, constructionYear && `Construida en ${constructionYear}`), to: `${base}/info` },
		...contacts.map(contact => ({
			section: sectionTitles.contacts,
			icon: contactTypes[contact.type]?.icon ?? 'lucide:phone',
			title: contact.name,
			text: join(contactTypes[contact.type]?.label, contact.phone, contact.whatsapp && `WhatsApp ${contact.whatsapp}`, contact.email),
			to: `${base}/contacts`,
		})),
		...documents.map(document => ({ section: sectionTitles.documents, icon: documentTypes[document.type]?.icon ?? 'lucide:file-text', title: document.title, text: documentTypes[document.type]?.label ?? '', to: `${base}/documents` })),
		...getCommonAreas(community).map(area => ({
			section: sectionTitles.locations,
			icon: area.icon,
			title: area.name,
			text: area.booking ? join('Zona reservable', area.booking.rules) : 'Zona común',
			to: area.booking ? `${base}/locations/${area.id}` : `${base}/locations`,
		})),
		...(cif || bank || iban ? [{ section: sectionTitles.info, icon: 'lucide:landmark', title: 'Datos fiscales', text: join(cif && `CIF ${cif}`, bank, iban && `IBAN ${formatIban(iban)}`), to: `${base}/info` }] : []),
		{ section: sectionTitles.settings, icon: 'lucide:vote', title: 'Votos por propiedad', text: `${monthlyVotes ?? DEFAULT_MONTHLY_VOTES} votos al mes por propiedad`, to: `${base}/settings` },
	];
}

// Everything else is read the first time the search is used, and kept for a while across visits to the page
const cache = new Map<string, { at: number; entries: Promise<SearchEntry[]> }>();

function loadEntries(id: string, base: string, categories: IssueCategory[]) {
	const community = (name: string) => collection(db, 'communities', id, name);
	return [
		load<User>(query(collection(db, 'users'), where('communityId', '==', id), limit(300)), user => ({
			section: sectionTitles.people,
			icon: 'lucide:user',
			title: user.name || user.email,
			text: join(user.email, roles[user.role]?.label),
			to: `${base}/people`,
		})),
		load<Property>(query(collection(db, 'properties'), where('communityId', '==', id), limit(500)), property => ({
			section: sectionTitles.properties,
			icon: propertyTypeIcons[property.type] ?? 'lucide:house',
			title: property.name,
			text: join(propertyTypeLabels[property.type], property.ownerName, property.ownerEmail, property.tenantName, property.tenantEmail),
			to: `${base}/properties`,
		})),
		// The same query as the issues page, so it uses its index
		load<Issue>(query(community('issues'), where('deletedAt', '==', null), orderBy('createdAt', 'desc'), limit(150)), issue => ({
			section: sectionTitles.issues,
			icon: findIssueCategory(categories, issue.category).icon,
			title: issue.title,
			text: issue.description ?? '',
			to: `${base}/issues/${issue.id}`,
		})),
		load<Event>(query(collection(db, 'events'), where('communityId', '==', id), orderBy('date', 'desc'), limit(100)), event => ({
			section: sectionTitles.notifications,
			icon: eventTypes[event.type]?.icon ?? 'lucide:bell',
			title: event.title,
			text: event.description ?? '',
			// Opened in its form, the list only shows the latest ones
			to: `${base}/notifications?edit=${event.id}`,
		})),
		load<Meeting>(query(community('meetings'), orderBy('date', 'desc'), limit(50)), meeting => ({
			section: sectionTitles.meetings,
			icon: 'lucide:gavel',
			title: meeting.title,
			text: join(meeting.place, ...(meeting.agenda ?? []).flatMap(item => [item.title, item.description])),
			to: `${base}/meetings/${meeting.id}`,
		})),
		load<Obligation>(query(community('obligations'), limit(100)), obligation => ({
			section: sectionTitles.obligations,
			icon: obligationTypes[obligation.type]?.icon ?? 'lucide:calendar-check',
			title: obligation.title,
			text: join(obligation.provider?.name, obligation.notes),
			to: `${base}/obligations`,
		})),
		load<Expense>(query(community('expenses'), orderBy('date', 'desc'), limit(100)), expense => ({
			section: sectionTitles.budget,
			icon: 'lucide:receipt',
			title: expense.concept,
			text: join(expense.provider?.name, expense.invoiceNumber && `Fra. ${expense.invoiceNumber}`, String(expense.year)),
			to: `${base}/budget`,
		})),
		// What the pages have written in them: their tabs, sections, buttons and options
		import('virtual:page-texts').then(({ default: pages }) => pages.flatMap(page => page.texts.filter(([text]) => text !== page.title).map(([text, tab, heading]) => {
			// The community's own form takes its section as the path, the rest open their tab from the query
			const path = page.path || tab || 'info';
			const title = page.path ? page.title : sectionTitles[path];
			return {
				section: heading ? `${title} › ${heading}` : title,
				icon: sectionIcons[path] ?? 'lucide:text-search',
				title: text,
				text: '',
				to: `${base}/${path}${page.path && tab ? `?${tab}` : ''}`,
			};
		}))),
		load<Provider>(query(collection(db, 'providers'), where('communityIds', 'array-contains', id), limit(100)), provider => ({
			section: 'Proveedores',
			icon: providerCategories[provider.category]?.icon ?? 'lucide:hard-hat',
			title: provider.name,
			text: join(providerCategories[provider.category]?.label, provider.fiscalName, provider.phone, provider.email, provider.cif, provider.notes),
			to: '/providers',
		})),
	];
}

// Exact phrase in the title first, then words starting in it, then anywhere in the text. Every word has to be there
function score(entry: SearchEntry, phrase: string, words: string[]) {
	const title = fold(entry.title);
	const text = fold(entry.text);
	// Word starts are found as ' word' with punctuation turned into spaces, which keeps positions
	const titleWords = ` ${title.replace(NON_ALPHANUMERIC_REGEX, ' ')}`;
	const textWords = ` ${text.replace(NON_ALPHANUMERIC_REGEX, ' ')}`;
	let total = title === phrase ? 200 : title.includes(phrase) ? 100 : text.includes(phrase) ? 20 : 0;
	for (const word of words) {
		const points = titleWords.includes(` ${word}`) ? 10 : title.includes(word) ? 6 : textWords.includes(` ${word}`) ? 4 : text.includes(word) ? 2 : 0;
		if (!points) {
			return 0;
		}
		total += points;
	}
	return total;
}

function segments(text: string, words: string[]): Segment[] {
	const result: Segment[] = [];
	let position = 0;
	for (const [start, end] of findRanges(text, words)) {
		result.push({ text: text.slice(position, start), mark: false }, { text: text.slice(start, end), mark: true });
		position = end;
	}
	result.push({ text: text.slice(position), mark: false });
	return result.filter(segment => segment.text);
}

// A piece of the text around its first match, so it's seen in long descriptions
function snippet(text: string, words: string[]) {
	const folded = fold(text);
	const first = Math.min(...words.map(word => folded.indexOf(word)).filter(index => index !== -1));
	const start = Number.isFinite(first) ? Math.max(0, first - SNIPPET_BEFORE) : 0;
	const piece = text.slice(start, start + SNIPPET_LENGTH);
	return `${start > 0 ? '…' : ''}${piece}${start + SNIPPET_LENGTH < text.length ? '…' : ''}`;
}

// The best ones for the text, with its words marked in the title and around them in the text
export function rank(entries: SearchEntry[], text: string) {
	const words = searchWords(text);
	if (!words.length) {
		return [];
	}
	const phrase = words.join(' ');
	return entries
		.map(entry => ({ entry, score: score(entry, phrase, words) }))
		.filter(match => match.score)
		.sort((a, b) => b.score - a.score)
		.slice(0, MAX_RESULTS)
		.map(({ entry }) => ({
			...entry,
			titleSegments: segments(entry.title, words),
			textSegments: segments(snippet(entry.text, words), words),
		}));
}

export function useCommunitySearch(communityId: MaybeRefOrGetter<string>, community: MaybeRefOrGetter<Community | undefined>) {
	const base = computed(() => `/communities/${toValue(communityId)}`);
	const loaded = shallowRef<SearchEntry[]>([]);
	const loading = ref(false);
	let started = false;

	// Each source on its own, so one the rules don't allow doesn't leave the rest out
	async function loadIndex() {
		if (started) {
			return;
		}
		started = true;
		const id = toValue(communityId);
		let cached = cache.get(id);
		if (!cached || Date.now() - cached.at > CACHE_TTL) {
			cached = {
				at: Date.now(),
				entries: Promise.allSettled(loadEntries(id, base.value, getIssueCategories(toValue(community))))
					.then(results => results.flatMap(result => result.status === 'fulfilled' ? result.value : [])),
			};
			cache.set(id, cached);
		}
		loading.value = true;
		loaded.value = await cached.entries;
		loading.value = false;
	}

	const entries = computed(() => {
		const current = toValue(community);
		return [
			...sections.map(({ path, ...section }) => ({ ...section, section: 'Secciones', to: `${base.value}/${path}` })),
			...(current ? communityEntries(current, base.value) : []),
			...loaded.value,
		];
	});

	function search(text: string) {
		return rank(entries.value, text);
	}

	return { search, loadIndex, loading };
}

// The census of every community the office has, to find a neighbour without knowing where they live. Read the first time it's
// used, community by community with the same query as the search inside one, and kept like it
// ponytail: one read per home, about 2.000 for an office of 40 communities every CACHE_TTL. A summary doc per community if that
// shows on the bill
const censusCache = new Map<string, { at: number; entries: Promise<SearchEntry[]> }>();

async function loadCensus({ id, name }: Community) {
	let cached = censusCache.get(id);
	if (!cached || Date.now() - cached.at > CACHE_TTL) {
		cached = {
			at: Date.now(),
			entries: load<Property>(query(collection(db, 'properties'), where('communityId', '==', id), limit(500)), property => ({
				section: name || 'Sin nombre',
				icon: propertyTypeIcons[property.type] ?? 'lucide:house',
				title: property.ownerName || property.name,
				text: join(property.name, property.ownerNif, property.ownerEmail, property.ownerPhone, property.tenantName && `Inquilino: ${property.tenantName}`, property.tenantEmail),
				// Their home marked in the census, which doesn't show the NIF or the phone
				to: `/communities/${id}/properties?highlight=${encodeURIComponent(property.name)}`,
			})).catch(() => []),
		};
		censusCache.set(id, cached);
	}
	return cached.entries;
}

export function useNeighbourSearch(communities: MaybeRefOrGetter<Community[]>) {
	const loaded = shallowRef<SearchEntry[]>([]);
	const loading = ref(false);

	async function loadIndex() {
		if (loading.value) {
			return;
		}
		loading.value = true;
		loaded.value = (await Promise.all(toValue(communities).map(loadCensus))).flat();
		loading.value = false;
	}

	return { search: (text: string) => rank(loaded.value, text), loadIndex, loading };
}
