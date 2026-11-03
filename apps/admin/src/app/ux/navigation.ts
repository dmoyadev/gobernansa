import type { Router } from 'vue-router';
import { changeCount } from '@gobernansa/shared/application/activity.ts';
import { db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, doc } from 'firebase/firestore';
import { computed, nextTick, onActivated, onMounted, ref, shallowRef } from 'vue';

const UPDATE_TIMEOUT_MS = 1500;
// What others change shows up after this long at most; what's changed from here, at once
const REVALIDATE_AFTER_MS = 5 * 60 * 1000;

// Where in the history this page is, kept by the router in each entry's state
function historyPosition() {
	return (window.history.state as { position?: number } | null)?.position ?? 0;
}

// Each page change crossfades with a slight slide, backwards when going back (by the browser or BackButton). Not when
// the browser already animated it, as iOS' swipe back does, nor for those who prefer less motion
export function installViewTransitions(router: Router) {
	const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
	let lastPosition = 0;
	let browserAnimated = false;
	// The transition waiting for each navigation's page, so a navigation cut short by another doesn't end the newer one's
	const pending = new Map<object, () => void>();

	window.addEventListener('popstate', (event) => {
		browserAnimated = (event as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition ?? false;
	});

	router.beforeResolve(async (to, from) => {
		const position = historyPosition();
		const animate = 'startViewTransition' in document && !reducedMotion.matches && !browserAnimated && !!from.matched.length && to.path !== from.path;
		browserAnimated = false;
		if (!animate) {
			return true;
		}
		// On a push the state is still the current page's, on back and forward it's already the destination's
		document.documentElement.dataset.navigation = position < lastPosition ? 'back' : 'forward';
		return new Promise<true>((resolve) => {
			document.startViewTransition(async () => {
				resolve(true);
				// The new page is in the DOM once the navigation is done and rendered
				await new Promise<void>((done) => {
					pending.set(to, done);
					setTimeout(done, UPDATE_TIMEOUT_MS);
				});
			});
		});
	});

	router.afterEach(async (to) => {
		lastPosition = historyPosition();
		await nextTick();
		pending.get(to)?.();
		pending.delete(to);
	});
}

// A page's code is downloaded as soon as a link to it is pointed at or focused, so it opens at once. Its data is
// still read when it opens. The main sections are downloaded too while the browser is idle
export function installPrefetch(router: Router, sections: string[]) {
	const fetched = new Set<string>();

	function prefetch(path: string) {
		if (fetched.has(path)) {
			return;
		}
		fetched.add(path);
		for (const record of router.resolve(path).matched) {
			for (const component of Object.values(record.components ?? {})) {
				if (typeof component === 'function') {
					(component as () => Promise<unknown>)().catch(() => fetched.delete(path));
				}
			}
		}
	}

	function onIntent(event: Event) {
		const link = (event.target as Element | null)?.closest?.('a[href]');
		if (link instanceof HTMLAnchorElement && link.origin === window.location.origin && !link.target) {
			prefetch(link.pathname);
		}
	}

	document.addEventListener('pointerover', onIntent, { passive: true });
	document.addEventListener('focusin', onIntent);
	const whenIdle = (callback: () => void) => 'requestIdleCallback' in window ? window.requestIdleCallback(callback) : setTimeout(callback, 1000);
	whenIdle(() => sections.forEach(prefetch));
}

// Pages come back after going elsewhere, kept alive with their data. What a page reads only once is read again
// then, showing the last one meanwhile: stale while it revalidates. Only if something was changed from here since, or
// it was read over 5 minutes ago, so going back and forth between pages doesn't read everything again each time. Live
// listeners never stopped, so they need nothing
export function onRevalidate(refresh: () => unknown) {
	let first = true;
	let readAt = Date.now();
	let readChanges = changeCount();
	onActivated(() => {
		if (!first && (changeCount() !== readChanges || Date.now() - readAt > REVALIDATE_AFTER_MS)) {
			readAt = Date.now();
			readChanges = changeCount();
			void refresh();
		}
		first = false;
	});
}

// What several pages, or the same one opened again, read once: kept here for 5 minutes, or until something is changed
// from here. A failed read isn't kept
const remembered = new Map<string, { at: number; changes: number; value: Promise<unknown> }>();
export async function remember<T>(key: string, load: () => Promise<T>): Promise<T> {
	const kept = remembered.get(key);
	if (kept && kept.changes === changeCount() && Date.now() - kept.at <= REVALIDATE_AFTER_MS) {
		return kept.value as Promise<T>;
	}
	const value = load();
	remembered.set(key, { at: Date.now(), changes: changeCount(), value });
	value.catch(() => remembered.get(key)?.value === value && remembered.delete(key));
	return value;
}

// Read again each time the page comes back, showing the last data meanwhile. A failed reread keeps them
export function useRevalidated<T>(load: () => Promise<T>) {
	const data = shallowRef<T>();
	const error = ref<string>();

	async function reload() {
		try {
			data.value = await load();
			error.value = undefined;
		} catch (e) {
			if (!data.value) {
				error.value = (e as Error).message;
			}
		}
	}
	onMounted(reload);
	onRevalidate(reload);

	return { data, error, loading: computed(() => !data.value && !error.value) };
}

// Idempotency key: a new document's id, made when its form opens instead of when it's sent. Sending twice, or again
// after a failure, writes the same document instead of a duplicate. Made locally, without reading anything
export function newId() {
	return doc(collection(db, 'ids')).id;
}
