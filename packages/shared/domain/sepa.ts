import type { Timestamp } from 'firebase/firestore';
import type { Datable } from './audit.ts';
import { toDateString } from './booking.ts';
import { normalizeTaxId } from './fiscal.ts';
import { formatCents } from './money.ts';

const BIC_REGEX = /^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/;
const SUFFIX_REGEX = /^[A-Z0-9]{3}$/;
const DIACRITICS_REGEX = /[\u0300-\u036F]/g;
// The Latin characters the SEPA rulebook allows, anything else is turned into a space
const NON_SEPA_REGEX = /[^\w/?:().,'+\- ]|_/g;
const SPACES_REGEX = /\s+/g;
const NON_ID_REGEX = /[^A-Z0-9-]/g;
const XML_SPECIAL_REGEX = /[&<>"']/g;
const XML_ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&apos;' };

// Orden de domiciliación SEPA Core, recurrent, kept in the property it's charged to. Signed by the owner, who may
// pay from someone else's account (debtorName is the account holder)
export interface SepaMandate {
	// Unique within the community (the creditor), at most 35 characters. Kept when the account changes
	reference: string;
	debtorName: string;
	iban: string;
	bic?: string;
	// 'YYYY-MM-DD'
	signedAt: string;
	status: 'active' | 'cancelled';
	// The remittance that carried its first debit (FRST), the next ones are RCUR. Cleared when that debit is returned or
	// the account changes, so the next one is first again
	firstRemittanceId?: string;
}

export const mandateStatuses: Record<SepaMandate['status'], string> = {
	active: 'Activo',
	cancelled: 'Cancelado',
};

export type SequenceType = 'FRST' | 'RCUR';

// Remesa de recibos domiciliados, at communities/{communityId}/remittances. Self-contained: it keeps the creditor and
// each mandate as they were, so the same file can be downloaded again and returns don't depend on later edits
export interface Remittance extends Datable {
	id: string;
	// Also the file's MsgId
	reference: string;
	// 'YYYY-MM-DD', the day the bank charges the debtors
	collectionDate: string;
	// ISO date and time without milliseconds, the file's CreDtTm
	issuedAt: string;
	status: 'generated' | 'sent' | 'collected';
	creditor: { name: string; id: string; iban: string; bic?: string };
	items: RemittanceItem[];
	// Of every item, returned or not, as the file has them
	total: number;
	sentAt?: Timestamp | null;
	collectedAt?: Timestamp | null;
}

export interface RemittanceItem {
	chargeId: string;
	propertyId: string;
	propertyName: string;
	concept: string;
	amount: number;
	endToEndId: string;
	sequence: SequenceType;
	mandate: Pick<SepaMandate, 'reference' | 'debtorName' | 'iban' | 'bic' | 'signedAt'>;
	returned?: RemittanceReturn;
}

// Devolución: the bank's R-transaction, entered by the office from its statement
export interface RemittanceReturn {
	reason: ReturnReason;
	// 'YYYY-MM-DD'
	date: string;
	// The gastos de devolución charged to the property, when there were
	feeChargeId?: string;
}

export const remittanceStatuses: Record<Remittance['status'], string> = {
	generated: 'Generada',
	sent: 'Enviada al banco',
	collected: 'Cobrada',
};

// The usual SEPA return reason codes for direct debits
export const returnReasons = {
	AM04: 'Saldo insuficiente',
	MD06: 'Devuelto a petición del titular',
	MS02: 'Sin motivo, a petición del titular',
	MS03: 'Sin motivo, por el banco',
	MD01: 'Sin mandato o mandato no válido',
	MD07: 'Titular fallecido',
	AC01: 'IBAN incorrecto',
	AC04: 'Cuenta cancelada',
	AC06: 'Cuenta bloqueada',
	AG01: 'La cuenta no admite adeudos',
	BE05: 'Identificador del acreedor incorrecto',
	SL01: 'Servicios específicos del banco del titular',
	FF01: 'Formato del fichero no válido',
	RC01: 'BIC incorrecto',
	RR01: 'Falta la cuenta o la identificación del titular',
	RR02: 'Falta el nombre o la dirección del titular',
	RR03: 'Falta el nombre o la dirección del acreedor',
	RR04: 'Motivos regulatorios',
} as const;

export type ReturnReason = keyof typeof returnReasons;

export function isValidBic(value: string) {
	return BIC_REGEX.test(value.replace(SPACES_REGEX, '').toUpperCase());
}

export function isValidCreditorSuffix(value: string) {
	return SUFFIX_REGEX.test(value);
}

/**
 * Identificador de acreedor SEPA (AT-02) of a Spanish entity: ES, two check digits, the business code (suffix, '000'
 * unless the bank gave another one) and the NIF. The check digits are ISO 7064 mod 97-10 over the NIF and 'ES00',
 * letters as numbers (A = 10), as in the IBAN. The suffix is left out of them. Other countries' work the same way
 */
export function creditorId(nif: string, suffix = '000', country = 'ES') {
	const id = normalizeTaxId(nif);
	const digits = Array.from(`${id}${country}00`, char => Number.parseInt(char, 36)).join('');
	let rest = 0;
	for (let start = 0; start < digits.length; start += 7) {
		rest = Number(`${rest}${digits.slice(start, start + 7)}`) % 97;
	}
	return `${country}${String(98 - rest).padStart(2, '0')}${suffix}${id}`;
}

// Mandate reference, e.g. "GOB-ABC123DEF456-20261031": the property and the day it was made, unique enough per creditor
export function newMandateReference(propertyId: string, date = new Date()) {
	const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()].map(part => String(part).padStart(2, '0')).join('');
	return `GOB-${propertyId.toUpperCase().replace(NON_ID_REGEX, '').slice(0, 16)}-${day}`;
}

// What may go in a SEPA text: accents and ñ transliterated, other characters as spaces, cut to its length
export function sepaText(value: string, max: number) {
	return value.normalize('NFD').replace(DIACRITICS_REGEX, '').replace(NON_SEPA_REGEX, ' ').replace(SPACES_REGEX, ' ').trim().slice(0, max).trim();
}

// Identifiers (MsgId, EndToEndId, MndtId) only letters, digits and dashes, which every bank takes
export function sepaId(value: string, max = 35) {
	return value.normalize('NFD').replace(DIACRITICS_REGEX, '').toUpperCase().replace(NON_ID_REGEX, '').slice(0, max);
}

// CreDtTm, the moment the file was made in local time without zone, e.g. 2026-10-31T09:05:00
export function sepaDateTime(date: Date) {
	return `${toDateString(date)}T${[date.getHours(), date.getMinutes(), date.getSeconds()].map(part => String(part).padStart(2, '0')).join(':')}`;
}

function amount(cents: number) {
	return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export function escapeXml(value: string) {
	return value.replace(XML_SPECIAL_REGEX, char => XML_ENTITIES[char]);
}

// The bank's identifier, or NOTPROVIDED: within SEPA the IBAN alone is enough
function agent(bic?: string) {
	return bic ? `<FinInstnId><BIC>${escapeXml(bic)}</BIC></FinInstnId>` : '<FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>';
}

/**
 * The remittance as a pain.008.001.02 file (SEPA Core Direct Debit), the one Spanish banks take in their online
 * banking: one PmtInf per sequence type, each debit with its mandate and the charge's concept. Returned items are
 * still in it, the file is what was sent
 */
export function remittanceXml(remittance: Pick<Remittance, 'reference' | 'collectionDate' | 'issuedAt' | 'creditor' | 'items'>) {
	const { creditor, items } = remittance;
	const name = escapeXml(sepaText(creditor.name, 70));
	const total = items.reduce((sum, item) => sum + item.amount, 0);
	const groups = (['FRST', 'RCUR'] as const).map(sequence => ({ sequence, items: items.filter(item => item.sequence === sequence) })).filter(group => group.items.length);

	const payments = groups.map(group => [
		'<PmtInf>',
		`<PmtInfId>${sepaId(`${remittance.reference}-${group.sequence}`)}</PmtInfId>`,
		'<PmtMtd>DD</PmtMtd>',
		'<BtchBookg>true</BtchBookg>',
		`<NbOfTxs>${group.items.length}</NbOfTxs>`,
		`<CtrlSum>${amount(group.items.reduce((sum, item) => sum + item.amount, 0))}</CtrlSum>`,
		`<PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl><LclInstrm><Cd>CORE</Cd></LclInstrm><SeqTp>${group.sequence}</SeqTp></PmtTpInf>`,
		`<ReqdColltnDt>${remittance.collectionDate}</ReqdColltnDt>`,
		`<Cdtr><Nm>${name}</Nm></Cdtr>`,
		`<CdtrAcct><Id><IBAN>${escapeXml(creditor.iban)}</IBAN></Id></CdtrAcct>`,
		`<CdtrAgt>${agent(creditor.bic)}</CdtrAgt>`,
		'<ChrgBr>SLEV</ChrgBr>',
		`<CdtrSchmeId><Id><PrvtId><Othr><Id>${escapeXml(creditor.id)}</Id><SchmeNm><Prtry>SEPA</Prtry></SchmeNm></Othr></PrvtId></Id></CdtrSchmeId>`,
		...group.items.map(item => [
			'<DrctDbtTxInf>',
			`<PmtId><EndToEndId>${escapeXml(item.endToEndId)}</EndToEndId></PmtId>`,
			`<InstdAmt Ccy="EUR">${amount(item.amount)}</InstdAmt>`,
			`<DrctDbtTx><MndtRltdInf><MndtId>${escapeXml(item.mandate.reference)}</MndtId><DtOfSgntr>${item.mandate.signedAt}</DtOfSgntr></MndtRltdInf></DrctDbtTx>`,
			`<DbtrAgt>${agent(item.mandate.bic)}</DbtrAgt>`,
			`<Dbtr><Nm>${escapeXml(sepaText(item.mandate.debtorName, 70))}</Nm></Dbtr>`,
			`<DbtrAcct><Id><IBAN>${escapeXml(item.mandate.iban)}</IBAN></Id></DbtrAcct>`,
			`<RmtInf><Ustrd>${escapeXml(sepaText(`${item.concept} ${item.propertyName}`, 140))}</Ustrd></RmtInf>`,
			'</DrctDbtTxInf>',
		].join('')),
		'</PmtInf>',
	].join('\n'));

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
		'<CstmrDrctDbtInitn>',
		'<GrpHdr>',
		`<MsgId>${escapeXml(remittance.reference)}</MsgId>`,
		`<CreDtTm>${remittance.issuedAt}</CreDtTm>`,
		`<NbOfTxs>${items.length}</NbOfTxs>`,
		`<CtrlSum>${amount(total)}</CtrlSum>`,
		`<InitgPty><Nm>${name}</Nm><Id><OrgId><Othr><Id>${escapeXml(creditor.id)}</Id></Othr></OrgId></Id></InitgPty>`,
		'</GrpHdr>',
		...payments,
		'</CstmrDrctDbtInitn>',
		'</Document>',
		'',
	].join('\n');
}

// Orden de pago a proveedores por transferencia, at communities/{communityId}/paymentOrders. Self-contained like the
// remittance: the debtor and each creditor as they were, so the same file can be downloaded again
export interface PaymentOrder extends Datable {
	id: string;
	// Also the file's MsgId
	reference: string;
	// 'YYYY-MM-DD', the day the bank sends the transfers
	executionDate: string;
	// ISO date and time without milliseconds, the file's CreDtTm
	issuedAt: string;
	status: 'generated' | 'executed';
	// id: NIF plus the business suffix, how Spanish banks identify who orders the transfers
	debtor: { name: string; id: string; iban: string; bic?: string };
	items: PaymentOrderItem[];
	total: number;
	executedAt?: Timestamp | null;
}

export interface PaymentOrderItem {
	expenseId: string;
	providerId: string;
	creditorName: string;
	iban: string;
	// What's owed to the provider, the withholding is paid to Hacienda
	amount: number;
	concept: string;
	invoiceNumber?: string;
	endToEndId: string;
}

export const paymentOrderStatuses: Record<PaymentOrder['status'], string> = {
	generated: 'Generada',
	executed: 'Ejecutada',
};

/**
 * The order as a pain.001.001.03 file (SEPA Credit Transfer), the one Spanish banks take in their online banking: one
 * PmtInf from the community's account, a transfer per invoice with the invoice number as the remittance information
 */
export function paymentOrderXml(order: Pick<PaymentOrder, 'reference' | 'executionDate' | 'issuedAt' | 'debtor' | 'items'>) {
	const { debtor, items } = order;
	const name = escapeXml(sepaText(debtor.name, 70));
	const id = `<Id><OrgId><Othr><Id>${escapeXml(debtor.id)}</Id></Othr></OrgId></Id>`;
	const total = amount(items.reduce((sum, item) => sum + item.amount, 0));

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
		'<CstmrCdtTrfInitn>',
		'<GrpHdr>',
		`<MsgId>${escapeXml(order.reference)}</MsgId>`,
		`<CreDtTm>${order.issuedAt}</CreDtTm>`,
		`<NbOfTxs>${items.length}</NbOfTxs>`,
		`<CtrlSum>${total}</CtrlSum>`,
		`<InitgPty><Nm>${name}</Nm>${id}</InitgPty>`,
		'</GrpHdr>',
		'<PmtInf>',
		`<PmtInfId>${sepaId(`${order.reference}-1`)}</PmtInfId>`,
		'<PmtMtd>TRF</PmtMtd>',
		'<BtchBookg>true</BtchBookg>',
		`<NbOfTxs>${items.length}</NbOfTxs>`,
		`<CtrlSum>${total}</CtrlSum>`,
		'<PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>',
		`<ReqdExctnDt>${order.executionDate}</ReqdExctnDt>`,
		`<Dbtr><Nm>${name}</Nm>${id}</Dbtr>`,
		`<DbtrAcct><Id><IBAN>${escapeXml(debtor.iban)}</IBAN></Id><Ccy>EUR</Ccy></DbtrAcct>`,
		`<DbtrAgt>${agent(debtor.bic)}</DbtrAgt>`,
		'<ChrgBr>SLEV</ChrgBr>',
		// The creditor's bank is left out, within SEPA the IBAN is enough
		...items.map(item => [
			'<CdtTrfTxInf>',
			`<PmtId><EndToEndId>${escapeXml(item.endToEndId)}</EndToEndId></PmtId>`,
			`<Amt><InstdAmt Ccy="EUR">${amount(item.amount)}</InstdAmt></Amt>`,
			`<Cdtr><Nm>${escapeXml(sepaText(item.creditorName, 70))}</Nm></Cdtr>`,
			`<CdtrAcct><Id><IBAN>${escapeXml(item.iban)}</IBAN></Id></CdtrAcct>`,
			`<RmtInf><Ustrd>${escapeXml(sepaText(item.invoiceNumber ? `Fra. ${item.invoiceNumber} ${item.concept}` : item.concept, 140))}</Ustrd></RmtInf>`,
			'</CdtTrfTxInf>',
		].join('')),
		'</PmtInf>',
		'</CstmrCdtTrfInitn>',
		'</Document>',
		'',
	].join('\n');
}

