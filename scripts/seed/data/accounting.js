// Facturas de proveedores, órdenes de pago, banco y contabilidad. comm1's invoices of last year were typed from the old
// program when it moved, to close that year here, and this year's as they came: by transfer, direct debit, in a SEPA
// payment order or in cash, one from the fondo de reserva. Its account comes from a Norma 43 statement and, since 54
// days ago, from the test bank feed, reconciled with what it paid but a few left to try the suggestions. Last year is
// closed and opens this one. comm2 only has its first invoices since the takeover and a CSV of its last days
import { createHash } from 'node:crypto';
import { buildLedger, closeYear } from '../../../packages/shared/domain/accounting.ts';
import { quarterReturn, withholdings } from '../../../packages/shared/domain/aeat.ts';
import { canonical, ibanAccount } from '../../../packages/shared/domain/bank.ts';
import { monthLabel } from '../../../packages/shared/domain/billing.ts';
import { bookingTotal, toDateString } from '../../../packages/shared/domain/booking.ts';
import { invoiceAmounts, payableAmount } from '../../../packages/shared/domain/finance.ts';
import { normalizeIban, normalizeTaxId } from '../../../packages/shared/domain/fiscal.ts';
import { sepaDateTime, sepaId, sepaText } from '../../../packages/shared/domain/sepa.ts';
import billing from './billing.js';
import bookings from './bookings.js';
import { audit, commonAreas, communities, days, isoDate, now, office, propertiesOf, providers, uids, year } from './cast.js';
import charges, { bankFlows, openCharges } from './charges.js';

const lastYear = year - 1;
const by = uids.office;
const communityById = Object.fromEntries(communities.map(community => [community.id, community]));
const store = { comm1: {}, comm2: {} };
for (const docs of Object.values(store)) {
	Object.assign(docs, { expenses: {}, paymentOrders: {}, bankMovements: {}, journalEntries: {}, fiscalYears: {}, accounting: {} });
}

/* Helpers */

// n days after a date, at that time
function after(date, n = 0, time = '12:00') {
	const [hours, minutes, seconds = 0] = time.split(':').map(Number);
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n, hours, minutes, seconds);
}

// 'YYYY-MM-DD' at that time
function on(date, time = '12:00') {
	return new Date(`${date}T${time}`);
}

function later(a, b) {
	return a > b ? a : b;
}

// As Firestore gives them back, for the domain's functions that read Timestamps
function stored(value) {
	if (value instanceof Date) {
		return { toDate: () => value, toMillis: () => value.getTime() };
	}
	if (Array.isArray(value)) {
		return value.map(stored);
	}
	return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stored(item)])) : value;
}

function asList(communityId, collection) {
	return Object.entries(store[communityId][collection]).map(([id, data]) => ({ ...stored(data), id }));
}

// The last day of each period of `months` months of this year already over
function ended(months) {
	const ends = [];
	for (let end = new Date(year, months, 0); end < days(0, '00:00'); end = new Date(year, end.getMonth() + 1 + months, 0)) {
		ends.push(end);
	}
	return ends;
}

const monthName = new Intl.DateTimeFormat('es', { month: 'long' });

/* Supplier invoices */

// When the office started typing each community's invoices: comm1 moved 398 days ago, comm2 was taken over 38 days ago
const typedSince = { comm1: days(-398, '17:00'), comm2: days(-38, '17:00') };
const payers = [...providers, { id: 'prov_office', name: office.name, fiscalName: office.name, cif: office.nif, address: office.address, iban: office.iban }];
const payeeById = Object.fromEntries(payers.map(provider => [provider.id, provider]));

/**
 * As the budget page saves one: dated at midnight, due at the end of its day (30 days later unless given), owed while
 * paid is null, the withholding a professional's. Typed the afternoon it came, older ones when the office moved
 */
function invoice(communityId, id, { item, provider, concept, number, date, base, vatRate = 21, withholdingRate = 0, due = after(date, 30, '23:59:59'), paid = null, method = 'transfer', fromReserve }) {
	const { vat, withholding, amount } = invoiceAmounts(base, vatRate, withholdingRate);
	const payee = provider && payeeById[provider];
	const typed = later(after(date, 0, '17:00'), typedSince[communityId]);
	store[communityId].expenses[id] = {
		year: date.getFullYear(),
		itemId: item,
		concept,
		amount,
		date: after(date, 0, '00:00'),
		provider: payee && { id: payee.id, name: payee.id === 'prov_office' ? office.name : payee.name, nif: payee.cif },
		invoiceNumber: number,
		base,
		vatRate,
		vat,
		withholdingRate,
		withholding,
		withholdingType: withholding ? 'professional' : undefined,
		dueDate: due,
		paidAt: paid && paid < now ? paid : null,
		paymentMethod: method,
		fromReserve: fromReserve || undefined,
		...audit(typed),
		updatedAt: paid && paid < now && paid > typed ? paid : typed,
	};
	return id;
}

