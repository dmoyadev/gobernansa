import type { IncomeKind, ManualEntry } from './accounting.ts';
import type { Expense } from './finance.ts';
import type { Property } from './property.ts';
import { incomeAmounts } from './accounting.ts';
import { isValidNif, normalizeTaxId } from './fiscal.ts';
import { splitByCoefficient } from './property.ts';

/*
 * Declaraciones a la AEAT a community files as retenedor and as entidad en régimen de atribución de rentas: 347, 111 and
 * 190 (with 115 and 180 for rentals) and 184. The files follow the AEAT's diseños de registro, records of 500
 * characters in ISO-8859-1, one per line:
 * - 347: Orden EHA/3012/2008, as last amended by Orden HAC/1431/2025 (diseño "ejercicio 2025 y siguientes")
 * - 190: Orden EHA/3127/2009, as last amended by Orden HAC/1432/2024
 * - 184: Orden HAP/2250/2015 (diseño del ejercicio 2025)
 */

const RECORD_LENGTH = 500;
// Operations above it go in the 347 (RGAT art. 33)
export const THRESHOLD_347 = 300_506;
// Entities without an economic activity whose income doesn't exceed it needn't file the 184
export const THRESHOLD_184 = 300_000;

const DROPPED_REGEX = /[.,']/g;
const NOT_ALLOWED_REGEX = /[^A-Z0-9 ÑÇ]/g;
const NOT_EMAIL_REGEX = /[^A-Z0-9@._-]/g;
const SPACES_REGEX = /\s+/g;
const MARKS_REGEX = /\p{M}/gu;
const NON_DIGITS_REGEX = /\D/g;
const DIGITS_REGEX = /^\d*$/;
const POSTAL_CODE_REGEX = /\b(0[1-9]|[1-4]\d|5[0-2])\d{3}\b/;
const PROTECTED = { Ñ: '\u0001', Ç: '\u0002' };

/* Fields */

// Alphanumeric: uppercase, without accents (Ñ and Ç are kept) nor special characters (S.L. is SL), left aligned and blank padded
function text(value: string | undefined, length: number) {
	const plain = (value ?? '').toUpperCase().replaceAll('Ñ', PROTECTED.Ñ).replaceAll('Ç', PROTECTED.Ç).normalize('NFD').replace(MARKS_REGEX, '').replaceAll(PROTECTED.Ñ, 'Ñ').replaceAll(PROTECTED.Ç, 'Ç').replace(DROPPED_REGEX, '').replace(NOT_ALLOWED_REGEX, ' ').replace(SPACES_REGEX, ' ').trim();
	return plain.slice(0, length).padEnd(length, ' ');
}

function email(value: string | undefined, length: number) {
	return (value ?? '').toUpperCase().replace(NOT_EMAIL_REGEX, '').slice(0, length).padEnd(length, ' ');
}

// Numeric: right aligned and zero padded
function digits(value: number | string, length: number) {
	const plain = String(value);
	if (plain.length > length || !DIGITS_REGEX.test(plain)) {
		throw new Error(`${plain} doesn't fit in ${length} digits`);
	}
	return plain.padStart(length, '0');
}

// An amount in cents as the designs write them, without comma: the whole euros and two decimals. signed adds the
// position before it, 'N' when negative
function money(cents: number, length: number, signed = false) {
	const amount = digits(Math.abs(cents), length);
	return signed ? `${cents < 0 ? 'N' : ' '}${amount}` : amount;
}

// Right aligned, zero padded, the control character last
function nif(value: string | undefined) {
	const plain = normalizeTaxId(value ?? '');
	return plain ? plain.padStart(9, '0').slice(-9) : ' '.repeat(9);
}

// A percentage with `decimals` decimals and `whole` digits before them, e.g. 12,5 % as 0125000 with 3 and 4
function percentage(value: number, whole: number, decimals: number) {
	return digits(Math.round(value * 10 ** decimals), whole + decimals);
}

function blanks(length: number) {
	return ' '.repeat(length);
}

function zeros(length: number) {
	return '0'.repeat(length);
}

function record(parts: string[]) {
	const line = parts.join('');
	if (line.length !== RECORD_LENGTH) {
		throw new Error(`A record must be ${RECORD_LENGTH} characters long, this one is ${line.length}`);
	}
	return line;
}

// ISO-8859-1, the encoding the AEAT reads: every character left after text() fits in a byte
export function aeatFile(records: string[]) {
	const content = `${records.join('\r\n')}\r\n`;
	return Uint8Array.from(content, char => char.charCodeAt(0));
}

/* Who files it and who's declared */

export interface Declarant {
	nif: string;
	name: string;
	year: number;
	// Persona con quién relacionarse
	phone?: string;
	contact?: string;
	email?: string;
	// The president, who represents the community (184)
	representativeNif?: string;
	representativeName?: string;
}

// Two digits of the province, from the postal code in an address. undefined when there's none
export function provinceCode(address?: string) {
	return address?.match(POSTAL_CODE_REGEX)?.[1];
}

// A sequential number starting with the model's code, 13 digits
function declarationId(model: string, year: number) {
	return `${model}${year}000001`;
}

function phone(value?: string) {
	return digits((value ?? '').replace(NON_DIGITS_REGEX, '').slice(-9), 9);
}

// Positions 1-135, the same in the three models' declarant record
function declarantHead(model: string, declarant: Declarant) {
	return [
		'1',
		model,
		digits(declarant.year, 4),
		nif(declarant.nif),
		text(declarant.name, 40),
		// 58 tipo de soporte: telemático
		'T',
		phone(declarant.phone),
		text(declarant.contact, 40),
		digits(declarationId(model, declarant.year), 13),
		// 121-122 complementaria o sustitutiva, 123-135 the declaration it amends: a first one
		blanks(2),
		zeros(13),
	];
}

export function quarterOf(date: Date) {
	return Math.floor(date.getMonth() / 3) as 0 | 1 | 2 | 3;
}

/* 347: operaciones con terceras personas */

export type Key347 = 'B' | 'D';

export interface Operation347 {
	key: string;
	nif?: string;
	name: string;
	province?: string;
	// D: adquisiciones of an entity under the Ley de Propiedad Horizontal, B: what it charges others (e.g. a rental)
	operation: Key347;
	total: number;
	quarters: [number, number, number, number];
	// Supplies and insurance of the common areas, which communities don't declare (RGAT art. 33.5)
	exempt: boolean;
}

export interface ProviderData {
	id: string;
	cif?: string;
	fiscalName?: string;
	name: string;
	address?: string;
	category?: string;
}

const EXEMPT_REGEX = /luz|electric|energ|agua|gas\b|gasoil|gasóleo|combustib|suministro|seguro|póliza|poliza/i;

// Guessed from the provider's category and the concepts, the office can change it
function isExemptSupply(concepts: string[], category?: string) {
	return category === 'insurance' || concepts.some(concept => EXEMPT_REGEX.test(concept));
}

/**
 * Each provider's invoices of the year by their date (IVA included), but those with a withholding, and each payer of
 * the community's rents, those above 3.005,06 €. The NIF is the one on the invoices, the provider's current one otherwise
 */
export function operations347(year: number, expenses: Expense[], incomes: ManualEntry[], providers: ProviderData[]) {
	const byProvider = new Map(providers.map(provider => [provider.id, provider]));
	const groups = new Map<string, Operation347 & { concepts: string[]; category?: string }>();
	const add = (key: string, base: Omit<Operation347, 'total' | 'quarters' | 'exempt'> & { category?: string }, date: Date, amount: number, concept: string) => {
		const group = groups.get(key) ?? { ...base, total: 0, quarters: [0, 0, 0, 0], exempt: false, concepts: [] };
		group.total += amount;
		group.quarters[quarterOf(date)] += amount;
		group.concepts.push(concept);
		groups.set(key, group);
	};

	for (const expense of expenses) {
		const date = expense.date.toDate();
		// Invoices with a withholding are declared in the 190 or the 180, so they stay out (RGAT art. 33.2)
		if (date.getFullYear() !== year || expense.withholding) {
			continue;
		}
		const provider = expense.provider && byProvider.get(expense.provider.id);
		const taxId = expense.provider?.nif || provider?.cif;
		const key = expense.provider?.id ?? `concept:${expense.concept}`;
		add(`D:${key}`, {
			key: `D:${key}`,
			nif: taxId,
			name: provider?.fiscalName || expense.provider?.name || expense.concept,
			province: provinceCode(provider?.address),
			operation: 'D',
			category: provider?.category,
		}, date, expense.amount, expense.concept);
	}
	// Interests come from the bank, a financial operation, not one with a third party
	for (const entry of incomes) {
		if (entry.income?.kind !== 'rental' || !entry.date.startsWith(`${year}-`)) {
			continue;
		}
		const taxId = entry.income.payerNif;
		const key = `B:${taxId ? normalizeTaxId(taxId) : entry.income.payer}`;
		add(key, { key, nif: taxId, name: entry.income.payer, operation: 'B' }, new Date(`${entry.date}T12:00`), incomeAmounts(entry).gross, entry.concept);
	}

	return [...groups.values()]
		.filter(group => group.total > THRESHOLD_347)
		.map(({ concepts, category, ...group }) => ({ ...group, exempt: group.operation === 'D' && isExemptSupply(concepts, category) }))
		.sort((a, b) => b.total - a.total);
}

export function model347File(declarant: Declarant, operations: Operation347[]) {
	const total = operations.reduce((sum, operation) => sum + operation.total, 0);
	const head = record([
		...declarantHead('347', declarant),
		// 136-144 personas y entidades, 145-160 their total
		digits(operations.length, 9),
		money(total, 15, true),
		// 161-169 inmuebles and 170-185 arrendamientos de locales de negocio: none
		zeros(9),
		money(0, 15, true),
		// 186-390, 391-399 the legal representative of a minor, 400-487 and 488-500 the electronic seal
		blanks(205),
		blanks(9),
		blanks(88),
		blanks(13),
	]);
	const year = digits(declarant.year, 4);
	const lines = operations.map(operation => record([
		'2',
		'347',
		year,
		nif(declarant.nif),
		nif(operation.nif),
		// 27-35 legal representative of a minor
		blanks(9),
		text(operation.name, 40),
		'D',
		digits(operation.province ?? '', 2),
		// 79-80 country of a non resident, 81 blank
		blanks(2),
		blanks(1),
		operation.operation,
		money(operation.total, 15, true),
		// 99 seguro, 100 arrendamiento de local de negocio
		blanks(2),
		// 101-115 cash above 6.000 €, 116-131 transmisiones de inmuebles con IVA, 132-135 year of the cash
		zeros(15),
		money(0, 15, true),
		zeros(4),
		// 136-263 the quarters, each with its transmisiones de inmuebles: left empty by entities under the Ley 49/1960
		money(0, 15, true).repeat(8),
		// 264-280 NIF operador comunitario, 281-283 caja, inversión del sujeto pasivo and depósito
		blanks(17),
		blanks(3),
		// 284-299 criterio de caja, 300-305 BDNS (subsidies)
		money(0, 15, true),
		zeros(6),
		blanks(195),
	]));
	return aeatFile([head, ...lines]);
}

/* 111, 115, 190 and 180: withholdings on what's paid to professionals and landlords */

export interface Withholding {
	providerId: string;
	nif?: string;
	name: string;
	province?: string;
	type: 'professional' | 'rental';
	// 190 subclave: G01 general rate, G03 starting the activity (7 %)
	subkey: '01' | '03';
	base: number;
	withholding: number;
	quarters: { base: number; withholding: number }[];
}

// When it's paid: withholding is due when the income is paid (RIRPF art. 78). Older invoices without paidAt were paid
// on their date, unpaid ones don't count yet
function paidDate(expense: Expense) {
	const paidAt = expense.paidAt === undefined ? expense.date : expense.paidAt;
	return paidAt?.toDate();
}

/**
 * Each recipient's withholdings of the year, by the day they were paid, with the base (without VAT) and what was kept,
 * also by quarter
 */
export function withholdings(year: number, expenses: Expense[], providers: ProviderData[]) {
	const byProvider = new Map(providers.map(provider => [provider.id, provider]));
	const groups = new Map<string, Withholding>();
	for (const expense of expenses) {
		const paid = paidDate(expense);
		if (!expense.withholding || !paid || paid.getFullYear() !== year) {
			continue;
		}
		const type = expense.withholdingType ?? 'professional';
		const subkey = type === 'professional' && expense.withholdingRate === 7 ? '03' : '01';
		const provider = expense.provider && byProvider.get(expense.provider.id);
		const providerId = expense.provider?.id ?? expense.concept;
		const key = `${type}:${providerId}:${subkey}`;
		const group = groups.get(key) ?? {
			providerId,
			nif: expense.provider?.nif || provider?.cif,
			name: provider?.fiscalName || expense.provider?.name || expense.concept,
			province: provinceCode(provider?.address),
			type,
			subkey,
			base: 0,
			withholding: 0,
			quarters: [0, 1, 2, 3].map(() => ({ base: 0, withholding: 0 })),
		};
		const base = expense.base ?? expense.amount - (expense.vat ?? 0);
		group.base += base;
		group.withholding += expense.withholding;
		group.quarters[quarterOf(paid)].base += base;
		group.quarters[quarterOf(paid)].withholding += expense.withholding;
		groups.set(key, group);
	}
	return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

// The 111 (professionals, casillas 07 a 09) or 115 (rentals, casillas 01 a 03) of a quarter
export function quarterReturn(list: Withholding[], type: Withholding['type'], quarter: number) {
	const paid = list.filter(item => item.type === type && item.quarters[quarter].withholding);
	return {
		recipients: new Set(paid.map(item => item.nif ? normalizeTaxId(item.nif) : item.providerId)).size,
		base: paid.reduce((sum, item) => sum + item.quarters[quarter].base, 0),
		withholding: paid.reduce((sum, item) => sum + item.quarters[quarter].withholding, 0),
	};
}

export function model190File(declarant: Declarant, list: Withholding[]) {
	const professionals = list.filter(item => item.type === 'professional');
	const head = record([
		...declarantHead('190', declarant),
		// 136-144 percepciones, 145-160 their total, 161-175 the withholdings
		digits(professionals.length, 9),
		money(professionals.reduce((sum, item) => sum + item.base, 0), 15, true),
		money(professionals.reduce((sum, item) => sum + item.withholding, 0), 15),
		email(declarant.email, 50),
		// 226-487, 488-500 the electronic seal
		blanks(262),
		blanks(13),
	]);
	const year = digits(declarant.year, 4);
	const lines = professionals.map(item => record([
		'2',
		'190',
		year,
		nif(declarant.nif),
		nif(item.nif),
		// 27-35 legal representative of a minor
		blanks(9),
		text(item.name, 40),
		digits(item.province ?? '', 2),
		// 78-80 clave G: rendimientos de actividades profesionales
		'G',
		item.subkey,
		// 81-107 dinerarias: sign, percepción íntegra and retenciones
		money(item.base, 13, true),
		money(item.withholding, 13),
		// 108-147 en especie: sign, valoración, ingresos a cuenta efectuados and repercutidos
		money(0, 13, true),
		zeros(26),
		// 148-151 ejercicio de devengo, 152 Ceuta o Melilla
		zeros(4),
		zeros(1),
		// 153-254 datos adicionales, only for employees and pensioners: zeros but the spouse's NIF (158-166)
		zeros(5),
		blanks(9),
		zeros(88),
		// 255-321 incapacidad laboral, dinerarias and en especie
		money(0, 26, true),
		money(0, 39, true),
		// 322 ayuda para la infancia, 323-387 by tax administration, 388 empresas emergentes
		zeros(67),
		blanks(112),
	]));
	return aeatFile([head, ...lines]);
}

/* 184: the community's income, attributed to the owners by their coefficient */

export interface Member {
	key: string;
	nif?: string;
	name: string;
	properties: string[];
	// The sum of their properties' coefficients, as a percentage of the census
	share: number;
	// Per kind of income
	income: Partial<Record<IncomeKind, { gross: number; withholding: number }>>;
}

// 184 claves: rentals are capital inmobiliario (C), interests capital mobiliario (A), and their withholdings K
const keys184: Record<IncomeKind, { key: 'A' | 'C'; subkey: string; withholdingSubkey: string }> = {
	rental: { key: 'C', subkey: '01', withholdingSubkey: '02' },
	interest: { key: 'A', subkey: '01', withholdingSubkey: '01' },
};

export function incomeTotals(year: number, incomes: ManualEntry[]) {
	const totals: Partial<Record<IncomeKind, { gross: number; withholding: number }>> = {};
	for (const entry of incomes) {
		if (!entry.income || !entry.date.startsWith(`${year}-`)) {
			continue;
		}
		const { gross, withholding } = incomeAmounts(entry);
		const total = totals[entry.income.kind] ?? { gross: 0, withholding: 0 };
		total.gross += gross;
		total.withholding += withholding;
		totals[entry.income.kind] = total;
	}
	return totals;
}

/**
 * Each owner's part of the year's income and withholdings, split by coefficient to the cent. Several properties of
 * the same owner (by NIF, or else by name) are one member
 */
export function attributeIncome(totals: ReturnType<typeof incomeTotals>, properties: Pick<Property, 'id' | 'name' | 'coefficient' | 'ownerName' | 'ownerNif'>[]) {
	const census = properties.filter(property => property.coefficient);
	const total = census.reduce((sum, property) => sum + property.coefficient!, 0);
	const members = new Map<string, Member>();
	for (const property of census) {
		const key = property.ownerNif ? normalizeTaxId(property.ownerNif) : `name:${property.ownerName || property.id}`;
		const member = members.get(key) ?? { key, nif: property.ownerNif, name: property.ownerName || property.name, properties: [], share: 0, income: {} };
		member.properties.push(property.name);
		member.share += property.coefficient! * 100 / total;
		members.set(key, member);
	}
	const list = [...members.values()];
	for (const [kind, sums] of Object.entries(totals) as [IncomeKind, { gross: number; withholding: number }][]) {
		const gross = splitByCoefficient(sums.gross, list.map(member => ({ coefficient: member.share })));
		const kept = splitByCoefficient(sums.withholding, list.map(member => ({ coefficient: member.share })));
		list.forEach((member, index) => {
			member.income[kind] = { gross: gross[index].cents, withholding: kept[index].cents };
		});
	}
	return list.sort((a, b) => b.share - a.share || a.name.localeCompare(b.name, 'es'));
}

function daysIn(year: number) {
	return new Date(year, 1, 29).getMonth() === 1 ? 366 : 365;
}

/**
 * Tipo 1 the community, tipo 2 'E' each kind of its income and withholdings, tipo 2 'S' each member's part of them.
 * Only members with a NIF go in, the page warns about the rest. address is the members' fiscal address
 */
export function model184File(declarant: Declarant, totals: ReturnType<typeof incomeTotals>, members: Member[], address: string, province?: string) {
	const year = digits(declarant.year, 4);
	// ponytail: the whole year rented and owned, with no deductible expenses; a per-income period and expenses would refine it
	const days = daysIn(declarant.year);
	const kinds = (Object.keys(totals) as IncomeKind[]).filter(kind => totals[kind]!.gross);

	const entity = (key: string, subkey: string, rental: boolean, gross: number, withholding: number) => record([
		'2',
		'184',
		year,
		nif(declarant.nif),
		nif(declarant.nif),
		blanks(9),
		text(declarant.name, 40),
		'E',
		key,
		subkey,
		// 80-81 country, 82-87 actividades económicas, 88-116 cesionario or IIC, 117-150 IIC and Sociedades
		blanks(2),
		zeros(6),
		blanks(29),
		zeros(34),
		// 151-164 ingresos íntegros, 165-176 gastos, 177-190 renta atribuible
		money(gross, 13, true),
		zeros(12),
		money(gross, 13, true),
		// 191-232 reducciones, ganancias and deducciones
		zeros(5),
		money(0, 11, true),
		zeros(13),
		zeros(12),
		// 233-244 retenciones
		money(withholding, 12),
		// 245 situación del inmueble: without a cadastral reference, 246-265 the reference
		rental ? '4' : '0',
		blanks(20),
		// 266-395 actividades económicas, 396 criterio de caja, 397-497 gastos del capital inmobiliario, 498-500 days rented
		zeros(130),
		blanks(1),
		zeros(101),
		digits(rental ? days : 0, 3),
	]);

	const entities = kinds.flatMap((kind) => {
		const { key, subkey, withholdingSubkey } = keys184[kind];
		const { gross, withholding } = totals[kind]!;
		return [
			entity(key, subkey, kind === 'rental', gross, 0),
			...(withholding ? [entity('K', withholdingSubkey, false, 0, withholding)] : []),
		];
	});

	const member = (item: Member, key: string, subkey: string, rental: boolean, amount: number) => record([
		'2',
		'184',
		year,
		nif(declarant.nif),
		nif(item.nif),
		// 27-35 representative of a minor or a non resident
		blanks(9),
		text(item.name, 40),
		'S',
		digits(province ?? '', 2),
		// 79-80 country, 81 resident, 82 still a member on 31 December, 83-85 days a member
		blanks(2),
		'1',
		'X',
		digits(days, 3),
		percentage(item.share, 3, 4),
		key,
		subkey,
		money(amount, 12, true),
		// 109-119 reducción
		zeros(11),
		text(address, 40),
		// 160-171 provisiones
		zeros(12),
		// 172 urbano, 173 without a cadastral reference, 174-193 the reference, 194 titular, 195-199 their share
		rental ? '1' : '0',
		rental ? '4' : '0',
		blanks(20),
		rental ? 'T' : ' ',
		rental ? percentage(item.share, 3, 2) : zeros(5),
		digits(rental ? days : 0, 3),
		// 203-229 estimación objetiva
		zeros(13),
		money(0, 13, true),
		blanks(271),
	]);

	const declared = members.filter(item => item.nif && isValidNif(item.nif));
	const memberRecords = declared.flatMap(item => kinds.flatMap((kind) => {
		const { key, withholdingSubkey } = keys184[kind];
		const part = item.income[kind];
		if (!part?.gross) {
			return [];
		}
		// Clave C has no subclave in the members' records
		return [
			member(item, key, key === 'A' ? '01' : '00', kind === 'rental', part.gross),
			...(part.withholding ? [member(item, 'K', withholdingSubkey, false, part.withholding)] : []),
		];
	}));

	const head = record([
		...declarantHead('184', declarant),
		digits(memberRecords.length, 9),
		// 145 comunidad de propietarios, 146 tenencia y administración de inmuebles
		'4',
		'3',
		// 147-155 constituted abroad, 156 Impuesto sobre Sociedades, 157-171 cifra de negocios
		'0',
		blanks(3),
		zeros(5),
		blanks(1),
		zeros(15),
		nif(declarant.representativeNif),
		text(declarant.representativeName, 40),
		digits(entities.length, 9),
		blanks(258),
		blanks(13),
	]);
	return aeatFile([head, ...entities, ...memberRecords]);
}

/* Plazos */

export interface TaxDeadline {
	id: string;
	model: string;
	title: string;
	// 'YYYY-MM-DD'
	due: string;
}

function lastDay(year: number, month: number) {
	return `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`;
}

// The year's returns and when they're due: the quarterly ones by the 20th of the next month (January for the fourth),
// the annual ones in January and the 347 in February. withRentals adds 115 and 180
export function taxDeadlines(year: number, withRentals: boolean, with184: boolean): TaxDeadline[] {
	const quarterly = withRentals ? ['111', '115'] : ['111'];
	return [
		...quarterly.flatMap(model => [0, 1, 2, 3].map(quarter => ({
			id: `aeat-${model}-${year}-${quarter + 1}t`,
			model,
			title: `Modelo ${model} · ${quarter + 1}T ${year}`,
			due: quarter === 3 ? `${year + 1}-01-20` : `${year}-${String(quarter * 3 + 4).padStart(2, '0')}-20`,
		}))),
		...[...(withRentals ? ['180'] : []), '190', ...(with184 ? ['184'] : [])].map(model => ({ id: `aeat-${model}-${year}`, model, title: `Modelo ${model} · ${year}`, due: lastDay(year + 1, 1) })),
		{ id: `aeat-347-${year}`, model: '347', title: `Modelo 347 · ${year}`, due: lastDay(year + 1, 2) },
	];
}
