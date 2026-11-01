import { computed, ref } from 'vue';

/*
 * Each app as an installed one: its service worker (public/sw.js) and updates, the browser's install prompt and the connection.
 * Imported by main.ts, so the install event isn't missed
 */

interface BeforeInstallPromptEvent extends Event {
	prompt: () => Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/* Connection. Without one Firestore shows what it kept and sends the changes once it's back */
export const online = ref(navigator.onLine);
window.addEventListener('online', () => online.value = true);
window.addEventListener('offline', () => online.value = false);

/* Install. Chrome and Edge offer it with this event, Safari only from its share menu */
const installEvent = ref<BeforeInstallPromptEvent>();
export const canInstall = computed(() => !!installEvent.value);
export const installed = ref(matchMedia('(display-mode: standalone)').matches || ('standalone' in navigator && navigator.standalone === true));
// iPadOS says it's a Mac
export const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);

window.addEventListener('beforeinstallprompt', (event) => {
	// The app's own button instead of the browser's banner
	event.preventDefault();
	installEvent.value = event as BeforeInstallPromptEvent;
});
window.addEventListener('appinstalled', () => {
	installEvent.value = undefined;
	installed.value = true;
});

export async function install() {
	// Each event prompts only once
	const event = installEvent.value;
	installEvent.value = undefined;
	await event?.prompt();
}

/* Updates: a new worker, or a deploy while the app stayed open */
export const updateReady = ref(false);
let registration: Promise<ServiceWorkerRegistration | undefined> | undefined;
let reloadOnChange = false;
// The file this page started with; index.html loading another one means there's been a deploy since
const entry = document.querySelector('script[type="module"][src]')?.getAttribute('src');

export function registerServiceWorker() {
	if (!('serviceWorker' in navigator)) {
		return;
	}

	registration = navigator.serviceWorker.register('/sw.js').then((current) => {
		// A new worker waits until the user chooses to update. The first one isn't an update
		const check = () => {
			if (current.waiting && navigator.serviceWorker.controller) {
				updateReady.value = true;
			}
		};
		check();
		current.addEventListener('updatefound', () => current.installing?.addEventListener('statechange', check));
		return current;
	}, (error: unknown) => {
		// eslint-disable-next-line no-console
		console.error(error);
		return undefined;
	});

	navigator.serviceWorker.addEventListener('controllerchange', () => {
		if (reloadOnChange) {
			window.location.reload();
		}
	});

	// Installed apps stay open for days: checked each time it's shown again
	document.addEventListener('visibilitychange', () => void checkForUpdate());
}

async function checkForUpdate() {
	if (document.visibilityState !== 'visible' || !online.value || updateReady.value) {
		return;
	}

	void (await registration)?.update().catch(() => undefined);
	const html = await fetch('/index.html', { cache: 'no-cache' }).then(async response => response.text()).catch(() => '');
	if (entry && html && !html.includes(entry)) {
		updateReady.value = true;
	}
}

export async function applyUpdate() {
	const waiting = (await registration)?.waiting;
	if (waiting) {
		reloadOnChange = true;
		waiting.postMessage('skipWaiting');
	} else {
		window.location.reload();
	}
}

// Push subscriptions need it active
export async function activeServiceWorker() {
	if (!await registration) {
		throw new Error('The service worker could not be registered');
	}
	return navigator.serviceWorker.ready;
}