function expense(communityId, id) {
	return store[communityId].expenses[id];
}

// Back to owed, as it was typed
function owe(communityId, id) {
	if (id) {
		Object.assign(expense(communityId, id), { paidAt: null, updatedAt: expense(communityId, id).createdAt });
	}
}

// [id, partida, provider, concept, number, date, base, VAT, withholding, days to pay it, method]. Utilities have no provider
const comm1LastYear = [
	...[1, 2, 3, 4].map(n => [`clean-${lastYear}-${n}t`, 'cleaning', 'prov_cleaning', `Limpieza ${n}T ${lastYear}`, `LJ-${lastYear}/T${n}`, new Date(lastYear, n * 3, 0), 59504, 21, 0, 10]),
	[`clean-${lastYear}-glass`, 'cleaning', 'prov_cleaning', 'Limpieza de cristales y del garaje', `LJ-${lastYear}/E01`, new Date(lastYear, 5, 15), 15000, 21, 0, 20],
	...[1, 2].flatMap(n => [
		[`elevator-${lastYear}-${n}s`, 'elevator', 'prov_elevator', `Mantenimiento del ascensor, ${n}º semestre ${lastYear}`, `ADS-${lastYear}-0${n * 41}`, new Date(lastYear, n * 6, 0), 52355, 21, 0, 15],
		[`garden-${lastYear}-${n}s`, 'gardening', 'prov_garden', `Jardín y piscina, ${n}º semestre ${lastYear}`, `JG ${lastYear}/0${n * 18}`, new Date(lastYear, n * 6, 0), 59504, 21, 0, 15],
		[`power-${lastYear}-${n}s`, 'electricity', null, `Electricidad de zonas comunes, ${n}º semestre ${lastYear}`, `E${lastYear}-${n}S`, new Date(lastYear, n * 6, 0), 59504, 21, 0, 5, 'direct_debit'],
		[`water-${lastYear}-${n}s`, 'water', null, `Agua de zonas comunes, ${n}º semestre ${lastYear}`, `A${lastYear}-${n}S`, new Date(lastYear, n * 6, 0), 26182, 10, 0, 5, 'direct_debit'],
	]),
	// The renewal the obligations page has as last done 307 days ago. Insurance has no VAT
	['insurance-renewal', 'insurance', 'prov_insurance', 'Prima anual del seguro multirriesgo, póliza 123456', `123456/${days(-307).getFullYear()}`, days(-307), 104830, 0, 0, 0, 'direct_debit'],
	[`led-${lastYear}`, 'maintenance', 'prov_electric', 'Cambio a LED de la iluminación de la escalera', `L${lastYear}0057`, new Date(lastYear, 4, 20), 38000, 21, 0, 16],
	['extinguishers', 'maintenance', 'prov_fire', 'Revisión anual de extintores', `EXT-${days(-340).getFullYear()}-1187`, days(-340), 18000, 21, 0, 10],
	[`legal-${lastYear}-1`, 'legal', 'prov_lawyer', 'Revisión del contrato de arrendamiento de la azotea', `${lastYear}-006`, new Date(lastYear, 1, 20), 12000, 21, 15, 13],
	[`legal-${lastYear}-2`, 'legal', 'prov_lawyer', `Asistencia jurídica en la junta ordinaria de ${lastYear}`, `${lastYear}-031`, new Date(lastYear, 10, 25), 16000, 21, 15, 15],
	// The office's fees from its old program, 144 € a month then
	...[1, 2, 3, 4].map(n => [`office-${lastYear}-${n}t`, 'administration', 'prov_office', `Honorarios de administración, ${n}T ${lastYear}`, `FJ-${lastYear}-${String(n * 9).padStart(3, '0')}`, new Date(lastYear, n * 3, 0), 43200, 21, 0, 10]),
];

