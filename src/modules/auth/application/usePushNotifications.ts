import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { deleteToken, getMessaging, getToken, isSupported } from 'firebase/messaging';
import { computed, ref } from 'vue';
import { useCurrentUser } from 'vuefire';
import { db, firebaseApp } from '@/shared/infrastructure/firebase.ts';
import { useStorage } from '@/shared/utils/useStorage.ts';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

/**
 * Asks the browser for permission and registers this device in users/{uid}/devices/{token},
 * where whoever sends the notifications (e.g. a test message from the Firebase console) finds it.
 * public/firebase-messaging-sw.js shows them.
 */
export function usePushNotifications() {
	const user = useCurrentUser();
	const supported = 'Notification' in window && 'serviceWorker' in navigator;
	const permission = ref<NotificationPermission>(supported ? Notification.permission : 'denied');
	const wanted = useStorage('push-notifications', false);
	// Kept to unregister the device when turning them off
	const token = useStorage<string | null>('push-token', null);

	const enabled = computed(() => wanted.value && permission.value === 'granted');

	async function enable() {
		permission.value = await Notification.requestPermission();
		if (permission.value !== 'granted') {
			return;
		}

		// shortcut: without a VAPID key the device gets no token to send to, set VITE_FIREBASE_VAPID_KEY (Firebase console → Cloud Messaging → Web Push certificates)
		if (VAPID_KEY && user.value && await isSupported()) {
			token.value = await getToken(getMessaging(firebaseApp), { vapidKey: VAPID_KEY });
			await setDoc(doc(db, 'users', user.value.uid, 'devices', token.value), { createdAt: serverTimestamp() });
		}

		wanted.value = true;
	}

	async function disable() {
		wanted.value = false;
		if (token.value && user.value) {
			await deleteDoc(doc(db, 'users', user.value.uid, 'devices', token.value));
			await deleteToken(getMessaging(firebaseApp));
			token.value = null;
		}
	}

	return {
		supported,
		permission,
		enabled,
		enable,
		disable,
	};
}
