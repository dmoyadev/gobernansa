const SPACES_AND_SYMBOL_REGEX = /[\s€]/g;
const THOUSANDS_DOTS_REGEX = /\./g;
const AMOUNT_REGEX = /^-?\d+(?:\.\d{1,2})?$/;
// "12.000" or "1.250.000": dots grouping thousands, as amounts are written in Spain
const THOUSANDS_ONLY_REGEX = /^-?\d{1,3}(?:\.\d{3})+$/;

// Amounts are stored in cents, so sums and splits don't drift with floating point
const euros = new Intl.NumberFormat('es', { style: 'currency', currency: 'EUR' });

export function formatCents(cents: number) {
	return euros.format(cents / 100);
}

// From what's typed in an input, e.g. "1.234,5", "12.000" or "1234.50". NaN when it isn't an amount
export function toCents(text: string) {
	const normalized = text.trim().replace(SPACES_AND_SYMBOL_REGEX, '');
	const decimal = normalized.includes(',') || THOUSANDS_ONLY_REGEX.test(normalized)
		? normalized.replace(THOUSANDS_DOTS_REGEX, '').replace(',', '.')
		: normalized;
	return AMOUNT_REGEX.test(decimal) ? Math.round(Number(decimal) * 100) : Number.NaN;
}