/* Files from the bank and other programs, read with the browser's XML parser */

const AMOUNT_REGEX = /^(\d{1,9})(?:\.(\d{1,2}))?$/;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// undefined when it isn't well-formed XML
export function parseXml(xml: string) {
	const document = new DOMParser().parseFromString(xml, 'application/xml');
	return document.getElementsByTagName('parsererror').length ? undefined : document;
}

// The first element down that path of children, by their name without prefix, e.g. xmlChild(tx, 'Dbtr', 'Nm')
export function xmlChild(node: Element | null | undefined, ...path: string[]) {
	return path.reduce<Element | undefined>((current, name) => current && [...current.children].find(child => child.localName === name), node ?? undefined);
}

export function xmlText(node: Element | null | undefined, ...path: string[]) {
	return xmlChild(node, ...path)?.textContent?.trim() ?? '';
}

// Cents of an amount as SEPA writes it, e.g. 1234.5, NaN when it isn't one: two decimals at most, up to 999999999.99
export function sepaCents(text: string) {
	const match = AMOUNT_REGEX.exec(text);
	return match ? Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0')) : Number.NaN;
}

// A debit the bank returned or rejected, as its report gives it
export interface ReturnedDebit {
	endToEndId: string;
	// Cents, when the report says
	amount?: number;
	code: string;
	// 'YYYY-MM-DD', when the report says
	date?: string;
}

