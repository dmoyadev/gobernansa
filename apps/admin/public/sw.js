// The admin's service worker (registered by @gobernansa/shared/application/pwa.ts): opens it without a connection.
// Firestore keeps the data itself, here only the app's own files are cached. Same as the webapp's, without notifications.
// Renaming the caches drops the old ones when this worker updates
const SHELL = 'shell-v1';
const ASSETS = 'assets-v1';
// Vite's dev server serves everything fresh, with hot reload
const CACHING = !['localhost', '127.0.0.1', '[::1]'].includes(globalThis.location.hostname);
// What index.html loads from Vite's build
const BUILD_FILES = /(?:src|href)="(\/assets\/[^"]+)"/g;

// The page and the files it starts with, saved again after each deploy. The old hashed files go: Hosting no longer has them
async function saveShell(response) {
	if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
		return;
	}

	const html = await response.clone().text();
	const shell = await caches.open(SHELL);
	if (await (await shell.match('/index.html'))?.text() === html) {
		return;
	}

	await caches.delete(ASSETS);
	const assets = await caches.open(ASSETS);
	await assets.addAll(Array.from(html.matchAll(BUILD_FILES), ([, url]) => url));
	await shell.put('/index.html', response);
}

globalThis.addEventListener('install', (event) => {
	if (CACHING) {
		event.waitUntil(fetch('/index.html', { cache: 'no-cache' }).then(saveShell));
	}
});

globalThis.addEventListener('activate', (event) => {
	event.waitUntil((async () => {
		for (const key of await caches.keys()) {
			if (key !== SHELL && key !== ASSETS) {
				await caches.delete(key);
			}
		}
		// The first visit's lazy pages are cached too
		await globalThis.clients.claim();
	})());
});

// The app asks for it once the user chooses to update
globalThis.addEventListener('message', (event) => {
	if (event.data === 'skipWaiting') {
		void globalThis.skipWaiting();
	}
});

globalThis.addEventListener('fetch', (event) => {
	const { request } = event;
	const url = new URL(request.url);
	// Firestore, Google APIs, Cloudinary and any write go straight to the network
	if (!CACHING || request.method !== 'GET' || url.origin !== globalThis.location.origin) {
		return;
	}

	if (request.mode === 'navigate') {
		// The latest page while online (Hosting has the browser check it each time), the saved one without a connection
		event.respondWith(fetch(request).then((response) => {
			event.waitUntil(saveShell(response.clone()));
			return response;
		}, async () => await caches.match('/index.html') ?? Response.error()));
	} else if (url.pathname.startsWith('/assets/')) {
		// Vite's hashed files never change
		event.respondWith(caches.match(request).then(cached => cached ?? fetch(request).then(async (response) => {
			if (response.ok) {
				await (await caches.open(ASSETS)).put(request, response.clone());
			}
			return response;
		})));
	}
});
