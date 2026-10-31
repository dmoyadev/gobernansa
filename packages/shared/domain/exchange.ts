import type { Account, JournalEntry } from './accounting.ts';
import type { Charge } from './finance.ts';
import type { Property } from './property.ts';
import { canonical, parseDate } from './bank.ts';
import { toCents } from './money.ts';

const DIACRITICS_REGEX = /[\u0300-\u036F]/g;
const NON_ASCII_REGEX = /[^\x20-\x7E]/g;
const DIGITS_REGEX = /^\d+$/;
const LEVY_REGEX = /DERRAMA|EXTRA/;

/* Interchange with spreadsheets and other programs */

// 'DD/MM/YYYY' from 'YYYY-MM-DD', as a Spanish spreadsheet reads a date
export function csvDate(date: string) {
	return date ? date.split('-').reverse().join('/') : '';
}

/*
 * Libro diario as ContaPlus imports it: its XDiario.dbf table (dBase III), one record per line of an entry, with the
 * amounts in euros (MONEDAUSO 2, EURODEBE and EUROHABER) and 8 digit subaccounts. A3 and most Spanish programs read it too
 */

interface DbfField {
	name: string;
	type: 'C' | 'N' | 'D' | 'L';
	length: number;
	decimals?: number;
}

const xdiarioFields: DbfField[] = [
	{ name: 'ASIEN', type: 'N', length: 6 },
	{ name: 'FECHA', type: 'D', length: 8 },
	{ name: 'SUBCTA', type: 'C', length: 12 },
	{ name: 'CONTRA', type: 'C', length: 12 },
	{ name: 'PTADEBE', type: 'N', length: 16, decimals: 2 },
	{ name: 'CONCEPTO', type: 'C', length: 25 },
	{ name: 'PTAHABER', type: 'N', length: 16, decimals: 2 },
	{ name: 'FACTURA', type: 'N', length: 8 },
	{ name: 'BASEIMPO', type: 'N', length: 16, decimals: 2 },
	{ name: 'IVA', type: 'N', length: 5, decimals: 2 },
	{ name: 'RECEQUIV', type: 'N', length: 5, decimals: 2 },
	{ name: 'DOCUMENTO', type: 'C', length: 10 },
	{ name: 'DEPARTA', type: 'C', length: 3 },
	{ name: 'CLAVE', type: 'C', length: 6 },
	{ name: 'ESTADO', type: 'C', length: 1 },
	{ name: 'NCASADO', type: 'N', length: 6 },
	{ name: 'TCASADO', type: 'N', length: 1 },
	{ name: 'TRANS', type: 'N', length: 6 },
	{ name: 'CAMBIO', type: 'N', length: 16, decimals: 6 },
	{ name: 'DEBEME', type: 'N', length: 16, decimals: 2 },
	{ name: 'HABERME', type: 'N', length: 16, decimals: 2 },
	{ name: 'AUXILIAR', type: 'C', length: 1 },
	{ name: 'SERIE', type: 'C', length: 1 },
	{ name: 'SUCURSAL', type: 'C', length: 4 },
	{ name: 'CODDIVISA', type: 'C', length: 5 },
	{ name: 'IMPAUXME', type: 'N', length: 16, decimals: 2 },
	{ name: 'MONEDAUSO', type: 'C', length: 1 },
	{ name: 'EURODEBE', type: 'N', length: 16, decimals: 2 },
	{ name: 'EUROHABER', type: 'N', length: 16, decimals: 2 },
	{ name: 'BASEEURO', type: 'N', length: 16, decimals: 2 },
	{ name: 'NOCONV', type: 'L', length: 1 },
	{ name: 'NUMEROINV', type: 'C', length: 10 },
];

// Plain ASCII, as old programs read text in their own code page
export function asciiText(text: string) {
	return text.normalize('NFD').replace(DIACRITICS_REGEX, '').replace(NON_ASCII_REGEX, '?');
}

