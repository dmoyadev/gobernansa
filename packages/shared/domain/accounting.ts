import type { Datable } from './audit.ts';
import type { Booking } from './booking.ts';
import type { Budget, Charge, Expense } from './finance.ts';
import type { Property } from './property.ts';
import { bookingTotal, toDateString } from './booking.ts';
import { payableAmount } from './finance.ts';

/*
 * Contabilidad por partida doble of a community. Every entry is derived from the data the office already keeps (charges,
 * invoices and their payments), so the books never go out of step with them; only the manual entries and the closings
 * are stored
 */

const CODE_REGEX = /^\d{3,10}$/;

// A line of an entry, in cents. account is the account's key: the code for the fixed and the added accounts, `kind:id`
// for the subaccounts made from the data (owners, providers, partidas), whose code is given by their order
export interface JournalLine {
	account: string;
	debit: number;
	credit: number;
}

export type EntryKind = 'opening' | 'charge' | 'invoice' | 'collection' | 'payment' | 'return' | 'manual' | 'regularization' | 'closing';

export interface JournalEntry {
	id: string;
	// 'YYYY-MM-DD'
	date: string;
	concept: string;
	kind: EntryKind;
	lines: JournalLine[];
	// The manual entry it comes from, to edit or delete it
	manualId?: string;
}

export const entryKinds: Record<EntryKind, string> = {
	opening: 'Apertura',
	charge: 'Recibo emitido',
	invoice: 'Factura recibida',
	collection: 'Cobro',
	payment: 'Pago',
	return: 'Devolución',
	manual: 'Manual',
	regularization: 'Regularización',
	closing: 'Cierre',
};

// Asiento manual, at communities/{communityId}/journalEntries, e.g. paying the withholdings to Hacienda or a bank fee
export interface ManualEntry extends Datable {
	id: string;
	year: number;
	date: string;
	concept: string;
	lines: JournalLine[];
	// When it records an income from a third party (e.g. renting the roof to a phone company), who paid it, for the
	// tax returns (184, 347). The amounts are read from the lines, so editing them in the books keeps them right
	income?: IncomeSource;
}

// Arrendamiento: rendimiento del capital inmobiliario. Intereses: del capital mobiliario
export type IncomeKind = 'rental' | 'interest';

export interface IncomeSource {
	kind: IncomeKind;
	payer: string;
	payerNif?: string;
}

// The income account each kind is credited to, and the withholding the payer kept, debited to 4730
export const incomeKinds: Record<IncomeKind, { label: string; account: string }> = {
	rental: { label: 'Arrendamiento (azotea, antena, local…)', account: '7520' },
	interest: { label: 'Intereses de la cuenta', account: '7690' },
};

// The gross income (credits to group 7) and the withholding kept by the payer (debits to 4730)
export function incomeAmounts(entry: Pick<ManualEntry, 'lines'>) {
	const sum = (match: (item: JournalLine) => boolean, side: 'debit' | 'credit') => entry.lines.filter(match).reduce((total, item) => total + item[side], 0);
	return {
		gross: sum(item => item.account.startsWith('7'), 'credit') - sum(item => item.account.startsWith('7'), 'debit'),
		withholding: sum(item => item.account === '4730', 'debit') - sum(item => item.account === '4730', 'credit'),
	};
}

// Cierre del ejercicio, at communities/{communityId}/fiscalYears/{year}. Its closing entry, reversed, opens the next
// year. names keeps the subaccounts' names as they were, for when an owner or a provider is gone
export interface FiscalYearClosing extends Datable {
	id: string;
	year: number;
	// Excedente (positive) or déficit of the year
	result: number;
	regularization: JournalLine[];
	closing: JournalLine[];
	names: Record<string, string>;
}

// The accounts added by the office, at communities/{communityId}/accounting/chart
export interface CustomAccount {
	code: string;
	name: string;
}

export interface Account {
	key: string;
	code: string;
	name: string;
	// Added by the office, so it can be removed
	custom?: boolean;
}

