// Saves a file made in the browser (SEPA, AEAT, Norma 43, CSV, Verifactu XML…): nothing is uploaded anywhere
export function downloadFile(name: string, content: BlobPart, type: string) {
	const url = URL.createObjectURL(new Blob([content], { type }));
	Object.assign(document.createElement('a'), { href: url, download: name }).click();
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
