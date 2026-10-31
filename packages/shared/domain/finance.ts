import type { Timestamp } from 'firebase/firestore';
import type { Datable } from './audit.ts';
import type { Property } from './property.ts';
import type { ReturnReason } from './sepa.ts';
import { splitByCoefficient } from './property.ts';

// Recibos and derramas, one per property, at communities/{communityId}/charges. Owners see theirs. Amounts in cents (see money.ts)
export interface Charge extends Datable {
	id: string;
	communityId: string;
	propertyId: string;
	propertyName: string;
	// The owner when it was issued, '' when they hadn't signed up
	ownerUid: string;
	ownerName?: string;
	type: 'fee' | 'levy';
	// e.g. "Cuota enero 2027" or "Derrama fachada"
	concept: string;
	amount: number;
	dueDate: Timestamp;
	paidAt: Timestamp | null;
	// The charges of the same derrama or batch of fees share it. The year's fees from the budget share feeBatchId(year)
	batchId?: string;
	// The part of the amount that goes to the fondo de reserva, in the fees from the budget
	reserve?: number;
	// The remittance (domiciliación) it's being collected with, removed when it's returned so it can go in another one
	remittanceId?: string;
	// Direct debits of it the bank returned, the last one last
	returns?: ChargeReturn[];
}

export interface ChargeReturn {
	remittanceId: string;
	reason: ReturnReason;
	// 'YYYY-MM-DD'
	date: string;
}

export const chargeTypes: Record<Charge['type'], string> = {
	fee: 'Recibo',
	levy: 'Derrama',
};

// Unpaid after its due date. A charge or an invoice, those without a due date never are
export function isOverdue(debt: { paidAt?: Timestamp | null; dueDate?: Timestamp }, now = new Date()) {
	return !debt.paidAt && !!debt.dueDate && debt.dueDate.toMillis() < now.getTime();
}

// Presupuesto anual, at communities/{communityId}/budgets/{year}
export interface Budget extends Datable {
	id: string;
	year: number;
	items: BudgetItem[];
	// Aportación al fondo de reserva, collected with the fees on top of the items. Older budgets lack these
	reserve?: number;
	// What the fund had when the year began, carried over by the admin
	reserveOpening?: number;
	// How the year's fees were issued, so the rest are issued the same way
	fees?: FeePlan;
}

// LPH art. 9.1.f: the fund must be at least 10 % of the last ordinary budget
export const MIN_RESERVE_PERCENT = 10;

export function minReserve(ordinary: number) {
	return Math.ceil(ordinary * MIN_RESERVE_PERCENT / 100);
}

// Months each fee covers
export type FeeMonths = 1 | 2 | 3 | 6 | 12;
export const feePeriodicities: Record<FeeMonths, string> = {
	1: 'Mensual',
	2: 'Bimestral',
	3: 'Trimestral',
	6: 'Semestral',
	12: 'Anual',
};

export interface FeePlan {
	months: FeeMonths;
	// 'YYYY-MM-DD', the next ones fall on the same day every `months` months
	firstDue: string;
	// Cuota fija per fee instead of the coefficient's share (e.g. garages), by property id
	overrides: Record<string, number>;
}

export function feeBatchId(year: number) {
	return `fees-${year}`;
}

// In parts that differ at most by a cent, the first ones get the extra cents
function splitEvenly(cents: number, parts: number) {
	return Array.from({ length: parts }, (_, index) => Math.floor(cents / parts) + (index < cents % parts ? 1 : 0));
}

const monthNames = new Intl.DateTimeFormat('es', { month: 'long' });

/**
 * The year's fees: the budget plus the reserve, split evenly between the periods and each period between the properties
 * (fixed ones first, the rest by coefficient), so everything adds up to the cent. Each fee carries its part of the reserve.
 * The ids depend only on the year, the periodicity, the period and the property, so issuing again never duplicates
 */
