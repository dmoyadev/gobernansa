import type { Datable } from './audit.ts';
import type { Charge, Expense } from './finance.ts';
import type { PaymentOrder, Remittance } from './sepa.ts';
import { toDateString } from './booking.ts';
import { payableAmount } from './finance.ts';
import { normalizeIban } from './fiscal.ts';
import { toCents } from './money.ts';
import { sepaText } from './sepa.ts';

const LINES_REGEX = /\r?\n/;
const DIGITS_14_REGEX = /^\d{14}$/;
const DATE_6_REGEX = /^\d{6}$/;
const ZEROS_REGEX = /^0+$/;
const SPACES_REGEX = /\s+/g;
const DIACRITICS_REGEX = /[\u0300-\u036F]/g;
const NON_WORD_REGEX = /[^a-z0-9]+/;
const ISO_DATE_REGEX = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const SPANISH_DATE_REGEX = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/;
const PLUS_REGEX = /^\+/;

// Apunte of the community's bank account, at communities/{communityId}/bankMovements. The id depends only on what
// the bank says of it (see movementIds), so importing the same statement again doesn't duplicate it
export interface BankMovement extends Datable {
	id: string;
	// As Norma 43 identifies it: bank, branch and number, without the check digits (see ibanAccount)
	account: string;
	// 'YYYY-MM-DD', the operation's date and its value date
	date: string;
	valueDate?: string;
	// Cents, positive when it comes in (haber) and negative when it goes out (debe)
	amount: number;
	concept: string;
	// Concepto común of Norma 43, e.g. '04' transfers or '17' fees
	commonConcept?: string;
	reference?: string;
	// The account's balance right after it, when the statement says
	balance?: number;
	// Its place in the statement, to order those of the same day
	position: number;
	source: 'norma43' | 'csv' | 'demo';
	status: 'pending' | 'matched' | 'ignored';
	// What it paid or collected, marked paid on its date
	match?: BankMatch;
	// Ignored: why, and the expense recorded for it (e.g. a bank fee)
	note?: string;
	expenseId?: string;
}

export interface BankMatch {
	kind: 'charges' | 'expenses' | 'remittance' | 'paymentOrder';
	ids: string[];
	label: string;
}

export type MovementData = Pick<BankMovement, 'account' | 'date' | 'valueDate' | 'amount' | 'concept' | 'commonConcept' | 'reference' | 'balance' | 'position'>;

export const movementSources: Record<BankMovement['source'], string> = {
	norma43: 'Norma 43',
	csv: 'CSV',
	demo: 'Banco de pruebas',
};

// Conceptos comunes of the AEB's cuaderno 43
export const commonConcepts: Record<string, string> = {
	'01': 'Talones, reintegros',
	'02': 'Abonarés, entregas, ingresos',
	'03': 'Domiciliados, recibos, letras',
	'04': 'Giros, transferencias, traspasos, cheques',
	'05': 'Amortizaciones de préstamos y créditos',
	'06': 'Remesas de efectos',
	'07': 'Suscripciones, dividendos pasivos, canjes',
	'08': 'Dividendos, cupones, primas de junta',
	'09': 'Operaciones de bolsa',
	'10': 'Cheques de gasolina',
	'11': 'Cajero automático',
	'12': 'Tarjetas de crédito y débito',
	'13': 'Operaciones con el extranjero',
	'14': 'Devoluciones e impagados',
	'15': 'Nóminas, seguros sociales',
	'16': 'Timbres, corretaje, pólizas',
	'17': 'Intereses, comisiones, custodia, gastos e impuestos',
	'98': 'Anulaciones, correcciones de asiento',
	'99': 'Varios',
};

// '' when it isn't a Spanish IBAN
export function ibanAccount(iban: string) {
	const value = normalizeIban(iban);
	return value.startsWith('ES') && value.length === 24 ? value.slice(4, 12) + value.slice(14) : '';
}

// Uppercase, without accents nor repeated spaces: the same concept from a file or another reads the same
function canonical(text: string) {
	return text.normalize('NFD').replace(DIACRITICS_REGEX, '').replace(SPACES_REGEX, ' ').trim().toUpperCase();
}

/**
 * Deterministic ids: the account, date, amount, reference and concept, plus how many identical ones came before in the
 * same file (two equal fees the same day are two movements). Prefixed by the date, so they sort by it
 */
