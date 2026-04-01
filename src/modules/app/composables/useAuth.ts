import type { DocumentReference } from 'firebase/firestore';
import {
	isSignInWithEmailLink,
	sendSignInLinkToEmail,
	signInWithEmailLink,
	signOut,
} from 'firebase/auth';
import { doc } from 'firebase/firestore';
import { ref, watchEffect } from 'vue';
import { useRouter } from 'vue-router';
import { useCurrentUser, useDocument } from 'vuefire';
import { auth, db } from '../../../utils/firebase';

export interface User {
	email: string;
	role: 'admin' | 'manager' | 'user';
	communityId: string;
	name: string;
}

export default function useAuth() {
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

	const router = useRouter();
	async function logout() {
		await signOut(auth);
		userRef.value = undefined;
		await router.push('/logout');
	}

	return {
		user: userData,
		sendMagicLink,
		completeMagicLink,
		logout,
	};
}
