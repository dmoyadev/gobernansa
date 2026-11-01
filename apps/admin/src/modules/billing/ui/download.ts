export function downloadXml(name: string, xml: string) {
	const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
	Object.assign(document.createElement('a'), { href: url, download: name }).click();
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
