// Presupuestos, recibos, cobros, remesas SEPA y morosidad. comm1 moved to gobernança in the autumn of last year: that
// year's recibos came from its old program (batchId import) and this year's are issued from the budget each quarter,
// the domiciliated ones collected in a remittance. María Núñez had hers returned until the office cancelled her
// domiciliación, and is in a monitorio. comm2 was taken over a month ago: its monthly fees are issued by hand
import { createHash } from 'node:crypto';
import { interestOwed, SUGGESTED_INTEREST_RATE } from '../../../packages/shared/domain/arrears.ts';
import { canonical, payoutDate } from '../../../packages/shared/domain/bank.ts';
import { toDateString } from '../../../packages/shared/domain/booking.ts';
import { IMPORT_BATCH_ID } from '../../../packages/shared/domain/exchange.ts';
import { feeBatchId, INTEREST_BATCH_ID, outstanding, planFees } from '../../../packages/shared/domain/finance.ts';
import { splitByCoefficient } from '../../../packages/shared/domain/property.ts';
import { creditorId, sepaDateTime, sepaId, sepaText } from '../../../packages/shared/domain/sepa.ts';
import { audit, communities, days, isoDate, properties, propertiesOf, uids, year } from './cast.js';

// Quarterly, due on the same day as María's first unpaid one. Garages and storage rooms pay a fixed fee
const plan = { months: 3, firstDue: isoDate(-220), overrides: { prop5: 6000, prop6: 3000, prop11: 6000, prop12: 3000 } };
// comm1's fees are of the year their first quarter falls in, so seeded before mid-August the story is a year back
// instead of two years' fees falling on the same days
const feeYear = Number(plan.firstDue.slice(0, 4));
const lastYear = feeYear - 1;
const office = uids.office;
const card = { brand: 'Visa', last4: '4242' };
// As core sets comm1's (applied 52 days ago). comm2 has none, nor online payments
const lateInterest = { rate: SUGGESTED_INTEREST_RATE, graceDays: 30 };
// comm1's test bank feed, connected 54 days ago (core): what came in since is reconciled. comm2 has no feed
const bankSince = { comm1: isoDate(-54) };
const monthName = new Intl.DateTimeFormat('es', { month: 'long' });

const communityById = Object.fromEntries(communities.map(community => [community.id, community]));
const propertyById = Object.fromEntries(properties.map(property => [property.id, property]));
const store = { comm1: {}, comm2: {} };
for (const docs of Object.values(store)) {
	Object.assign(docs, { budgets: {}, charges: {}, payments: {}, remittances: {}, debtCases: {} });
}

/* Helpers */

// 'YYYY-MM-DD' at that time, as the app dates what's paid on a day (a remittance's collection, a bank movement)
function on(date, time = '12:00') {
	return new Date(`${date}T${time}`);
}

// What toDueDate() keeps: the end of that day
function dueOn(date) {
	return on(date, '23:59:59');
}

// 'YYYY-MM-DD' n days after a date
function dayOf(date, n = 0) {
	return toDateString(new Date(date.getFullYear(), date.getMonth(), date.getDate() + n));
}

function sum(list) {
	return list.reduce((total, item) => total + item.amount, 0);
}

// A charge as Firestore gives it back, for the domain's functions that read Timestamps
function asStored(id, charge) {
	const stamp = date => date && { toMillis: () => date.getTime(), toDate: () => date };
	return { ...charge, id, dueDate: stamp(charge.dueDate), paidAt: stamp(charge.paidAt), collections: charge.collections?.map(item => ({ ...item, date: stamp(item.date) })) };
}

function chargesOf(communityId, propertyId) {
	return Object.entries(store[communityId].charges).filter(([, charge]) => charge.propertyId === propertyId).map(([id, charge]) => asStored(id, charge));
}

// collected 0 too: the dashboard sums amount and collected in one aggregation, which skips docs missing either field
function addCharge(communityId, id, property, fields) {
	store[communityId].charges[id] = { communityId, propertyId: property.id, propertyName: property.name, ownerUid: property.ownerUid, ownerName: property.ownerName, paidAt: null, collected: 0, ...fields };
	return store[communityId].charges[id];
}

