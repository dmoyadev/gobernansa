import type { Timestamp } from 'firebase/firestore';
import type { Datable } from './audit.ts';

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
	// The charges of the same derrama or batch of fees share it
	batchId?: string;
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
