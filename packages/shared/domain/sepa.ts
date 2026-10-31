import type { Timestamp } from 'firebase/firestore';
import type { Datable } from './audit.ts';
import { normalizeTaxId } from './fiscal.ts';

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
 * letters as numbers (A = 10), as in the IBAN. The suffix is left out of them
 */
export function creditorId(nif: string, suffix = '000') {
	const id = normalizeTaxId(nif);
	const digits = Array.from(`${id}ES00`, char => Number.parseInt(char, 36)).join('');
	let rest = 0;
	for (let start = 0; start < digits.length; start += 7) {
		rest = Number(`${rest}${digits.slice(start, start + 7)}`) % 97;
	}
	return `ES${String(98 - rest).padStart(2, '0')}${suffix}${id}`;
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

function amount(cents: number) {
	return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

function escapeXml(value: string) {
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