const comm1ThisYear = [
	['garage-door', 'maintenance', 'prov_electric', 'Revisión de la puerta automática del garaje', `L${days(-186).getFullYear()}0012`, days(-186), 9000, 21, 0, 12],
	['bulbs', 'maintenance', 'prov_electric', 'Bombillas y fluorescentes del garaje', `L${days(-75).getFullYear()}0031`, days(-75), 2479, 21, 0, 0, 'cash'],
	// The leak in the garage (issue_leak): paid, and claimed to the insurer
	['inv_leak', 'maintenance', 'prov_plumbing', 'Reparación de la fuga de agua del garaje', `HO-${days(-20).getFullYear()}-0418`, days(-20), 64500, 21, 0, 2],
	[`legal-${year}-1`, 'legal', 'prov_lawyer', 'Informe sobre la actualización de la renta de la antena', `${days(-262).getFullYear()}-004`, days(-262), 6000, 21, 15, 18],
	// Both in the payment order executed 37 days ago
	['humidity-3b', 'maintenance', 'prov_plumbing', 'Sustitución de la bajante comunitaria junto al 3B', `HO-${days(-46).getFullYear()}-0391`, days(-46), 42000, 21, 0, null],
	['legal-junta', 'legal', 'prov_lawyer', 'Asistencia jurídica en la junta ordinaria', `${days(-44).getFullYear()}-014`, days(-44), 8000, 21, 15, null],
	// The old seed's claim of Piso 2B's debt, now the monitorio the ordinary meeting approved
	['inv_3', 'legal', 'prov_lawyer', 'Reclamación de deuda de Piso 2B: petición de monitorio', `${days(-8).getFullYear()}-017`, days(-8), 15000, 21, 15, null],
	// What the office invoiced by hand before its monthly run (billing's last six months)
	...Array.from({ length: Math.max(now.getMonth() - 6, 0) }, (_, month) => {
		const date = new Date(year, month, 1);
		return [`office-${toDateString(date).slice(0, 7)}`, 'administration', 'prov_office', `Honorarios de administración, ${monthLabel(toDateString(date).slice(0, 7))}`, `FJ-${year}-${String(month + 1).padStart(3, '0')}`, date, 15000, 21, 0, 10];
	}),
];

for (const [id, item, provider, concept, number, date, base, vatRate, withholdingRate, payIn, method] of [...comm1LastYear, ...comm1ThisYear]) {
	invoice('comm1', id, { item, provider, concept, number, date, base, vatRate, withholdingRate, paid: payIn === null ? null : after(date, payIn), method, due: method === 'direct_debit' ? after(date, payIn, '23:59:59') : undefined });
}

// The pool's pump, from the fondo de reserva
invoice('comm1', 'pool-pump', { item: 'gardening', provider: 'prov_garden', concept: 'Sustitución de la bomba de depuración de la piscina', number: `JG ${days(-150).getFullYear()}/061`, date: days(-150), base: 185000, paid: days(-140), fromReserve: true });

// Periodic ones of this year, newest last: those the orders carry or still owed are marked by their place from the end
const series = {
	clean: ended(1).map((end, index) => invoice('comm1', `clean-${toDateString(end).slice(0, 7)}`, { item: 'cleaning', provider: 'prov_cleaning', concept: `Limpieza ${monthName.format(end)}`, number: `LJ-${year}/${String(index + 1).padStart(2, '0')}01`, date: end, base: 20661, paid: after(end, 10) })),
	elevator: ended(3).map((end, index) => invoice('comm1', `elevator-${year}-${index + 1}t`, { item: 'elevator', provider: 'prov_elevator', concept: `Mantenimiento del ascensor, ${index + 1}T ${year}`, number: `ADS-${year}-0${(index + 1) * 23}`, date: end, base: 27273, paid: after(end, 15) })),
	garden: ended(3).map((end, index) => invoice('comm1', `garden-${year}-${index + 1}t`, { item: 'gardening', provider: 'prov_garden', concept: `Jardín y piscina, ${index + 1}T ${year}`, number: `JG ${year}/0${(index + 1) * 14}`, date: end, base: 30992, paid: after(end, 15) })),
	power: ended(2).map((end, index) => invoice('comm1', `power-${year}-${index + 1}b`, { item: 'electricity', concept: `Electricidad de zonas comunes, ${index + 1}º bimestre ${year}`, number: `E${year}-${index + 1}B`, date: end, base: 20661, paid: after(end, 5), due: after(end, 5, '23:59:59'), method: 'direct_debit' })),
	water: ended(3).map((end, index) => invoice('comm1', `water-${year}-${index + 1}t`, { item: 'water', concept: `Agua de zonas comunes, ${index + 1}T ${year}`, number: `A${year}-${index + 1}T`, date: end, base: 13636, vatRate: 10, paid: after(end, 5), due: after(end, 5, '23:59:59'), method: 'direct_debit' })),
};
// The newest cleaning still owed, and the newest water bill too: the bank charged it but it isn't reconciled yet
owe('comm1', series.clean.at(-1));
owe('comm1', series.water.at(-1));

