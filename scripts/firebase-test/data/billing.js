import { createHash } from 'node:crypto';
import { ibanAccount, movementIds } from '../../../packages/shared/domain/bank.ts';
import { counterKey, expenseIdOf, feeInvoiceAmounts, invoiceNumber, invoiceTypes, monthLabel, monthlyInvoiceId } from '../../../packages/shared/domain/billing.ts';
import { toDateString } from '../../../packages/shared/domain/booking.ts';
import { normalizeTaxId } from '../../../packages/shared/domain/fiscal.ts';
import { sepaText } from '../../../packages/shared/domain/sepa.ts';
import { altaRecord, anulacionRecord, generationTime, VERIFACTU_MODE } from '../../../packages/shared/domain/verifactu.ts';
import { audit, communities, days, isoDate, now, office, uids } from './cast.js';

// Fincas Jaén is a company: 21 % VAT and no IRPF withheld
const VAT_RATE = 21;
const WITHHOLDING_RATE = 0;
const SERIES = 'A';
const RECT_SERIES = 'R';
// The fees remembered by the monthly run, as the charges group's budgets have them: 150 € and 120 € plus VAT
const monthlyFees = { comm1: 15000, comm2: 12000 };
// The office as a provider in its communities' books, made when comm1 moved to type its old fee invoices (accounting
// group) and taken by recordInBooks since
const PROVIDER_ID = 'prov_office';
const providerSince = days(-398, '17:00');
// The administration partida of the communities' budgets (charges group), where the fee expenses are filed
const ITEM_ID = 'administration';
const CSV_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const issuer = { nif: office.nif, name: office.name, address: office.address, iban: office.iban };
const recipients = Object.fromEntries(communities.map(community => [community.id, {
	nif: normalizeTaxId(community.cif),
	name: `Comunidad de propietarios ${community.name}`,
	address: community.address,
}]));

function at(monthsAgo, day, time) {
	const [hours, minutes] = time.split(':').map(Number);
	return new Date(now.getFullYear(), now.getMonth() - monthsAgo, day, hours, minutes);
}

function later(date, dayCount, time = '10:00') {
	const [hours, minutes] = time.split(':').map(Number);
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + dayCount, hours, minutes);
}

/*
 * The invoice events in the order they happened, so the numbers and the chain come out as useBilling makes them:
 * the monthly run on the 1st of each of the last six months of this year (this month's is still to run; last year's
 * were invoiced by hand, in the accounting group), comm2 from its takeover 40 days ago, billed alone the day its budget
 * was made with comm1's fee typed by mistake and rectified by differences, and the garage leak's claim handling invoiced
 * to comm2 by mistake, annulled and issued again to comm1. paid: when the community paid it, books: recorded there
 */
const takeover = days(-38, '12:00');
const events = [];
for (let monthsAgo = Math.min(6, now.getMonth()); monthsAgo >= 1; monthsAgo--) {
	const date = at(monthsAgo, 1, '09:30');
	const period = toDateString(date).slice(0, 7);
	for (const [index, communityId] of (date > takeover ? ['comm1', 'comm2'] : ['comm1']).entries()) {
		events.push({
			kind: 'alta',
			at: new Date(date.getTime() + index * 2000),
			draft: { id: monthlyInvoiceId(period, communityId), type: 'F1', communityId, period, lines: [{ concept: `Honorarios de administración, ${monthLabel(period)}`, base: monthlyFees[communityId] }] },
			books: true,
			paid: monthsAgo >= 2 ? later(date, 10) : undefined,
		});
	}
}
const takeoverPeriod = toDateString(takeover).slice(0, 7);
// Both in one transfer, the rectificativa netted
const takeoverPaid = later(takeover, 10);
events.push(
	{
		kind: 'alta',
		at: takeover,
		draft: { id: monthlyInvoiceId(takeoverPeriod, 'comm2'), type: 'F1', communityId: 'comm2', period: takeoverPeriod, lines: [{ concept: `Honorarios de administración, ${monthLabel(takeoverPeriod)}`, base: monthlyFees.comm1 }] },
		books: true,
		paid: takeoverPaid,
	},
	{
		kind: 'alta',
		at: days(-35, '10:15'),
		draft: {
			id: 'rect_fee_comm2',
			type: 'R1',
			communityId: 'comm2',
			lines: [{ concept: `Honorarios de administración, ${monthLabel(takeoverPeriod)} (cuota corregida a 120,00 €)`, base: monthlyFees.comm2 - monthlyFees.comm1 }],
			rectifies: monthlyInvoiceId(takeoverPeriod, 'comm2'),
		},
		books: true,
		paid: takeoverPaid,
	},
);
const claim = { concept: 'Tramitación con la aseguradora del siniestro por la fuga de agua del garaje', base: 8000 };
events.push(
	// Once the insurer paid the indemnity (accounting group)
	{ kind: 'alta', at: days(-4, '13:00'), draft: { id: 'claim_fee_comm2', type: 'F1', communityId: 'comm2', lines: [claim] } },
	{ kind: 'anulacion', at: days(-4, '13:25'), invoiceId: 'claim_fee_comm2' },
	// Not in comm1's books yet, to record it from the invoice
	{ kind: 'alta', at: days(-4, '13:30'), draft: { id: 'claim_fee_comm1', type: 'F1', communityId: 'comm1', lines: [claim] } },
);
events.sort((a, b) => a.at - b.at);

