import type { Datable } from './audit.ts';
import type { LateInterest } from './community.ts';
import type { Charge } from './finance.ts';
import { INTEREST_BATCH_ID, isOverdue, outstanding } from './finance.ts';

const DAY_MS = 86_400_000;

// Antigüedad de la deuda, by the days since each charge fell due
export const agingBuckets = [
	{ label: '0–30 días', maxDays: 30 },
	{ label: '31–90 días', maxDays: 90 },
	{ label: '91–180 días', maxDays: 180 },
	{ label: 'Más de 180 días', maxDays: Infinity },
] as const;

export function daysOverdue(charge: Pick<Charge, 'dueDate'>, now = new Date()) {
	return Math.max(0, Math.floor((now.getTime() - charge.dueDate.toMillis()) / DAY_MS));
}

// The overdue debt in each bucket, in cents, without what was collected on account
export function agingOf(charges: Pick<Charge, 'amount' | 'dueDate' | 'paidAt' | 'collections'>[], now = new Date()) {
	const buckets = agingBuckets.map(() => 0);
	let count = 0;
	for (const charge of charges) {
		if (isOverdue(charge, now)) {
			const days = daysOverdue(charge, now);
			buckets[agingBuckets.findIndex(bucket => days <= bucket.maxDays)] += outstanding(charge);
			count++;
		}
	}
	return { buckets, total: buckets.reduce((sum, cents) => sum + cents, 0), count };
}

// Only a starting value, never the law: the interés legal del dinero is set each year by the Ley de Presupuestos
export const SUGGESTED_INTEREST_RATE = 325;

const rateFormat = new Intl.NumberFormat('es', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });

// e.g. "3,25 %" from 325
export function formatRate(rate: number) {
	return rateFormat.format(rate / 10_000);
}

// Calendar days, so a change of time doesn't move them
function dayNumber(date: Date) {
	return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
}

/**
 * Interés de demora of an unpaid charge, simple and on what was owed each day: from the end of the grace (or the day its
 * last recibo de intereses counted until, 'YYYY-MM-DD') to `to`, each collection on account stopping what it paid from
 * accruing. A 365 day year, rounded to the cent. from is the first day counted, 'YYYY-MM-DD'
 */
export function chargeInterest(charge: Pick<Charge, 'amount' | 'dueDate' | 'collections'>, { rate, graceDays }: LateInterest, to: Date, invoicedTo?: string) {
	const start = Math.max(dayNumber(charge.dueDate.toDate()) + graceDays, invoicedTo ? dayNumber(new Date(`${invoicedTo}T00:00`)) : 0);
	const end = dayNumber(to);
	const from = new Date(start * DAY_MS).toISOString().slice(0, 10);
	if (end <= start) {
		return { from, days: 0, amount: 0 };
	}
	let owed = charge.amount;
	let last = start;
	let centDays = 0;
	for (const collection of [...charge.collections ?? []].sort((a, b) => a.date.toMillis() - b.date.toMillis())) {
		const day = Math.min(Math.max(dayNumber(collection.date.toDate()), start), end);
		centDays += owed * (day - last);
		last = day;
		owed -= collection.amount;
	}
	centDays += owed * (end - last);
	return { from, days: end - start, amount: Math.max(Math.round(centDays * rate / (10_000 * 365)), 0) };
}

/**
 * The interest each charge overdue at `to` owes until then. Recibos de intereses (all of them, paid or not, must be among
 * the charges) say until when each charge was charged already, so it's never charged twice; they accrue none themselves
 */
export function interestOwed(charges: Charge[], settings: LateInterest, to = new Date()) {
	const invoiced = new Map<string, string>();
	for (const { interest } of charges) {
		for (const id of interest?.chargeIds ?? []) {
			if (interest!.to > (invoiced.get(id) ?? '')) {
				invoiced.set(id, interest!.to);
			}
		}
	}
	const items = charges.filter(charge => charge.batchId !== INTEREST_BATCH_ID && isOverdue(charge, to))
		.map(charge => ({ charge, ...chargeInterest(charge, settings, to, invoiced.get(charge.id)) }))
		.filter(item => item.amount > 0)
		.sort((a, b) => a.charge.dueDate.toMillis() - b.charge.dueDate.toMillis());
	return { items, total: items.reduce((sum, item) => sum + item.amount, 0) };
}

// Reclamación of a property's debt, at communities/{communityId}/debtCases/{propertyId}: every claim sent and, once
// the junta has approved the liquidation of the debt, what the monitorio (LPH art. 21) needs. Only the office
export interface DebtCase extends Datable {
	id: string;
	propertyId: string;
	propertyName: string;
	status: DebtCaseStatus;
	// The last one last
	claims: Claim[];
	monitorio?: Monitorio;
}

export type DebtCaseStatus = 'claimed' | 'monitorio' | 'paid' | 'uncollectible';
export const debtCaseStatus: Record<DebtCaseStatus, string> = {
	claimed: 'Reclamado',
	monitorio: 'Monitorio preparado',
	paid: 'Pagado',
	uncollectible: 'Incobrable',
};

export interface Claim {
	// 'YYYY-MM-DD'
	date: string;
	level: ClaimLevel;
	channel: ClaimChannel;
	// What was claimed, in cents
	amount: number;
	// Burofax only, the certified send's reference
	tracking?: string;
}

export type ClaimLevel = 'reminder' | 'second' | 'formal';
// days: the term given to pay
export const claimLevels: Record<ClaimLevel, { label: string; title: string; days: number }> = {
	reminder: { label: 'Recordatorio amistoso', title: 'Recordatorio de pago', days: 15 },
	second: { label: 'Segundo aviso', title: 'Segundo aviso de pago', days: 10 },
	formal: { label: 'Requerimiento formal', title: 'Requerimiento previo de pago', days: 10 },
};

export type ClaimChannel = 'letter' | 'email' | 'burofax';
export const claimChannels: Record<ClaimChannel, string> = {
	letter: 'Carta',
	email: 'Email',
	burofax: 'Burofax',
};

// The level after the last one sent, the formal one stays
export function nextClaimLevel(claims: Claim[] = []): ClaimLevel {
	const levels = Object.keys(claimLevels) as ClaimLevel[];
	const last = claims.at(-1)?.level;
	return last ? levels[Math.min(levels.indexOf(last) + 1, levels.length - 1)] : 'reminder';
}

// A made-up reference for the test mode's burofax, which sends nothing
export function demoBurofaxTracking() {
	return `PRUEBA-BF${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
}

export interface Monitorio {
	// The junta that approved the liquidation of the debt, when it's one of the app's. Its date either way
	meetingId?: string;
	// 'YYYY-MM-DD'
	meetingDate: string;
	// The debt liquidated, owed by the junta's date
	amount: number;
	secretary: string;
	president: string;
	// When and how the agreement was notified to the debtor (LPH art. 9.1.h), '' until it is
	notifiedAt: string;
	notification: NotificationMethod;
	// 'YYYY-MM-DD'
	preparedAt: string;
}

// LPH art. 9.1.h: at the address given to the community, else at the property, else on the notice board for 3 days
export type NotificationMethod = 'address' | 'property' | 'board';
export const notificationMethods: Record<NotificationMethod, string> = {
	address: 'En el domicilio designado a la comunidad',
	property: 'En la propia propiedad',
	board: 'En el tablón de anuncios durante 3 días naturales',
};