// readImport's ids: the row's data hashed, so the same file imported again gives the same charges
function importId(propertyId, dueDate, amount, concept) {
	const key = [propertyId, 'fee', dueDate, amount, canonical(concept)].join('|');
	return `${IMPORT_BATCH_ID}-${propertyId}-${createHash('sha256').update(`${key}|0`).digest('hex').slice(0, 16)}`;
}

/* What reached the community's account */

// For the accounting group's bank movements, oldest first. Those with a movementId are reconciled with their match:
// the charges and online payments paid with them point to it (bankMovementId). The rest are history before the bank
// feed, still to reconcile (a payout), or outgoing without a match (returned debits and their fees)
export const bankFlows = { comm1: [], comm2: [] };

function receive(communityId, slug, { match, ...entry }) {
	const movementId = match && bankSince[communityId] && entry.date >= bankSince[communityId] ? `${entry.date}-${slug}` : undefined;
	bankFlows[communityId].push({ ...(movementId ? { movementId, match } : {}), ...entry, concept: sepaText(entry.concept, 76).toUpperCase() });
	return movementId;
}

/* Ways of paying */

// By transfer, reconciled with the bank movement of that day as the bank page leaves them
function payByTransfer(communityId, chargeId, date) {
	const charge = store[communityId].charges[chargeId];
	const movementId = receive(communityId, chargeId, {
		date,
		amount: charge.amount - (charge.collected ?? 0),
		concept: `TRANSFERENCIA DE ${charge.ownerName} ${charge.propertyName} ${charge.concept}`,
		commonConcept: '04',
		match: { kind: 'charges', ids: [chargeId], label: `«${charge.concept}» de ${charge.propertyName}` },
	});
	Object.assign(charge, { paidAt: on(date), bankMovementId: movementId, updatedAt: on(date), updatedBy: office });
}

// From the app with the test checkout. Reverted: the office marked it unpaid again, the payment stays marked so
function payOnline(communityId, chargeId, paymentId, method, createdAt, revertedAt) {
	const charge = store[communityId].charges[chargeId];
	const withCard = method === 'card' ? { card } : {};
	store[communityId].payments[paymentId] = {
		communityId,
		mode: 'test',
		method,
		amount: charge.amount - (charge.collected ?? 0),
		uid: charge.ownerUid,
		chargeId,
		...withCard,
		createdAt,
		...(revertedAt ? { revertedAt, revertedBy: office } : {}),
	};
	Object.assign(charge, revertedAt
		? { updatedAt: revertedAt, updatedBy: office }
		: { paidAt: createdAt, payment: { id: paymentId, mode: 'test', method, ...withCard }, updatedAt: createdAt, updatedBy: charge.ownerUid });
}

// Entregas a cuenta: [id, cents, date, method, note]. Paid on the latest one when they reach the amount
function collect(communityId, chargeId, entries) {
	const charge = store[communityId].charges[chargeId];
	const collections = entries.map(([id, amount, date, method, note]) => ({ id, amount, date, method, ...(note ? { note } : {}) }));
	const collected = sum(collections);
	const latest = collections.at(-1).date;
	Object.assign(charge, {
		collections,
		collected,
		collectionYears: [...new Set(collections.map(item => item.date.getFullYear()))],
		paidAt: collected >= charge.amount ? latest : null,
		updatedAt: latest,
		updatedBy: office,
	});
	for (const item of collections.filter(item => item.method === 'transfer')) {
		receive(communityId, item.id, { date: toDateString(item.date), amount: item.amount, concept: `TRANSFERENCIA DE ${charge.ownerName} ENTREGA A CUENTA ${charge.concept}`, commonConcept: '04' });
	}
}