// Plan General Contable adapted to comunidades de propietarios
export const baseAccounts: Record<string, string> = {
	1130: 'Fondo de reserva',
	1200: 'Remanente',
	1290: 'Resultado del ejercicio',
	4000: 'Proveedores',
	4100: 'Acreedores por prestación de servicios',
	4300: 'Propietarios',
	4730: 'Hacienda Pública, retenciones y pagos a cuenta',
	4751: 'Hacienda Pública, acreedora por retenciones practicadas',
	5600: 'Fianzas recibidas a corto plazo',
	5700: 'Caja',
	5720: 'Bancos',
	6220: 'Reparaciones y conservación',
	6230: 'Servicios de profesionales independientes',
	6250: 'Primas de seguros',
	6260: 'Servicios bancarios',
	6280: 'Suministros',
	6290: 'Otros servicios',
	6690: 'Otros gastos financieros',
	7000: 'Cuotas ordinarias',
	7010: 'Derramas',
	7520: 'Ingresos por arrendamientos',
	7590: 'Otros ingresos de gestión',
	7690: 'Otros ingresos financieros',
};

// The group of a partida's subaccount, guessed from its name; the rest are otros servicios
const itemGroups: [RegExp, string][] = [
	[/segur/i, '625'],
	[/banc|comisi/i, '626'],
	[/luz|agua|gas|electric|suministr|energ/i, '628'],
	[/administra|honorari|asesor|abogad|gestor|auditor|notar/i, '623'],
	[/repara|manten|conserva|ascensor|obra|pintura/i, '622'],
];

export function isValidAccountCode(code: string) {
	return CODE_REGEX.test(code) && '1234567'.includes(code[0]);
}

const propertyKey = (id: string) => `4300:${id}`;
const providerKey = (id: string) => `400:${id}`;
const itemKey = (id: string) => `6:${id}`;

function line(account: string, debit: number, credit = 0): JournalLine {
	return { account, debit, credit };
}

function day(timestamp: { toDate: () => Date }) {
	return toDateString(timestamp.toDate());
}

export interface LedgerInput {
	year: number;
	// Those due, paid or returned in the year, or more: the rest are left out
	charges: Charge[];
	// Those dated or paid in the year, or more
	expenses: Expense[];
	// Paid bookings of common areas, those paid or whose fianza was returned in the year, or more
	bookings?: Booking[];
	manual: ManualEntry[];
	budget?: Pick<Budget, 'items' | 'reserveOpening'>;
	properties: Pick<Property, 'id' | 'name' | 'ownerName'>[];
	custom: CustomAccount[];
	// The previous year's closing, which opens this one
	previous?: FiscalYearClosing;
	// This year's, when it's closed
	closing?: FiscalYearClosing;
}

export interface Ledger {
	accounts: Map<string, Account>;
	// In order, numbered by their position
	entries: JournalEntry[];
}

const kindOrder: EntryKind[] = ['opening', 'charge', 'invoice', 'collection', 'payment', 'return', 'manual', 'regularization', 'closing'];

/**
 * The year's journal, deterministic for the same data:
 * - recibo emitido (on its due date): propietario a cuotas ordinarias, derramas or otros ingresos (gastos de devolución),
 *   the part for the fondo de reserva to 113
 * - cobro: bancos a propietario. A direct debit returned is collected and given back on the day of the return, as the
 *   bank does, since the charge no longer keeps when it was collected
 * - factura recibida: the partida's expense (or the fondo de reserva when paid from it) a proveedor and retenciones
 * - pago: proveedor a bancos (or caja), older invoices without paidAt were paid on their date
 * - reserva pagada: bancos a otros ingresos de gestión, and the fianza to fianzas recibidas until it's given back
 * plus the opening (the previous closing, or else the fund's opening balance from the budget), the manual entries,
 * and the regularization and closing once the year is closed
 */