// Cents as a dBase number with 2 decimals, from the integer so there's no floating point drift
function decimal(cents: number) {
	const abs = Math.abs(cents);
	return `${cents < 0 ? '-' : ''}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * A dBase III table: a 32 byte header, a 32 byte descriptor per field, 0x0D, then the records (a space for not deleted
 * and each field at its fixed width: text left aligned and numbers right aligned, padded with spaces) and 0x1A
 */
export function dbf(fields: DbfField[], records: Record<string, string | number | boolean>[], today = new Date()) {
	const headerLength = 32 + fields.length * 32 + 1;
	const recordLength = 1 + fields.reduce((sum, field) => sum + field.length, 0);
	const bytes = new Uint8Array(headerLength + records.length * recordLength + 1);
	const view = new DataView(bytes.buffer);
	view.setUint8(0, 0x03);
	view.setUint8(1, today.getFullYear() - 1900);
	view.setUint8(2, today.getMonth() + 1);
	view.setUint8(3, today.getDate());
	view.setUint32(4, records.length, true);
	view.setUint16(8, headerLength, true);
	view.setUint16(10, recordLength, true);
	const write = (offset: number, text: string) => {
		for (let index = 0; index < text.length; index++) {
			bytes[offset + index] = text.charCodeAt(index);
		}
	};
	fields.forEach((field, index) => {
		const offset = 32 + index * 32;
		write(offset, field.name);
		write(offset + 11, field.type);
		bytes[offset + 16] = field.length;
		bytes[offset + 17] = field.decimals ?? 0;
	});
	bytes[headerLength - 1] = 0x0D;
	records.forEach((record, index) => {
		let offset = headerLength + index * recordLength;
		bytes[offset++] = 0x20;
		for (const field of fields) {
			const value = record[field.name];
			let text: string;
			if (field.type === 'N') {
				// Amounts come in cents; the other numbers are whole, and CAMBIO is left at zero
				text = typeof value === 'number' ? (field.decimals === 2 ? decimal(value) : String(value)) : (0).toFixed(field.decimals ?? 0);
				text = text.slice(-field.length).padStart(field.length);
			} else if (field.type === 'L') {
				text = value === true ? 'T' : 'F';
			} else {
				text = asciiText(String(value ?? '')).slice(0, field.length).padEnd(field.length);
			}
			write(offset, text);
			offset += field.length;
		}
	});
	bytes[bytes.length - 1] = 0x1A;
	return bytes;
}

// ContaPlus' subaccounts have 8 digits, the zeros between the account and its number: 5720 is 57200000, 6230001 is 62300001
export function subaccount({ code }: Pick<Account, 'code'>) {
	if (!DIGITS_REGEX.test(code) || code.length >= 8) {
		return code;
	}
	return code.length <= 4 ? code.padEnd(8, '0') : `${code.slice(0, 4)}${code.slice(4).padStart(4, '0')}`;
}

// Entries numbered in order, as the journal shows them. With two lines, each one's counterpart goes in CONTRA
export function xdiario(entries: JournalEntry[], accounts: Map<string, Account>, today = new Date()) {
	const code = (key: string) => subaccount(accounts.get(key) ?? { code: key });
	const records = entries.flatMap((entry, index) => entry.lines.map((item, position) => ({
		ASIEN: index + 1,
		FECHA: entry.date.replaceAll('-', ''),
		SUBCTA: code(item.account),
		CONTRA: entry.lines.length === 2 ? code(entry.lines[1 - position].account) : '',
		CONCEPTO: entry.concept,
		MONEDAUSO: '2',
		EURODEBE: item.debit,
		EUROHABER: item.credit,
		NOCONV: false,
	})));
	return dbf(xdiarioFields, records, today);
}

/* Import of the debt (and the history) of each property from another program */

// Imported charges share it, so importing again only adds those still missing
export const IMPORT_BATCH_ID = 'import';

export interface ImportColumns {
	property: number;
	concept: number;
	type: number;
	dueDate: number;
	amount: number;
	paidAt: number;
}

export const importTemplate = [
	['Propiedad', 'Concepto', 'Tipo', 'Vencimiento', 'Importe', 'Pagado el'],
	['1º A', 'Saldo pendiente', 'Recibo', '31/12/2025', '240,50', ''],
	['Local 1', 'Derrama fachada 2/4', 'Derrama', '15/11/2025', '1.200,00', ''],
	['2º B', 'Cuota octubre 2025', 'Recibo', '01/10/2025', '85,00', '03/10/2025'],
];

// Each column by its heading, -1 when it isn't there. The date of payment first, so "Fecha" is left to the due date
export function guessImportColumns(header: string[]): ImportColumns {
	const names = header.map(canonical);
	const find = (candidates: string[], skip: number[] = []) => names.findIndex((name, index) => !skip.includes(index) && candidates.some(candidate => name.includes(candidate)));
	const paidAt = find(['PAGADO', 'FECHA PAGO', 'FECHA DE PAGO', 'COBRADO', 'FECHA COBRO', 'FECHA DE COBRO']);
	return {
		property: find(['PROPIEDAD', 'INMUEBLE', 'VIVIENDA', 'PISO', 'FINCA', 'UNIDAD', 'PUERTA']),
		concept: find(['CONCEPTO', 'DESCRIPCION', 'DETALLE']),
		type: find(['TIPO']),
		dueDate: find(['VENCIMIENTO', 'FECHA'], [paidAt]),
		amount: find(['IMPORTE', 'DEUDA', 'SALDO', 'PENDIENTE', 'CANTIDAD', 'TOTAL']),
		paidAt,
	};
}

export interface ImportRow {
	// Its line in the file, to find it there
	line: number;
	text: string;
	property?: Property;
	type: Charge['type'];
	concept: string;
	// 'YYYY-MM-DD'
	dueDate: string;
	paidAt: string;
	amount: number;
	// What's wrong with it, it isn't imported then
	error?: string;
	id: string;
}

/**
 * The rows after the heading, matched to the census by the property's name. Without a due date they get `date`, the
 * day of the balances, and without a concept "Saldo pendiente a…". The ids depend only on the row's data (and how many
 * identical rows came before it), so the same file imported again gives the same charges
 */
export async function readImport(rows: string[][], columns: ImportColumns, properties: Property[], date: string) {
	const byName = Object.groupBy(properties, property => canonical(property.name));
	const seen = new Map<string, number>();
	return Promise.all(rows.slice(1).map(async (cells, index): Promise<ImportRow> => {
		const cell = (column: number) => (column === -1 ? '' : cells[column] ?? '').trim();
		const text = cell(columns.property);
		const matches = byName[canonical(text)] ?? [];
		const amount = toCents(cell(columns.amount));
		const dueText = cell(columns.dueDate);
		const dueDate = dueText ? parseDate(dueText) : date;
		const paidText = cell(columns.paidAt);
		const paidAt = paidText ? parseDate(paidText) : '';
		const row: ImportRow = {
			line: index + 2,
			text,
			property: matches.length === 1 ? matches[0] : undefined,
			type: LEVY_REGEX.test(canonical(cell(columns.type))) ? 'levy' : 'fee',
			concept: cell(columns.concept) || `Saldo pendiente a ${csvDate(date)}`,
			dueDate,
			paidAt,
			amount,
			id: '',
		};
		row.error = !text
			? 'Falta la propiedad'
			: matches.length > 1
				? `Hay ${matches.length} propiedades «${text}»`
				: !row.property
						? `No hay ninguna propiedad «${text}»`
						: Number.isNaN(amount)
							? 'El importe no es válido'
							: amount <= 0
								? 'Solo se importan importes a cobrar, mayores que cero'
								: !dueDate
										? 'La fecha de vencimiento no es válida'
										: paidText && !paidAt
											? 'La fecha de pago no es válida'
											: undefined;
		if (!row.error) {
			const key = [row.property!.id, row.type, row.dueDate, row.amount, canonical(row.concept)].join('|');
			const count = seen.get(key) ?? 0;
			seen.set(key, count + 1);
			const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${key}|${count}`));
			row.id = `${IMPORT_BATCH_ID}-${row.property!.id}-${Array.from(new Uint8Array(digest).slice(0, 8), byte => byte.toString(16).padStart(2, '0')).join('')}`;
		}
		return row;
	}));
}
