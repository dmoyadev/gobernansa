import type { FirebaseApp } from 'firebase/app';
import { initializeApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import { getAuth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';

let firebaseApp: FirebaseApp;
let auth: Auth;
let db: Firestore;

try {
	firebaseApp = initializeApp({
		apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
		authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
		databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL as string,
		projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
		storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string,
		messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
		appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
		measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID as string,
	});

	auth = getAuth(firebaseApp);
	db = getFirestore(firebaseApp);
} catch (error) {
	console.error('🔴 Something went wrong: ', error);
}

export {
	firebaseApp,
	auth,
	db,
};