// What AEAT would answer, made up as the app does but the same on every run
function submission(id, date) {
	const csv = Array.from(createHash('sha256').update(id).digest().subarray(0, 16), byte => CSV_CHARS[byte % CSV_CHARS.length]).join('');
	return { mode: VERIFACTU_MODE, status: 'accepted', csv, at: generationTime(new Date(date.getTime() + 3000)) };
}

// The office's counters and chain as issueInvoices and annulInvoice leave them, event after event
const invoices = new Map();
const records = [];
const counters = {};
const lastDates = {};
let chain = null;
for (const event of events) {
	const seq = records.length + 1;
	const data = { seq, previous: chain, generatedAt: generationTime(event.at) };
	if (event.kind === 'alta') {
		const { draft } = event;
		const date = toDateString(event.at);
		const year = event.at.getFullYear();
		const series = draft.type === 'R1' ? RECT_SERIES : SERIES;
		const key = counterKey(series, year);
		counters[key] = (counters[key] ?? 0) + 1;
		lastDates[key] = date;
		const original = draft.rectifies && invoices.get(draft.rectifies).invoice;
		const invoice = {
			id: draft.id,
			number: invoiceNumber(series, year, counters[key]),
			series,
			year,
			date,
			type: draft.type,
			issuer,
			communityId: draft.communityId,
			recipient: recipients[draft.communityId],
			lines: draft.lines,
			vatRate: VAT_RATE,
			withholdingRate: WITHHOLDING_RATE,
			...feeInvoiceAmounts(draft.lines, VAT_RATE, WITHHOLDING_RATE),
			period: draft.period,
			rectifies: original && { id: original.id, number: original.number, date: original.date },
		};
		const record = await altaRecord(invoice, { ...data, submission: submission(`${draft.id}-alta`, event.at) }, uids.office);
		invoices.set(draft.id, { invoice: { ...invoice, huella: record.huella }, event, updatedAt: event.at });
		if (original) {
			const entry = invoices.get(original.id);
			entry.invoice.rectifiedBy = [invoice.number];
			entry.updatedAt = event.at;
		}
		records.push({ id: `${draft.id}-alta`, at: event.at, record });
	} else {
		const entry = invoices.get(event.invoiceId);
		const record = await anulacionRecord(entry.invoice, { ...data, submission: submission(`${event.invoiceId}-anulacion`, event.at) }, uids.office);
		entry.invoice.annulled = true;
		entry.updatedAt = event.at;
		records.push({ id: `${event.invoiceId}-anulacion`, at: event.at, record });
	}
	const { record } = records.at(-1);
	chain = { nif: record.issuer.nif, number: record.number, date: record.date, huella: record.huella };
}

// comm1's transfers in the statement the accounting group imports (its last 90 days) are reconciled there, so they
// point to their movement as matchMovement leaves them. Same id as accounting's, which makes it from this concept
const statementStart = isoDate(-90);
const comm1Account = ibanAccount(communities.find(community => community.id === 'comm1').iban);
async function bankMovementOf(invoice, paidAt) {
	const date = paidAt && toDateString(paidAt);
	if (invoice.communityId !== 'comm1' || !date || date < statementStart) {
		return undefined;
	}
	const [id] = await movementIds([{ account: comm1Account, date, amount: -invoice.payable, concept: sepaText(`TRANSFERENCIA A ${office.name} FRA ${invoice.number}`, 76).toUpperCase() }]);
	return id;
}

