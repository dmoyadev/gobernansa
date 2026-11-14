import type { DocumentData, Query } from 'firebase/firestore';
import { toCsv } from '@gobernansa/shared/domain/accounting.ts';
import { db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, doc, getDoc, getDocs, query, Timestamp, where } from 'firebase/firestore';
import { zip } from '@/app/ux/download.ts';

// GAR-2: everything the community has, to take it to another program. One CSV per collection
const COLLECTIONS = ['issues', 'meetings', 'charges', 'payments', 'debtCases', 'remittances', 'paymentOrders', 'bankMovements', 'journalEntries', 'fiscalYears', 'budgets', 'expenses', 'obligations', 'bookings', 'activity'];
// Under each meeting: who came, how they voted, the minutes and the notices sent
const MEETING_COLLECTIONS = ['attendance', 'ballots', 'minutes', 'notices'];

// Dates as ISO, the rest as JSON when it isn't plain text or a number
function plain(value: unknown): unknown {
	if (value instanceof Timestamp) {
		return value.toDate().toISOString();
	}
	if (Array.isArray(value)) {
		return value.map(plain);
	}
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
	}
	return value;
}

function cell(value: unknown) {
	const shown = plain(value);
	return shown == null ? '' : typeof shown === 'object' ? JSON.stringify(shown) : String(shown);
}

// A column per field any of them has, after their id and, for subcollections, their parent's
function csv(rows: (DocumentData & { id: string })[]) {
	const columns = [...new Set(rows.flatMap(Object.keys))].filter(key => key !== 'id').sort();
	return toCsv([['id', ...columns], ...rows.map(row => [row.id, ...columns.map(key => cell(row[key]))])]);
}

async function read(source: Query, extra: Record<string, string> = {}) {
	const snapshot = await getDocs(source);
	return snapshot.docs.map(item => ({ id: item.id, ...extra, ...item.data() }));
}

/**
 * The community whole in a ZIP: its data, its census, its neighbours, its providers and every collection under it.
 * ponytail: one read per document, a few thousand for a big community, once; issue comments, votes and who reported
 * each one stay out, as neighbours never see them either
 */
export async function exportCommunity(id: string) {
	const communityRef = doc(db, 'communities', id);
	const sub = (name: string) => collection(communityRef, name);
	const [community, chart, properties, neighbours, others, providers, ...lists] = await Promise.all([
		getDoc(communityRef),
		// Its chart of accounts is a single document
		getDoc(doc(communityRef, 'accounting', 'chart')),
		read(query(collection(db, 'properties'), where('communityId', '==', id))),
		read(query(collection(db, 'users'), where('communityId', '==', id))),
		read(query(collection(db, 'users'), where('otherCommunityIds', 'array-contains', id))),
		read(query(collection(db, 'providers'), where('communityIds', 'array-contains', id))),
		...COLLECTIONS.map(async name => read(sub(name))),
	]);
	const meetings = lists[COLLECTIONS.indexOf('meetings')];
	const underMeetings = await Promise.all(MEETING_COLLECTIONS.map(async name =>
		(await Promise.all(meetings.map(async meeting => read(collection(communityRef, 'meetings', meeting.id, name), { meetingId: meeting.id })))).flat()));

	const files: Record<string, string> = {
		'comunidad.json': JSON.stringify(plain({ id, ...community.data() }), null, '\t'),
		'plan-de-cuentas.json': JSON.stringify(plain(chart.data() ?? {}), null, '\t'),
		'propiedades.csv': csv(properties),
		'vecinos.csv': csv([...neighbours, ...others]),
		'proveedores.csv': csv(providers),
	};
	COLLECTIONS.forEach((name, index) => files[`${name}.csv`] = csv(lists[index]));
	MEETING_COLLECTIONS.forEach((name, index) => files[`meetings-${name}.csv`] = csv(underMeetings[index]));
	return zip(files);
}