export async function movementIds(movements: MovementData[]) {
	const seen = new Map<string, number>();
	return Promise.all(movements.map(async (movement) => {
		const key = [movement.account, movement.date, movement.amount, movement.reference ?? '', canonical(movement.concept)].join('|');
		const index = seen.get(key) ?? 0;
		seen.set(key, index + 1);
		const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${key}|${index}`));
		const hex = Array.from(new Uint8Array(digest).slice(0, 10), byte => byte.toString(16).padStart(2, '0')).join('');
		return `${movement.date}-${hex}`;
	}));
}

/* Norma 43 (AEB cuaderno 43): fixed records of 80 characters */

export interface StatementAccount {
	account: string;
	holder: string;
	// 'YYYY-MM-DD'
	from: string;
	to: string;
	opening: number;
	closing: number;
	movements: MovementData[];
}

export interface ParsedStatement {
	accounts: StatementAccount[];
	// Anything wrong in the file: it isn't imported then
	errors: string[];
}

// AAMMDD, '' when it isn't a date
function n43Date(text: string) {
	if (!DATE_6_REGEX.test(text)) {
		return '';
	}
	const date = `20${text.slice(0, 2)}-${text.slice(2, 4)}-${text.slice(4, 6)}`;
	return isRealDate(date) ? date : '';
}

function isRealDate(date: string) {
	const parsed = new Date(`${date}T12:00:00Z`);
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date);
}

// 14 digits with two implied decimals, already cents. 1 is debe (negative), 2 haber
function n43Amount(sign: string, digits: string) {
	if (!DIGITS_14_REGEX.test(digits) || (sign !== '1' && sign !== '2')) {
		return Number.NaN;
	}
	return Number(digits) * (sign === '1' ? -1 : 1);
}

/**
 * Reads a Norma 43 statement: 11 opens each account with its opening balance, 22 is a movement and the 23 after it
 * its concept, 33 closes the account with its totals and closing balance, which must add up, and 88 ends the file.
 * Records of other kinds (24, currency equivalence) are skipped. Balances are worked out for each movement
 */
export function parseNorma43(text: string): ParsedStatement {
	const errors: string[] = [];
	// Each movement's concept lines, and whether its totals (33) came
	const accounts: (StatementAccount & { concepts: string[][]; ended: boolean })[] = [];
	let current: (typeof accounts)[number] | undefined;
	let records = 0;
	let ended = false;
	const lines = text.split(LINES_REGEX).map(line => line.trimEnd()).filter(Boolean);

	function closeMovement() {
		const movement = current?.movements.at(-1);
		const concepts = current?.concepts.at(-1);
		if (movement && concepts?.length) {
			movement.concept = concepts.join(' ');
		}
	}

	for (const [index, raw] of lines.entries()) {
		const line = raw.padEnd(80);
		const at = `línea ${index + 1}`;
		const kind = line.slice(0, 2);
		if (ended) {
			errors.push(`Hay datos después del final del fichero (${at}).`);
			break;
		}
		if (raw.length > 80) {
			errors.push(`La ${at} tiene más de 80 caracteres: no parece un fichero Norma 43.`);
			break;
		}
		if (kind !== '88') {
			records++;
		}

		if (kind === '11') {
			if (current && !current.ended) {
				errors.push(`Falta el registro de totales (33) de la cuenta ${current.account}.`);
			}
			const opening = n43Amount(line[32], line.slice(33, 47));
			const [from, to] = [n43Date(line.slice(20, 26)), n43Date(line.slice(26, 32))];
			if (Number.isNaN(opening) || !from || !to) {
				errors.push(`La cabecera de cuenta no es válida (${at}).`);
			}
			if (line.slice(47, 50) !== '978') {
				errors.push(`Solo se admiten cuentas en euros (${at}).`);
			}
			current = { account: line.slice(2, 20), holder: line.slice(51, 77).trim(), from, to, opening, closing: opening, movements: [], concepts: [], ended: false };
			accounts.push(current);
		} else if (kind === '22') {
			if (!current || current.ended) {
				errors.push(`Movimiento fuera de una cuenta (${at}).`);
				continue;
			}
			closeMovement();
			const amount = n43Amount(line[27], line.slice(28, 42));
			const date = n43Date(line.slice(10, 16));
			if (Number.isNaN(amount) || !date) {
				errors.push(`Movimiento no válido (${at}).`);
				continue;
			}
			const valueDate = n43Date(line.slice(16, 22));
			const commonConcept = line.slice(22, 24);
			const reference = line.slice(64, 80).trim() || line.slice(52, 64).trim().replace(ZEROS_REGEX, '');
			current.closing += amount;
			current.movements.push({
				account: current.account,
				date,
				...(valueDate ? { valueDate } : {}),
				amount,
				concept: commonConcepts[commonConcept] ?? 'Movimiento',
				commonConcept,
				...(reference ? { reference } : {}),
				balance: current.closing,
				position: current.movements.length,
			});
			current.concepts.push([]);
		} else if (kind === '23') {
			if (!current?.concepts.length) {
				errors.push(`Concepto sin movimiento (${at}).`);
				continue;
			}
			current.concepts.at(-1)!.push(...[line.slice(4, 42), line.slice(42, 80)].map(part => part.trim()).filter(Boolean));
		} else if (kind === '33') {
			if (!current || current.ended) {
				errors.push(`Totales fuera de una cuenta (${at}).`);
				continue;
			}
			closeMovement();
			current.ended = true;
			const debits = current.movements.filter(movement => movement.amount < 0);
			const credits = current.movements.filter(movement => movement.amount > 0);
			const debitTotal = -debits.reduce((sum, movement) => sum + movement.amount, 0);
			const creditTotal = credits.reduce((sum, movement) => sum + movement.amount, 0);
			const closing = n43Amount(line[58], line.slice(59, 73));
			if (line.slice(2, 20) !== current.account) {
				errors.push(`Los totales no son de la cuenta ${current.account} (${at}).`);
			}
			if (Number(line.slice(20, 25)) !== debits.length || Number(line.slice(25, 39)) !== debitTotal) {
				errors.push(`Los cargos de la cuenta ${current.account} no suman lo que dicen sus totales.`);
			}
			if (Number(line.slice(39, 44)) !== credits.length || Number(line.slice(44, 58)) !== creditTotal) {
				errors.push(`Los abonos de la cuenta ${current.account} no suman lo que dicen sus totales.`);
			}
			if (closing !== current.closing) {
				errors.push(`El saldo final de la cuenta ${current.account} no cuadra con sus movimientos.`);
			}
		} else if (kind === '88') {
			ended = true;
			// The count leaves out the 88 itself, some banks count it
			const count = Number(line.slice(20, 26));
			if (count !== records && count !== records + 1) {
				errors.push(`El fichero dice tener ${count} registros y tiene ${records}: puede estar incompleto.`);
			}
		} else if (kind !== '24') {
			errors.push(`Registro desconocido «${kind}» (${at}): no parece un fichero Norma 43.`);
			break;
		}
	}

	if (current && !current.ended) {
		errors.push(`Falta el registro de totales (33) de la cuenta ${current.account}.`);
	}
	if (!lines.length) {
		errors.push('El fichero está vacío.');
	} else if (!ended && !errors.length) {
		errors.push('Falta el registro de fin de fichero (88): puede estar incompleto.');
	}
	return { accounts: accounts.map(({ concepts: _, ended: __, ...account }) => account), errors };
}

function digits(value: number, length: number) {
	return String(Math.abs(value)).padStart(length, '0').slice(-length);
}

function n43DateOf(date: string) {
	return date.slice(2).replaceAll('-', '');
}

function text(value: string, length: number) {
	return sepaText(value, length).toUpperCase().padEnd(length);
}

// In parts of up to `length`, cut between words when it can
function chunks(value: string, length: number) {
	const parts: string[] = [];
	let rest = sepaText(value, 380).toUpperCase();
	while (rest) {
		const cut = rest.length <= length ? rest.length : (rest.lastIndexOf(' ', length) > 0 ? rest.lastIndexOf(' ', length) : length);
		parts.push(rest.slice(0, cut).trim());
		rest = rest.slice(cut).trim();
	}
	return parts;
}

/**
 * One account as a Norma 43 file, as a bank would send it: header, each movement with its concept in 23 records of
 * two halves of 38, totals and end of file, CRLF lines. Plain ASCII, so it reads the same as Latin-1 or UTF-8
 */
export function norma43(account: Pick<StatementAccount, 'account' | 'holder' | 'from' | 'to' | 'opening'>, movements: MovementData[]) {
	const sign = (amount: number) => amount < 0 ? '1' : '2';
	const debits = movements.filter(movement => movement.amount < 0);
	const credits = movements.filter(movement => movement.amount > 0);
	const closing = account.opening + movements.reduce((sum, movement) => sum + movement.amount, 0);
	const lines = [
		`11${account.account}${n43DateOf(account.from)}${n43DateOf(account.to)}${sign(account.opening)}${digits(account.opening, 14)}9783${text(account.holder, 26)}   `,
	];
	for (const movement of movements) {
		lines.push(`22    0000${n43DateOf(movement.date)}${n43DateOf(movement.valueDate ?? movement.date)}${movement.commonConcept ?? '99'}000${sign(movement.amount)}${digits(movement.amount, 14)}${'0'.repeat(10)}${'0'.repeat(12)}${text(movement.reference ?? '', 16)}`);
		const parts = chunks(movement.concept, 38).slice(0, 10);
		for (let start = 0; start < parts.length; start += 2) {
			lines.push(`23${String(start / 2 + 1).padStart(2, '0')}${(parts[start] ?? '').padEnd(38)}${(parts[start + 1] ?? '').padEnd(38)}`);
		}
	}
	lines.push(`33${account.account}${digits(debits.length, 5)}${digits(debits.reduce((sum, movement) => sum + movement.amount, 0), 14)}${digits(credits.length, 5)}${digits(credits.reduce((sum, movement) => sum + movement.amount, 0), 14)}${sign(closing)}${digits(closing, 14)}978    `);
	lines.push(`88${'9'.repeat(18)}${digits(lines.length, 6)}${' '.repeat(54)}`);
	return `${lines.join('\r\n')}\r\n`;
}

/* CSV, as most online banking exports it */

// Rows of cells, separated by whichever of ; tab or , the first line has most of. Quoted cells may have any of them
export function parseCsv(content: string) {
	const firstLine = content.split(LINES_REGEX, 1)[0] ?? '';
	const separator = [';', '\t', ','].reduce((best, candidate) => firstLine.split(candidate).length > firstLine.split(best).length ? candidate : best, ';');
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let quoted = false;
	for (let index = 0; index < content.length; index++) {
		const char = content[index];
		if (quoted) {
			if (char === '"' && content[index + 1] === '"') {
				cell += '"';
				index++;
			} else if (char === '"') {
				quoted = false;
			} else {
				cell += char;
			}
		} else if (char === '"') {
			quoted = true;
		} else if (char === separator) {
			row.push(cell.trim());
			cell = '';
		} else if (char === '\n' || char === '\r') {
			if (char === '\r' && content[index + 1] === '\n') {
				index++;
			}
			row.push(cell.trim());
			rows.push(row);
			row = [];
			cell = '';
		} else {
			cell += char;
		}
	}
	if (cell || row.length) {
		row.push(cell.trim());
		rows.push(row);
	}
	return rows.filter(cells => cells.some(Boolean));
}

// 'DD/MM/YYYY', 'DD-MM-YY', 'DD.MM.YYYY' or 'YYYY-MM-DD' as 'YYYY-MM-DD', '' when it isn't a date
export function parseDate(value: string) {
	const iso = ISO_DATE_REGEX.exec(value.trim());
	const spanish = SPANISH_DATE_REGEX.exec(value.trim());
	const [year, month, day] = iso ? [iso[1], iso[2], iso[3]] : spanish ? [spanish[3].length === 2 ? `20${spanish[3]}` : spanish[3], spanish[2], spanish[1]] : [];
	if (!year || !month || !day) {
		return '';
	}
	const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
	return isRealDate(date) ? date : '';
}

export interface CsvColumns {
	date: number;
	concept: number;
	amount: number;
	// -1 when the file has none
	balance: number;
}

// Each column by its header, as banks usually name them
export function guessColumns(header: string[]): CsvColumns {
	const find = (...names: string[]) => header.findIndex(cell => names.some(name => canonical(cell).includes(name)));
	const date = find('FECHA OPER', 'F. OPER', 'FECHA');
	const amount = find('IMPORTE', 'CANTIDAD');
	return {
		date: Math.max(date, 0),
		concept: Math.max(find('CONCEPTO', 'DESCRIPCION', 'MOVIMIENTO'), 0),
		amount: amount === -1 ? Math.min(2, header.length - 1) : amount,
		balance: find('SALDO', 'DISPONIBLE'),
	};
}

/**
 * The rows with a date and an amount become movements, the rest (the bank's heading, the column names) are skipped.
 * Newest first, as many banks list them, is put back in order so the last one carries the balance
 */
export function csvMovements(rows: string[][], columns: CsvColumns, account: string) {
	const parsed = rows.flatMap((cells) => {
		const date = parseDate(cells[columns.date] ?? '');
		const amount = toCents((cells[columns.amount] ?? '').replace(PLUS_REGEX, ''));
		const balance = columns.balance === -1 ? Number.NaN : toCents((cells[columns.balance] ?? '').replace(PLUS_REGEX, ''));
		return date && !Number.isNaN(amount) && amount !== 0
			? [{ date, amount, concept: cells[columns.concept] || 'Movimiento', ...(Number.isNaN(balance) ? {} : { balance }) }]
			: [];
	});
	if (parsed.length > 1 && parsed[0].date > parsed.at(-1)!.date) {
		parsed.reverse();
	}
	return {
		movements: parsed.map((movement, position): MovementData => ({ ...movement, account, position })),
		skipped: rows.length - parsed.length,
	};
}

/* Matching */

// Something a movement can pay or collect: one or several charges or invoices, a remittance or a payment order
export interface MatchCandidate extends BankMatch {
	// Signed like the movement it matches
	amount: number;
	// Names, concepts and references to compare with the movement's concept
	text: string;
	// 'YYYY-MM-DD', the due or expected date
	date?: string;
}

const STOP_WORDS = new Set(['del', 'las', 'los', 'por', 'para', 'con', 'una', 'que']);

function words(value: string) {
	return new Set(value.normalize('NFD').replace(DIACRITICS_REGEX, '').toLowerCase().split(NON_WORD_REGEX).filter(word => word.length >= 3 && !STOP_WORDS.has(word)));
}

// How many of the candidate's words (names, references) the movement's concept has
export function similarity(movement: Pick<BankMovement, 'concept' | 'reference'>, candidate: Pick<MatchCandidate, 'text'>) {
	const said = words(`${movement.concept} ${movement.reference ?? ''}`);
	return [...words(candidate.text)].filter(word => said.has(word)).length;
}

function daysBetween(a: string, b?: string) {
	return b ? Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000 : 365;
}

/**
 * The best candidate for each movement: same amount, then the most words in common, then the closest date. Each
 * document is suggested once, to the movement that matches it best
 */
export function suggestMatches(movements: BankMovement[], candidates: MatchCandidate[]) {
	const pairs = movements.flatMap(movement => candidates
		.filter(candidate => candidate.amount === movement.amount)
		.map(candidate => ({ movement, candidate, score: similarity(movement, candidate), days: daysBetween(movement.date, candidate.date) })));
	pairs.sort((a, b) => b.score - a.score || a.days - b.days);
	const suggestions = new Map<string, { candidate: MatchCandidate; score: number }>();
	const used = new Set<string>();
	for (const { movement, candidate, score } of pairs) {
		const keys = candidate.ids.map(id => `${candidate.kind}:${id}`);
		if (!suggestions.has(movement.id) && !keys.some(key => used.has(key))) {
			suggestions.set(movement.id, { candidate, score });
			keys.forEach(key => used.add(key));
		}
	}
	return suggestions;
}

function dateOf(timestamp?: { toDate: () => Date }) {
	return timestamp ? toDateString(timestamp.toDate()) : undefined;
}

/**
 * What the pending movements can match: unpaid charges not in a remittance, one by one and all of a property
 * together (an owner paying several months at once), remittances not collected yet (what's left after returns),
 * unpaid invoices not in a payment order, and payment orders not executed yet
 */
export function matchCandidates({ charges, invoices, remittances, orders }: { charges: Charge[]; invoices: Expense[]; remittances: Remittance[]; orders: PaymentOrder[] }) {
	const free = charges.filter(charge => !charge.paidAt && !charge.remittanceId);
	const byProperty = Map.groupBy(free, charge => charge.propertyId);
	const chargeText = (charge: Charge) => `${charge.propertyName} ${charge.ownerName ?? ''} ${charge.concept}`;
	const candidates: MatchCandidate[] = [
		...free.map((charge): MatchCandidate => ({
			kind: 'charges',
			ids: [charge.id],
			amount: charge.amount,
			label: `«${charge.concept}» de ${charge.propertyName}`,
			text: chargeText(charge),
			date: dateOf(charge.dueDate),
		})),
		...[...byProperty.values()].filter(group => group.length > 1).map((group): MatchCandidate => ({
			kind: 'charges',
			ids: group.map(charge => charge.id),
			amount: group.reduce((sum, charge) => sum + charge.amount, 0),
			label: `${group.length} recibos de ${group[0].propertyName}`,
			text: group.map(chargeText).join(' '),
			date: dateOf(group.at(-1)!.dueDate),
		})),
		...remittances.filter(remittance => remittance.status !== 'collected').map((remittance): MatchCandidate => ({
			kind: 'remittance',
			ids: [remittance.id],
			amount: remittance.items.filter(item => !item.returned).reduce((sum, item) => sum + item.amount, 0),
			label: `Remesa ${remittance.reference}`,
			text: `remesa adeudos recibos ${remittance.reference}`,
			date: remittance.collectionDate,
		})),
		...invoices.filter(invoice => !invoice.paidAt && !invoice.paymentOrderId && payableAmount(invoice) > 0).map((invoice): MatchCandidate => ({
			kind: 'expenses',
			ids: [invoice.id],
			amount: -payableAmount(invoice),
			label: `Factura «${invoice.concept}»${invoice.provider ? ` de ${invoice.provider.name}` : ''}`,
			text: `${invoice.provider?.name ?? ''} ${invoice.invoiceNumber ?? ''} ${invoice.concept}`,
			date: dateOf(invoice.dueDate ?? invoice.date),
		})),
		...orders.filter(order => order.status === 'generated').map((order): MatchCandidate => ({
			kind: 'paymentOrder',
			ids: [order.id],
			amount: -order.total,
			label: `Orden de pago ${order.reference}`,
			text: `orden transferencias ${order.reference}`,
			date: order.executionDate,
		})),
	];
	return candidates.filter(candidate => candidate.amount !== 0);
}

/* Bank connection in test mode */

/**
 * The movements a bank feed would bring in test mode, made up from what's pending so reconciling can be tried: owners
 * paying some charges by transfer, the bank crediting a remittance, transfers to providers, a payment order, the
 * account's fee and a cash deposit nothing matches. The same inputs on the same day give the same movements, so its
 * Norma 43 file and the feed import as the same ones. Amounts already waiting in a pending movement are left out
 */
export function demoMovements({ account, today, opening, candidates, waiting }: { account: string; today: string; opening: number; candidates: MatchCandidate[]; waiting: number[] }) {
	const busy = new Set(waiting);
	const pick = (kind: MatchCandidate['kind'], count: number) => candidates
		.filter(candidate => candidate.kind === kind && candidate.ids.length === 1 && !busy.has(candidate.amount))
		.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
		.slice(0, count);
	const charges = pick('charges', 3);
	const invoices = pick('expenses', 2);
	const [remittance] = pick('remittance', 1);
	const [order] = pick('paymentOrder', 1);
	const reference = `DEMO${today.slice(2).replaceAll('-', '')}`;
	const drafts: Omit<MovementData, 'account' | 'date' | 'position'>[] = [
		...charges.map(candidate => ({ amount: candidate.amount, concept: `TRANSFERENCIA DE ${candidate.text}`, commonConcept: '04' })),
		...(remittance ? [{ amount: remittance.amount, concept: `ABONO REMESA ADEUDOS SEPA ${remittance.label.replace('Remesa ', '')}`, commonConcept: '06' }] : []),
		...invoices.map(candidate => ({ amount: candidate.amount, concept: `TRANSFERENCIA A ${candidate.text}`, commonConcept: '04' })),
		...(order ? [{ amount: order.amount, concept: `ORDEN DE TRANSFERENCIAS ${order.label.replace('Orden de pago ', '')}`, commonConcept: '04' }] : []),
		// Their own references, so syncing again the same day doesn't bring them twice when the rest have shifted
		{ amount: -1200, concept: 'COMISION MANTENIMIENTO CUENTA', commonConcept: '17', reference: `${reference}CO` },
		{ amount: 3745, concept: 'INGRESO EN EFECTIVO EN OFICINA', commonConcept: '02', reference: `${reference}EF` },
	];
	// Spread over the last days, oldest first
	const base = new Date(`${today}T12:00:00Z`);
	let balance = opening;
	return drafts.map((draft, position): MovementData => {
		const day = new Date(base.getTime() - Math.floor((drafts.length - 1 - position) / 2) * 86_400_000).toISOString().slice(0, 10);
		balance += draft.amount;
		return { ...draft, concept: sepaText(draft.concept, 76).toUpperCase(), account, date: day, reference: draft.reference ?? `${reference}${String(position + 1).padStart(2, '0')}`, balance, position };
	});
}