/**
 * Remesa of these charges, generated 5 days before they're due (yesterday at the latest), sent the day after and
 * collected on their due date unless it's only generated. returned: by property, the reason and the gastos de
 * devolución charged, registered 3 days after. A mandate's first debit goes FRST, as the remittances page decides
 */
export const firstRemittances = {};

function remit(communityId, id, tag, chargeIds, { returned = {}, generated = false } = {}) {
	const { name, cif, sepaSuffix, iban, bic } = communityById[communityId];
	const charges = store[communityId].charges;
	const due = charges[chargeIds[0]].dueDate;
	const collectionDate = toDateString(due);
	const issued = new Date(Math.min(new Date(due.getFullYear(), due.getMonth(), due.getDate() - 5, 9, 30), days(-1, '09:30')));
	const reference = sepaId(`REM-${toDateString(issued).replaceAll('-', '')}-${tag}`);
	// As the page lists them: all due the same day, by property name
	const byName = [...chargeIds].sort((a, b) => charges[a].propertyName.localeCompare(charges[b].propertyName, 'es', { numeric: true }));
	const items = byName.map((chargeId, index) => {
		const charge = charges[chargeId];
		const mandate = propertyById[charge.propertyId].mandate;
		return {
			chargeId,
			propertyId: charge.propertyId,
			propertyName: charge.propertyName,
			concept: charge.concept,
			amount: outstanding(charge),
			endToEndId: `${reference}-${String(index + 1).padStart(4, '0')}`,
			sequence: firstRemittances[charge.propertyId] ? 'RCUR' : 'FRST',
			mandate: { reference: mandate.reference, debtorName: mandate.debtorName, iban: mandate.iban, ...(mandate.bic ? { bic: mandate.bic } : {}), signedAt: mandate.signedAt },
		};
	});
	for (const item of items) {
		firstRemittances[item.propertyId] ??= id;
	}

	const collectedAt = on(collectionDate);
	let updatedAt = generated ? issued : collectedAt;
	for (const item of items) {
		const charge = charges[item.chargeId];
		Object.assign(charge, { remittanceId: id, updatedAt: generated ? issued : collectedAt, updatedBy: office }, generated ? {} : { paidAt: collectedAt });
		if (!returned[item.propertyId]) {
			continue;
		}
		const [reason, fee] = returned[item.propertyId];
		const date = dayOf(due, 3);
		const feeChargeId = `return-${id}-${item.propertyId}`;
		updatedAt = on(date, '10:00');
		item.returned = { reason, date, ...(fee ? { feeChargeId } : {}) };
		delete charge.remittanceId;
		Object.assign(charge, { paidAt: null, returns: [{ remittanceId: id, reason, date, amount: item.amount }], updatedAt });
		receive(communityId, `${item.endToEndId}-return`, { date, amount: -item.amount, concept: `DEVOLUCION ADEUDO SEPA ${item.endToEndId} ${reason}`, commonConcept: '06' });
		if (fee) {
			addCharge(communityId, feeChargeId, propertyById[item.propertyId], { type: 'fee', concept: `Gastos de devolución · ${item.concept}`, amount: fee, dueDate: dueOn(date), batchId: `return-${id}`, ...audit(updatedAt) });
			receive(communityId, `${item.endToEndId}-fee`, { date, amount: -fee, concept: 'COMISION DEVOLUCION ADEUDO SEPA', commonConcept: '17' });
		}
	}

	if (!generated) {
		receive(communityId, id, { date: collectionDate, amount: sum(items), concept: `ABONO REMESA ADEUDOS SEPA ${reference}`, commonConcept: '06', match: { kind: 'remittance', ids: [id], label: `Remesa ${reference}` } });
	}
	store[communityId].remittances[id] = {
		reference,
		collectionDate,
		issuedAt: sepaDateTime(issued),
		status: generated ? 'generated' : 'collected',
		creditor: { name, id: creditorId(cif, sepaSuffix), iban, ...(bic ? { bic } : {}) },
		items,
		total: sum(items),
		...(generated ? {} : { sentAt: new Date(issued.getFullYear(), issued.getMonth(), issued.getDate() + 1, 10, 15), collectedAt }),
		createdAt: issued,
		createdBy: office,
		updatedAt,
		updatedBy: office,
	};
}

