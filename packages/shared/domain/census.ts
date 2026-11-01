import type { Community } from './community.ts';
import type { Property } from './property.ts';
import type { SepaMandate } from './sepa.ts';
import { normalize } from '../utils/helpers.ts';
import { canonical, parseDate } from './bank.ts';
import { isValidIban, isValidNif, normalizeIban, normalizeTaxId } from './fiscal.ts';
import { isEmail } from './mail.ts';
import { totalCoefficient } from './property.ts';
import { sepaId } from './sepa.ts';

/* Import of the census (properties, owners and coefficients) from a spreadsheet exported by any other program */

const SPACES_REGEX = /\s+/g;
const PERCENT_REGEX = /[%\s]/g;
// Phones are kept as typed, up to what the rules take
const PHONE_LENGTH = 40;

// What a census file can have, in the order the columns are picked. The community's only when importing several at once
export const censusFields = {
	community: 'Comunidad',
	communityCif: 'CIF de la comunidad',
	communityAddress: 'Dirección de la comunidad',
	communityIban: 'IBAN de la comunidad',
	name: 'Propiedad',
	type: 'Tipo',
	coefficient: 'Coeficiente (%)',
	ownerName: 'Propietario',
	ownerSurname: 'Apellidos del propietario',
	ownerEmail: 'Email del propietario',
	ownerNif: 'NIF del propietario',
	ownerPhone: 'Teléfono',
	iban: 'IBAN',
	mandateReference: 'Referencia del mandato SEPA',
	mandateDate: 'Fecha de firma del mandato',
	tenantName: 'Inquilino',
	tenantEmail: 'Email del inquilino',
};

export type CensusField = keyof typeof censusFields;
// Each field's column, -1 when the file has none
export type CensusColumns = Record<CensusField, number>;

export const communityFields: CensusField[] = ['community', 'communityCif', 'communityAddress', 'communityIban'];

// Mandates brought from another program were already debited there: marked as if a remittance had carried their first
// debit, the first one from here goes as recurrent (RCUR), as SEPA asks of migrated mandates
export const MIGRATED_MANDATE = 'migrated';

export function censusTemplate(withCommunity: boolean) {
	const rows = [
		['Propiedad', 'Tipo', 'Coeficiente', 'Propietario', 'Email', 'NIF', 'Teléfono', 'IBAN', 'Referencia del mandato', 'Fecha de firma del mandato', 'Inquilino', 'Email del inquilino'],
		['1º A', 'Vivienda', '3,25', 'María García López', 'maria.garcia@example.com', '12345678Z', '600 123 456', 'ES91 2100 0418 4502 0005 1332', 'MAND-1A-2019', '15/03/2019', '', ''],
		['Plaza 14', 'Plaza de garaje', '0,40', 'Juan Pérez Sanz', 'juan.perez@example.com', 'X1234567L', '', '', '', '', 'Ana Ruiz', 'ana.ruiz@example.com'],
	];
	const community = ['C.P. Calle Mayor 12', 'H12345674', 'Calle Mayor 12, 28013 Madrid', 'ES79 2100 0813 6101 2345 6789'];
	return withCommunity ? rows.map((row, index) => [...(index ? community : ['Comunidad', 'CIF de la comunidad', 'Dirección', 'IBAN de la comunidad']), ...row]) : rows;
}

/*
 * Field, words its heading may have and, when given, one of these too. In this order, each column taken once and within
 * a field by the order of its words: "Email del inquilino" isn't the owner's, and "Propiedad" wins over "Referencia catastral"
 */