/* comm2, since the takeover */

for (const [id, item, provider, concept, number, date, base, vatRate, payIn, method] of [
	...ended(1).filter(end => end > days(-42)).map(end => [`clean-${toDateString(end).slice(0, 7)}`, 'cleaning', 'prov_cleaning', `Limpieza ${monthName.format(end)}`, `LJ-${year}/${String(end.getMonth() + 1).padStart(2, '0')}02`, end, 12397, 21, 10]),
	['terrace-drains', 'cleaning', 'prov_cleaning', 'Limpieza de la azotea y los sumideros', `LJ-${days(-30).getFullYear()}/S07`, days(-30), 9000, 21, 5],
	['elevator-month', 'elevator', 'prov_elevator', `Mantenimiento del ascensor, ${monthName.format(days(-32))}`, `ADS-${days(-32).getFullYear()}-0207`, days(-32), 8264, 21, 5, 'direct_debit'],
	['power-month', 'electricity', null, `Electricidad de zonas comunes, ${monthName.format(days(-20))}`, `E${days(-20).getFullYear()}-M2`, days(-20), 6198, 21, 5, 'direct_debit'],
	// Charged by the bank 3 days ago, in the CSV still to reconcile
	['water-month', 'water', null, 'Agua de zonas comunes, bimestre', `A${days(-12).getFullYear()}-B2`, days(-12), 5455, 10, 9, 'direct_debit'],
]) {
	invoice('comm2', id, { item, provider, concept, number, date, base, vatRate, paid: after(date, payIn), method, due: method === 'direct_debit' ? after(date, payIn, '23:59:59') : undefined });
}
// The newest cleaning still owed, and the water's debit in the CSV still to reconcile
owe('comm2', Object.keys(store.comm2.expenses).filter(id => id.startsWith('clean-')).at(-1));
owe('comm2', 'water-month');

/* Payment orders (SEPA credit transfers): one executed and reconciled, one generated whose debit came yesterday */

function order(communityId, id, issued, executionDate, expenseIds) {
	const { name, cif, sepaSuffix, iban, bic } = communityById[communityId];
	const reference = sepaId(`TRF-${toDateString(issued).replaceAll('-', '')}-${id.slice(0, 6)}`);
	const invoices = expenseIds.filter(Boolean).map(expenseId => [expenseId, expense(communityId, expenseId)]);
	if (!invoices.length) {
		return undefined;
	}
	const items = invoices.map(([expenseId, invoiced], index) => {
		const payee = payeeById[invoiced.provider.id];
		Object.assign(invoiced, { paymentOrderId: id, paidAt: null, paymentMethod: 'transfer', updatedAt: issued });
		return {
			expenseId,
			providerId: payee.id,
			creditorName: payee.fiscalName || payee.name,
			iban: normalizeIban(payee.iban),
			amount: payableAmount(invoiced),
			concept: invoiced.concept,
			invoiceNumber: invoiced.invoiceNumber,
			endToEndId: `${reference}-${String(index + 1).padStart(4, '0')}`,
		};
	});
	store[communityId].paymentOrders[id] = {
		reference,
		executionDate,
		issuedAt: sepaDateTime(issued),
		status: 'generated',
		debtor: { name, id: `${normalizeTaxId(cif)}${sepaSuffix || '000'}`, iban: normalizeIban(iban), ...(bic ? { bic } : {}) },
		items,
		total: items.reduce((total, item) => total + item.amount, 0),
		...audit(issued),
	};
	return { id, ...store[communityId].paymentOrders[id] };
}

const executed = order('comm1', 'po0001', days(-38, '10:00'), isoDate(-37), [series.clean.at(-3), 'humidity-3b', 'legal-junta']);
const generated = order('comm1', 'po0002', days(-2, '09:40'), isoDate(-1), [series.clean.at(-2), series.elevator.at(-1), series.garden.at(-1)]);

