import type { User as AuthUser } from 'firebase/auth';
import type { DocumentReference } from 'firebase/firestore';
import type { Invitation, User } from '../domain/user.ts';
import {
	isSignInWithEmailLink,
	sendSignInLinkToEmail,
	signInWithEmailAndPassword,
	signInWithEmailLink,
	signOut,
	updatePassword,
} from 'firebase/auth';
import { doc, getDoc, writeBatch } from 'firebase/firestore';
import { effectScope, ref, watch, watchEffect } from 'vue';
import { useCurrentUser, useDocument } from 'vuefire';
import { auth, db } from '../infrastructure/firebase.ts';

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

	// Without a profile, it's their first sign-in: the profile is created from the invitation sent to their email, if there's one
	watch(() => !!userRef.value && !userData.pending.value && userData.value === null, async (withoutProfile) => {
		if (withoutProfile && user.value) {
			// eslint-disable-next-line no-console
			await acceptInvitation(user.value).catch(console.error);
		}
	});

	async function acceptInvitation({ uid, email, emailVerified }: AuthUser) {
		// The rules only take verified emails, which sign-in links are
		if (!email || !emailVerified) {
			return;
		}

		const invitationRef = doc(db, 'invitations', email);
		const invitation = await getDoc(invitationRef);
		if (!invitation.exists()) {
			return;
		}

		const { name, role, communityId, communityIds } = invitation.data() as Invitation;
		const batch = writeBatch(db);
		batch.set(doc(db, 'users', uid), { email, name, role, communityId, ...(communityIds ? { communityIds } : {}) });
		batch.delete(invitationRef);
		// The profile is listened to, so it shows up by itself
		await batch.commit();
	}

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
		// A full reload, so nothing from the previous user stays in memory. Each app has its own /login
		window.location.assign('/login');
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
