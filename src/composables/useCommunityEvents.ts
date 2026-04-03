import type { Datable } from '../utils/interfaces.ts';
import {
	collection,
	deleteDoc,
	doc,
	getFirestore,
	limit,
	orderBy,
	query,
	setDoc,
	Timestamp,
	updateDoc,
	where,
} from 'firebase/firestore';
import { computed, ref } from 'vue';
import { useCollection } from 'vuefire';
import useAuth from './useAuth.ts';

export interface Event extends Datable {
	id: string;
	title: string;
	description?: string;
	type: 'community' | 'maintenance' | 'improvements' | 'other';
	date: Timestamp;
	communityId: string;
}

interface QueryFilters {
	type?: Event['type'];
	year?: string;
}

export function useCommunityEvents(pageSize = 15) {
	const { user } = useAuth();
	const communityId = computed(() => user.value?.communityId);
	const db = getFirestore();

	const filters = ref<QueryFilters>();
	const page = ref(1);

	const currentPageSize = computed(() => page.value * pageSize);
	const eventsRef = computed(() => {
		if (!communityId.value) {
			return null;
		}

		let q = query(
			collection(db, 'events'),
			where('communityId', '==', communityId.value),
			orderBy('date', 'desc'),
			limit(currentPageSize.value),
		);

		if (filters.value?.type) {
			q = query(q, where('type', '==', filters.value.type));
		}

		if (filters.value?.year) {
			q = query(
				q,
				where('date', '>=', new Date(+filters.value.year, 0, 1)),
				where('date', '<=', new Date(+filters.value.year, 11, 31, 23, 59, 59)),
			);
		}

		return q;
	});
	const events = useCollection<Event>(eventsRef);
	const allLoaded = computed(() => {
		if (!events.value) {
			return true;
		}

		return events.value.length < currentPageSize.value;
	});

	function setFilters(newFilters: QueryFilters) {
		filters.value = {
			...filters.value,
			...newFilters,
		};

		page.value = 1;
	}

	function createEvent(data: Partial<Event>) {
		const { user } = useAuth();
		if (!user.value) {
			throw new Error('🔴 User must be authenticated to create an event');
		}

		void setDoc(doc(db, 'events'), {
			...data,
			communityId: communityId.value,
			createdAt: Timestamp.now(),
			updatedAt: Timestamp.now(),
			createdBy: user.value.id,
			updatedBy: user.value.id,
		});
	}

	function updateEvent(eventId: string, data: any) {
		const { user } = useAuth();
		if (!user.value) {
			throw new Error('🔴 User must be authenticated to edit an event');
		}

		void updateDoc(doc(db, 'events', eventId), {
			...data,
			updatedAt: Timestamp.now(),
			updatedBy: user.value.id,
		});
	}

	function deleteEvent(eventId: string) {
		void deleteDoc(doc(db, 'events', eventId));
	}

	return {
		events,
		page,
		allLoaded,
		setFilters,
		createEvent,
		updateEvent,
		deleteEvent,
	};
}
