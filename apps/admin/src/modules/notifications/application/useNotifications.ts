import type { Event } from '@gobernansa/shared/domain/event.ts';
import type { MaybeRefOrGetter } from 'vue';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, doc, getDoc, limit, orderBy, query, serverTimestamp, Timestamp, where, writeBatch } from 'firebase/firestore';
import { computed, toValue } from 'vue';
import { useCollection } from 'vuefire';

// Stored as events, the webapp lists them in the community's timeline
const eventsRef = collection(db, 'events');

export type NotificationForm = Pick<Event, 'title' | 'type'> & { description: string; date: string };

// Newest first, the same query as the webapp's so it uses its index
export function useNotifications(communityId: string, max: MaybeRefOrGetter<number>) {
	return useCollection<Event>(computed(() => query(eventsRef, where('communityId', '==', communityId), orderBy('date', 'desc'), limit(toValue(max)))));
}

// Creates it with the given id when isNew, made when its form opened so sending it twice doesn't duplicate it
export async function saveNotification(communityId: string, id: string, isNew: boolean, { date, description, ...form }: NotificationForm) {
	const uid = auth.currentUser!.uid;
	const data = {
		...form,
		description: description.trim(),
		date: Timestamp.fromDate(new Date(`${date}T00:00`)),
		updatedAt: serverTimestamp(),
		updatedBy: uid,
	};

	const batch = writeBatch(db);
	if (isNew) {
		batch.set(doc(eventsRef, id), { ...data, communityId, createdAt: serverTimestamp(), createdBy: uid });
	} else {
		batch.update(doc(eventsRef, id), data);
	}
	logActivity(batch, communityId, {
		area: 'event',
		summary: `${isNew ? 'Publicó' : 'Editó'} el aviso «${form.title.trim()}»`,
		link: `/communities/${communityId}/notifications`,
	});
	await batch.commit();
}

// One that may not be among the loaded pages, e.g. opened from the search
export async function loadNotification(id: string) {
	const snapshot = await getDoc(doc(eventsRef, id));
	return snapshot.exists() ? { ...snapshot.data() as Event, id } : undefined;
}

// The one shown, so it's logged without reading it again
export async function deleteNotification(event: Event) {
	const batch = writeBatch(db);
	batch.delete(doc(eventsRef, event.id));
	logActivity(batch, event.communityId, { area: 'event', summary: `Borró el aviso «${event.title}»`, link: `/communities/${event.communityId}/notifications` });
	await batch.commit();
}

// Puts a deleted one back exactly as it was, with the same id and dates, from what was shown
export async function restoreNotification({ id, ...event }: Event) {
	const batch = writeBatch(db);
	batch.set(doc(eventsRef, id), event);
	logActivity(batch, event.communityId, { area: 'event', summary: `Restauró el aviso «${event.title}»`, link: `/communities/${event.communityId}/notifications` });
	await batch.commit();
}
