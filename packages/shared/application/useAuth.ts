import type { User as AuthUser } from 'firebase/auth';
import type { DocumentReference, WriteBatch } from 'firebase/firestore';
import type { Invitation, User } from '../domain/user.ts';
import {
	createUserWithEmailAndPassword,
	EmailAuthProvider,
	reauthenticateWithCredential,
	sendEmailVerification,
	sendPasswordResetEmail,
	signInWithEmailAndPassword,
	signOut,
	updatePassword,
	verifyBeforeUpdateEmail,
} from 'firebase/auth';
import { arrayUnion, clearIndexedDbPersistence, collection, doc, getDoc, getDocs, query, terminate, updateDoc, where, writeBatch } from 'firebase/firestore';
import { computed, effectScope, ref, shallowRef, watch, watchEffect } from 'vue';
import { useCurrentUser, useDocument } from 'vuefire';
import { codeEmail, homeCommunities, isCodeEmail, managesCommunity, parseInviteCode } from '../domain/user.ts';
import { logAction, logActionBeforeLeaving } from '../infrastructure/actions.ts';
import { auth, db } from '../infrastructure/firebase.ts';
import { reportError } from '../infrastructure/monitoring.ts';

const VIEW_AS_KEY = 'viewAs';
const COMMUNITY_KEY = 'community';
// What Firebase answers to a wrong email or password, with and without email enumeration protection
const WRONG_CREDENTIALS = ['auth/invalid-credential', 'auth/invalid-login-credentials', 'auth/user-not-found', 'auth/wrong-password'];

// Shared by every caller so the user document is listened to only once
let shared: ReturnType<typeof createAuth> | undefined;

export default function useAuth() {
	shared ??= effectScope(true).run(createAuth)!;
	return shared;
}