/* Budgets: partidas with stable ids, the accounting group charges the invoices to them */

const partidas = {
	comm1: [
		['cleaning', 'Limpieza', 300000],
		['elevator', 'Mantenimiento del ascensor', 132000],
		['insurance', 'Seguro multirriesgo', 110000],
		['electricity', 'Electricidad de zonas comunes', 150000],
		['water', 'Agua', 60000],
		['gardening', 'Jardín y piscina', 150000],
		['maintenance', 'Reparaciones y mantenimiento', 100000],
		['legal', 'Asesoría jurídica', 36000],
		// The office's 150 € a month plus VAT
		['administration', 'Honorarios de administración', 217800],
	],
	comm2: [
		['cleaning', 'Limpieza', 180000],
		['elevator', 'Mantenimiento del ascensor', 120000],
		['insurance', 'Seguro multirriesgo', 84000],
		['electricity', 'Electricidad de zonas comunes', 90000],
		['water', 'Agua', 36000],
		['maintenance', 'Reparaciones y mantenimiento', 60000],
		// 120 € a month plus VAT
		['administration', 'Honorarios de administración', 174240],
	],
};

// Last year's were a bit lower, in whole euros
function items(list, factor = 1) {
	return list.map(([id, name, amount]) => ({ id, name, amount: factor === 1 ? amount : Math.round(amount * factor / 100) * 100 }));
}

export const budgetItems = {
	comm1: { [feeYear]: items(partidas.comm1), [lastYear]: items(partidas.comm1, 0.96) },
	comm2: { [year]: items(partidas.comm2) },
};

const reserves = { comm1: { [feeYear]: 130000, [lastYear]: 125000 }, comm2: { [year]: 75000 } };

// [community, year, fondo de reserva on 1 January, how its fees were issued, created and updated n days ago]. Last
// year's opening plus its contribution is this year's. comm1's last year and comm2's fees weren't issued from the budget
for (const [communityId, budgetYear, reserveOpening, fees, created, updated] of [
	['comm1', feeYear, 605000, plan, -250, -236],
	['comm1', lastYear, 480000, undefined, -398, -398],
	['comm2', year, 210000, undefined, -38, -38],
]) {
	store[communityId].budgets[budgetYear] = {
		year: budgetYear,
		items: budgetItems[communityId][budgetYear],
		reserve: reserves[communityId][budgetYear],
		reserveOpening,
		fees,
		...audit(created),
		updatedAt: days(updated),
	};
}

/* comm1 */

// In id order, as the fees page reads the census: the homes' equal coefficients leave the extra cents to the first ones
const comm1 = propertiesOf('comm1').sort((a, b) => a.id < b.id ? -1 : 1);
const domiciliated = comm1.filter(property => property.mandate?.status === 'active').map(property => property.id);

// Last year, imported from the old program when moving: the first three quarters paid, the fourth issued (and later
// domiciliated here) but owed by Andrés Molina and Francisco López
const lastQ4 = {};
planFees(lastYear, sum(budgetItems.comm1[lastYear]), reserves.comm1[lastYear], comm1, { ...plan, firstDue: `${lastYear}${plan.firstDue.slice(4)}` }).forEach((period, index) => {
	for (const { property, cents } of period.shares) {
		const concept = `Cuota ${index + 1}T ${lastYear}`;
		const due = toDateString(period.dueDate);
		const id = importId(property.id, due, cents, concept);
		addCharge('comm1', id, property, {
			type: 'fee',
			concept,
			amount: cents,
			dueDate: dueOn(due),
			paidAt: index < 3 ? on(dayOf(period.dueDate, property.mandate ? 0 : 3)) : null,
			batchId: IMPORT_BATCH_ID,
			...audit(days(-398, '17:00')),
		});
		if (index === 3) {
			lastQ4[property.id] = id;
		}
	}
});

