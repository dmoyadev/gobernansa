import {
	sendSignInLinkToEmail,
	isSignInWithEmailLink,
	signInWithEmailLink,
	signOut,
} from 'firebase/auth';
import { useCurrentUser } from 'vuefire';
import { auth } from '../../../utils/firebase';

export default function useAuth() {
	const user = useCurrentUser();

	async function sendMagicLink(email: string) {
		const actionCodeSettings = {
			url: window.location.origin + '/login' + window.location.search,
			handleCodeInApp: true,
		};

		await sendSignInLinkToEmail(auth, email, actionCodeSettings);

		localStorage.setItem('user', email);
	}

	async function completeMagicLink() {
		const url = window.location.href;

		if (isSignInWithEmailLink(auth, url)) {
			let email = localStorage.getItem('user');
			if (!email) {
				return;
			}

			await signInWithEmailLink(auth, email, url);
			localStorage.removeItem('user');
		}
	}

	async function logout() {
		await signOut(auth);
	}

	return {
		user,
		sendMagicLink,
		completeMagicLink,
		logout,
	};
}