const headings: [CensusField, string[], string[]?][] = [
	['communityCif', ['CIF', 'NIF'], ['COMUNIDAD']],
	['communityIban', ['IBAN', 'CUENTA'], ['COMUNIDAD']],
	['tenantEmail', ['EMAIL', 'CORREO', 'MAIL'], ['INQUILINO', 'ARRENDATARIO']],
	['tenantName', ['INQUILINO', 'ARRENDATARIO']],
	['mandateDate', ['FECHA', 'FIRMA'], ['MANDATO', 'FIRMA']],
	['mandateReference', ['MANDATO']],
	['ownerEmail', ['EMAIL', 'CORREO', 'MAIL']],
	['ownerNif', ['NIF', 'DNI', 'NIE', 'CIF']],
	['ownerPhone', ['TELEFONO', 'MOVIL', 'TLF']],
	['iban', ['IBAN', 'CUENTA', 'CCC']],
	['coefficient', ['COEF', 'PARTICIPA', 'PORCENTAJE', '%', 'CUOTA']],
	['type', ['TIPO', 'USO', 'CLASE']],
	['community', ['COMUNIDAD', 'EDIFICIO']],
	['communityAddress', ['DIRECCION', 'DOMICILIO']],
	['name', ['PROPIEDAD', 'INMUEBLE', 'VIVIENDA', 'PISO', 'PUERTA', 'FINCA', 'DEPARTAMENTO', 'UNIDAD', 'REFERENCIA']],
	['ownerName', ['PROPIETARIO', 'NOMBRE', 'TITULAR']],
	['ownerSurname', ['APELLIDO']],
];

export function guessCensusColumns(header: string[]): CensusColumns {
	// D.N.I. is DNI
	const names = header.map(heading => canonical(heading).replaceAll('.', ''));
	const used = new Set<number>();
	const columns = Object.fromEntries(Object.keys(censusFields).map(field => [field, -1])) as CensusColumns;
	for (const [field, words, also] of headings) {
		for (const word of words) {
			const index = names.findIndex((name, column) => !used.has(column) && name.includes(word) && (!also || also.some(other => name.includes(other))));
			if (index !== -1) {
				columns[field] = index;
				used.add(index);
				break;
			}
		}
	}
	return columns;
}

// The one with most headings it recognises among the first rows, as exports often start with a title
export function guessHeaderRow(rows: string[][]) {
	const scores = rows.slice(0, 20).map(cells => Object.values(guessCensusColumns(cells)).filter(column => column !== -1).length);
	return Math.max(0, scores.indexOf(Math.max(...scores)));
}

const typeWords: [Property['type'], string[]][] = [
	['parking', ['GARAJE', 'PLAZA', 'PARKING', 'APARCAMIENTO', 'COCHERA']],
	['storage', ['TRASTERO']],
	['other', ['LOCAL', 'OFICINA', 'NAVE', 'OTRO']],
	['home', ['VIVIENDA', 'PISO', 'CASA', 'APARTAMENTO', 'ATICO', 'DUPLEX', 'CHALET']],
];

// From the type as another program writes it, or from the name: "Plaza 14" is a parking space
export function guessPropertyType(text: string) {
	const name = canonical(text);
	return typeWords.find(([, words]) => words.some(word => name.includes(word)))?.[0];
}

// '3,25', '3.25' and '3,25 %' are 3.25. NaN when it isn't a number
export function parseCoefficient(text: string) {
	const number = text.replace(PERCENT_REGEX, '');
	return Number(number.includes(',') ? number.replaceAll('.', '').replace(',', '.') : number);
}

// '1º A', '1ºA' and '1 a' are the same property
export function censusKey(name: string) {
	return normalize(name).replace(SPACES_REGEX, '');
}

export interface CensusLine {
	// Its row in the sheet, to find it there
	line: number;
	cells: string[];
}

export type CensusData = Partial<Pick<Property, 'name' | 'type' | 'coefficient' | 'ownerName' | 'ownerEmail' | 'ownerNif' | 'ownerPhone' | 'tenantName' | 'tenantEmail' | 'mandate'>>;

export interface CensusRow {
	line: number;
	name: string;
	// The one of the census it updates, by name
	property?: Property;
	status: 'new' | 'update' | 'unchanged' | 'error';
	// What's wrong with it, it isn't imported then
	error?: string;
	// What the file has that isn't saved
	warnings: string[];
	// What the file gives it. An empty cell changes nothing
	values: CensusData;
	// What's written: all of it for a new one, only what changes otherwise
	data: CensusData;
	// The labels of what changes
	changes: string[];
}