/**
 * The debits returned in a bank report: a pain.002 (Payment Status Report, each rejected transaction with TxSts RJCT and
 * its reason) or a camt.054 notification, or camt.053 statement, whose entries carry the return information (RtrInf).
 * undefined when it's none of them
 */
export function parseReturns(xml: string): ReturnedDebit[] | undefined {
	const body = parseXml(xml)?.documentElement.firstElementChild;
	const all = (node: Element, name: string) => [...node.getElementsByTagNameNS('*', name)];
	const cents = (text: string) => text && !Number.isNaN(sepaCents(text)) ? { amount: sepaCents(text) } : {};
	const day = (text: string) => ISO_DATE_REGEX.test(text.slice(0, 10)) ? { date: text.slice(0, 10) } : {};
	if (body?.localName === 'CstmrPmtStsRpt') {
		const date = day(xmlText(body, 'GrpHdr', 'CreDtTm'));
		return all(body, 'TxInfAndSts')
			.filter(tx => (xmlText(tx, 'TxSts') || xmlText(tx.parentElement, 'PmtInfSts')) === 'RJCT')
			.map(tx => ({
				endToEndId: xmlText(tx, 'OrgnlEndToEndId'),
				...cents(xmlText(tx, 'OrgnlTxRef', 'Amt', 'InstdAmt')),
				code: xmlText(tx, 'StsRsnInf', 'Rsn', 'Cd') || xmlText(tx, 'StsRsnInf', 'Rsn', 'Prtry'),
				...date,
			}));
	}
	if (body?.localName === 'BkToCstmrDbtCdtNtfctn' || body?.localName === 'BkToCstmrStmt') {
		return all(body, 'Ntry').flatMap((entry) => {
			const date = day(xmlText(entry, 'BookgDt', 'Dt') || xmlText(entry, 'BookgDt', 'DtTm') || xmlText(entry, 'ValDt', 'Dt'));
			const details = all(entry, 'TxDtls');
			return details.filter(tx => xmlChild(tx, 'RtrInf')).map(tx => ({
				endToEndId: xmlText(tx, 'Refs', 'EndToEndId'),
				// The amount first debited, the entry's own when it's the only one
				...cents(xmlText(tx, 'AmtDtls', 'InstdAmt', 'Amt') || xmlText(tx, 'Amt') || xmlText(tx, 'AmtDtls', 'TxAmt', 'Amt') || (details.length === 1 ? xmlText(entry, 'Amt') : '')),
				code: xmlText(tx, 'RtrInf', 'Rsn', 'Cd') || xmlText(tx, 'RtrInf', 'Rsn', 'Prtry'),
				...date,
			}));
		});
	}
	return undefined;
}

