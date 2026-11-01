import type { Datable } from './audit.ts';
import type { FeeInvoice } from './billing.ts';
import { escapeXml } from './sepa.ts';

// Verifactu (RD 1007/2023, Orden HAC/1177/2024). Only in test mode: sending the records needs the issuer's certificate
// and a server, so the submission is simulated and the QR points to the AEAT's test environment
export const VERIFACTU_MODE = 'test';
const QR_URL = 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR';
const NS_LR = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd';
const NS_INFO = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd';
const CSV_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// What the next record chains to: the previous one's invoice and huella
export interface VerifactuLink {
	nif: string;
	number: string;
	// 'dd-mm-yyyy'
	date: string;
	huella: string;
}

// Registro de facturación, at offices/{uid}/verifactu. Created with its invoice and never changed nor removed
export interface VerifactuRecord extends Pick<Datable, 'createdAt' | 'createdBy'> {
	id: string;
	kind: 'alta' | 'anulacion';
	// Order in the issuer's chain, from 1
	seq: number;
	// When it was generated, so a year's records are a whole stretch of the chain (not the invoice's, it may be annulled later)
	year: number;
	invoiceId: string;
	issuer: { nif: string; name: string };
	number: string;
	// 'dd-mm-yyyy', as AEAT has it
	date: string;
	// Alta only, cents
	invoiceType?: FeeInvoice['type'];
	vatTotal?: number;
	total?: number;
	previous: VerifactuLink | null;
	// FechaHoraHusoGenRegistro, ISO 8601 with the offset
	generatedAt: string;
	huella: string;
	// The record's element, wrapped in a SuministroLR envelope to download (suministroXml)
	xml: string;
	submission: { mode: typeof VERIFACTU_MODE; status: 'accepted'; csv: string; at: string };
}

export const recordKinds: Record<VerifactuRecord['kind'], string> = {
	alta: 'Alta',
	anulacion: 'Anulación',
};

// 'YYYY-MM-DD' to 'dd-mm-yyyy'
export function aeatDate(date: string) {
	return date.split('-').reverse().join('-');
}

