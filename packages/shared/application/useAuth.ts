import type { User as AuthUser } from 'firebase/auth';
import type { DocumentReference } from 'firebase/firestore';
import type { Invitation, User } from '../domain/user.ts';
import {
	isSignInWithEmailLink,
	sendSignInLinkToEmail,
	signInAnonymously,
	signInWithEmailAndPassword,
	signInWithEmailLink,
	signOut,
	updatePassword,
} from 'firebase/auth';
import { arrayUnion, clearIndexedDbPersistence, doc, getDoc, terminate, updateDoc, writeBatch } from 'firebase/firestore';
import { computed, effectScope, ref, watch, watchEffect } from 'vue';
import { useCurrentUser, useDocument } from 'vuefire';
import { homeCommunities, managesCommunity, parseInviteCode } from '../domain/user.ts';
import { auth, db } from '../infrastructure/firebase.ts';
import { reportError } from '../infrastructure/monitoring.ts';

const VIEW_AS_KEY = 'viewAs';
const COMMUNITY_KEY = 'community';

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

	// Fallback for when the daily quota of sign-in emails runs out
	async function signInWithPassword(email: string, password: string) {
		await signInWithEmailAndPassword(auth, email, password);
	}

	// A neighbour without email (B2.4): an account on this device, made from the code the office printed for them. Fails
	// with nobody left signed in when there's no such code
	async function signInWithCode(typed: string) {
		const code = parseInviteCode(typed);
		if (code.length !== 10) {
			throw new Error('INVALID_CODE');
		}

		const { user: account } = await signInAnonymously(auth);
		try {
			const invitationRef = doc(db, 'invitations', code);
			const invitation = (await getDoc(invitationRef)).data() as Invitation | undefined;
			if (!invitation?.byCode) {
				throw new Error('INVALID_CODE');
			}
			const batch = writeBatch(db);
			batch.set(doc(db, 'users', account.uid), { email: '', name: invitation.name, role: 'user', communityId: invitation.communityId, inviteCode: code });
			batch.delete(invitationRef);
			await batch.commit();
		} catch (error) {
			// The rules don't let read a code that isn't one, so a wrong one ends here too
			discarded = account.uid;
			await account.delete();
			throw new Error('INVALID_CODE', { cause: error });
		}
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
		communities,
		switchCommunity,
		viewingAs,
		exitViewAs,
		sendMagicLink,
		completeMagicLink,
		signInWithPassword,
		signInWithCode,
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
