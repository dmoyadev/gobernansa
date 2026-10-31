const SPACES_AND_DASHES_REGEX = /[\s.-]/g;
const IBAN_REGEX = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;
const DNI_REGEX = /^\d{8}[A-Z]$/;
const NIE_REGEX = /^[XYZ]\d{7}[A-Z]$/;
const CIF_REGEX = /^[A-HJ-NP-SUVW]\d{7}[0-9A-Z]$/;
const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
const CIF_LETTERS = 'JABCDEFGHI';
// Entities whose control character is always a letter, and those always a digit
const CIF_LETTER_CONTROL = 'NPQRSW';
const CIF_DIGIT_CONTROL = 'ABEH';

// As stored: uppercase without spaces, dots or dashes
export function normalizeTaxId(value: string) {
	return value.replace(SPACES_AND_DASHES_REGEX, '').toUpperCase();
}

export function normalizeIban(value: string) {
	return value.replace(SPACES_AND_DASHES_REGEX, '').toUpperCase();
}

// ISO 13616: the country and check digits moved to the end, letters as numbers (A = 10), and the whole mod 97 is 1
export function isValidIban(value: string) {
	const iban = normalizeIban(value);
	if (!IBAN_REGEX.test(iban) || (iban.startsWith('ES') && iban.length !== 24)) {
		return false;
	}
	const digits = Array.from(iban.slice(4) + iban.slice(0, 4), char => Number.parseInt(char, 36)).join('');
	// In chunks, the number is too big for a double
	let rest = 0;
	for (let start = 0; start < digits.length; start += 7) {
		rest = Number(`${rest}${digits.slice(start, start + 7)}`) % 97;
	}
	return rest === 1;
}

// DNI and NIE (people) or CIF (companies, communities and other entities), with their control character
export function isValidNif(value: string) {
	const nif = normalizeTaxId(value);
	if (DNI_REGEX.test(nif)) {
		return DNI_LETTERS[Number(nif.slice(0, 8)) % 23] === nif[8];
	}
	if (NIE_REGEX.test(nif)) {
		return DNI_LETTERS[Number(`${'XYZ'.indexOf(nif[0])}${nif.slice(1, 8)}`) % 23] === nif[8];
	}
	if (!CIF_REGEX.test(nif)) {
		return false;
	}
	// K, L and M are people without DNI, with its letter over the seven digits
	if ('KLM'.includes(nif[0])) {
		return DNI_LETTERS[Number(nif.slice(1, 8)) % 23] === nif[8];
	}

	// Odd positions are doubled and their digits added, even ones added as they are
	const sum = [...nif.slice(1, 8)].reduce((total, char, index) => {
		const digit = Number(char);
		return total + (index % 2 ? digit : Math.floor(digit * 2 / 10) + (digit * 2) % 10);
	}, 0);
	const control = (10 - sum % 10) % 10;
	const [kind, given] = [nif[0], nif[8]];
	if (CIF_LETTER_CONTROL.includes(kind)) {
		return given === CIF_LETTERS[control];
	}
	if (CIF_DIGIT_CONTROL.includes(kind)) {
		return given === String(control);
	}
	return given === String(control) || given === CIF_LETTERS[control];
}