// This year's from the budget, issued at once
const quarters = planFees(feeYear, sum(budgetItems.comm1[feeYear]), reserves.comm1[feeYear], comm1, plan);
for (const period of quarters) {
	for (const share of period.shares) {
		addCharge('comm1', share.id, share.property, { type: 'fee', concept: period.concept, amount: share.cents, dueDate: period.dueDate, batchId: feeBatchId(feeYear), reserve: share.reserve, ...audit(days(-236)) });
	}
}

function feeId(quarter, propertyId) {
	return `${feeBatchId(feeYear)}-${plan.months}m-${quarter}-${propertyId}`;
}

// The derrama the ordinary meeting approved, by coefficient in two instalments: one past due, one to come
const levies = [[1, -15], [2, 45]].map(([n, due]) => ({ batchId: `levy-roof-${n}`, concept: `Derrama impermeabilización de la cubierta ${n}/2`, dueDate: dueOn(isoDate(due)) }));
for (const { batchId, concept, dueDate } of levies) {
	for (const { property, cents } of splitByCoefficient(300000, comm1)) {
		addCharge('comm1', `${batchId}-${property.id}`, property, { type: 'levy', concept, amount: cents, dueDate, batchId, ...audit(days(-40, '10:30')) });
	}
}

// Francisco paid last year's last quarter in two entregas, Andrés only part of it
collect('comm1', lastQ4.prop10, [
	['col-prop10-1', 20000, days(-270, '11:00'), 'cash', 'En la oficina'],
	['col-prop10-2', store.comm1.charges[lastQ4.prop10].amount - 20000, days(-240, '12:00'), 'transfer'],
]);
collect('comm1', lastQ4.prop8, [['col-prop8-1', 15000, days(-60, '12:30'), 'cash', 'En la oficina, a cuenta de la cuota del año pasado']]);

// Every quarter domiciliated, María's returned at her request until her mandate was cancelled (33 days ago). The
// derrama's: the company's account hadn't enough, and the bank's fee was charged to it
const withMaria = [...domiciliated, 'prop4'];
remit('comm1', 'rem_last_q4', `4T${String(lastYear).slice(2)}`, withMaria.map(id => lastQ4[id]));
for (const quarter of [1, 2, 3]) {
	remit('comm1', `rem_q${quarter}`, `${quarter}T${String(feeYear).slice(2)}`, withMaria.map(id => feeId(quarter, id)), { returned: { prop4: ['MD06'] } });
}
remit('comm1', 'rem_levy1', 'DERRAMA1', domiciliated.map(id => `levy-roof-1-${id}`), { returned: { prop7: ['AM04', 450] } });

// The rest: t transfer, c card or b Bizum from the app (on since 55 days ago), x by card and reverted by the office the
// next morning (before the gateway paid it in), - not yet. Q1 to Q4 and the derrama's first instalment. María only pays her garage, the junta liquidated Piso 2B's debt
const slots = [...[1, 2, 3, 4].map(quarter => [`q${quarter}`, id => feeId(quarter, id)]), ['levy1', id => `levy-roof-1-${id}`]];
const paidBy = { prop6: 'ttc-x', prop8: 'ttt-t', prop10: 'ttt-t', prop11: 'ttt-t', prop12: 'ttbcb' };
const onlineAt = { [uids.javier]: '21:14', [uids.carmen]: '09:05' };
for (const id of ['prop6', 'prop11', 'prop12']) {
	payByTransfer('comm1', lastQ4[id], dayOf(store.comm1.charges[lastQ4[id]].dueDate, 2));
}
for (const [propertyId, ways] of Object.entries(paidBy)) {
	[...ways].forEach((way, index) => {
		const [slot, idOf] = slots[index];
		const chargeId = idOf(propertyId);
		const charge = store.comm1.charges[chargeId];
		// The day before it's due, or 3 days ago for one not due yet
		const day = [dayOf(charge.dueDate, way === 't' ? -2 : -1), isoDate(-3)].sort()[0];
		if (way === 't') {
			payByTransfer('comm1', chargeId, day);
		} else if (way !== '-') {
			const createdAt = on(day, onlineAt[charge.ownerUid]);
			payOnline('comm1', chargeId, `pay_charge_${propertyId}_${slot}`, way === 'b' ? 'bizum' : 'card', createdAt, way === 'x' ? on(dayOf(createdAt, 1), '10:30') : undefined);
		}
	});
}

