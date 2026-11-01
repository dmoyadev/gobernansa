import { canonical, decodeText, parseCsv, parseDate } from './bank.ts';
import { toDateString } from './booking.ts';
import { csvDate } from './exchange.ts';
import { isValidIban, isValidNif } from './fiscal.ts';
import { formatCents, toCents } from './money.ts';
import { creditorId, isValidBic, parseXml, sepaCents, xmlChild, xmlText } from './sepa.ts';

/*
 * Comprobación de los ficheros for the bank and the AEAT, made here or by another program: SEPA remittances (pain.008)
 * and transfers (pain.001), the AEAT's records (347, 190 and 184) and the journal (ContaPlus' XDiario and the CSV). They
 * check the record design and the data, not what the bank or the Sede will say of them
 */

export interface FileIssue {
	level: 'error' | 'warning';
	message: string;
	// The record, block or transaction it points to
	where: string;
}

const FILE = 'Fichero';

function collector() {
	const issues: FileIssue[] = [];
	return {
		issues,
		error: (where: string, message: string) => issues.push({ level: 'error', where, message }),
		warning: (where: string, message: string) => issues.push({ level: 'warning', where, message }),
	};
}

/* SEPA: pain.008 and pain.001 */

// The Latin characters of the SEPA rulebook, and those of identifiers: no spaces (nor a / at either end or doubled)
const SEPA_TEXT_REGEX = /^[A-Z0-9/?:().,'+\- ]*$/i;
const SEPA_ID_REGEX = /^[A-Z0-9/?:().,'+-]+$/i;
const IBAN_REGEX = /^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
// ES, check digits, business code (suffix) and NIF
const CREDITOR_ID_REGEX = /^([A-Z]{2})\d{2}([A-Z0-9]{3})([A-Z0-9]{1,28})$/;
const SEQUENCES = ['FRST', 'RCUR', 'OOFF', 'FNAL'];
// The versions Spanish banks take: those of the 2009 rulebooks and those of 2019 (in force since November 2023)
const SEPA_VERSIONS = { 'pain.008': ['pain.008.001.02', 'pain.008.001.08'], 'pain.001': ['pain.001.001.03', 'pain.001.001.09'] };

/**
 * A pain.008 (adeudos) or pain.001 (transferencias) file: its version, the counts and control sums of the file and of
 * each block, identifiers, IBAN, BIC, the creditor identifier, amounts, dates, sequence types, mandates and names.
 * today is 'YYYY-MM-DD'
 */
export function checkSepa(xml: string, today = toDateString(new Date())) {
	const { issues, error, warning } = collector();
	const document = parseXml(xml);
	if (!document) {
		error(FILE, 'No es un XML bien formado: está cortado o tiene caracteres sin escapar.');
		return issues;
	}
	const root = document.documentElement;
	const body = root.firstElementChild;
	const kind: keyof typeof SEPA_VERSIONS | undefined = body?.localName === 'CstmrDrctDbtInitn' ? 'pain.008' : body?.localName === 'CstmrCdtTrfInitn' ? 'pain.001' : undefined;
	if (root.localName !== 'Document' || !body || !kind) {
		error(FILE, 'No es una remesa de adeudos (pain.008) ni una orden de transferencias (pain.001).');
		return issues;
	}
	const debit = kind === 'pain.008';
	const version = root.namespaceURI?.split(':').at(-1) ?? '';
	if (!version.startsWith(kind)) {
		error(FILE, `El espacio de nombres (${root.namespaceURI || 'ninguno'}) no es el de un ${kind}.`);
	} else if (!SEPA_VERSIONS[kind].includes(version)) {
		warning(FILE, `Versión ${version}: los bancos admiten la ${SEPA_VERSIONS[kind].join(' y la ')}.`);
	}

	const id = (where: string, value: string, label: string) => {
		if (!value) {
			error(where, `Falta ${label}.`);
		} else if (value.length > 35) {
			error(where, `${label} tiene ${value.length} caracteres, como mucho 35.`);
		} else if (!SEPA_ID_REGEX.test(value) || value.startsWith('/') || value.endsWith('/') || value.includes('//')) {
			error(where, `${label} (${value}) tiene caracteres que SEPA no admite.`);
		}
	};
	const name = (where: string, value: string, label: string) => {
		if (!value) {
			error(where, `Falta el nombre ${label}.`);
		} else if (!SEPA_TEXT_REGEX.test(value)) {
			warning(where, `El nombre ${label} tiene caracteres fuera del juego SEPA (acentos, ñ, &…): el banco puede cambiarlos o rechazarlo.`);
		} else if (value.length > 70) {
			warning(where, `El nombre ${label} pasa de 70 caracteres: el banco lo cortará.`);
		}
	};
	const iban = (where: string, value: string, label: string) => {
		if (!value) {
			error(where, `Falta el IBAN ${label}.`);
		} else if (!IBAN_REGEX.test(value) || !isValidIban(value)) {
			error(where, `El IBAN ${label} (${value}) no es válido.`);
		}
	};
	const bic = (where: string, agent: Element | undefined, label: string) => {
		const value = xmlText(agent, 'FinInstnId', 'BIC') || xmlText(agent, 'FinInstnId', 'BICFI');
		if (value && (value !== value.toUpperCase() || !isValidBic(value) || value.includes(' '))) {
			error(where, `El BIC ${label} (${value}) no tiene un formato válido.`);
		}
	};
	const date = (where: string, value: string, label: string) => {
		const plain = value.slice(0, 10);
		if (!ISO_DATE_REGEX.test(plain) || parseDate(plain) !== plain) {
			error(where, `${label} (${value || 'vacía'}) no es una fecha válida.`);
			return '';
		}
		if (plain < today) {
			error(where, `${label} (${csvDate(plain)}) ya ha pasado: el banco la rechazará.`);
		} else if (debit && plain === today) {
			warning(where, `${label} es hoy: el banco necesita la remesa al menos un día hábil antes.`);
		}
		return plain;
	};
	const totals = (where: string, node: Element, count: number, sum: number) => {
		const declared = xmlText(node, 'NbOfTxs');
		if (declared !== String(count)) {
			error(where, `Dice tener ${declared || 'sin indicar'} operaciones (NbOfTxs) y tiene ${count}.`);
		}
		const control = xmlText(node, 'CtrlSum');
		if (!control) {
			warning(where, 'No tiene suma de control (CtrlSum): algunos bancos la exigen.');
		} else if (sepaCents(control) !== sum) {
			error(where, `La suma de control (CtrlSum ${control}) no coincide con la de sus importes, ${formatCents(sum)}.`);
		}
	};

	const header = xmlChild(body, 'GrpHdr');
	if (!header) {
		error(FILE, 'Falta la cabecera (GrpHdr).');
		return issues;
	}
	id('Cabecera', xmlText(header, 'MsgId'), 'la referencia del fichero (MsgId)');
	if (!xmlText(header, 'InitgPty', 'Nm')) {
		warning('Cabecera', 'Falta el nombre del presentador (InitgPty).');
	}

	const blocks = [...body.children].filter(child => child.localName === 'PmtInf');
	if (!blocks.length) {
		error(FILE, 'No tiene ningún bloque de pagos (PmtInf).');
	}
	const blockIds = new Set<string>();
	const endToEndIds = new Set<string>();
	let count = 0;
	let total = 0;
	for (const [index, block] of blocks.entries()) {
		const blockId = xmlText(block, 'PmtInfId');
		const where = `Bloque ${blockId || index + 1}`;
		id(where, blockId, 'la referencia del bloque (PmtInfId)');
		if (blockIds.has(blockId)) {
			error(where, 'Hay otro bloque con la misma referencia (PmtInfId).');
		}
		blockIds.add(blockId);
		if (xmlText(block, 'PmtMtd') !== (debit ? 'DD' : 'TRF')) {
			error(where, `El método de pago (PmtMtd) tiene que ser ${debit ? 'DD' : 'TRF'}.`);
		}

		const party = debit ? 'Cdtr' : 'Dbtr';
		name(where, xmlText(block, party, 'Nm'), debit ? 'del acreedor' : 'del ordenante');
		iban(where, xmlText(block, `${party}Acct`, 'Id', 'IBAN'), debit ? 'del acreedor' : 'del ordenante');
		bic(where, xmlChild(block, `${party}Agt`), debit ? 'del acreedor' : 'del ordenante');
		const when = date(where, xmlText(block, debit ? 'ReqdColltnDt' : 'ReqdExctnDt'), debit ? 'La fecha de cargo' : 'La fecha de ejecución');

		const transactions = [...block.children].filter(child => child.localName === (debit ? 'DrctDbtTxInf' : 'CdtTrfTxInf'));
		if (!transactions.length) {
			error(where, 'El bloque no tiene operaciones.');
		}
		let sum = 0;
		if (debit) {
			const sequence = xmlText(block, 'PmtTpInf', 'SeqTp') || xmlText(transactions[0], 'PmtTpInf', 'SeqTp');
			if (!SEQUENCES.includes(sequence)) {
				error(where, `El tipo de secuencia (SeqTp) ${sequence || 'falta'}: tiene que ser FRST, RCUR, OOFF o FNAL.`);
			}
			const scheme = xmlText(block, 'PmtTpInf', 'LclInstrm', 'Cd');
			if (scheme !== 'CORE' && scheme !== 'B2B') {
				warning(where, `El esquema (LclInstrm) es ${scheme || 'ninguno'}: lo normal es CORE.`);
			}
			const creditor = xmlText(block, 'CdtrSchmeId', 'Id', 'PrvtId', 'Othr', 'Id') || xmlText(transactions[0], 'DrctDbtTx', 'CdtrSchmeId', 'Id', 'PrvtId', 'Othr', 'Id');
			const parts = CREDITOR_ID_REGEX.exec(creditor);
			if (!parts) {
				error(where, `El identificador de acreedor (${creditor || 'falta'}) no tiene el formato ES, dos dígitos de control, el sufijo y el NIF.`);
			} else if (creditorId(parts[3], parts[2], parts[1]) !== creditor) {
				error(where, `Los dígitos de control del identificador de acreedor ${creditor} no cuadran: serían ${creditorId(parts[3], parts[2], parts[1]).slice(2, 4)}.`);
			} else if (parts[1] === 'ES' && !isValidNif(parts[3])) {
				warning(where, `El NIF del identificador de acreedor (${parts[3]}) no es válido.`);
			}
		}

		for (const [position, transaction] of transactions.entries()) {
			const endToEndId = xmlText(transaction, 'PmtId', 'EndToEndId');
			const counterpart = debit ? 'Dbtr' : 'Cdtr';
			const who = xmlText(transaction, counterpart, 'Nm');
			const at = `${debit ? 'Adeudo' : 'Transferencia'} ${endToEndId || position + 1}${who ? ` · ${who}` : ''}`;
			id(at, endToEndId, 'la referencia de la operación (EndToEndId)');
			if (endToEndId && endToEndIds.has(endToEndId)) {
				warning(at, 'Su referencia (EndToEndId) está repetida: no se podrán distinguir sus devoluciones.');
			}
			endToEndIds.add(endToEndId);

			const amountNode = debit ? xmlChild(transaction, 'InstdAmt') : xmlChild(transaction, 'Amt', 'InstdAmt');
			const amountText = amountNode?.textContent?.trim() ?? '';
			const cents = sepaCents(amountText);
			if (Number.isNaN(cents)) {
				error(at, `El importe «${amountText}» no es válido: con punto, dos decimales como mucho y hasta 999999999.99.`);
			} else if (cents <= 0) {
				error(at, 'El importe tiene que ser mayor que cero.');
			} else {
				sum += cents;
			}
			if (amountNode && amountNode.getAttribute('Ccy') !== 'EUR') {
				error(at, 'El importe tiene que ser en euros (Ccy="EUR").');
			}

			name(at, who, debit ? 'del deudor' : 'del beneficiario');
			iban(at, xmlText(transaction, `${counterpart}Acct`, 'Id', 'IBAN'), debit ? 'del deudor' : 'del beneficiario');
			bic(at, xmlChild(transaction, `${counterpart}Agt`), debit ? 'del deudor' : 'del beneficiario');
			if (xmlText(transaction, 'RmtInf', 'Ustrd').length > 140) {
				error(at, 'El concepto (Ustrd) pasa de 140 caracteres.');
			}
			if (debit) {
				const mandate = xmlChild(transaction, 'DrctDbtTx', 'MndtRltdInf');
				id(at, xmlText(mandate, 'MndtId'), 'la referencia del mandato (MndtId)');
				const signed = xmlText(mandate, 'DtOfSgntr');
				if (!ISO_DATE_REGEX.test(signed) || parseDate(signed) !== signed) {
					error(at, `La fecha de firma del mandato (${signed || 'vacía'}) no es válida.`);
				} else if (when && signed > when) {
					error(at, `El mandato se firmó (${csvDate(signed)}) después de la fecha de cargo.`);
				}
			}
		}
		totals(where, block, transactions.length, sum);
		count += transactions.length;
		total += sum;
	}
	totals('Cabecera', header, count, total);
	return issues;
}

/* AEAT: records of 500 characters (347, 190 and 184) */

const AEAT_LENGTH = 500;
const AEAT_MODELS = ['347', '190', '184'];
const DIGITS_REGEX = /^\d+$/;
const NOT_AEAT_REGEX = /[^A-Z0-9 ÑÇ]/g;
const LINES_REGEX = /\r?\n/;
const BOM_REGEX = /^\uFEFF/;
const NUL_TAIL_REGEX = /\0.*$/s;

// Positions as the designs number them (from 1, both included) of the fields aeat.ts writes as numbers, and of the
// signs before amounts (blank or N). Type 2 records of the 184 are E (the entity) or S (each member)
const numericFields: Record<string, [number, number][]> = {
	'1': [[5, 8], [59, 67], [108, 120], [123, 135], [136, 144]],
	'2': [[5, 8]],
	'347-1': [[146, 160], [161, 169], [171, 185]],
	'347-2': [[77, 78], [84, 98], [101, 115], [117, 131], [132, 135], ...[0, 1, 2, 3, 4, 5, 6, 7].map((quarter): [number, number] => [137 + quarter * 16, 151 + quarter * 16]), [285, 299], [300, 305]],
	'190-1': [[146, 160], [161, 175]],
	'190-2': [[76, 77], [79, 80], [82, 94], [95, 107], [109, 121], [122, 134], [135, 147], [256, 268], [269, 281], [283, 295], [296, 308], [309, 321]],
	'184-1': [[145, 147], [151, 155], [157, 171], [221, 229]],
	'184-E': [[78, 79], [152, 164], [165, 176], [178, 190], [233, 244], [498, 500]],
	'184-S': [[77, 78], [83, 85], [86, 92], [94, 95], [97, 108], [195, 199], [200, 202]],
};
const signFields: Record<string, number[]> = {
	'347-1': [145, 170],
	'347-2': [83, 116, ...[0, 1, 2, 3, 4, 5, 6, 7].map(quarter => 136 + quarter * 16), 284],
	'190-1': [145],
	'190-2': [81, 108, 255, 282],
	'184-E': [151, 177, 196],
	'184-S': [96, 216],
};

function field(record: string, from: number, to = from) {
	return record.slice(from - 1, to);
}

// An amount with its sign before it, in cents
function signed(record: string, sign: number, to: number) {
	const amount = Number(field(record, sign + 1, to));
	return field(record, sign) === 'N' ? -amount : amount;
}

/**
 * A 347, 190 or 184 as aeatFile makes it: ISO-8859-1, every record of 500 characters, one of type 1 then those of type
 * 2, the model and the year in their place, valid NIFs, numbers where the design has them, the totals of the type 1
 * equal to what the type 2 add up, and the characters the AEAT takes
 */
export function checkAeat(bytes: Uint8Array, today = toDateString(new Date())) {
	const { issues, error, warning } = collector();
	const text = new TextDecoder('windows-1252').decode(bytes);
	// Read as UTF-8 when it is, which only changes it if it has accents, Ñ or Ç
	if (decodeText(bytes) !== text) {
		error(FILE, 'Está en UTF-8 y la AEAT lo lee en ISO-8859-1: las Ñ y Ç saldrían mal.');
	}
	const records = text.split(LINES_REGEX);
	if (records.at(-1) === '') {
		records.pop();
	}
	if (!records.length) {
		error(FILE, 'El fichero está vacío.');
		return issues;
	}

	const model = field(records[0], 2, 4);
	const year = field(records[0], 5, 8);
	const declarant = field(records[0], 9, 17);
	if (!AEAT_MODELS.includes(model)) {
		error('Registro 1', `El modelo ${model.trim() || 'falta'}: solo se comprueban el 347, el 190 y el 184.`);
		return issues;
	}
	if (!DIGITS_REGEX.test(year)) {
		error('Registro 1', `El ejercicio (posiciones 5 a 8) «${year}» no es un año.`);
	} else if (Number(year) >= Number(today.slice(0, 4))) {
		warning('Registro 1', `El ejercicio ${year} aún no ha terminado.`);
	}
	if (!isValidNif(declarant.trim())) {
		error('Registro 1', `El NIF del declarante (${declarant.trim() || 'vacío'}) no es válido.`);
	}

	// Each type 2's amounts, to compare with the type 1. partial when some couldn't be read
	let declared = 0;
	let partial = false;
	const sums = { total: 0, withholding: 0, entities: 0, members: 0 };
	// The 184's income by clave, of the entity and attributed to the members
	const byKey = new Map<string, { entity: number; members: number }>();
	const keyTotals = (key: string) => byKey.get(key) ?? byKey.set(key, { entity: 0, members: 0 }).get(key)!;

	for (const [index, record] of records.entries()) {
		const type = record[0];
		const name = type === '2' ? field(record, 36, 75).trim() : '';
		const where = `Registro ${index + 1}${name ? ` · ${name}` : ''}`;
		if (record.length !== AEAT_LENGTH) {
			error(where, `Tiene ${record.length} caracteres y deben ser ${AEAT_LENGTH}.`);
			partial = true;
			continue;
		}
		if (index === 0 ? type !== '1' : type !== '2') {
			error(where, index === 0 ? 'El primer registro tiene que ser el del declarante (tipo 1).' : `Solo puede haber un registro de tipo 1, este es de tipo ${type}.`);
			partial = true;
			continue;
		}
		if (field(record, 2, 4) !== model || field(record, 5, 8) !== year) {
			error(where, `El modelo o el ejercicio (${field(record, 2, 8)}) no son los del primero (${model}${year}).`);
		}

		const design = type === '1' ? `${model}-1` : model === '184' ? `184-${field(record, 76)}` : `${model}-2`;
		if (model === '184' && type === '2' && !['E', 'S'].includes(field(record, 76))) {
			error(where, `El tipo de registro (posición 76) «${field(record, 76)}» tiene que ser E (la entidad) o S (un comunero).`);
			partial = true;
			continue;
		}
		const wrong = [...numericFields[type], ...numericFields[design]].filter(([from, to]) => !DIGITS_REGEX.test(field(record, from, to)));
		if (wrong.length) {
			error(where, `Debe haber solo cifras en las posiciones ${wrong.map(([from, to]) => `${from}-${to}`).join(', ')}.`);
		}
		const signs = (signFields[design] ?? []).filter(position => ![' ', 'N'].includes(field(record, position)));
		if (signs.length) {
			error(where, `El signo de las posiciones ${signs.join(', ')} tiene que ser N o un espacio.`);
		}
		// The email of the 190's contact may have its own characters
		const plain = design === '190-1' ? field(record, 1, 175) + field(record, 226, 500) : record;
		const odd = [...new Set(plain.match(NOT_AEAT_REGEX))];
		if (odd.length) {
			warning(where, `Tiene caracteres que la AEAT puede no admitir: ${odd.map(char => `«${char}»`).join(' ')}.`);
		}

		if (type === '1') {
			if (model === '184') {
				const representative = field(record, 172, 180).trim();
				if (!representative) {
					warning(where, 'Falta el NIF del representante (el presidente).');
				} else if (!isValidNif(representative)) {
					error(where, `El NIF del representante (${representative}) no es válido.`);
				}
			}
			continue;
		}

		if (field(record, 9, 17) !== declarant) {
			error(where, 'El NIF del declarante no es el del registro de tipo 1.');
		}
		const nif = field(record, 18, 26).trim();
		// In the 347 a non resident may have none, with their country instead
		if (!(model === '347' && !nif && field(record, 79, 80).trim()) && !isValidNif(nif)) {
			error(where, `El NIF del declarado (${nif || 'vacío'}) no es válido.`);
		}
		declared++;
		if (model === '184') {
			sums[field(record, 76) === 'E' ? 'entities' : 'members']++;
		}
		if (wrong.length || signs.length) {
			partial = true;
			continue;
		}
		if (model === '347') {
			sums.total += signed(record, 83, 98);
		} else if (model === '190') {
			// Dinerarias and en especie, with those of incapacidad laboral
			sums.total += signed(record, 81, 94) + signed(record, 108, 121) + signed(record, 255, 268) + signed(record, 282, 295);
			sums.withholding += [[95, 107], [122, 134], [269, 281], [296, 308]].reduce((sum, [from, to]) => sum + Number(field(record, from, to)), 0);
		} else if (field(record, 76) === 'E') {
			const key = field(record, 77);
			keyTotals(key).entity += key === 'K' ? Number(field(record, 233, 244)) : signed(record, 151, 164);
		} else {
			keyTotals(field(record, 93)).members += signed(record, 96, 108);
		}
	}

	// The totals only add up once every record can be read
	const head = records[0];
	if (partial || head.length !== AEAT_LENGTH || head[0] !== '1' || [...numericFields[1], ...numericFields[`${model}-1`]].some(([from, to]) => !DIGITS_REGEX.test(field(head, from, to)))) {
		return issues;
	}
	const totalsError = (message: string) => error('Registro 1', message);
	if (model === '184') {
		if (Number(field(head, 136, 144)) !== sums.members) {
			totalsError(`Dice tener ${Number(field(head, 136, 144))} registros de comuneros (S) y tiene ${sums.members}.`);
		}
		if (Number(field(head, 221, 229)) !== sums.entities) {
			totalsError(`Dice tener ${Number(field(head, 221, 229))} registros de la entidad (E) y tiene ${sums.entities}.`);
		}
		for (const [key, { entity, members }] of byKey) {
			if (entity !== members) {
				warning(FILE, `En la clave ${key} la entidad declara ${formatCents(entity)} y a los comuneros se les atribuyen ${formatCents(members)}: falta alguno sin NIF o el reparto no cuadra.`);
			}
		}
		return issues;
	}
	if (Number(field(head, 136, 144)) !== declared) {
		totalsError(`Dice tener ${Number(field(head, 136, 144))} declarados y tiene ${declared}.`);
	}
	if (signed(head, 145, 160) !== sums.total) {
		totalsError(`El importe total (${formatCents(signed(head, 145, 160))}) no es la suma de los declarados, ${formatCents(sums.total)}.`);
	}
	if (model === '190' && Number(field(head, 161, 175)) !== sums.withholding) {
		totalsError(`El total de retenciones (${formatCents(Number(field(head, 161, 175)))}) no es la suma de los declarados, ${formatCents(sums.withholding)}.`);
	}
	return issues;
}

/* Journal: ContaPlus' XDiario and the CSV, each entry has to balance */

interface JournalLine {
	entry: string;
	where: string;
	debit: number;
	credit: number;
}

function unbalanced(lines: JournalLine[]) {
	const { issues, error, warning } = collector();
	if (!lines.length) {
		warning(FILE, 'No tiene ningún apunte.');
	}
	for (const [entry, group] of Map.groupBy(lines, line => line.entry)) {
		const debit = group.reduce((sum, line) => sum + line.debit, 0);
		const credit = group.reduce((sum, line) => sum + line.credit, 0);
		if (debit !== credit) {
			error(group[0].where, `El asiento ${entry} no cuadra: debe ${formatCents(debit)} y haber ${formatCents(credit)}.`);
		}
	}
	return issues;
}

const SUBACCOUNT_REGEX = /^\d{8}$/;

// The XDiario.dbf table (dBase III) as exchange.ts writes it, read back field by field
export function checkXdiario(bytes: Uint8Array) {
	const { issues, error, warning } = collector();
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const latin1 = new TextDecoder('windows-1252');
	if (bytes.length < 33 || bytes[0] !== 0x03) {
		error(FILE, 'No es una tabla dBase como el XDiario de ContaPlus.');
		return issues;
	}
	const count = view.getUint32(4, true);
	const headerLength = view.getUint16(8, true);
	const recordLength = view.getUint16(10, true);
	const fields = new Map<string, { start: number; length: number }>();
	for (let offset = 32, start = 1; offset + 32 <= headerLength && bytes[offset] !== 0x0D; offset += 32) {
		fields.set(latin1.decode(bytes.subarray(offset, offset + 11)).replace(NUL_TAIL_REGEX, ''), { start, length: bytes[offset + 16] });
		start += bytes[offset + 16];
	}
	const [debitField, creditField] = fields.has('EURODEBE') ? ['EURODEBE', 'EUROHABER'] : ['PTADEBE', 'PTAHABER'];
	if (!fields.has('ASIEN') || !fields.has(debitField) || !fields.has(creditField)) {
		error(FILE, 'No tiene las columnas ASIEN, EURODEBE y EUROHABER del XDiario.');
		return issues;
	}
	if (headerLength + count * recordLength > bytes.length) {
		error(FILE, `Está cortado: dice tener ${count} apuntes y no caben.`);
		return issues;
	}

	const lines: JournalLine[] = [];
	const odd = new Set<string>();
	for (let index = 0; index < count; index++) {
		const offset = headerLength + index * recordLength;
		// Deleted
		if (bytes[offset] === 0x2A) {
			continue;
		}
		const read = (name: string) => {
			const position = fields.get(name);
			return position ? latin1.decode(bytes.subarray(offset + position.start, offset + position.start + position.length)).trim() : '';
		};
		const entry = read('ASIEN');
		const date = read('FECHA');
		const where = `Asiento ${entry}${date ? ` · ${date.slice(6)}/${date.slice(4, 6)}/${date.slice(0, 4)}` : ''}${read('CONCEPTO') ? ` · ${read('CONCEPTO')}` : ''}`;
		const debit = read(debitField) ? toCents(read(debitField)) : 0;
		const credit = read(creditField) ? toCents(read(creditField)) : 0;
		if (Number.isNaN(debit) || Number.isNaN(credit)) {
			error(where, `El apunte ${index + 1} tiene un importe que no es un número.`);
			continue;
		}
		if (!date || parseDate(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`) === '') {
			error(where, `La fecha del apunte ${index + 1} (${date || 'vacía'}) no es válida.`);
		}
		if (!SUBACCOUNT_REGEX.test(read('SUBCTA'))) {
			odd.add(read('SUBCTA'));
		}
		lines.push({ entry, where, debit, credit });
	}
	if (odd.size) {
		warning(FILE, `Subcuentas que no tienen 8 dígitos, el nivel por defecto de ContaPlus: ${[...odd].slice(0, 5).join(', ')}${odd.size > 5 ? '…' : ''}.`);
	}
	return [...issues, ...unbalanced(lines)];
}

// The journal as a CSV with the columns Asiento, Debe and Haber (the one ExchangePage exports, or another program's)
export function checkJournalCsv(content: string) {
	const [header = [], ...rows] = parseCsv(content.replace(BOM_REGEX, ''));
	const names = header.map(canonical);
	const column = (name: string) => names.findIndex(cell => cell.includes(name));
	const [entry, debit, credit, date, concept] = ['ASIENTO', 'DEBE', 'HABER', 'FECHA', 'CONCEPTO'].map(column);
	if (entry === -1 || debit === -1 || credit === -1) {
		return [{ level: 'error', where: FILE, message: 'No tiene las columnas Asiento, Debe y Haber.' } satisfies FileIssue];
	}
	const { issues, error } = collector();
	const lines = rows.flatMap((cells, index): JournalLine[] => {
		const where = `Asiento ${cells[entry]}${date === -1 ? '' : ` · ${cells[date]}`}${concept === -1 ? '' : ` · ${cells[concept]}`}`;
		const amounts = [debit, credit].map(position => cells[position] ? toCents(cells[position]) : 0);
		if (amounts.some(Number.isNaN)) {
			error(where, `La fila ${index + 2} tiene un importe que no es un número.`);
			return [];
		}
		return [{ entry: cells[entry], where, debit: amounts[0], credit: amounts[1] }];
	});
	return [...issues, ...unbalanced(lines)];
}

/* Any file, from here or another program */

const AEAT_HEAD_REGEX = /^1(?:347|190|184)\d{4}/;

export type FileKind = 'sepa' | 'aeat' | 'journal';

// Works out what kind of file it is and checks it. label is what it was taken for, to show it
export function checkFile(bytes: Uint8Array, today = toDateString(new Date())): { kind?: FileKind; label: string; issues: FileIssue[] } {
	const text = decodeText(bytes);
	const start = text.replace(BOM_REGEX, '').trimStart();
	if (start.startsWith('<')) {
		const label = start.includes('pain.008') ? 'Remesa de adeudos SEPA (pain.008)' : start.includes('pain.001') ? 'Transferencias SEPA (pain.001)' : 'XML';
		return { kind: 'sepa', label, issues: checkSepa(text, today) };
	}
	if (AEAT_HEAD_REGEX.test(start)) {
		return { kind: 'aeat', label: `Modelo ${start.slice(1, 4)} de la AEAT`, issues: checkAeat(bytes, today) };
	}
	if (bytes[0] === 0x03) {
		return { kind: 'journal', label: 'Diario de ContaPlus (XDiario.dbf)', issues: checkXdiario(bytes) };
	}
	const firstLine = canonical(start.split('\n', 1)[0]);
	if (firstLine.includes('ASIENTO') && firstLine.includes('DEBE')) {
		return { kind: 'journal', label: 'Libro diario (CSV)', issues: checkJournalCsv(start) };
	}
	return { label: 'Desconocido', issues: [{ level: 'error', where: FILE, message: 'No parece una remesa o una orden SEPA (pain.008, pain.001), un modelo 347, 190 o 184 de la AEAT ni un diario de ContaPlus.' }] };
}
