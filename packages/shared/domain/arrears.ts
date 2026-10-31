import type { Datable } from './audit.ts';
import type { Charge } from './finance.ts';
import { isOverdue } from './finance.ts';

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

// The overdue debt in each bucket, in cents
export function agingOf(charges: Pick<Charge, 'amount' | 'dueDate' | 'paidAt'>[], now = new Date()) {
	const buckets = agingBuckets.map(() => 0);
	let count = 0;
	for (const charge of charges) {
		if (isOverdue(charge, now)) {
			const days = daysOverdue(charge, now);
			buckets[agingBuckets.findIndex(bucket => days <= bucket.maxDays)] += charge.amount;
			count++;
		}
	}
	return { buckets, total: buckets.reduce((sum, cents) => sum + cents, 0), count };
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
