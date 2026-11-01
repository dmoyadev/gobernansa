import type { Datable } from './audit.ts';
import type { VatRate } from './finance.ts';
import type { VerifactuLink } from './verifactu.ts';
import { invoiceAmounts } from './finance.ts';

// The administrator's office as the issuer of its fee invoices (honorarios), at offices/{uid}. Only them and the team
export interface Office extends Datable {
	nif: string;
	name: string;
	// One line, with the postcode and town, as it's printed
	address: string;
	email?: string;
	// Where the communities pay the invoices, printed on them
	iban?: string;
	vatRate: VatRate;
	// IRPF withheld by the communities, 15 % (7 % starting out) when the administrator is a professional; 0 for a company
	withholdingRate: number;
	// Invoices and rectificativas number on their own, each year from 1
	series: string;
	rectSeries: string;
	// The monthly fee of each community, by id, for the monthly run
	monthlyFees?: Record<string, number>;
	// Last number used, by series and year (counterKey)
	counters?: Record<string, number>;
	// And the date of that last one ('YYYY-MM-DD'), the next can't be earlier
	lastDates?: Record<string, string>;
	// The last Verifactu record, the next one chains to it, and how many there are
	chain?: VerifactuLink;
	recordCount?: number;
	// The provider standing for the office in its communities' books
	providerId?: string;
}

export type OfficeData = Pick<Office, 'nif' | 'name' | 'address' | 'email' | 'iban' | 'vatRate' | 'withholdingRate' | 'series' | 'rectSeries'>;

export const officeVatRates: VatRate[] = [21, 10, 4];
export const officeWithholdings = [
	{ rate: 15, label: 'Profesional 15 %' },
	{ rate: 7, label: 'Profesional, inicio de actividad 7 %' },
	{ rate: 0, label: 'Sin retención (sociedad)' },
];

export interface InvoiceLine {
	concept: string;
	base: number;
}

// Factura de honorarios to a community, at offices/{uid}/invoices. Never removed: corrected with a rectificativa (R1)
// or, if it was never really issued, annulled in the registry. Issuer and recipient as they were on the day
export interface FeeInvoice extends Datable {
	id: string;
	// NumSerieFactura, e.g. "A2027-0001"
	number: string;
	series: string;
	year: number;
	// 'YYYY-MM-DD', fecha de expedición
	date: string;
	type: 'F1' | 'R1';
	issuer: { nif: string; name: string; address: string; iban?: string };
	communityId: string;
	recipient: { nif: string; name: string; address: string };
	lines: InvoiceLine[];
	base: number;
	vatRate: VatRate;
	vat: number;
	withholdingRate: number;
	withholding: number;
	// Base plus VAT, ImporteTotal for Verifactu
	total: number;
	// What the community pays: the total minus the withholding
	payable: number;
	// The monthly fee's month ('YYYY-MM'), its id depends on it so a run never bills a community twice
	period?: string;
	// R1 only: the invoice it corrects, by differences (its lines are what changes, negative to lower it)
	rectifies?: { id: string; number: string; date: string };
	// Written later: its rectificativas, its annulment and its expense in the community's books
	rectifiedBy?: string[];
	annulled?: boolean;
	expenseId?: string;
	// Of its alta record, to print and check
	huella: string;
}

export interface InvoiceDraft {
	id: string;
	type: FeeInvoice['type'];
	date: string;
	communityId: string;
	recipient: FeeInvoice['recipient'];
	lines: InvoiceLine[];
	period?: string;
	rectifies?: FeeInvoice['rectifies'];
}

export function counterKey(series: string, year: number) {
	return `${series}${year}`;
}

export function invoiceNumber(series: string, year: number, sequence: number) {
	return `${series}${year}-${String(sequence).padStart(4, '0')}`;
}

// The id of a community's monthly fee invoice
export function monthlyInvoiceId(period: string, communityId: string) {
	return `${period}-${communityId}`;
}

// Each tax rounded once over the whole base, as Verifactu checks them
export function feeInvoiceAmounts(lines: InvoiceLine[], vatRate: number, withholdingRate: number) {
	const base = lines.reduce((sum, line) => sum + line.base, 0);
	const { vat, withholding, amount, payable } = invoiceAmounts(base, vatRate, withholdingRate);
	return { base, vat, withholding, total: amount, payable };
}

export const invoiceTypes: Record<FeeInvoice['type'], string> = {
	F1: 'Factura',
	R1: 'Rectificativa',
};

export function monthLabel(period: string) {
	const [year, month] = period.split('-').map(Number);
	return new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
}

// Recorded in a community's books as an invoice of the office, so both sides match
export function expenseIdOf(invoiceId: string) {
	return `fee-invoice-${invoiceId}`;
}
