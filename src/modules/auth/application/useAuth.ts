import type { DocumentReference } from 'firebase/firestore';
import type { User } from '../domain/user.ts';
import {
	isSignInWithEmailLink,
	sendSignInLinkToEmail,
	signInWithEmailAndPassword,
	signInWithEmailLink,
	signOut,
	updatePassword,
} from 'firebase/auth';
import { doc } from 'firebase/firestore';
import { effectScope, ref, watchEffect } from 'vue';
import { useCurrentUser, useDocument } from 'vuefire';
import router from '@/app/router.ts';
import { auth, db } from '@/shared/infrastructure/firebase.ts';

// Shared by every caller so the user document is listened to only once
let shared: ReturnType<typeof createAuth> | undefined;

export default function useAuth() {
	shared ??= effectScope(true).run(createAuth)!;
	return shared;
}

function createAuth() {
	const user = useCurrentUser();
	const userRef = ref<DocumentReference>();
	const userData = useDocument<User>(userRef);

	async function sendMagicLink(email: string) {
		const actionCodeSettings = {
			url: `${window.location.origin}/login${window.location.search}`,
			handleCodeInApp: true,
		};

		await sendSignInLinkToEmail(auth, email, actionCodeSettings);
		localStorage.setItem('user', email);
	}

	async function completeMagicLink() {
		const url = window.location.href;

		if (isSignInWithEmailLink(auth, url)) {
			const email = localStorage.getItem('user');
			if (!email) {
				return;
			}

			const result = await signInWithEmailLink(auth, email, url);
			localStorage.removeItem('user');

			if (result.user?.uid) {
				userRef.value = doc(db, 'users', result.user.uid);
			}
		}
	}

	watchEffect(() => {
		if (user.value?.uid) {
			userRef.value = doc(db, 'users', user.value.uid);
		} else {
			userRef.value = undefined;
		}
	});

	// Fallback for when the daily quota of sign-in emails runs out
	async function signInWithPassword(email: string, password: string) {
		await signInWithEmailAndPassword(auth, email, password);
	}

	// Firebase asks to have signed in recently (auth/requires-recent-login) to change it
	async function changePassword(password: string) {
		if (!auth.currentUser) {
			throw new Error('The user must be signed in to change the password');
		}

		await updatePassword(auth.currentUser, password);
	}

	async function logout() {
		await signOut(auth);
		userRef.value = undefined;
		await router.push('/logout');
	}

	return {
		user: userData,
		sendMagicLink,
		completeMagicLink,
		signInWithPassword,
		changePassword,
		logout,
	};
}