export function planFees<T extends Pick<Property, 'id' | 'coefficient'>>(year: number, ordinary: number, reserve: number, properties: T[], plan: FeePlan) {
	const count = 12 / plan.months;
	const totals = splitEvenly(ordinary + reserve, count);
	const reserves = splitEvenly(reserve, count);
	const [firstYear, firstMonth, firstDay] = plan.firstDue.split('-').map(Number);
	const fixed = properties.filter(property => plan.overrides[property.id] !== undefined);
	const byCoefficient = properties.filter(property => plan.overrides[property.id] === undefined);
	const fixedTotal = fixed.reduce((sum, property) => sum + plan.overrides[property.id], 0);

	return totals.map((total, index) => {
		const month = firstMonth - 1 + index * plan.months;
		// The 31st falls on the last day of shorter months
		const dueDate = new Date(firstYear, month, Math.min(firstDay, new Date(firstYear, month + 1, 0).getDate()), 23, 59, 59);
		const concept = plan.months === 12
			? `Cuota anual ${year}`
			: plan.months === 1
				? `Cuota ${monthNames.format(dueDate)} ${dueDate.getFullYear()}`
				: `Cuota ${feePeriodicities[plan.months].toLowerCase()} ${index + 1}/${count} ${year}`;
		const shares = [
			...fixed.map(property => ({ property, cents: plan.overrides[property.id] })),
			...splitByCoefficient(Math.max(total - fixedTotal, 0), byCoefficient),
		].filter(share => share.cents > 0);
		// The reserve in proportion to each fee
		const reserveShares = splitByCoefficient(Math.min(reserves[index], total), shares.map(share => ({ coefficient: share.cents })));
		return {
			concept,
			dueDate,
			total,
			shares: shares.map((share, i) => ({ ...share, reserve: reserveShares[i].cents, id: `${feeBatchId(year)}-${plan.months}m-${index + 1}-${share.property.id}` })),
		};
	});
}

// Partida, e.g. "Limpieza" or "Ascensor"
export interface BudgetItem {
	// Kept when it's renamed, expenses point to it
	id: string;
	name: string;
	amount: number;
}

// Gasto or factura recibida, at communities/{communityId}/expenses. Older ones only have the amount, with no tax
// breakdown nor payment status, and count as paid
export interface Expense extends Datable {
	id: string;
	year: number;
	itemId: string;
	concept: string;
	// What it costs the community: base plus VAT, as communities can't deduct it. The withholding is part of it too,
	// paid to Hacienda instead of the provider
	amount: number;
	// The invoice's date (fecha de expedición)
	date: Timestamp;
	// nif as it was on the invoice, for the tax returns (347, 111, 190)
	provider?: { id: string; name: string; nif?: string };

	invoiceNumber?: string;
	base?: number;
	vatRate?: VatRate;
	vat?: number;
	withholdingRate?: number;
	withholding?: number;
	withholdingType?: WithholdingType;
	dueDate?: Timestamp;
	// null while it's owed. Missing in older expenses, taken as paid
	paidAt?: Timestamp | null;
	paymentMethod?: PaymentMethod;
	// Paid from the fondo de reserva, e.g. an extraordinary repair
	fromReserve?: boolean;
	// The transfer order it's being paid with, so it can't go in another one
	paymentOrderId?: string;
}

export type VatRate = 0 | 4 | 10 | 21;
export const vatRates: VatRate[] = [21, 10, 4, 0];

// Retención de IRPF: professionals go to 111 and 190, rentals to 115 and 180
export type WithholdingType = 'professional' | 'rental';
export const withholdings: { type?: WithholdingType; rate: number; label: string }[] = [
	{ rate: 0, label: 'Sin retención' },
	{ type: 'professional', rate: 15, label: 'Profesional 15 %' },
	{ type: 'professional', rate: 7, label: 'Profesional, inicio de actividad 7 %' },
	{ type: 'rental', rate: 19, label: 'Alquiler 19 %' },
];

export type PaymentMethod = 'transfer' | 'direct_debit' | 'card' | 'cash';
export const paymentMethods: Record<PaymentMethod, string> = {
	transfer: 'Transferencia',
	direct_debit: 'Domiciliación',
	card: 'Tarjeta',
	cash: 'Efectivo',
};

// Each tax rounded on its own, as it's printed on the invoice
export function invoiceAmounts(base: number, vatRate: number, withholdingRate: number) {
	const vat = Math.round(base * vatRate / 100);
	const withholding = Math.round(base * withholdingRate / 100);
	return { vat, withholding, amount: base + vat, payable: base + vat - withholding };
}

// What's owed to the provider: the total minus what's withheld for Hacienda
export function payableAmount(expense: Pick<Expense, 'amount' | 'withholding'>) {
	return expense.amount - (expense.withholding ?? 0);
}
