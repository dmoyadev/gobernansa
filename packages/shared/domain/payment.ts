import type { Timestamp } from 'firebase/firestore';

/*
 * Pagos online de los vecinos. Only in test mode for now: no money moves and nothing is sent anywhere, the checkout
 * takes the card networks' public test cards. A real gateway (e.g. Redsys or Stripe Connect) would replace
 * checkTestCard() with its own form and confirm the payment from its server
 */

export type OnlinePaymentMethod = 'card' | 'bizum';

export const onlinePaymentMethods: Record<OnlinePaymentMethod, string> = {
	card: 'Tarjeta',
	bizum: 'Bizum',
};

// At communities/{communityId}/payments, one per payment made from the neighbours' app, for a charge or a booking
export interface Payment {
	id: string;
	communityId: string;
	mode: 'test';
	method: OnlinePaymentMethod;
	// For a charge, what was left of it after any entregas a cuenta
	amount: number;
	uid: string;
	chargeId?: string;
	bookingId?: string;
	// Never the card number: only what a receipt shows
	card?: CardSummary;
	createdAt: Timestamp;
}

export interface CardSummary {
	brand: string;
	last4: string;
}

// What a charge or a booking paid online keeps, the payment's id as the reference
export interface PaymentRef {
	id: string;
	mode: 'test';
	method: OnlinePaymentMethod;
	card?: CardSummary;
}

const NON_DIGITS_REGEX = /\D/g;
const EXPIRY_REGEX = /^(\d{2})\s*\/\s*(\d{2})$/;
const CVC_REGEX = /^\d{3,4}$/;

// The public test cards: the first one is approved, the second one declined by the issuer
export const TEST_CARD = '4242424242424242';
export const DECLINED_CARD = '4000000000000002';

export type CardCheck = { ok: true; card: CardSummary } | { ok: false; error: string };

/**
 * Validates the test checkout's card. Any other number, even a valid one, is turned down without being kept, so a real
 * card can never be charged nor stored. expiry is 'MM/AA'
 */
export function checkTestCard(number: string, expiry: string, cvc: string, now = new Date()): CardCheck {
	const digits = number.replace(NON_DIGITS_REGEX, '');
	if (digits !== TEST_CARD && digits !== DECLINED_CARD) {
		return { ok: false, error: 'En modo de prueba solo se aceptan las tarjetas de prueba, p. ej. 4242 4242 4242 4242.' };
	}

	const [, month, year] = EXPIRY_REGEX.exec(expiry.trim()) ?? [];
	// Valid until the last day of its month
	if (!month || Number(month) < 1 || Number(month) > 12 || new Date(2000 + Number(year), Number(month), 1) <= now) {
		return { ok: false, error: 'La fecha de caducidad no es válida o ya ha pasado.' };
	}
	if (!CVC_REGEX.test(cvc.trim())) {
		return { ok: false, error: 'El CVC son los 3 o 4 dígitos del dorso.' };
	}
	if (digits === DECLINED_CARD) {
		return { ok: false, error: 'Tu banco ha rechazado el pago. Prueba con otra tarjeta.' };
	}
	return { ok: true, card: { brand: 'Visa', last4: digits.slice(-4) } };
}

// e.g. "Tarjeta Visa ···· 4242" or "Bizum"
export function describePayment(payment: Pick<PaymentRef, 'method' | 'card'>) {
	return payment.card ? `${onlinePaymentMethods[payment.method]} ${payment.card.brand} ···· ${payment.card.last4}` : onlinePaymentMethods[payment.method];
}
