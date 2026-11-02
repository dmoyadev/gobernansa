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
import { clearIndexedDbPersistence, doc, getDoc, terminate, writeBatch } from 'firebase/firestore';
import { computed, effectScope, ref, watch, watchEffect } from 'vue';
import { useCurrentUser, useDocument } from 'vuefire';
import { managesCommunity } from '../domain/user.ts';
import { auth, db } from '../infrastructure/firebase.ts';
import { reportError } from '../infrastructure/monitoring.ts';

const VIEW_AS_KEY = 'viewAs';

// Shared by every caller so the user document is listened to only once
let shared: ReturnType<typeof createAuth> | undefined;

export default function useAuth() {
	shared ??= effectScope(true).run(createAuth)!;
	return shared;
}

function createAuth() {
	const authUser = useCurrentUser();
	const userRef = ref<DocumentReference>();
	const userData = useDocument<User>(userRef);

	/*
	 * "Ver como vecino": the admin platform opens the webapp with ?viewAs=<communityId> for support. Whoever manages that
	 * community then sees it as a neighbour, read-only: the profile is overlaid with that community, the neighbour role and
	 * blocked, so every screen uses it and nothing can be reported, commented, voted or booked. Kept for the browser tab
	 */
	const viewAsParam = new URLSearchParams(window.location.search).get(VIEW_AS_KEY);
	if (viewAsParam) {
		sessionStorage.setItem(VIEW_AS_KEY, viewAsParam);
	}
	const viewAs = ref(sessionStorage.getItem(VIEW_AS_KEY) || undefined);
	const viewingAs = computed(() => managesCommunity(userData.value, viewAs.value) ? viewAs.value : undefined);
	// Only once the profile is loaded, so it isn't cleared while signing in
	watch(() => !!userData.value && !viewingAs.value && !!viewAs.value, (notAllowed) => {
		if (notAllowed) {
			exitViewAs(false);
		}
	});

	function exitViewAs(reload = true) {
		sessionStorage.removeItem(VIEW_AS_KEY);
		viewAs.value = undefined;
		// A full reload, so nothing loaded for that community stays in memory
		if (reload) {
			window.location.assign('/');
		}
	}

	// Same ref as the profile (with its pending and error), with the overlay applied
	const user = Object.assign(
		computed(() => userData.value && viewingAs.value
			? { ...userData.value, id: userData.value.id, communityId: viewingAs.value, role: 'user' as const, blocked: true }
			: userData.value),
		{ data: userData.data, error: userData.error, pending: userData.pending, promise: userData.promise, stop: userData.stop },
	) as unknown as typeof userData;

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

	// Signed out in another tab, which also stopped this tab's Firestore to clear its copy: started again from /login
	watch(() => authUser.value?.uid, (uid, before) => {
		if (before && !uid) {
			window.location.assign('/login');
		}
	});

	watchEffect(() => {
		if (authUser.value?.uid) {
			userRef.value = doc(db, 'users', authUser.value.uid);
		} else {
			userRef.value = undefined;
		}
	});

	// Without a profile, it's their first sign-in: the profile is created from the invitation sent to their email, if there's one
	watch(() => !!userRef.value && !userData.pending.value && userData.value === null, async (withoutProfile) => {
		if (withoutProfile && authUser.value) {
			await acceptInvitation(authUser.value).catch((error: unknown) => reportError(error, { action: 'Aceptar la invitación' }));
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
		// Firestore's copy of what this user read is removed first, as the device may be shared, along with every tab's.
		// Changes not sent yet go with it. At most a few seconds, so signing out never waits on a tab that holds it
		// eslint-disable-next-line no-console
		const cleared = terminate(db).then(async () => clearIndexedDbPersistence(db)).catch(console.error);
		await Promise.race([cleared, new Promise(resolve => setTimeout(resolve, 3000))]);
		await signOut(auth);
		userRef.value = undefined;
		// A full reload, so nothing from the previous user stays in memory either. Each app has its own /login
		window.location.assign('/login');
	}

	return {
		user,
		viewingAs,
		exitViewAs,
		sendMagicLink,
		completeMagicLink,
		signInWithPassword,
		changePassword,
		logout,
	};
}