const dataLabels: Record<keyof CensusData, string> = {
	name: 'Nombre',
	type: 'Tipo',
	coefficient: 'Coeficiente',
	ownerName: 'Propietario',
	ownerEmail: 'Email',
	ownerNif: 'NIF',
	ownerPhone: 'Teléfono',
	tenantName: 'Inquilino',
	tenantEmail: 'Email del inquilino',
	mandate: 'Mandato SEPA',
};

function same(field: keyof CensusData, value: CensusData[keyof CensusData], current: Property) {
	if (field !== 'mandate') {
		return value === current[field];
	}
	const [mandate, old] = [value as SepaMandate, current.mandate];
	return mandate.reference === old?.reference && mandate.iban === old.iban && mandate.signedAt === old.signedAt;
}

/**
 * The rows of a community's census, compared with what it has: each one is a new property, an update of the one with
 * its name (only what the file fills in, so an empty cell never removes anything), unchanged, or an error. Without a
 * type the name says it, but an existing one keeps its own. Owners with an account keep the account's name and email
 */
export function readCensus(lines: CensusLine[], columns: CensusColumns, properties: Property[], today: string): CensusRow[] {
	const byKey = Object.groupBy(properties, property => censusKey(property.name));
	const seen = new Map<string, number>();
	// Mandate references are unique within the community, the creditor
	const references = new Map(properties.flatMap(property => property.mandate ? [[property.mandate.reference, property.id]] : []));
	return lines.map(({ line, cells }): CensusRow => {
		const cell = (field: CensusField) => (cells[columns[field]] ?? '').trim();
		const name = cell('name');
		const key = censusKey(name);
		const matches = byKey[key] ?? [];
		const property = matches.length === 1 ? matches[0] : undefined;
		const coefficientText = cell('coefficient');
		const coefficient = Number(parseCoefficient(coefficientText).toPrecision(10));
		const ownerName = [cell('ownerName'), cell('ownerSurname')].filter(Boolean).join(' ');
		const ownerEmail = cell('ownerEmail').toLowerCase();
		const ownerNif = normalizeTaxId(cell('ownerNif'));
		const ownerPhone = cell('ownerPhone');
		const tenantEmail = cell('tenantEmail').toLowerCase();
		const iban = normalizeIban(cell('iban'));
		const reference = sepaId(cell('mandateReference'));
		const signedText = cell('mandateDate');
		const signedAt = parseDate(signedText);
		const debtorName = ownerName || property?.ownerName || '';
		const hasMandate = !!(iban && reference && signedText);
		const linked = !!property?.ownerUid;
		const firstLine = seen.get(key);

		const error = ([
			[!key, 'Falta el nombre de la propiedad'],
			[firstLine, `Repetida, ya está en la fila ${firstLine}`],
			[matches.length > 1, `Hay ${matches.length} propiedades «${name}» en el censo`],
			[coefficientText && !(coefficient >= 0 && coefficient <= 100), 'El coeficiente no es un porcentaje válido'],
			[ownerNif && !isValidNif(ownerNif), 'El NIF no es válido'],
			[[ownerEmail, tenantEmail].some(email => email && !isEmail(email)), 'El email no es válido'],
			[ownerPhone.length > PHONE_LENGTH, 'El teléfono es demasiado largo'],
			[iban && !isValidIban(iban), 'El IBAN no es válido'],
			[hasMandate && !signedAt, 'La fecha de firma del mandato no es válida'],
			[hasMandate && signedAt > today, 'La fecha de firma del mandato es futura'],
			[hasMandate && !debtorName, 'Falta el propietario, titular del mandato'],
			[hasMandate && (references.get(reference) ?? property?.id) !== property?.id, `Otra propiedad ya tiene el mandato ${reference}`],
		] as const).find(([wrong]) => wrong)?.[1];
		if (key) {
			seen.set(key, firstLine ?? line);
		}
		if (!error && hasMandate) {
			references.set(reference, property?.id ?? `line-${line}`);
		}

		const warnings = [
			...(linked && ((ownerName && ownerName !== property?.ownerName) || (ownerEmail && ownerEmail !== property?.ownerEmail))
				? ['Su propietario tiene cuenta: su nombre y email se cambian desde Propiedades']
				: []),
			...((iban || reference || signedText) && !hasMandate ? ['El mandato SEPA necesita IBAN, referencia y fecha de firma: no se guarda'] : []),
		];
		const values = Object.fromEntries(Object.entries({
			name,
			// From the type column, or for a new one from its name
			type: guessPropertyType(cell('type')) ?? (property ? undefined : guessPropertyType(name) ?? 'home'),
			coefficient: coefficientText ? coefficient : undefined,
			ownerName: linked ? undefined : ownerName,
			ownerEmail: linked ? undefined : ownerEmail,
			ownerNif,
			ownerPhone,
			tenantName: cell('tenantName'),
			tenantEmail,
			mandate: hasMandate ? { reference, debtorName, iban, signedAt, status: 'active', firstRemittanceId: MIGRATED_MANDATE } satisfies SepaMandate : undefined,
		}).filter(([, value]) => value !== undefined && value !== '')) as CensusData;
		const changed = property && !error
			? (Object.keys(values) as (keyof CensusData)[]).filter(field => field !== 'name' && !same(field, values[field], property))
			: [];
		return {
			line,
			name,
			property,
			status: error ? 'error' : !property ? 'new' : changed.length ? 'update' : 'unchanged',
			error,
			warnings,
			values,
			data: property ? Object.fromEntries(changed.map(field => [field, values[field]])) : values,
			changes: changed.map(field => dataLabels[field]),
		};
	});
}

