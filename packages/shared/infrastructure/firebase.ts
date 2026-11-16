import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { browserLocalPersistence, browserSessionPersistence, connectAuthEmulator, indexedDBLocalPersistence, initializeAuth } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

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
// As getAuth() but without Google's sign-in popups, which no page uses: with them, phones load apis.google.com and an iframe
// on start, which hangs the first screen without internet (npm run demo)
const auth = initializeAuth(firebaseApp, { persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence] });
// Kept in the browser, so the installed app shows the last data without a connection, and listeners opened again within
// 30 minutes only read what changed. Not with the emulators: their data is reset, and the live project's would mix with it
const db = initializeFirestore(firebaseApp, emulators ? {} : { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

// Photos and videos of issues and work orders. Needs Firebase's paid plan in the real project (docs/firebase.md)
const storage = getStorage(firebaseApp);

/*
 * Where an emulator listens. In development, straight to it. In the local demo (npm run demo, scripts/demo.js) the page is
 * served over http on the laptop's network address, and its own server forwards the emulators' paths to them: that way
 * phones on the same wifi reach them too, whatever the address is that day
 */
function emulatorAt(port: number) {
	return location.protocol === 'http:'
		? { host: location.hostname, port: Number(location.port) || 80 }
		: { host: '127.0.0.1', port };
}

// All or none: emulator auth tokens are rejected by the real Firestore and Storage
if (emulators) {
	const authAt = emulatorAt(9099);
	connectAuthEmulator(auth, `http://${authAt.host}:${authAt.port}`, { disableWarnings: true });
	connectFirestoreEmulator(db, emulatorAt(8080).host, emulatorAt(8080).port);
	connectStorageEmulator(storage, emulatorAt(9199).host, emulatorAt(9199).port);
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
	emulatorAt,
	emulators,
	firebaseApp,
	storage,
};
