import { emulatorAt, emulators, firebaseApp } from '@gobernansa/shared/infrastructure/firebase.ts';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';

// The functions' region, REGION in apps/functions/index.js: Firestore's triggers run in the database's
const REGION = 'europe-southwest1';

const functions = getFunctions(firebaseApp, REGION);

// The local demo (npm run demo, served over http) runs no functions: nothing is recorded there and nothing can be restored.
// In development (https) they're in the emulators with the rest
export const hasFunctions = !emulators || location.protocol === 'https:';
if (emulators && hasFunctions) {
	const { host, port } = emulatorAt(5505);
	connectFunctionsEmulator(functions, host, port);
}

// Puts a document back as it was before or after a change of the Historial (restoreVersion in apps/functions/index.js)
export const restoreVersion = httpsCallable<{ auditId: string; side: 'before' | 'after' }, { path: string; deleted: boolean }>(functions, 'restoreVersion');