// The executed one paid its invoices on its day, reconciled with its bank movement below
const executedAt = executed && on(executed.executionDate);
if (executed) {
	Object.assign(store.comm1.paymentOrders[executed.id], { status: 'executed', executedAt });
	for (const item of executed.items) {
		Object.assign(expense('comm1', item.expenseId), { paidAt: executedAt });
	}
}

/* Asientos manuales: incomes from third parties, bank fees, the 111 paid, last year's fund and what no invoice covers */

// The antenna on the roof, rented to a phone company that withholds 19 % (for the 184 and the 347)
const antenna = { kind: 'rental', payer: 'Antenas del Sur S.A.', payerNif: 'A23045677' };
const bank = { kind: 'interest', payer: communityById.comm1.bank };

const manualMoves = [];

// movement: what the bank says of it in the statement or the feed, set apart there: [concept, common concept, note]
function entry(id, date, concept, lines, { income, movement } = {}) {
	if (on(date) >= now) {
		return;
	}
	store.comm1.journalEntries[id] = { year: Number(date.slice(0, 4)), date, concept, lines, income, ...audit(later(on(date, '10:00'), typedSince.comm1)) };
	if (movement) {
		const [text, commonConcept, note] = movement;
		const amount = lines.filter(line => line.account === '5720').reduce((total, line) => total + line.debit - line.credit, 0);
		manualMoves.push({ date, amount, concept: text, commonConcept, status: 'ignored', note });
	}
}

function line(account, debit, credit = 0) {
	return { account, debit, credit };
}

// As the Impuestos page adds one: bancos what arrived, 4730 the withholding kept, the kind's income account the gross
function incomeLines(account, gross, withholding) {
	return [line('5720', gross - withholding), ...(withholding ? [line('4730', withholding)] : []), line(account, 0, gross)];
}

for (const y of [lastYear, year]) {
	[1, 2, 3, 4].forEach((quarter) => {
		const date = `${y}-${String(quarter * 3 - 2).padStart(2, '0')}-05`;
		entry(`rent-${y}-${quarter}t`, date, `Alquiler de la azotea para la antena, ${quarter}T ${y}`, incomeLines('7520', 90000, 17100), {
			income: antenna,
			movement: [`TRANSFERENCIA DE ANTENAS DEL SUR SA ALQUILER AZOTEA ${quarter}T ${y}`, '04', 'Alquiler de la antena, anotado como ingreso en Impuestos'],
		});
	});
}
const interestMovement = ['LIQUIDACION INTERESES CUENTA', '17', 'Intereses de la cuenta, anotados como ingreso en Impuestos'];
entry(`interest-${lastYear}`, `${lastYear}-12-31`, `Intereses de la cuenta ${lastYear}`, incomeLines('7690', 1850, 352), { income: bank, movement: interestMovement });
entry(`interest-${year}-1s`, `${year}-06-30`, `Intereses de la cuenta, primer semestre ${year}`, incomeLines('7690', 920, 175), { income: bank, movement: interestMovement });

// The old seed's bank fee: what the bank charged before its movements were imported, 12 € a month
const windowStart = isoDate(-90);
const monthEnds = [...Array.from({ length: 12 }, (_, month) => new Date(lastYear, month + 1, 0)), ...ended(1)].map(toDateString);
for (const y of [lastYear, year]) {
	const feeMonths = monthEnds.filter(date => date < windowStart && date.startsWith(`${y}-`));
	if (feeMonths.length) {
		const months = feeMonths.length === 12 ? '' : `, enero a ${monthName.format(on(feeMonths.at(-1)))}`;
		entry(`bank-fees-${y}`, feeMonths.at(-1), `Comisiones de mantenimiento de la cuenta${months} ${y}`, [line('6260', feeMonths.length * 1200), line('5720', 0, feeMonths.length * 1200)]);
	}
}

// Last year's recibos came from the old program without the fund's part: the year's contribution is moved to it
entry(`reserve-${lastYear}`, `${lastYear}-12-31`, `Aportación de ${lastYear} al fondo de reserva, incluida en las cuotas`, [line('7000', 125000), line('1130', 0, 125000)]);

entry('burofax-prop4', isoDate(-30), 'Burofax de requerimiento de pago a Piso 2B', [line('6292', 2694), line('5720', 0, 2694)], { movement: ['COMPRA TARJETA CORREOS BUROFAX', '12', 'Burofax a Piso 2B, en un asiento manual'] });
entry('indemnity-leak', isoDate(-4), `Indemnización de La Previsora por la fuga del garaje, siniestro ${year}/004512`, [line('5720', 63045), line('7780', 0, 63045)], {
	movement: [`TRANSFERENCIA DE LA PREVISORA SINIESTRO ${year}/004512`, '04', 'Indemnización del seguro por la fuga del garaje, en un asiento manual'],
});

