import { activate, fetchAndActivate, getAll, getRemoteConfig, onConfigUpdate } from 'firebase/remote-config';
import { reactive } from 'vue';
import { firebaseApp } from './firebase.ts';

/*
 * Switches changed from the Firebase console (Remote Config) without a deploy (ROB-5, docs/fiabilidad.md): turn off a
 * feature that's failing, force everyone onto a new version, or show a maintenance message. Read when the app opens and
 * again on each change published in the console. Free and with no Firestore reads. Without a connection to it, the
 * defaults below: everything on
 */
const DEFAULTS = {
	// Paying charges, payments on account and deposits from the webapp
	payments: true,
	// Generating SEPA remittances and payment orders in the admin
	remittances: true,
	// Downloading the AEAT files in the admin
	aeatFiles: true,
	// Importing the census in the admin
	censusImport: true,
	errorReporting: true,
	// Share of sessions that send a sample with each error, from 0 to 1
	errorSampleRate: 1,
	// The lowest release (VITE_RELEASE) still allowed, e.g. 2026.11.04-1200; empty for any
	minVersion: '',
	// Shown in both apps while it isn't empty
	maintenance: '',
};

export const remote = reactive({ ...DEFAULTS });

try {
	const config = getRemoteConfig(firebaseApp);
	config.defaultConfig = DEFAULTS;
	// Changes arrive at once through onConfigUpdate; this only limits fetches on every reload
	config.settings.minimumFetchIntervalMillis = 60 * 60 * 1000;
	const refresh = () => {
		for (const [key, value] of Object.entries(getAll(config))) {
			if (key in DEFAULTS) {
				const fallback = DEFAULTS[key as keyof typeof DEFAULTS];
				Object.assign(remote, { [key]: typeof fallback === 'boolean' ? value.asBoolean() : typeof fallback === 'number' ? value.asNumber() : value.asString() });
			}
		}
	};
	void fetchAndActivate(config).then(refresh, () => undefined);
	onConfigUpdate(config, {
		next: () => void activate(config).then(refresh, () => undefined),
		error: () => undefined,
		complete: () => undefined,
	});
} catch {
	// No Remote Config in this browser or build: the defaults stay
}
