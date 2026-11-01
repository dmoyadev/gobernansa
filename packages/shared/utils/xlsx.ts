// Excel workbooks (.xlsx) read in the browser without a library: a zip of XML files, unzipped with DecompressionStream
// and parsed with DOMParser. Each sheet comes as rows of cells as Excel shows them, like a CSV saved from it

export interface Sheet {
	name: string;
	// Row 1 first, empty rows as [] so each one's index is its row number minus one
	rows: string[][];
}

const ZIP_END = 0x06054B50;
const ZIP_ENTRY = 0x02014B50;
const COLUMN_REGEX = /^[A-Z]+/;
// Day and year tokens of a number format once its literals ("…", \x and [colour]) are out: a date
const FORMAT_LITERALS_REGEX = /"[^"]*"|\\.|\[[^\]]*\]/g;
const DATE_TOKENS_REGEX = /[dy]/i;
// Built-in formats: 9 and 10 are percentages, 14 to 17 and 22 dates (18 to 21 are times)
const PERCENT_FORMATS = new Set([9, 10]);
const DATE_FORMATS = new Set([14, 15, 16, 17, 22]);
// Day 0 of Excel's dates, which counts 1900 as a leap year as Lotus did
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

// The files of the zip by name, inflated when read. Its central directory, at the end, says where each one is
function unzip(buffer: ArrayBuffer) {
	const view = new DataView(buffer);
	let end = buffer.byteLength - 22;
	while (end >= 0 && view.getUint32(end, true) !== ZIP_END) {
		end--;
	}
	if (end < 0) {
		throw new Error('no es un .xlsx válido');
	}

	const names = new TextDecoder();
	const files = new Map<string, () => Promise<string>>();
	let offset = view.getUint32(end + 16, true);
	for (let count = view.getUint16(end + 10, true); count > 0 && view.getUint32(offset, true) === ZIP_ENTRY; count--) {
		const method = view.getUint16(offset + 10, true);
		const size = view.getUint32(offset + 20, true);
		const nameLength = view.getUint16(offset + 28, true);
		const local = view.getUint32(offset + 42, true);
		const name = names.decode(new Uint8Array(buffer, offset + 46, nameLength));
		files.set(name, async () => {
			// The local header repeats the name, and may have another extra field than the directory
			const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
			const data = new Blob([new Uint8Array(buffer, start, size)]);
			// 0 is stored, 8 deflated
			return method === 8 ? new Response(data.stream().pipeThrough(new DecompressionStream('deflate-raw'))).text() : data.text();
		});
		offset += 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
	}
	return files;
}

// Elements by their local name, as some programs write them with a prefix (x:row)
function children(parent: Document | Element, name: string) {
	return Array.from(parent.getElementsByTagNameNS('*', name));
}

// A string item: plain or rich text (runs), without the phonetic guides of Japanese
function text(item?: Element) {
	return item ? children(item, 't').filter(t => t.parentElement?.localName !== 'rPh').map(t => t.textContent).join('') : '';
}

// A as 0, Z as 25, AA as 26…
export function columnIndex(reference: string) {
	return [...(COLUMN_REGEX.exec(reference)?.[0] ?? '')].reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

export function columnLetter(index: number): string {
	return (index >= 26 ? columnLetter(Math.floor(index / 26) - 1) : '') + String.fromCharCode(65 + index % 26);
}

export async function readXlsx(buffer: ArrayBuffer): Promise<Sheet[]> {
	const files = unzip(buffer);
	const parser = new DOMParser();
	const xml = async (path: string) => {
		const read = files.get(path);
		return read ? parser.parseFromString(await read(), 'application/xml') : undefined;
	};

	const workbook = await xml('xl/workbook.xml');
	if (!workbook) {
		throw new Error('no es un .xlsx válido');
	}
	// Targets are relative to xl/, or absolute from the root of the zip
	const targets = new Map(children(await xml('xl/_rels/workbook.xml.rels') ?? workbook, 'Relationship').map((relationship) => {
		const target = relationship.getAttribute('Target') ?? '';
		return [relationship.getAttribute('Id'), { type: relationship.getAttribute('Type') ?? '', path: target.startsWith('/') ? target.slice(1) : `xl/${target}` }];
	}));
	const pathOf = (type: string) => [...targets.values()].find(target => target.type.endsWith(`/${type}`))?.path ?? `xl/${type}.xml`;

	const shared = children(await xml(pathOf('sharedStrings')) ?? workbook, 'si').map(text);

	// Percentages and dates are stored as numbers, their style says how they're shown
	const styles = await xml(pathOf('styles'));
	const formats = new Map(children(styles ?? workbook, 'numFmt').map(format => [Number(format.getAttribute('numFmtId')), format.getAttribute('formatCode') ?? '']));
	const cellFormats = children(children(styles ?? workbook, 'cellXfs')[0] ?? workbook, 'xf').map((xf) => {
		const id = Number(xf.getAttribute('numFmtId'));
		const code = (formats.get(id) ?? '').replace(FORMAT_LITERALS_REGEX, '');
		return PERCENT_FORMATS.has(id) || code.includes('%') ? 'percent' : DATE_FORMATS.has(id) || DATE_TOKENS_REGEX.test(code) ? 'date' : undefined;
	});

	function value(cell: Element) {
		const type = cell.getAttribute('t');
		const raw = children(cell, 'v')[0]?.textContent ?? '';
		if (type === 's') {
			return shared[Number(raw)] ?? '';
		}
		if (type === 'inlineStr') {
			return text(children(cell, 'is')[0]);
		}
		if (type === 'b') {
			return raw === '1' ? 'VERDADERO' : 'FALSO';
		}
		const number = Number(raw);
		const format = type && type !== 'n' ? undefined : cellFormats[Number(cell.getAttribute('s') ?? 0)];
		if (!raw || Number.isNaN(number) || !format) {
			return raw;
		}
		// '3.25 %' and '2019-03-15', which the census reads as typed
		return format === 'percent'
			? `${Number((number * 100).toPrecision(12))} %`
			: new Date(EXCEL_EPOCH + Math.round(number * DAY_MS)).toISOString().slice(0, 10);
	}

	return Promise.all(children(workbook, 'sheet').map(async (sheet) => {
		// Its r:id, whatever the prefix of the relationships' namespace
		const id = Array.from(sheet.attributes).find(attribute => attribute.localName === 'id')?.value;
		const document = await xml(targets.get(id ?? null)?.path ?? '');
		const rows: string[][] = [];
		for (const row of document ? children(document, 'row') : []) {
			const cells: string[] = [];
			for (const cell of children(row, 'c')) {
				const reference = cell.getAttribute('r');
				cells[reference ? columnIndex(reference) : cells.length] = value(cell).trim();
			}
			// Rows only styled, or past the data, are left out instead of making the sheet that long
			if (cells.some(Boolean)) {
				const number = Number(row.getAttribute('r')) || rows.length + 1;
				while (rows.length < number - 1) {
					rows.push([]);
				}
				rows.push(Array.from(cells, cell => cell ?? ''));
			}
		}
		return { name: sheet.getAttribute('name') ?? '', rows };
	}));
}