// The 111 of each quarter with withholdings, paid on the 20th of the next month
for (const y of [lastYear, year]) {
	const kept = withholdings(y, asList('comm1', 'expenses'), payers);
	[0, 1, 2, 3].forEach((quarter) => {
		const { withholding } = quarterReturn(kept, 'professional', quarter);
		if (withholding) {
			const date = toDateString(new Date(y, quarter * 3 + 3, 20));
			entry(`model111-${y}-${quarter + 1}t`, date, `Pago del modelo 111 del ${quarter + 1}T ${y}`, [line('4751', withholding), line('5720', 0, withholding)], {
				movement: [`ADEUDO AEAT IMPUESTOS MODELO 111 ${quarter + 1}T ${y}`, '17', `Modelo 111 del ${quarter + 1}T, en un asiento manual`],
			});
		}
	});
}

// Added by the office for the burofax and the insurer's payment, the latter right before its entry
const chart = [{ code: '6292', name: 'Correo y burofax' }, { code: '7780', name: 'Indemnizaciones de seguros' }];
store.comm1.accounting.chart = { accounts: chart, updatedAt: days(-4, '09:50'), updatedBy: by };

/* Bank movements */

// What the other groups wrote, for what reached the bank and last year's books
const others = {};
for (const group of [charges, billing, bookings]) {
	group.seed((path, data) => {
		others[path] = data;
	});
}
function othersOf(communityId, collection) {
	const prefix = `communities/${communityId}/${collection}/`;
	return Object.entries(others).filter(([path]) => path.startsWith(prefix)).map(([path, data]) => ({ ...stored(data), id: path.slice(prefix.length) }));
}

const feedStart = isoDate(-54);
const today = isoDate(0);
const accounts = { comm1: ibanAccount(communityById.comm1.iban), comm2: ibanAccount(communityById.comm2.iban) };
const seen = {};

/**
 * comm1's: the Norma 43 statement imported before connecting the feed (its last 90 days, as the bank page shows them)
 * and the feed's since, synced every morning. comm2's: a CSV of its last days. Ids as movementIds makes them, unless
 * charges fixed one. Reconciled (or set apart) the morning they came in
 */
function move(communityId, { id, status = 'matched', ...entry }) {
	if (entry.date < windowStart || entry.date >= today) {
		return undefined;
	}
	const account = accounts[communityId];
	const concept = communityId === 'comm1' ? sepaText(entry.concept, 76).toUpperCase() : entry.concept;
	const key = [account, entry.date, entry.amount, entry.reference ?? '', canonical(concept)].join('|');
	seen[key] = (seen[key] ?? -1) + 1;
	const movementId = id ?? `${entry.date}-${createHash('sha256').update(`${key}|${seen[key]}`).digest('hex').slice(0, 20)}`;
	const source = communityId === 'comm2' ? 'csv' : entry.date < feedStart ? 'norma43' : 'demo';
	const createdAt = { csv: days(-1, '16:00'), norma43: days(-54, '11:05') }[source] ?? new Date(Math.min(after(on(entry.date), 1, '08:30'), days(-1, '08:30')));
	const updatedAt = status === 'pending' ? createdAt : new Date(createdAt.getTime() + 25 * 60_000);
	store[communityId].bankMovements[movementId] = { account, ...entry, concept, source, status, ...audit(createdAt), updatedAt };
	return { id: movementId, updatedAt };
}

// What charges paid or collected through the account, reconciled with their ids; the rest set apart or still pending
for (const { movementId, match, ...flow } of bankFlows.comm1) {
	if (movementId) {
		move('comm1', { id: movementId, ...flow, match });
	} else if (flow.commonConcept === '17') {
		const moved = move('comm1', { ...flow, status: 'ignored', note: 'Comisión del banco por el adeudo devuelto' });
		if (moved) {
			const at = on(flow.date);
			store.comm1.bankMovements[moved.id].expenseId = `bank-${moved.id}`;
			store.comm1.expenses[`bank-${moved.id}`] = { year: at.getFullYear(), itemId: '', concept: 'Comisión del banco por el adeudo devuelto', amount: -flow.amount, date: at, paidAt: at, paymentMethod: 'direct_debit', ...audit(moved.updatedAt) };
		}
	} else if (flow.amount < 0) {
		move('comm1', { ...flow, status: 'ignored', note: 'Adeudo devuelto, ya registrado en su remesa' });
	} else {
		move('comm1', { ...flow, status: flow.commonConcept === '12' ? 'pending' : 'ignored', note: flow.commonConcept === '12' ? undefined : 'Cobro registrado a mano antes de conectar el banco' });
	}
}