export function buildLedger(input: LedgerInput): Ledger {
	const { year, budget } = input;
	const inYear = (date: string) => date.startsWith(`${year}-`);
	const names = new Map<string, string>();
	const entries: JournalEntry[] = [];
	const add = (entry: JournalEntry) => {
		const lines = entry.lines.filter(item => item.debit || item.credit);
		if (lines.length && inYear(entry.date)) {
			entries.push({ ...entry, lines });
		}
	};

	for (const property of input.properties) {
		names.set(propertyKey(property.id), property.ownerName ? `${property.name} · ${property.ownerName}` : property.name);
	}
	const items = new Map((budget?.items ?? []).map(item => [item.id, item]));
	for (const item of items.values()) {
		names.set(itemKey(item.id), item.name);
	}

	if (input.previous) {
		Object.entries(input.previous.names).forEach(([key, name]) => names.has(key) || names.set(key, name));
		add({ id: 'opening', date: `${year}-01-01`, concept: `Asiento de apertura ${year}`, kind: 'opening', lines: input.previous.closing.map(item => line(item.account, item.credit, item.debit)) });
	} else if (budget?.reserveOpening) {
		add({ id: 'opening', date: `${year}-01-01`, concept: 'Saldo inicial del fondo de reserva', kind: 'opening', lines: [line('5720', budget.reserveOpening), line('1130', 0, budget.reserveOpening)] });
	}

	for (const charge of input.charges) {
		const owner = propertyKey(charge.propertyId);
		if (!names.has(owner)) {
			names.set(owner, charge.ownerName ? `${charge.propertyName} · ${charge.ownerName}` : charge.propertyName);
		}
		const reserve = Math.min(charge.reserve ?? 0, charge.amount);
		const income = charge.type === 'levy' ? '7010' : charge.batchId?.startsWith('return-') ? '7590' : '7000';
		const what = `${charge.concept} · ${charge.propertyName}`;
		add({ id: `charge-${charge.id}`, date: day(charge.dueDate), concept: what, kind: 'charge', lines: [line(owner, charge.amount), line(income, 0, charge.amount - reserve), line('1130', 0, reserve)] });
		if (charge.paidAt) {
			add({ id: `collection-${charge.id}`, date: day(charge.paidAt), concept: `Cobro ${what}`, kind: 'collection', lines: [line('5720', charge.amount), line(owner, 0, charge.amount)] });
		}
		for (const [index, { date }] of (charge.returns ?? []).entries()) {
			add({ id: `return-${charge.id}-${index}-a`, date, concept: `Adeudo domiciliado ${what}`, kind: 'collection', lines: [line('5720', charge.amount), line(owner, 0, charge.amount)] });
			add({ id: `return-${charge.id}-${index}-b`, date, concept: `Devolución ${what}`, kind: 'return', lines: [line(owner, charge.amount), line('5720', 0, charge.amount)] });
		}
	}

	for (const expense of input.expenses) {
		const creditor = expense.provider ? providerKey(expense.provider.id) : '4100';
		if (expense.provider) {
			names.set(creditor, expense.provider.name);
		}
		const debit = expense.fromReserve ? '1130' : items.has(expense.itemId) ? itemKey(expense.itemId) : '6290';
		const payable = payableAmount(expense);
		const withholding = expense.withholding ?? 0;
		const what = `${expense.concept}${expense.invoiceNumber ? ` · Fra. ${expense.invoiceNumber}` : ''}${expense.provider ? ` · ${expense.provider.name}` : ''}`;
		add({ id: `invoice-${expense.id}`, date: day(expense.date), concept: what, kind: 'invoice', lines: [line(debit, expense.amount), line(creditor, 0, payable), line('4751', 0, withholding)] });
		const paidAt = expense.paidAt === undefined ? expense.date : expense.paidAt;
		if (paidAt && payable > 0) {
			add({ id: `payment-${expense.id}`, date: day(paidAt), concept: `Pago ${what}`, kind: 'payment', lines: [line(creditor, payable), line(expense.paymentMethod === 'cash' ? '5700' : '5720', 0, payable)] });
		}
	}

	for (const booking of input.bookings ?? []) {
		const what = `Reserva ${booking.date} ${booking.from} · ${booking.name}`;
		const deposit = booking.deposit ?? 0;
		if (booking.paidAt) {
			add({ id: `booking-${booking.id}`, date: day(booking.paidAt), concept: what, kind: 'collection', lines: [line('5720', bookingTotal(booking)), line('7590', 0, booking.price ?? 0), line('5600', 0, deposit)] });
			if (booking.depositReturnedAt) {
				add({ id: `deposit-${booking.id}`, date: day(booking.depositReturnedAt), concept: `Devolución de fianza ${what}`, kind: 'return', lines: [line('5600', deposit), line('5720', 0, deposit)] });
			}
		}
	}

	for (const entry of input.manual) {
		add({ id: `manual-${entry.id}`, date: entry.date, concept: entry.concept, kind: 'manual', lines: entry.lines, manualId: entry.id });
	}

	if (input.closing) {
		Object.entries(input.closing.names).forEach(([key, name]) => names.has(key) || names.set(key, name));
		add({ id: 'regularization', date: `${year}-12-31`, concept: `Regularización ${year}`, kind: 'regularization', lines: input.closing.regularization });
		add({ id: 'closing', date: `${year}-12-31`, concept: `Asiento de cierre ${year}`, kind: 'closing', lines: input.closing.closing });
	}

	// The opening first and the closing last, the rest by date
	const rank = (entry: JournalEntry) => ['opening', '', 'regularization', 'closing'].indexOf(entry.kind) + 1 || 2;
	entries.sort((a, b) => rank(a) - rank(b) || a.date.localeCompare(b.date) || kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) || a.id.localeCompare(b.id));

	return { accounts: chartOfAccounts(names, budget?.items.map(item => item.id) ?? [], input.custom, entries), entries };
}