// Reconciled when accounting stamps the movement: the Norma 43 statement imported 54 days ago 25 minutes after it came
// in, the feed's the morning after it was paid
const feedStart = isoDate(-54);
function reconciledAt(paidAt) {
	if (toDateString(paidAt) < feedStart) {
		return days(-54, '11:30');
	}
	return new Date(Math.min(later(paidAt, 1, '08:55'), days(-1, '08:55')));
}

// Recorded in the community's books the same afternoon, as an unpaid supplier invoice until paid
const expenses = [];
for (const entry of invoices.values()) {
	if (!entry.event.books) {
		continue;
	}
	const { invoice, event } = entry;
	const recordedAt = later(event.at, 0, '17:00');
	const bankMovementId = await bankMovementOf(invoice, event.paid);
	// Reconciled ones are paid on the movement's day, at noon as the bank page dates them
	const paidAt = bankMovementId ? later(event.paid, 0, '12:00') : event.paid ?? null;
	const [y, m, d] = invoice.date.split('-').map(Number);
	invoice.expenseId = expenseIdOf(invoice.id);
	entry.updatedAt = recordedAt > entry.updatedAt ? recordedAt : entry.updatedAt;
	expenses.push([`communities/${invoice.communityId}/expenses/${invoice.expenseId}`, {
		year: invoice.year,
		itemId: ITEM_ID,
		concept: `${invoiceTypes[invoice.type]} de honorarios ${invoice.number}`,
		amount: invoice.total,
		date: new Date(y, m - 1, d, 12, 0),
		provider: { id: PROVIDER_ID, name: office.name, nif: invoice.issuer.nif },
		invoiceNumber: invoice.number,
		base: invoice.base,
		vatRate: invoice.vatRate,
		vat: invoice.vat,
		withholdingRate: invoice.withholdingRate,
		withholding: invoice.withholding,
		withholdingType: invoice.withholdingRate ? 'professional' : undefined,
		paidAt,
		bankMovementId,
		...audit(recordedAt),
		updatedAt: bankMovementId ? reconciledAt(event.paid) : paidAt ?? recordedAt,
	}]);
}
// comm2 added and touched again by each recording
const lastRecorded = expenses.at(-1)[1].createdAt;

export default {
	id: 'billing',
	label: 'Despacho: honorarios y Verifactu',
	hint: 'Datos fiscales del despacho, seis meses de facturas a sus comunidades con su registro Verifactu y su gasto en las cuentas',
	requires: ['core', 'charges', 'accounting'],
	collections: ['offices'],
	communityCollections: [],
	seed(set) {
		const last = records.at(-1).at;
		set(`offices/${uids.office}`, {
			nif: office.nif,
			name: office.name,
			address: office.address,
			email: office.email,
			iban: office.iban,
			vatRate: VAT_RATE,
			withholdingRate: WITHHOLDING_RATE,
			series: SERIES,
			rectSeries: RECT_SERIES,
			monthlyFees,
			counters,
			lastDates,
			chain,
			recordCount: records.length,
			providerId: PROVIDER_ID,
			...audit(at(7, 1, '10:00')),
			updatedAt: last,
		});

		for (const { invoice, event, updatedAt } of invoices.values()) {
			const { id, ...data } = invoice;
			set(`offices/${uids.office}/invoices/${id}`, { ...data, ...audit(event.at), updatedAt });
		}
		for (const { id, at: createdAt, record } of records) {
			set(`offices/${uids.office}/verifactu/${id}`, { ...record, createdAt, createdBy: uids.office });
		}

		set(`providers/${PROVIDER_ID}`, {
			name: office.name,
			category: 'other',
			phone: '',
			email: office.email,
			cif: office.nif,
			fiscalName: office.name,
			address: office.address,
			iban: office.iban,
			notes: 'Administración de fincas',
			communityIds: ['comm1', 'comm2'],
			ratingSum: 0,
			ratingCount: 0,
			...audit(providerSince),
			updatedAt: lastRecorded,
		});
		for (const [path, data] of expenses) {
			set(path, data);
		}
	},
};