export interface ReturnMatch {
	line: ReturnedDebit;
	remittance?: Remittance;
	item?: RemittanceItem;
	// Why it can't be registered, when it can't
	problem?: string;
}

// Each returned debit with its remittance's item, by its EndToEndId, and the amount when the report has it
export function matchReturns(lines: ReturnedDebit[], remittances: Remittance[]): ReturnMatch[] {
	const items = new Map(remittances.flatMap(remittance => remittance.items.map(item => [item.endToEndId, { remittance, item }])));
	const seen = new Set<string>();
	return lines.map((line) => {
		const found = items.get(line.endToEndId);
		const problem = !found
			? 'No está en ninguna remesa'
			: !Object.hasOwn(returnReasons, line.code)
					? `Motivo ${line.code || 'sin código'}: regístrala a mano`
					: line.amount !== undefined && line.amount !== found.item.amount
						? `El importe no coincide: ${formatCents(line.amount)} en el fichero y ${formatCents(found.item.amount)} en la remesa`
						: found.item.returned
							? 'Ya estaba registrada'
							: found.remittance.status === 'generated'
								? 'La remesa no está marcada como enviada'
								: seen.has(line.endToEndId) ? 'Repetida en el fichero' : undefined;
		seen.add(line.endToEndId);
		return { line, ...found, ...(problem ? { problem } : {}) };
	});
}