const collator = new Intl.Collator('es', { numeric: true });

/**
 * The fixed accounts, the added ones and a subaccount for each owner (4300xxxx), provider (4000xxxx) and partida (its
 * group, e.g. 625, and xxxxx), numbered in order of name (partidas in the budget's order). Keys used by an entry and
 * unknown, e.g. an account removed, are kept with their key as code
 */
export function chartOfAccounts(names: Map<string, string>, itemOrder: string[], custom: CustomAccount[], entries: JournalEntry[] = []) {
	const accounts = new Map<string, Account>();
	for (const [code, name] of Object.entries(baseAccounts)) {
		accounts.set(code, { key: code, code, name });
	}
	for (const { code, name } of custom) {
		accounts.set(code, { key: code, code, name, custom: true });
	}
	const byName = (prefix: string) => [...names.keys()].filter(key => key.startsWith(prefix)).sort((a, b) => collator.compare(names.get(a)!, names.get(b)!) || a.localeCompare(b));
	byName('4300:').forEach((key, index) => accounts.set(key, { key, code: `4300${String(index + 1).padStart(4, '0')}`, name: names.get(key)! }));
	byName('400:').forEach((key, index) => accounts.set(key, { key, code: `4000${String(index + 1).padStart(4, '0')}`, name: names.get(key)! }));
	const counts = new Map<string, number>();
	const itemKeys = [...itemOrder.map(itemKey), ...byName('6:').filter(key => !itemOrder.includes(key.slice(2)))];
	for (const key of itemKeys.filter(key => names.has(key))) {
		const name = names.get(key)!;
		const group = itemGroups.find(([pattern]) => pattern.test(name))?.[1] ?? '629';
		const count = (counts.get(group) ?? 0) + 1;
		counts.set(group, count);
		accounts.set(key, { key, code: `${group}${String(count).padStart(5, '0')}`, name });
	}
	for (const entry of entries) {
		for (const { account } of entry.lines) {
			if (!accounts.has(account)) {
				accounts.set(account, { key: account, code: account, name: names.get(account) ?? 'Cuenta desconocida' });
			}
		}
	}
	return accounts;
}

