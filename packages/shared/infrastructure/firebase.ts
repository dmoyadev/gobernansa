import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';

const firebaseApp = initializeApp({
	apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
	authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
	projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
	storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string,
	messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
	appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
	measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID as string,
});

const emulators = import.meta.env.VITE_FIREBASE_EMULATORS === 'true';
const auth = getAuth(firebaseApp);
// Kept in the browser, so the installed app shows the last data without a connection, and listeners opened again within
// 30 minutes only read what changed. Not with the emulators: their data is reset, and the live project's would mix with it
const db = initializeFirestore(firebaseApp, emulators ? {} : { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

// Both or neither: emulator auth tokens are rejected by the real Firestore
if (emulators) {
	connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
	connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

// B7: only our pages get a token, so a script with the public config can't spend the quota once the console enforces it.
// Measured first, enforced later, both from the console. In development the SDK logs a debug token to allow there
const appCheckKey = import.meta.env.VITE_APP_CHECK_KEY as string | undefined;
if (appCheckKey && !emulators) {
	if (import.meta.env.DEV) {
		(globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
	}
	initializeAppCheck(firebaseApp, { provider: new ReCaptchaEnterpriseProvider(appCheckKey), isTokenAutoRefreshEnabled: true });
}

export {
	auth,
	db,
	firebaseApp,
};