// Invoices paid by transfer or debited, reconciled: they're paid on the movement's day and point to it
function payee(expense) {
	return expense.provider ? payeeById[expense.provider.id]?.fiscalName || expense.provider.name : '';
}
const theirs = othersOf('comm1', 'expenses').map(expense => [expense.id, { ...expense, paidAt: expense.paidAt?.toDate() ?? null }]);
for (const [id, paid] of [...Object.entries(store.comm1.expenses), ...theirs]) {
	if (!paid.paidAt || paid.paymentMethod === 'cash' || paid.paymentOrderId || id.startsWith('bank-')) {
		continue;
	}
	const debit = paid.paymentMethod === 'direct_debit';
	const mine = !!store.comm1.expenses[id];
	// The billing group's already point to the id movementIds gives this one
	const moved = move('comm1', {
		date: toDateString(paid.paidAt),
		amount: -payableAmount(paid),
		concept: debit ? `ADEUDO RECIBO ${paid.concept} ${paid.invoiceNumber ?? ''}` : `TRANSFERENCIA A ${payee(paid)} FRA ${paid.invoiceNumber ?? ''}`,
		commonConcept: debit ? '03' : '04',
		match: { kind: 'expenses', ids: [id], label: `Factura «${paid.concept}»${paid.provider ? ` de ${paid.provider.name}` : ''}` },
	});
	if (moved && mine) {
		Object.assign(paid, { paidAt: on(toDateString(paid.paidAt)), bankMovementId: moved.id, updatedAt: moved.updatedAt });
	}
}
const water = expense('comm1', series.water.at(-1) ?? '');
if (water?.dueDate < now) {
	move('comm1', { date: toDateString(water.dueDate), amount: -water.amount, concept: `ADEUDO RECIBO ${water.concept} ${water.invoiceNumber}`, commonConcept: '03', status: 'pending' });
}

// The executed order, reconciled. The generated one's debit, still to reconcile
if (executed) {
	const moved = move('comm1', { date: executed.executionDate, amount: -executed.total, concept: `ORDEN DE TRANSFERENCIAS ${executed.reference}`, commonConcept: '04', match: { kind: 'paymentOrder', ids: [executed.id], label: `Orden de pago ${executed.reference}` } });
	const reconciledAt = moved?.updatedAt ?? executedAt;
	store.comm1.paymentOrders[executed.id].updatedAt = reconciledAt;
	for (const item of executed.items) {
		expense('comm1', item.expenseId).updatedAt = reconciledAt;
	}
}
if (generated) {
	move('comm1', { date: generated.executionDate, amount: -generated.total, concept: `ORDEN DE TRANSFERENCIAS ${generated.reference}`, commonConcept: '04', status: 'pending' });
}

// The account's monthly fee, set apart as an expense as the bank page offers, but the newest
const feeDays = monthEnds.filter(date => date >= windowStart);
for (const date of feeDays) {
	const latest = date === feeDays.at(-1);
	const moved = move('comm1', { date, amount: -1200, concept: 'COMISION MANTENIMIENTO CUENTA', commonConcept: '17', status: latest ? 'pending' : 'ignored', note: latest ? undefined : 'Comisión del banco' });
	if (moved && !latest) {
		store.comm1.bankMovements[moved.id].expenseId = `bank-${moved.id}`;
		store.comm1.expenses[`bank-${moved.id}`] = { year: on(date).getFullYear(), itemId: '', concept: 'Comisión del banco', amount: 1200, date: on(date), paidAt: on(date), paymentMethod: 'direct_debit', ...audit(moved.updatedAt) };
	}
}

for (const movement of manualMoves) {
	move('comm1', movement);
}
// The Local comercial's company paying the derrama its bank returned: the suggestion is that charge
move('comm1', { date: isoDate(-5), amount: 34500, concept: 'TRANSFERENCIA DE INVERSIONES JAEN SL LOCAL COMERCIAL DERRAMA CUBIERTA 1/2', commonConcept: '04', status: 'pending' });

