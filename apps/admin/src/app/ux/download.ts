// Saves a file made in the browser (SEPA, AEAT, Norma 43, CSV, Verifactu XML…): nothing is uploaded anywhere
export function downloadFile(name: string, content: BlobPart, type: string) {
	const url = URL.createObjectURL(new Blob([content], { type }));
	Object.assign(document.createElement('a'), { href: url, download: name }).click();
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// CRC-32 of the zip format, its table made once
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) {
		c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
	}
	return c >>> 0;
});

function crc32(bytes: Uint8Array) {
	let crc = 0xFFFFFFFF;
	for (const byte of bytes) {
		crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
	}
	return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * A zip of text files, stored without compressing: any system opens it, and readXlsx (utils/xlsx.ts) reads it back.
 * ponytail: under 4 GB and 65,535 files, no zip64
 */
export function zip(files: Record<string, string>) {
	const encoder = new TextEncoder();
	const parts: Uint8Array[] = [];
	const directory: Uint8Array[] = [];
	let offset = 0;
	for (const [name, text] of Object.entries(files)) {
		const nameBytes = encoder.encode(name);
		const data = encoder.encode(text);
		const crc = crc32(data);
		// Shared by the local header (from its version needed) and the directory entry; bit 11 says names are UTF-8
		const common = (view: DataView, at: number) => {
			view.setUint16(at, 20, true);
			view.setUint16(at + 2, 0x0800, true);
			// 1 January 1980, the first date the format has
			view.setUint16(at + 8, 0x21, true);
			view.setUint32(at + 10, crc, true);
			view.setUint32(at + 14, data.length, true);
			view.setUint32(at + 18, data.length, true);
			view.setUint16(at + 22, nameBytes.length, true);
		};
		const local = new Uint8Array(30 + nameBytes.length);
		const localView = new DataView(local.buffer);
		localView.setUint32(0, 0x04034B50, true);
		common(localView, 4);
		local.set(nameBytes, 30);
		const entry = new Uint8Array(46 + nameBytes.length);
		const entryView = new DataView(entry.buffer);
		entryView.setUint32(0, 0x02014B50, true);
		entryView.setUint16(4, 20, true);
		common(entryView, 6);
		entryView.setUint32(42, offset, true);
		entry.set(nameBytes, 46);
		parts.push(local, data);
		directory.push(entry);
		offset += local.length + data.length;
	}
	const size = directory.reduce((total, entry) => total + entry.length, 0);
	const end = new DataView(new ArrayBuffer(22));
	end.setUint32(0, 0x06054B50, true);
	end.setUint16(8, directory.length, true);
	end.setUint16(10, directory.length, true);
	end.setUint32(12, size, true);
	end.setUint32(16, offset, true);
	return new Blob([...parts, ...directory, end.buffer] as BlobPart[], { type: 'application/zip' });
}
