// Registered by Firebase Cloud Messaging (getToken), shows the notifications it delivers, even with the app closed
globalThis.addEventListener('push', (event) => {
	const { notification = {}, data = {} } = event.data?.json() ?? {};
	event.waitUntil(globalThis.registration.showNotification(notification.title || 'gobernança', {
		body: notification.body,
		icon: notification.image || '/isotype.svg',
		data: { link: data.link || '/' },
	}));
});

globalThis.addEventListener('notificationclick', (event) => {
	event.notification.close();
	event.waitUntil(globalThis.clients.openWindow(event.notification.data.link));
});