// Two decimals with a dot, the same in the huella, the XML and the QR: any other form gives another huella
export function aeatAmount(cents: number) {
	const abs = Math.abs(cents);
	return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// e.g. 2027-01-01T19:20:30+01:00
export function generationTime(date = new Date()) {
	const pad = (value: number) => String(Math.trunc(value)).padStart(2, '0');
	const offset = -date.getTimezoneOffset();
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
		+ `${offset < 0 ? '-' : '+'}${pad(Math.abs(offset) / 60)}:${pad(Math.abs(offset) % 60)}`;
}

async function sha256(text: string) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// The exact concatenation AEAT defines for each kind, empty Huella= on the first record
export async function recordHuella(record: Pick<VerifactuRecord, 'kind' | 'issuer' | 'number' | 'date' | 'invoiceType' | 'vatTotal' | 'total' | 'previous' | 'generatedAt'>) {
	const previous = record.previous?.huella ?? '';
	return sha256(record.kind === 'alta'
		? `IDEmisorFactura=${record.issuer.nif.trim()}&NumSerieFactura=${record.number.trim()}&FechaExpedicionFactura=${record.date}`
		+ `&TipoFactura=${record.invoiceType}&CuotaTotal=${aeatAmount(record.vatTotal!)}&ImporteTotal=${aeatAmount(record.total!)}`
		+ `&Huella=${previous}&FechaHoraHusoGenRegistro=${record.generatedAt}`
		: `IDEmisorFacturaAnulada=${record.issuer.nif.trim()}&NumSerieFacturaAnulada=${record.number.trim()}&FechaExpedicionFacturaAnulada=${record.date}`
			+ `&Huella=${previous}&FechaHoraHusoGenRegistro=${record.generatedAt}`);
}

function tag(name: string, content: string) {
	return `<sum1:${name}>${content}</sum1:${name}>`;
}

function chaining(previous: VerifactuLink | null) {
	return tag('Encadenamiento', previous
		? tag('RegistroAnterior', tag('IDEmisorFactura', previous.nif) + tag('NumSerieFactura', escapeXml(previous.number))
		+ tag('FechaExpedicionFactura', previous.date) + tag('Huella', previous.huella))
		: tag('PrimerRegistro', 'S'));
}

// The software that makes the records. ponytail: the producer's own NIF goes here once it's registered with AEAT;
// the test environment takes the issuer's, as for software developed by the issuer itself
function system(nif: string, installation: string) {
	return tag('SistemaInformatico', tag('NombreRazon', 'gobernança') + tag('NIF', nif)
		+ tag('NombreSistemaInformatico', 'gobernança') + tag('IdSistemaInformatico', 'GB') + tag('Version', '1.0')
		+ tag('NumeroInstalacion', escapeXml(installation.slice(0, 100)))
		+ tag('TipoUsoPosibleSoloVerifactu', 'S') + tag('TipoUsoPosibleMultiOT', 'S') + tag('IndicadorMultiplesOT', 'N'));
}

type RecordData = Omit<VerifactuRecord, 'id' | 'xml' | 'huella' | 'createdAt' | 'createdBy'>;

// The RegistroAlta of an invoice, its huella and its XML, in the order of the SuministroInformacion schema
export async function altaRecord(invoice: Omit<FeeInvoice, 'huella' | keyof Datable>, data: Omit<RecordData, 'kind' | 'issuer' | 'number' | 'date' | 'invoiceType' | 'vatTotal' | 'total' | 'invoiceId' | 'year'>, installation: string) {
	const record: RecordData = {
		...data,
		kind: 'alta',
		year: Number(data.generatedAt.slice(0, 4)),
		invoiceId: invoice.id,
		issuer: { nif: invoice.issuer.nif, name: invoice.issuer.name },
		number: invoice.number,
		date: aeatDate(invoice.date),
		invoiceType: invoice.type,
		vatTotal: invoice.vat,
		total: invoice.total,
	};
	const huella = await recordHuella(record);
	const id = (nif: string, number: string, date: string) => tag('IDEmisorFactura', nif) + tag('NumSerieFactura', escapeXml(number)) + tag('FechaExpedicionFactura', date);
	const xml = tag('RegistroAlta', tag('IDVersion', '1.0')
		+ tag('IDFactura', id(record.issuer.nif, record.number, record.date))
		+ tag('NombreRazonEmisor', escapeXml(invoice.issuer.name.slice(0, 120)))
		+ tag('TipoFactura', invoice.type)
		+ (invoice.rectifies
			? tag('TipoRectificativa', 'I') + tag('FacturasRectificadas', tag('IDFacturaRectificada', id(record.issuer.nif, invoice.rectifies.number, aeatDate(invoice.rectifies.date))))
			: '')
		+ tag('DescripcionOperacion', escapeXml(invoice.lines.map(line => line.concept).join('; ').slice(0, 500)))
		+ tag('Destinatarios', tag('IDDestinatario', tag('NombreRazon', escapeXml(invoice.recipient.name.slice(0, 120))) + tag('NIF', invoice.recipient.nif)))
		+ tag('Desglose', tag('DetalleDesglose', tag('Impuesto', '01') + tag('ClaveRegimen', '01') + tag('CalificacionOperacion', 'S1')
		+ tag('TipoImpositivo', aeatAmount(invoice.vatRate * 100)) + tag('BaseImponibleOimporteNoSujeto', aeatAmount(invoice.base))
		+ tag('CuotaRepercutida', aeatAmount(invoice.vat))))
	+ tag('CuotaTotal', aeatAmount(invoice.vat))
	+ tag('ImporteTotal', aeatAmount(invoice.total))
	+ chaining(record.previous)
	+ system(record.issuer.nif, installation)
	+ tag('FechaHoraHusoGenRegistro', record.generatedAt)
	+ tag('TipoHuella', '01')
	+ tag('Huella', huella));
	return { ...record, huella, xml };
}

// The RegistroAnulacion of an invoice that was never really issued
export async function anulacionRecord(invoice: Pick<FeeInvoice, 'id' | 'year' | 'issuer' | 'number' | 'date'>, data: Omit<RecordData, 'kind' | 'issuer' | 'number' | 'date' | 'invoiceId' | 'year'>, installation: string) {
	const record: RecordData = {
		...data,
		kind: 'anulacion',
		year: Number(data.generatedAt.slice(0, 4)),
		invoiceId: invoice.id,
		issuer: { nif: invoice.issuer.nif, name: invoice.issuer.name },
		number: invoice.number,
		date: aeatDate(invoice.date),
	};
	const huella = await recordHuella(record);
	const xml = tag('RegistroAnulacion', tag('IDVersion', '1.0')
		+ tag('IDFactura', tag('IDEmisorFacturaAnulada', record.issuer.nif) + tag('NumSerieFacturaAnulada', escapeXml(record.number)) + tag('FechaExpedicionFacturaAnulada', record.date))
		+ chaining(record.previous)
		+ system(record.issuer.nif, installation)
		+ tag('FechaHoraHusoGenRegistro', record.generatedAt)
		+ tag('TipoHuella', '01')
		+ tag('Huella', huella));
	return { ...record, huella, xml };
}

// RegFactuSistemaFacturacion, as it would be sent: up to 1000 records of one issuer
export function suministroXml(issuer: VerifactuRecord['issuer'], records: Pick<VerifactuRecord, 'xml'>[]) {
	return `<?xml version="1.0" encoding="UTF-8"?>\n<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sum="${NS_LR}" xmlns:sum1="${NS_INFO}">`
		+ `<soapenv:Header/><soapenv:Body><sum:RegFactuSistemaFacturacion>`
		+ `<sum:Cabecera>${tag('ObligadoEmision', tag('NombreRazon', escapeXml(issuer.name.slice(0, 120))) + tag('NIF', issuer.nif))}</sum:Cabecera>${
			records.map(record => `<sum:RegistroFactura>${record.xml}</sum:RegistroFactura>`).join('')
		}</sum:RegFactuSistemaFacturacion></soapenv:Body></soapenv:Envelope>\n`;
}

// The QR's URL to check the invoice at the AEAT (its test environment), with ImporteTotal
export function qrUrl(invoice: Pick<FeeInvoice, 'issuer' | 'number' | 'date' | 'total'>) {
	return `${QR_URL}?nif=${encodeURIComponent(invoice.issuer.nif)}&numserie=${encodeURIComponent(invoice.number)}`
		+ `&fecha=${aeatDate(invoice.date)}&importe=${aeatAmount(invoice.total)}`;
}

// What AEAT would answer: a Código Seguro de Verificación. Made up, as nothing is sent
export function simulatedSubmission(): VerifactuRecord['submission'] {
	const csv = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => CSV_CHARS[byte % CSV_CHARS.length]).join('');
	return { mode: VERIFACTU_MODE, status: 'accepted', csv, at: generationTime() };
}

// The first record whose huella isn't what its data gives, or that doesn't chain to the one before (or one is missing). Sorted by seq
export async function brokenLink(records: VerifactuRecord[]) {
	for (const [index, record] of records.entries()) {
		const before = records[index - 1];
		// A new NIF is another issuer, whose chain starts again
		const chained = !before || (before.seq === record.seq - 1
			&& (before.issuer.nif === record.issuer.nif ? record.previous?.huella === before.huella : !record.previous));
		if (!chained || await recordHuella(record) !== record.huella) {
			return record;
		}
	}
	return undefined;
}