export function sortedAccounts(accounts: Map<string, Account>) {
	return [...accounts.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export function isBalanced(lines: JournalLine[]) {
	const debit = lines.reduce((sum, item) => sum + item.debit, 0);
	const credit = lines.reduce((sum, item) => sum + item.credit, 0);
	return debit > 0 && debit === credit && lines.every(item => item.debit >= 0 && item.credit >= 0 && Number.isInteger(item.debit) && Number.isInteger(item.credit) && (item.debit > 0) !== (item.credit > 0));
}

export interface AccountBalance {
	debit: number;
	credit: number;
}

// Sumas of each account in the entries
export function balances(entries: JournalEntry[]) {
	const sums = new Map<string, AccountBalance>();
	for (const entry of entries) {
		for (const { account, debit, credit } of entry.lines) {
			const sum = sums.get(account) ?? { debit: 0, credit: 0 };
			sum.debit += debit;
			sum.credit += credit;
			sums.set(account, sum);
		}
	}
	return sums;
}

// Of the year's operations: without the regularization and closing, as the balances and the results are read
export function beforeClosing(entries: JournalEntry[]) {
	return entries.filter(entry => entry.kind !== 'regularization' && entry.kind !== 'closing');
}

// Groups 6 and 7, gastos and ingresos, by their code
export function isResultAccount(account: Pick<Account, 'code'>) {
	return account.code.startsWith('6') || account.code.startsWith('7');
}

export interface ReportRow {
	account: Account;
	amount: number;
	budgeted?: number;
}

const sheetSections: { side: 'assets' | 'liabilities'; title: string; prefixes: string[] }[] = [
	{ side: 'assets', title: 'Propietarios deudores', prefixes: ['43'] },
	{ side: 'assets', title: 'Tesorería', prefixes: ['57'] },
	{ side: 'assets', title: 'Otros deudores', prefixes: [''] },
	{ side: 'liabilities', title: 'Fondo de reserva', prefixes: ['11'] },
	{ side: 'liabilities', title: 'Resultados', prefixes: ['12'] },
	{ side: 'liabilities', title: 'Proveedores y acreedores', prefixes: ['40', '41'] },
	{ side: 'liabilities', title: 'Hacienda Pública', prefixes: ['47'] },
	{ side: 'liabilities', title: 'Propietarios con saldo a favor', prefixes: ['43'] },
	{ side: 'liabilities', title: 'Otros acreedores', prefixes: [''] },
];

/**
 * Balance de situación before closing: each account with a balance on its side (group 1 always with the patrimonio,
 * the rest by the sign of their balance), and the year's result, still in the expense and income accounts, in 129.
 * Both sides add up the same when every entry balances
 */
export function balanceSheet(entries: JournalEntry[], accounts: Map<string, Account>) {
	const sections = sheetSections.map(section => ({ ...section, rows: [] as ReportRow[], total: 0 }));
	let result = 0;
	for (const [key, { debit, credit }] of balances(beforeClosing(entries))) {
		const account = accounts.get(key) ?? { key, code: key, name: key };
		if (isResultAccount(account)) {
			result += credit - debit;
			continue;
		}
		if (debit === credit) {
			continue;
		}
		const side = account.code.startsWith('1') || credit > debit ? 'liabilities' : 'assets';
		const section = sections.find(other => other.side === side && other.prefixes.some(prefix => account.code.startsWith(prefix)))!;
		section.rows.push({ account, amount: side === 'assets' ? debit - credit : credit - debit });
	}
	if (result) {
		const results = sections.find(section => section.title === 'Resultados')!;
		results.rows.push({ account: { key: 'result', code: '129', name: 'Resultado del ejercicio (pendiente de regularizar)' }, amount: result });
	}
	for (const section of sections) {
		section.rows.sort((a, b) => a.account.code.localeCompare(b.account.code));
		section.total = section.rows.reduce((sum, row) => sum + row.amount, 0);
	}
	const shown = sections.filter(section => section.rows.length);
	const total = (side: string) => shown.filter(section => section.side === side).reduce((sum, section) => sum + section.total, 0);
	return { sections: shown, assets: total('assets'), liabilities: total('liabilities') };
}

/**
 * Cuenta de resultados before closing, with what the budget expected: each partida's amount, and the ordinary fees its
 * total. Partidas without expenses are listed too, so what's left of them shows
 */
export function incomeStatement(entries: JournalEntry[], accounts: Map<string, Account>, budget?: Pick<Budget, 'items'>) {
	const sums = balances(beforeClosing(entries));
	const budgeted = new Map((budget?.items ?? []).map(item => [itemKey(item.id), item.amount]));
	const ordinary = (budget?.items ?? []).reduce((sum, item) => sum + item.amount, 0);
	if (ordinary) {
		budgeted.set('7000', ordinary);
	}
	const income: ReportRow[] = [];
	const expenses: ReportRow[] = [];
	for (const account of sortedAccounts(accounts)) {
		const sum = sums.get(account.key);
		if (!isResultAccount(account) || (!sum && !budgeted.has(account.key))) {
			continue;
		}
		const isIncome = account.code.startsWith('7');
		const amount = sum ? (isIncome ? sum.credit - sum.debit : sum.debit - sum.credit) : 0;
		(isIncome ? income : expenses).push({ account, amount, budgeted: budgeted.get(account.key) });
	}
	const total = (rows: ReportRow[], field: 'amount' | 'budgeted') => rows.reduce((sum, row) => sum + (row[field] ?? 0), 0);
	return {
		income,
		expenses,
		totalIncome: total(income, 'amount'),
		totalExpenses: total(expenses, 'amount'),
		budgetedIncome: total(income, 'budgeted'),
		budgetedExpenses: total(expenses, 'budgeted'),
	};
}

/**
 * Cierre: the regularization takes every expense and income account to 129, so the result is left there, and the closing
 * entry zeroes every account with a balance, which reversed is the next year's opening. Lines in order of account key,
 * so closing the same data twice gives the same lines
 */
export function closeYear(entries: JournalEntry[], accounts: Map<string, Account>) {
	const sums = [...balances(beforeClosing(entries))].sort(([a], [b]) => a.localeCompare(b));
	const regularization: JournalLine[] = [];
	let result = 0;
	for (const [key, { debit, credit }] of sums) {
		const account = accounts.get(key);
		if (account && isResultAccount(account) && debit !== credit) {
			regularization.push(debit > credit ? line(key, 0, debit - credit) : line(key, credit - debit));
			result += credit - debit;
		}
	}
	if (regularization.length) {
		regularization.push(result > 0 ? line('1290', 0, result) : line('1290', -result));
	}
	const after = balances([...beforeClosing(entries), { id: 'regularization', date: '', concept: '', kind: 'regularization', lines: regularization }]);
	const closing = [...after].sort(([a], [b]) => a.localeCompare(b)).flatMap(([key, { debit, credit }]) => debit === credit
		? []
		: [debit > credit ? line(key, 0, debit - credit) : line(key, credit - debit)]);
	return { result, regularization: regularization.filter(item => item.debit || item.credit), closing };
}

// Whether the books still give what was closed, or charges or invoices of the year changed since. Lines are compared
// field by field, as Firestore gives a map's fields back in its own order
export function closingMatches(stored: Pick<FiscalYearClosing, 'regularization' | 'closing'>, current: Pick<FiscalYearClosing, 'regularization' | 'closing'>) {
	const flat = ({ regularization, closing }: typeof stored) => JSON.stringify([regularization, closing].map(lines => lines.map(item => [item.account, item.debit, item.credit])));
	return flat(stored) === flat(current);
}

const CSV_QUOTE_REGEX = /[";\n\r]/;
// A text starting like a formula would run as one in a spreadsheet, e.g. a concept typed as "=HYPERLINK(...)"
const CSV_FORMULA_REGEX = /^[=+\-@\t\r]/;

// For a spreadsheet in Spanish: semicolons, decimal commas and a BOM so accents open right. Numbers are cents
export function toCsv(rows: (string | number)[][]) {
	const cell = (value: string | number) => {
		const text = typeof value === 'number' ? (value / 100).toFixed(2).replace('.', ',') : CSV_FORMULA_REGEX.test(value) ? `'${value}` : value;
		return CSV_QUOTE_REGEX.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
	};
	return `\uFEFF${rows.map(row => row.map(cell).join(';')).join('\r\n')}\r\n`;
}
