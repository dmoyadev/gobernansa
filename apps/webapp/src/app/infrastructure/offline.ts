import { online } from '@gobernansa/shared/application/pwa.ts';
import { reportError } from '@gobernansa/shared/infrastructure/monitoring.ts';

const WAIT_MS = 6000;

export const QUEUED_MESSAGE = 'Se enviará cuando vuelvas a tener conexión.';

/**
 * Firestore shows a write at once and keeps it until it reaches the server, but its promise only settles then: without a
 * connection a button would spin until it's back. Offline, or with no answer in a few seconds (a wifi with no internet),
 * it's taken as sent and true says it's still waiting. A failure after that is only reported.
 */
export async function sendWrite(write: Promise<unknown>, action: string) {
	const waiting = online.value ? new Promise<boolean>(resolve => setTimeout(resolve, WAIT_MS, true)) : Promise.resolve(true);
	const queued = await Promise.race([write.then(() => false), waiting]);
	if (queued) {
		write.catch((error: unknown) => reportError(error, { action }));
	}
	return queued;
}

/**
 * For what only counts once the server has it (votes, signatures, bookings, payments): offline it fails at once, with the
 * code errorMessage reads as no connection, instead of waiting for one
 */
export function requireOnline() {
	if (!online.value) {
		throw Object.assign(new Error('Offline'), { code: 'unavailable' });
	}
}