// The bookings paid at the office, paid in that day, and the fianzas given back by transfer: nothing to match them with
const areaName = Object.fromEntries(commonAreas.comm1.map(area => [area.id, area.name]));
for (const booking of othersOf('comm1', 'bookings').filter(item => item.paidAt && !item.payment)) {
	const what = `RESERVA ${areaName[booking.areaId]} ${booking.date.split('-').reverse().join('/')}`;
	move('comm1', { date: toDateString(booking.paidAt.toDate()), amount: bookingTotal(booking), concept: `INGRESO EN EFECTIVO ${what}`, commonConcept: '02', status: 'ignored', note: 'Reserva cobrada en la oficina, anotada en Reservas' });
	if (booking.depositReturnedAt) {
		move('comm1', { date: toDateString(booking.depositReturnedAt.toDate()), amount: -booking.deposit, concept: `TRANSFERENCIA A ${booking.name} FIANZA ${what}`, commonConcept: '04', status: 'ignored', note: 'Fianza devuelta, anotada en Reservas' });
	}
}

// comm2's CSV: Pablo paying his first unpaid fee late, the water's debit and the bank's fee
const comm2Water = expense('comm2', 'water-month');
const pabloFee = openCharges.comm2.find(item => item.propertyId === 'c2prop5' && item.type === 'fee');
for (const movement of [
	{ date: isoDate(-3), amount: -comm2Water.amount, concept: `Recibo ${comm2Water.concept} ${comm2Water.invoiceNumber}` },
	{ date: isoDate(-2), amount: pabloFee.amount, concept: `Transferencia de ${pabloFee.ownerName}, cuota ${pabloFee.concept.split(' ')[1]} ${pabloFee.propertyName}` },
	{ date: isoDate(-1), amount: -600, concept: 'Comisión de mantenimiento' },
]) {
	move('comm2', { ...movement, status: 'pending' });
}

/* Last year's closing, as the books page makes it: regularization to 129 and the closing entry, which opens this year */

function ledgerOf(communityId, y) {
	return buildLedger({
		year: y,
		charges: othersOf(communityId, 'charges'),
		expenses: [...othersOf(communityId, 'expenses'), ...asList(communityId, 'expenses')],
		bookings: othersOf(communityId, 'bookings'),
		manual: asList(communityId, 'journalEntries').filter(item => item.year === y),
		budget: others[`communities/${communityId}/budgets/${y}`],
		properties: propertiesOf(communityId),
		custom: communityId === 'comm1' ? chart : [],
		previous: store[communityId].fiscalYears[y - 1],
	});
}

const ledger = ledgerOf('comm1', lastYear);
const { result, regularization, closing } = closeYear(ledger.entries, ledger.accounts);
store.comm1.fiscalYears[lastYear] = {
	year: lastYear,
	result,
	regularization,
	closing,
	names: Object.fromEntries([...regularization, ...closing].map(item => [item.account, ledger.accounts.get(item.account)?.name ?? item.account])),
	// Before the ordinary meeting approved those accounts
	...audit(days(-62, '17:30')),
};

// In order, with the balance the statement gives after each: from what the books had in the bank the day before the
// first, so what the bank page leaves reconciled is the books' bancos
for (const communityId of ['comm1', 'comm2']) {
	const list = Object.values(store[communityId].bankMovements).sort((a, b) => a.date.localeCompare(b.date));
	let balance = ledgerOf(communityId, Number(list[0].date.slice(0, 4))).entries.filter(item => item.date < list[0].date).flatMap(item => item.lines).reduce((total, item) => total + (item.account === '5720' ? item.debit - item.credit : 0), 0);
	list.forEach((movement, position) => {
		balance += movement.amount;
		Object.assign(movement, { balance, position });
	});
}

export default {
	id: 'accounting',
	label: 'Gastos, banco y contabilidad',
	hint: 'Facturas de proveedores, órdenes de pago, movimientos del banco conciliados, asientos e ingresos para Hacienda y el cierre del año pasado',
	requires: ['core', 'charges', 'billing', 'bookings'],
	collections: [],
	communityCollections: ['expenses', 'paymentOrders', 'bankMovements', 'journalEntries', 'fiscalYears', 'accounting'],
	seed(set) {
		for (const [communityId, collections] of Object.entries(store)) {
			for (const [collection, docs] of Object.entries(collections)) {
				for (const [id, data] of Object.entries(docs)) {
					set(`communities/${communityId}/${collection}/${id}`, data);
				}
			}
		}
	},
};