function createAuth() {
	const authUser = useCurrentUser();
	// Shallow: a deep ref hands the SDK a Vue proxy of the reference, and the offline cache can't store proxies in IndexedDB
	const userRef = shallowRef<DocumentReference>();
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
			void exitViewAs(false);
		}
	});
	// For the Historial, once it's allowed: when opened from the admin, not on each reload of the tab
	if (viewAsParam) {
		const stop = watch(viewingAs, (communityId) => {
			if (communityId) {
				stop();
				void logAction('view-as', { communityId, detail: 'Empezó a ver la comunidad como vecino' });
			}
		});
	}

	async function exitViewAs(reload = true) {
		const leaving = viewingAs.value;
		sessionStorage.removeItem(VIEW_AS_KEY);
		viewAs.value = undefined;
		// A full reload, so nothing loaded for that community stays in memory
		if (reload) {
			if (leaving) {
				await logActionBeforeLeaving('view-as-exit', { communityId: leaving, detail: 'Dejó de ver la comunidad como vecino' });
			}
			window.location.assign('/');
		}
	}

	/*
	 * Neighbours with a home in several communities (B10) pick the one they see, kept on the device. The profile is overlaid
	 * with it, so every screen uses it; in one they don't manage, a manager is a neighbour like any other
	 */
	const chosen = ref(readStorage(COMMUNITY_KEY));
	const communities = computed(() => homeCommunities(userData.value));
	const activeCommunity = computed(() => communities.value.includes(chosen.value ?? '') ? chosen.value : communities.value[0]);

	function switchCommunity(communityId: string) {
		chosen.value = communityId;
		try {
			localStorage.setItem(COMMUNITY_KEY, communityId);
		} catch {}
		// A full reload, so nothing loaded for the other community stays in memory
		window.location.assign('/');
	}

	// Same ref as the profile (with its pending and error), with the overlays applied
	const user = Object.assign(
		computed(() => {
			const profile = userData.value;
			if (profile && viewingAs.value) {
				return { ...profile, id: profile.id, communityId: viewingAs.value, role: 'user' as const, blocked: true };
			}
			if (profile && activeCommunity.value && activeCommunity.value !== profile.communityId) {
				return { ...profile, id: profile.id, communityId: activeCommunity.value, role: profile.role === 'manager' ? 'user' as const : profile.role };
			}
			return profile;
		}),
		{ data: userData.data, error: userData.error, pending: userData.pending, promise: userData.promise, stop: userData.stop },
	) as unknown as typeof userData;

	// Signed out in another tab, which also stopped this tab's Firestore to clear its copy: started again from /login. Not
	// the account of a wrong code, removed here (signInWithCode)
	let discarded: string | undefined;
	watch(() => authUser.value?.uid, (uid, before) => {
		if (before && !uid && before !== discarded) {
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

	// Without a profile, it's their first sign-in: the profile is created from the invitation sent to their email, if there's one.
	// With one, a neighbour may have been invited to another community where they also have a home: checked once per session
	watch(() => !!userRef.value && !userData.pending.value && userData.value !== undefined ? userData.value : undefined, async (profile, before) => {
		if (!authUser.value || profile === undefined || before !== undefined) {
			return;
		}
		const accept = profile === null ? acceptInvitation(authUser.value) : profile.role === 'user' || profile.role === 'manager' ? joinCommunity(authUser.value) : undefined;
		await accept?.catch((error: unknown) => reportError(error, { action: 'Aceptar la invitación' }));
		// Who entered with a code and has since confirmed their own email: the profile has it too, so the office sees it
		const { email, emailVerified } = authUser.value;
		if (profile?.email === '' && email && emailVerified && !isCodeEmail(email)) {
			await updateDoc(doc(db, 'users', authUser.value.uid), { email }).catch((error: unknown) => reportError(error, { action: 'Guardar el email' }));
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

		const { name, role, communityId, communityIds, officeId, officeRole } = invitation.data() as Invitation;
		const batch = writeBatch(db);
		batch.set(doc(db, 'users', uid), {
			email,
			name,
			role,
			communityId,
			...(communityIds ? { communityIds } : {}),
			...(officeId ? { officeId, officeRole } : {}),
		});
		batch.delete(invitationRef);
		// The profile is listened to, so it shows up by itself
		await batch.commit();

		// The office may have created or been given communities since it was sent (B4): its owner's, readable now
		if (officeId) {
			const office = (await getDoc(doc(db, 'users', officeId))).data()?.communityIds as string[] | undefined ?? [];
			if (office.join() !== (communityIds ?? []).join()) {
				await updateDoc(doc(db, 'users', uid), { communityIds: office });
			}
		}
	}

	// An invitation as a neighbour of another community adds it to their others. ponytail: costs one read per session even
	// without one; a flag on the profile set by whoever invites if it shows in the quota
	async function joinCommunity({ uid, email, emailVerified }: AuthUser) {
		if (!email || !emailVerified) {
			return;
		}

		const invitationRef = doc(db, 'invitations', email);
		const invitation = await getDoc(invitationRef);
		const data = invitation.data() as Invitation | undefined;
		if (!data || data.role !== 'user' || data.officeId || homeCommunities(userData.value).includes(data.communityId)) {
			return;
		}

		const batch = writeBatch(db);
		batch.update(doc(db, 'users', uid), { otherCommunityIds: arrayUnion(data.communityId) });
		batch.delete(invitationRef);
		await batch.commit();
	}

	async function signInWithPassword(email: string, password: string) {
		await signInWithEmailAndPassword(auth, email.trim(), password);
		void logAction('signin', { detail: 'Con email y contraseña', meta: { method: 'password' } });
	}

	// To make one, for whoever was invited by email but never had one, or to recover it. 150 a day in the free plan
	async function resetPassword(email: string) {
		await sendPasswordResetEmail(auth, email.trim(), { url: `${window.location.origin}/login` });
	}

	// The office's staff, invited by email: their profile is made once they confirm it, as the rules only take verified ones
	async function signUp(email: string, password: string) {
		const { user: account } = await createUserWithEmailAndPassword(auth, email.trim(), password);
		await sendEmailVerification(account, { url: `${window.location.origin}/login` });
	}

	async function resendVerification() {
		if (auth.currentUser) {
			await sendEmailVerification(auth.currentUser, { url: `${window.location.origin}/login` });
		}
	}

	// Once they've clicked the link in another tab or device: the token says so only after it's refreshed. Whether it is
	async function checkVerification() {
		const account = auth.currentUser;
		if (!account) {
			return false;
		}
		await account.reload();
		if (!account.emailVerified) {
			return false;
		}
		await account.getIdToken(true);
		if (userData.value === null) {
			await acceptInvitation(account);
		}
		return true;
	}

	/*
	 * An access code (B2.4) is a key to an account of its own, with a made-up email and the code as its password, so it
	 * opens it on any device. The first time the account is made, with the profile and the properties the invitation is
	 * for, and the invitation is gone in the same write. Fails with nobody signed in when there's no such code
	 */
	async function signInWithCode(typed: string) {
		const code = parseInviteCode(typed);
		if (code.length !== 10) {
			throw new Error('INVALID_CODE');
		}

		try {
			await signInWithEmailAndPassword(auth, codeEmail(code), code);
			void logAction('signin', { detail: 'Con su código de acceso', meta: { method: 'code' } });
			return;
		} catch (error) {
			if (!WRONG_CREDENTIALS.includes((error as { code?: string }).code ?? '')) {
				throw error;
			}
		}

		// Already made, its password changed since: the code no longer opens it
		const { user: account } = await createUserWithEmailAndPassword(auth, codeEmail(code), code).catch((error: unknown) => {
			throw new Error('INVALID_CODE', { cause: error });
		});
		let invitation: Invitation | undefined;
		try {
			const invitationRef = doc(db, 'invitations', code);
			invitation = (await getDoc(invitationRef)).data() as Invitation | undefined;
			if (!invitation?.byCode) {
				throw new Error('INVALID_CODE');
			}
			const batch = writeBatch(db);
			batch.set(doc(db, 'users', account.uid), { email: '', name: invitation.name, role: 'user', communityId: invitation.communityId, inviteCode: code });
			claimProperties(batch, invitation, code, account.uid);
			batch.delete(invitationRef);
			await batch.commit();
		} catch (error) {
			// The rules don't let read a code that isn't one, so a wrong one ends here too
			discarded = account.uid;
			await account.delete();
			throw new Error('INVALID_CODE', { cause: error });
		}
		void logAction('signin', { detail: 'Con su código de acceso, por primera vez', meta: { method: 'code' } });
		await claimUnpaidCharges(invitation, account.uid);
	}

	// Someone signed in who's given another code: one more home, in their community or another one (B10). Its community
	async function joinWithCode(typed: string) {
		const code = parseInviteCode(typed);
		const account = auth.currentUser;
		const profile = userData.value;
		if (code.length !== 10 || !account || !profile) {
			throw new Error('INVALID_CODE');
		}

		const invitationRef = doc(db, 'invitations', code);
		const invitation = (await getDoc(invitationRef).catch(() => undefined))?.data() as Invitation | undefined;
		if (!invitation?.byCode) {
			throw new Error('INVALID_CODE');
		}
		const joins = !homeCommunities(profile).includes(invitation.communityId);
		const batch = writeBatch(db);
		batch.update(doc(db, 'users', account.uid), { joinedWith: code, ...(joins ? { otherCommunityIds: arrayUnion(invitation.communityId) } : {}) });
		claimProperties(batch, invitation, code, account.uid);
		batch.delete(invitationRef);
		await batch.commit();
		void logAction('signin', { detail: 'Añadió una casa con un código de acceso', communityId: invitation.communityId, meta: { method: 'code' } });
		await claimUnpaidCharges(invitation, account.uid);
		return invitation.communityId;
	}

	// The properties it's for, signed with the code so the rules check it against the invitation
	function claimProperties(batch: WriteBatch, invitation: Invitation, code: string, uid: string) {
		for (const id of invitation.propertyIds ?? []) {
			batch.update(doc(db, 'properties', id), { ownerUid: uid, claimedWith: code });
		}
		if (invitation.tenantOf) {
			batch.update(doc(db, 'properties', invitation.tenantOf), { tenantUid: uid, claimedWith: code });
		}
	}

	// The charges issued while the property had no account are its new owner's: debts follow the property. Not to stop
	// them entering, the office can still move them when it edits the property
	async function claimUnpaidCharges(invitation: Invitation, uid: string) {
		const charges = collection(db, 'communities', invitation.communityId, 'charges');
		await Promise.all((invitation.propertyIds ?? []).map(async (propertyId) => {
			const unpaid = await getDocs(query(charges, where('propertyId', '==', propertyId), where('ownerUid', '==', ''), where('paidAt', '==', null)));
			await Promise.all(unpaid.docs.map(async charge => updateDoc(charge.ref, { ownerUid: uid })));
		})).catch((error: unknown) => reportError(error, { action: 'Pasar los recibos pendientes al propietario' }));
	}

	// Who entered with a code adds their email, to sign in with it too and recover the password. Firebase asks to have
	// signed in recently, so the code is asked again. Their email changes once they click the link sent to it, and then they
	// sign in with it and the code as password until they change it
	async function addEmail(typedCode: string, email: string) {
		const account = auth.currentUser;
		if (!account?.email) {
			throw new Error('The user must be signed in to add an email');
		}
		const code = parseInviteCode(typedCode);
		await reauthenticateWithCredential(account, EmailAuthProvider.credential(account.email, code)).catch((error: unknown) => {
			throw new Error('INVALID_CODE', { cause: error });
		});
		await verifyBeforeUpdateEmail(account, email.trim(), { url: `${window.location.origin}/login` });
		void logAction('email', { detail: 'Pidió añadir su email a la cuenta de su código' });
	}

	// Firebase asks to have signed in recently (auth/requires-recent-login) to change it
	async function changePassword(password: string) {
		if (!auth.currentUser) {
			throw new Error('The user must be signed in to change the password');
		}

		await updatePassword(auth.currentUser, password);
		void logAction('password', { detail: 'Cambió su contraseña' });
	}

	async function logout() {
		// Before Firestore stops, or it would never be sent
		await logActionBeforeLeaving('signout');
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
		communities,
		switchCommunity,
		viewingAs,
		exitViewAs,
		signInWithPassword,
		resetPassword,
		signUp,
		resendVerification,
		checkVerification,
		signInWithCode,
		joinWithCode,
		addEmail,
		changePassword,
		logout,
	};
}

function readStorage(key: string) {
	try {
		return localStorage.getItem(key) ?? undefined;
	} catch {
		return undefined;
	}
}

// What to tell whoever's signing in when Firebase says no
export function authErrorMessage(error: unknown) {
	const code = (error as { code?: string }).code ?? '';
	if (WRONG_CREDENTIALS.includes(code) || code === 'auth/invalid-email') {
		return 'El email o la contraseña no son correctos.';
	}
	if (code === 'auth/email-already-in-use') {
		return 'Ese email ya tiene cuenta. Entra con él o recupera la contraseña.';
	}
	if (code === 'auth/weak-password') {
		return 'Usa una contraseña de al menos 6 caracteres.';
	}
	if (code === 'auth/too-many-requests' || code === 'auth/quota-exceeded') {
		return 'Demasiados intentos. Espera unos minutos y vuelve a probar.';
	}
	if (code === 'auth/network-request-failed') {
		return 'Sin conexión. Revísala y vuelve a probar.';
	}
	return 'No se ha podido. Inténtalo de nuevo.';
}
