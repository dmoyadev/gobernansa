import type { Event } from '@gobernansa/shared/domain/event.ts';
import type { Timestamp as FirestoreTimestamp } from 'firebase/firestore';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, doc, getDocs, limit, orderBy, query, serverTimestamp, Timestamp, where, writeBatch } from 'firebase/firestore';

/*
 * Comunicados: one notice sent to several communities at once, as an event in each that shares its broadcastId, so they
 * can be listed and removed together
 */

const eventsRef = collection(db, 'events');

// Per community, the ones dated from this many days ago on, upcoming included: the latest by date alone would be the furthest future events
const RECENT_DAYS = 60;
const RECENT_PER_COMMUNITY = 100;

export function recentSince() {
	return Date.now() - RECENT_DAYS * 86_400_000;
}

// Each copy's id derives from the broadcast's, so sending twice writes them once
export function copyId(broadcastId: string, communityId: string) {
	return `${broadcastId}-${communityId}`;
}

// One copy per community, with its activity entry. 1 write per community, 2 with the activity
export async function sendAnnouncement(data: Pick<Event, 'title' | 'description' | 'type'> & { date: FirestoreTimestamp; broadcastId: string }, communityIds: string[], uid: string) {
	const now = serverTimestamp();
	const batch = writeBatch(db);
	for (const communityId of communityIds) {
		batch.set(doc(eventsRef, copyId(data.broadcastId, communityId)), { ...data, communityId, createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid });
		logActivity(batch, communityId, {
			area: 'event',
			summary: `Envió el comunicado «${data.title}»`,
			link: `/communities/${communityId}/notifications`,
		});
	}
	await batch.commit();
}

// A community's events of the last RECENT_DAYS on, upcoming included. Up to RECENT_PER_COMMUNITY reads
export async function loadRecentEvents(communityId: string) {
	return (await getDocs(query(
		eventsRef,
		where('communityId', '==', communityId),
		// Same index as the timeline's: communityId and date
		where('date', '>=', Timestamp.fromMillis(recentSince())),
		orderBy('date', 'desc'),
		limit(RECENT_PER_COMMUNITY),
	))).docs.map(snapshot => ({ ...snapshot.data(), id: snapshot.id }) as Event);
}

// Only the copies given: the rules don't let a query reach the communities not selected
export async function removeAnnouncement(copies: Event[]) {
	const batch = writeBatch(db);
	for (const copy of copies) {
		batch.delete(doc(eventsRef, copy.id));
		logActivity(batch, copy.communityId, { area: 'event', summary: `Borró el comunicado «${copy.title}»` });
	}
	await batch.commit();
}

// Undoes removeAnnouncement: every copy back with its id and what it had, from the list in memory
export async function restoreAnnouncement(copies: Event[]) {
	const batch = writeBatch(db);
	for (const { id, ...copy } of copies) {
		batch.set(doc(eventsRef, id), copy);
		logActivity(batch, copy.communityId, {
			area: 'event',
			summary: `Restauró el comunicado «${copy.title}»`,
			link: `/communities/${copy.communityId}/notifications`,
		});
	}
	await batch.commit();
}