// The census' coefficients once imported: the file's where it gives them, the rest as they are
export function importedTotal(rows: CensusRow[], properties: Property[]) {
	const imported = rows.filter(row => row.status !== 'error');
	const replaced = new Set(imported.map(row => row.property?.id));
	return totalCoefficient([
		...properties.filter(property => !replaced.has(property.id)),
		...imported.map(row => ({ coefficient: row.values.coefficient ?? row.property?.coefficient })),
	]);
}

export interface CensusGroup {
	// As the file has them, from the first row that does
	name: string;
	cif: string;
	address: string;
	iban: string;
	// The existing one it is, by CIF and then by name. A new one without it
	communityId?: string;
	// Why its rows aren't imported
	error?: string;
	lines: CensusLine[];
}

// The rows of a portfolio by their community, matched with the ones the user has. Only gobernança's team creates new ones
export function groupByCommunity(lines: CensusLine[], columns: CensusColumns, communities: Pick<Community, 'id' | 'name' | 'cif'>[], canCreate: boolean): CensusGroup[] {
	const groups = new Map<string, CensusGroup>();
	for (const item of lines) {
		const cell = (field: CensusField) => (item.cells[columns[field]] ?? '').trim();
		const key = censusKey(cell('community'));
		const group = groups.get(key) ?? { name: cell('community'), cif: '', address: '', iban: '', lines: [] };
		group.cif ||= normalizeTaxId(cell('communityCif'));
		group.address ||= cell('communityAddress');
		group.iban ||= normalizeIban(cell('communityIban'));
		group.lines.push(item);
		groups.set(key, group);
	}
	// One community named in different ways goes together, by its CIF or the one it is: two would import its rows twice
	const merged: CensusGroup[] = [];
	for (const group of groups.values()) {
		const community = communities.find(other => group.cif && other.cif && normalizeTaxId(other.cif) === group.cif)
			?? communities.find(other => censusKey(other.name ?? '') === censusKey(group.name));
		const same = merged.find(other => (community && other.communityId === community.id) || (group.cif && other.cif === group.cif));
		if (same) {
			same.name ||= group.name;
			same.cif ||= group.cif;
			same.address ||= group.address;
			same.iban ||= group.iban;
			same.lines = [...same.lines, ...group.lines].sort((a, b) => a.line - b.line);
		} else {
			merged.push({ ...group, communityId: community?.id });
		}
	}
	return merged.map((group) => {
		const error = ([
			[!group.name, 'Falta la comunidad'],
			[!group.communityId && !canCreate, 'No es una de tus comunidades'],
			[!group.communityId && group.cif && !isValidNif(group.cif), 'El CIF de la comunidad no es válido'],
			[!group.communityId && group.iban && !isValidIban(group.iban), 'El IBAN de la comunidad no es válido'],
		] as const).find(([wrong]) => wrong)?.[1];
		return { ...group, error };
	});
}