// The test gateway pays each day's payments in two days later. Those of more than a week ago are reconciled
for (const [day, group] of Map.groupBy(Object.entries(store.comm1.payments).filter(([, payment]) => !payment.revertedAt), ([, payment]) => toDateString(payment.createdAt))) {
	const date = payoutDate(day);
	const reference = `PASARELA${date.slice(2).replaceAll('-', '')}`;
	const ids = group.map(([id]) => id);
	const movementId = receive('comm1', 'pasarela', {
		date,
		amount: sum(group.map(([, payment]) => payment)),
		concept: `ABONO PASARELA DE PAGO ${reference}`,
		commonConcept: '12',
		reference,
		match: date <= isoDate(-7) ? { kind: 'payout', ids, label: `Abono de la pasarela: ${ids.length} ${ids.length === 1 ? 'pago online' : 'pagos online'} del ${day.split('-').reverse().join('/')}` } : undefined,
	});
	for (const [, payment] of group) {
		payment.bankMovementId = movementId;
	}
}

// Recibo de intereses de demora of Andrés's old debt, issued 20 days ago with 15 days to pay it
const interestTo = isoDate(-20);
const interest = interestOwed(chargesOf('comm1', 'prop8'), lateInterest, on(interestTo));
addCharge('comm1', 'interest-prop8', propertyById.prop8, {
	type: 'fee',
	concept: `Intereses de demora hasta el ${interestTo.split('-').reverse().join('/')}`,
	amount: interest.total,
	dueDate: dueOn(isoDate(-5)),
	batchId: INTEREST_BATCH_ID,
	interest: { chargeIds: interest.items.map(item => item.charge.id), to: interestTo },
	...audit(on(interestTo, '11:00')),
});

// What a claim letter of that day asked for: the charges issued and overdue then, plus their interest once core applied it
const interestSince = isoDate(-52);
function claimedAt(propertyId, date) {
	const at = on(date);
	const then = chargesOf('comm1', propertyId)
		.filter(charge => charge.createdAt < at)
		.map(charge => charge.paidAt?.toMillis() >= at.getTime() ? { ...charge, paidAt: null } : charge);
	const owed = then.filter(charge => charge.dueDate.toMillis() < at.getTime()).reduce((total, charge) => total + outstanding(charge, at), 0);
	return owed + (date >= interestSince ? interestOwed(then, lateInterest, at).total : 0);
}

// The monitorio against María: the debt the ordinary meeting (45 days ago) liquidated, with its interest until then
const meetingDate = isoDate(-45);
const liquidated = chargesOf('comm1', 'prop4').filter(charge => !charge.paidAt && charge.dueDate.toMillis() < dueOn(meetingDate).getTime());
const monitorio = {
	meetingId: 'meeting_ordinary',
	meetingDate,
	amount: liquidated.reduce((total, charge) => total + outstanding(charge), 0) + interestOwed(chargesOf('comm1', 'prop4'), lateInterest, on(meetingDate)).total,
	secretary: 'Rosa Delgado',
	president: 'Carmen Ruiz',
	// With the acta, sent to every owner once signed (meetings group)
	notifiedAt: isoDate(-25),
	notification: 'address',
	preparedAt: isoDate(-10),
};

