import type { FieldValue } from 'firebase/firestore';
import type { Router } from 'vue-router';
import type { ErrorApp } from '../domain/errors.ts';
import type { VitalBand } from '../domain/vitals.ts';
import { doc, increment, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase.ts';

/*
 * Rendimiento real (MON-6, docs/fiabilidad.md §3), with the browser's own PerformanceObserver: the load (LCP), the layout
 * shifts (CLS) and the slowest interaction, a rough INP. A 10 % of sessions add one to a band of each, in one write when
 * the page is first hidden, to vitals/{app}_{day}. No reads. LCP is the load's and goes to the screen the session opened
 * on, the other two to the screen where they happened
 */

const SAMPLE_RATE = 0.1;
const MAX_SCREEN = 80;
// The session windows of CLS: shifts less than 1 s apart, for at most 5 s
const CLS_GAP_MS = 1000;
const CLS_WINDOW_MS = 5000;

// canSend: the same switches as the errors' (ROB-5) and not with the quota used up
export function measurePerformance(router: Router, app: ErrorApp, canSend: () => boolean) {
	if (Math.random() >= SAMPLE_RATE || typeof PerformanceObserver === 'undefined') {
		return;
	}
	const screen = () => {
		const current = router.currentRoute.value;
		return String(current.name ?? current.matched.at(-1)?.path ?? '').slice(0, MAX_SCREEN);
	};

	let landing = '';
	void router.isReady().then(() => {
		landing = screen();
	});
	// Opened in the background, the load doesn't measure what someone waited
	let lcp = document.visibilityState === 'hidden' ? undefined : 0;
	let cls = { value: 0, screen: '' };
	let shifts = { value: 0, start: 0, last: 0, screen: '' };
	let inp = { value: 0, screen: '' };

	const observe = (type: string, onEntries: (entries: PerformanceEntry[]) => void, options: PerformanceObserverInit = {}) => {
		try {
			new PerformanceObserver(list => onEntries(list.getEntries())).observe({ type, buffered: true, ...options });
		} catch {
			// Not in this browser, e.g. Safari has neither LCP nor event timing
		}
	};
	observe('largest-contentful-paint', (entries) => {
		if (lcp !== undefined) {
			lcp = entries.at(-1)?.startTime ?? lcp;
		}
	});
	observe('layout-shift', (entries) => {
		for (const entry of entries as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
			if (entry.hadRecentInput) {
				continue;
			}
			if (entry.startTime - shifts.last > CLS_GAP_MS || entry.startTime - shifts.start > CLS_WINDOW_MS) {
				shifts = { value: 0, start: entry.startTime, last: entry.startTime, screen: screen() };
			}
			shifts.value += entry.value;
			shifts.last = entry.startTime;
			if (shifts.value > cls.value) {
				cls = { value: shifts.value, screen: shifts.screen };
			}
		}
	});
	observe('event', (entries) => {
		for (const entry of entries as (PerformanceEntry & { interactionId?: number })[]) {
			if (entry.interactionId && entry.duration > inp.value) {
				inp = { value: entry.duration, screen: screen() };
			}
		}
	}, { durationThreshold: 40 } as PerformanceObserverInit);

	const send = () => {
		if (document.visibilityState !== 'hidden') {
			return;
		}
		document.removeEventListener('visibilitychange', send);
		if (!auth.currentUser || !canSend()) {
			return;
		}
		const bands = new Map<string, Partial<Record<VitalBand, FieldValue>>>();
		const add = (name: string, band: VitalBand) => name && bands.set(name, { ...bands.get(name), [band]: increment(1) });
		if (lcp) {
			add(landing, lcp <= 1000 ? 'lcp1' : lcp <= 2500 ? 'lcp25' : lcp <= 4000 ? 'lcp4' : 'lcpMore');
		}
		add(cls.screen || landing, cls.value <= 0.1 ? 'clsGood' : cls.value <= 0.25 ? 'clsMid' : 'clsPoor');
		if (inp.screen) {
			add(inp.screen, inp.value <= 200 ? 'inpGood' : inp.value <= 500 ? 'inpMid' : 'inpPoor');
		}
		if (!bands.size) {
			return;
		}
		// The day in Spain, as the panel reads it. Closing, Firestore keeps the write and sends it next time
		const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
		setDoc(doc(db, 'vitals', `${app}_${day}`), { screens: Object.fromEntries(bands), touched: [...bands.keys()] }, { merge: true }).catch(() => undefined);
	};
	document.addEventListener('visibilitychange', send);
}
