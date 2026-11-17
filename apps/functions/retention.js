/*
 * Plazos de conservación del Historial (docs/setup.md#plazos). Each entry of audit and actions is written
 * with its class (keep) and deleted whole once its time is up, by purgeExpired every day (Blaze) or by the copia de
 * seguridad and `npm run purge` (free plan). And the photos nobody sees anymore, purgeMedia. No imports, so the scripts
 * use it with their own firebase-admin
 */

// Fiscal and meeting records: until the 31st of December of the year after the change
const FISCAL = new Set([
	'accounting',
	'attendance',
	'ballots',
	'bankMovements',
	'bookings',
	'budgets',
	'charges',
	'communities',
	'debtCases',
	'expenses',
	'fiscalYears',
	'invoices',
	'journalEntries',
	'meetings',
	'minutes',
	'notices',
	'offices',
	'paymentOrders',
	'payments',
	'properties',
	'remittances',
	'verifactu',
]);

// A change, by its collection: accounts as long as sign-ins, the fiscal ones to the end of the next year, the rest 90 days
export function changeKeep(collection) {
	return collection === 'auth' ? 'year' : FISCAL.has(collection) ? 'fiscal' : 'short';
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
// A whole number of years ago, from the 1st of January in Spain (UTC+1 then): early by an hour in Canarias, never late
const newYear = (now, yearsAgo) => new Date(Date.UTC(new Date(now.getTime() + HOUR).getUTCFullYear() - yearsAgo, 0, 1) - HOUR);

// Older than these, deleted. Everything goes at three years, whatever its class (the team's own, and any without one)
export function cutoffs(now = new Date()) {
	return {
		short: new Date(now.getTime() - 90 * DAY),
		year: new Date(now.getTime() - 365 * DAY),
		fiscal: newYear(now, 1),
		all: new Date(now.getTime() - 3 * 365 * DAY),
		// The register each community keeps (communities/{c}/activity), outside the Historial: five years after each one
		activity: newYear(now, 5),
	};
}

const PAGE = 500;
export const MAX = 10_000;

/*
 * Deletes what's expired, oldest first, up to max documents a run (the free plan has 20.000 deletes a day). With
 * dryRun, only counts it (a read per 1.000). Returns how many of each
 */
export async function purge(db, { now = new Date(), max = MAX, dryRun = false } = {}) {
	const cut = cutoffs(now);
	// Against a wrong clock or table: nothing younger than 30 days is ever deleted here
	if (Object.values(cut).some(date => !(now.getTime() - date.getTime() >= 30 * DAY))) {
		throw new Error(`Plazos imposibles: ${JSON.stringify(cut)}`);
	}

	const queries = {
		'actions · 90 días': db.collection('actions').where('keep', '==', 'short').where('at', '<', cut.short),
		'actions · 12 meses': db.collection('actions').where('keep', '==', 'year').where('at', '<', cut.year),
		'actions · 3 años': db.collection('actions').where('at', '<', cut.all),
		'audit · 90 días': db.collection('audit').where('keep', '==', 'short').where('at', '<', cut.short),
		'audit · 12 meses': db.collection('audit').where('keep', '==', 'year').where('at', '<', cut.year),
		'audit · ejercicio siguiente': db.collection('audit').where('keep', '==', 'fiscal').where('at', '<', cut.fiscal),
		'audit · 3 años': db.collection('audit').where('at', '<', cut.all),
		'activity · 5 años': db.collectionGroup('activity').where('at', '<', cut.activity),
		'errores · 30 días': db.collectionGroup('samples').where('expiresAt', '<', now),
	};

	const counts = {};
	let left = max;
	for (const [name, query] of Object.entries(queries)) {
		if (dryRun) {
			counts[name] = (await query.count().get()).data().count;
			continue;
		}
		counts[name] = 0;
		while (left > 0) {
			const snapshot = await query.select().limit(Math.min(PAGE, left)).get();
			if (snapshot.empty) {
				break;
			}
			const batch = db.batch();
			snapshot.docs.forEach(doc => batch.delete(doc.ref));
			await batch.commit();
			counts[name] += snapshot.size;
			left -= snapshot.size;
		}
	}
	return counts;
}

// A file's path in the bucket from its download URL, absolute or, with the emulators, relative. Nothing for a malformed
// one: the rules only check how it starts
const URL_PATH = /\/o\/([^?#]+)/;
function pathOf(url) {
	try {
		return decodeURIComponent(URL_PATH.exec(url)?.[1] ?? '');
	} catch {
		return '';
	}
}
// A list of links from the database, or none: the rules don't check what a work order's copy of its issue holds
const list = value => (Array.isArray(value) ? value : []);
// Each folder's depth, as storage.rules: issues/{communityId}/{authorKey}/{name} and workOrders/{token}/{name}
const FOLDERS = { 'issues/': 4, 'workOrders/': 3 };

/*
 * Photos and videos in Storage that nobody sees anymore, 90 days after, as the versions of an issue: those of an issue
 * removed then, whose links it drops, as do the work orders that copied them (useIssues.ts), and those uploaded and never
 * attached (an issue or a job that failed to save). Those of an issue or a work order still there stay. Every week,
 * purgeOldMedia. With dryRun, only counts them
 */
export async function purgeMedia(db, bucket, { now = new Date(), dryRun = false } = {}) {
	const cutoff = cutoffs(now).short;
	const folders = new Map();
	// ponytail: lists every file each time, fine up to some tens of thousands; by date in Storage's metadata if it grows
	for (const [prefix, depth] of Object.entries(FOLDERS)) {
		const [files] = await bucket.getFiles({ prefix });
		files.filter(file => file.name.split('/').length === depth && new Date(file.metadata.timeCreated) < cutoff).forEach((file) => {
			const folder = file.name.slice(0, file.name.lastIndexOf('/'));
			folders.set(folder, [...folders.get(folder) ?? [], file]);
		});
	}

	const counts = { ficheros: 0, incidencias: 0, partes: 0 };
	// Each community's work orders, read once, with the issue's links each one copied
	const orders = new Map();
	for (const [folder, files] of folders) {
		const [kind, id, authorKey] = folder.split('/');
		const kept = new Set();
		const removed = [];
		if (kind === 'issues') {
			const issues = await db.collection('communities').doc(id).collection('issues').where('authorKey', '==', authorKey).get();
			issues.forEach((issue) => {
				// The rules check who removes an issue, not what they write: anything but a date leaves it there
				const deletedAt = issue.get('deletedAt');
				const removedAt = typeof deletedAt?.toDate === 'function' ? deletedAt.toDate() : undefined;
				if (removedAt && removedAt < cutoff) {
					removed.push(issue);
				} else {
					list(issue.get('assets')).forEach(url => kept.add(pathOf(url)));
				}
			});
		} else {
			list((await db.collection('workOrders').doc(id).get()).get('photos')).forEach(url => kept.add(pathOf(url)));
		}
		const gone = files.filter(file => !kept.has(file.name));
		if (!gone.length) {
			continue;
		}
		const names = new Set(gone.map(file => file.name));
		// Their links first, so a restored issue comes back without them rather than with broken ones, and the provider's
		// page shows none rather than broken ones
		for (const issue of removed) {
			const assets = list(issue.get('assets'));
			const left = assets.filter(url => !names.has(pathOf(url)));
			if (left.length < assets.length) {
				counts.incidencias++;
				dryRun || await issue.ref.update({ assets: left });
			}
		}
		if (kind === 'issues') {
			if (!orders.has(id)) {
				const snapshot = await db.collection('workOrders').where('communityId', '==', id).get();
				orders.set(id, snapshot.docs.map(order => ({ ref: order.ref, assets: list(order.get('issue.assets')) })));
			}
			for (const order of orders.get(id)) {
				const left = order.assets.filter(url => !names.has(pathOf(url)));
				if (left.length < order.assets.length) {
					counts.partes++;
					order.assets = left;
					dryRun || await order.ref.update({ 'issue.assets': left });
				}
			}
		}
		counts.ficheros += gone.length;
		dryRun || await Promise.all(gone.map(file => file.delete({ ignoreNotFound: true })));
	}
	return counts;
}