// [property, status, claims as [n days ago, level, channel, burofax tracking], updated n days ago, monitorio]
for (const [propertyId, status, claims, updated, prepared] of [
	['prop4', 'monitorio', [[-100, 'reminder', 'letter'], [-30, 'second', 'burofax', 'PRUEBA-BF000123456']], -10, monitorio],
	['prop8', 'claimed', [[-90, 'reminder', 'email'], [-25, 'second', 'letter']], -25],
	// Closed the morning after his last entrega came in
	['prop10', 'paid', [[-290, 'reminder', 'letter']], -239],
]) {
	store.comm1.debtCases[propertyId] = {
		propertyId,
		propertyName: propertyById[propertyId].name,
		status,
		claims: claims.map(([n, level, channel, tracking]) => ({ date: isoDate(n), level, channel, amount: claimedAt(propertyId, isoDate(n)), ...(tracking ? { tracking } : {}) })),
		monitorio: prepared,
		...audit(days(claims[0][0], '11:10')),
		updatedAt: days(updated, '11:10'),
	};
}

export const debtCases = store.comm1.debtCases;

/* comm2: monthly fees by hand since the takeover, Tomás and Elena domiciliated, Pablo owes his first month's */

const comm2 = propertiesOf('comm2');
const firstMonth = dueOn(isoDate(-24));
// The same day of the next month, or its last one
const nextMonth = new Date(firstMonth.getFullYear(), firstMonth.getMonth() + 1, Math.min(firstMonth.getDate(), new Date(firstMonth.getFullYear(), firstMonth.getMonth() + 2, 0).getDate()), 23, 59, 59);
const monthly = Math.round((sum(budgetItems.comm2[year]) + reserves.comm2[year]) / 12);
[firstMonth, nextMonth].forEach((dueDate, index) => {
	const batchId = `fee-${toDateString(dueDate)}`;
	for (const { property, cents } of splitByCoefficient(monthly, comm2)) {
		addCharge('comm2', `${batchId}-${property.id}`, property, { type: 'fee', concept: `Cuota ${monthName.format(dueDate)} ${dueDate.getFullYear()}`, amount: cents, dueDate, batchId, ...audit(index ? -5 : -33) });
	}
	const ids = ['c2prop3', 'c2prop4'].map(id => `${batchId}-${id}`);
	remit('comm2', `rem_month${index + 1}`, `M${index + 1}`, ids, { generated: index === 1 });
	if (!index) {
		for (const id of ['c2prop1', 'c2prop2', 'c2prop6']) {
			payByTransfer('comm2', `${batchId}-${id}`, dayOf(dueDate, -2));
		}
	}
});

// The azotea's derrama the ordinary meeting approved, by coefficient in two recibos, neither due yet. The acta gives no
// total: 1.200 € each
for (const [n, due] of [[1, 25], [2, 85]]) {
	const batchId = `levy-azotea-${n}`;
	for (const { property, cents } of splitByCoefficient(120000, comm2)) {
		addCharge('comm2', `${batchId}-${property.id}`, property, { type: 'levy', concept: `Derrama impermeabilización de la azotea ${n}/2`, amount: cents, dueDate: dueOn(isoDate(due)), batchId, ...audit(-14) });
	}
}

for (const flows of Object.values(bankFlows)) {
	flows.sort((a, b) => a.date.localeCompare(b.date));
}

// Unpaid and not in a remittance: what a pending bank movement could pay (e.g. Javier's derrama, whose online payment was reverted)
export const openCharges = Object.fromEntries(Object.entries(store).map(([communityId, docs]) => [communityId, Object.entries(docs.charges)
	.filter(([, charge]) => !charge.paidAt && !charge.remittanceId)
	.map(([id, charge]) => ({ id, type: charge.type, propertyId: charge.propertyId, propertyName: charge.propertyName, ownerName: charge.ownerName, concept: charge.concept, amount: outstanding(charge), dueDate: toDateString(charge.dueDate) }))]));

export default {
	id: 'charges',
	label: 'Presupuestos, recibos y cobros',
	hint: 'Presupuestos, cuotas, derrama, pagos online, entregas a cuenta, remesas SEPA y la morosidad con su monitorio',
	requires: ['core'],
	collections: [],
	communityCollections: ['budgets', 'charges', 'payments', 'debtCases', 'remittances'],
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
