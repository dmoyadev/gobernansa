import { URGENT_CODES } from '@gobernansa/shared/domain/errors.ts';
import { db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { quotaExhausted, reportError } from '@gobernansa/shared/infrastructure/monitoring.ts';
import { and, collection, getCountFromServer, or, query, where } from 'firebase/firestore';
import { ref } from 'vue';

/*
 * Avisos de errores (MON-9 option A, docs/fiabilidad.md): how many groups ask for the team's attention, for the header.
 * The urgent pending ones and the resolved ones seen again, as the Errores page puts first. One count (a read per 1,000
 * groups) on opening and every hour, only for the team. Equality filters only, served by Firestore's single-field indexes
 */

const EVERY_MS = 60 * 60 * 1000;

export const errorAlerts = ref(0);

let timer: ReturnType<typeof setInterval> | undefined;

export async function countErrorAlerts() {
	if (quotaExhausted.value) {
		return;
	}
	try {
		const snapshot = await getCountFromServer(query(collection(db, 'errors'), or(
			and(where('status', '==', 'new'), where('code', 'in', URGENT_CODES)),
			and(where('status', '==', 'resolved'), where('seenSinceResolved', '==', true)),
		)));
		errorAlerts.value = snapshot.data().count;
	} catch (error) {
		reportError(error, { action: 'No se han podido contar los errores nuevos' });
	}
}

export function watchErrorAlerts(on: boolean) {
	clearInterval(timer);
	timer = undefined;
	errorAlerts.value = 0;
	if (on) {
		void countErrorAlerts();
		timer = setInterval(() => void countErrorAlerts(), EVERY_MS);
	}
}
