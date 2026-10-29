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

// Creates it when there's no id
export async function saveNotification(communityId: string, id: string | undefined, { date, description, ...form }: NotificationForm) {
	const uid = auth.currentUser!.uid;
	const data = {
		...form,
		description: description.trim(),
		date: Timestamp.fromDate(new Date(`${date}T00:00`)),
		updatedAt: serverTimestamp(),
		updatedBy: uid,
	};

	const batch = writeBatch(db);
	if (id) {
		batch.update(doc(eventsRef, id), data);
	} else {
		batch.set(doc(eventsRef), { ...data, communityId, createdAt: serverTimestamp(), createdBy: uid });
	}
	logActivity(batch, communityId, {
		area: 'event',
		summary: `${id ? 'Editó' : 'Publicó'} el aviso «${form.title.trim()}»`,
		link: `/communities/${communityId}/notifications`,
	});
	await batch.commit();
}

// Read once to log where it was and what it said, so callers only need its id
export async function deleteNotification(id: string) {
	const eventRef = doc(eventsRef, id);
	const event = (await getDoc(eventRef)).data() as Event | undefined;
	const batch = writeBatch(db);
	batch.delete(eventRef);
	if (event) {
		logActivity(batch, event.communityId, { area: 'event', summary: `Borró el aviso «${event.title}»`, link: `/communities/${event.communityId}/notifications` });
	}
	await batch.commit();
}
