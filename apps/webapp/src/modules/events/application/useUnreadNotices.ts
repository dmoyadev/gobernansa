import { computed, effectScope } from 'vue';
import { useStorage } from '@/app/utils/useStorage.ts';
import { useCommunityEvents } from './useCommunityEvents.ts';

function create() {
	// The newest one, the same query as Inicio's so it comes from the cache. One read, and one per new aviso
	const { events } = useCommunityEvents(1, true);
	const seenAt = useStorage<number>('notices-seen-at', 0);
	const unread = computed(() => !!events.value[0] && events.value[0].date.toMillis() > seenAt.value);
	const markSeen = () => {
		seenAt.value = Date.now();
	};
	return { unread, markSeen };
}

let shared: ReturnType<typeof create> | undefined;

/**
 * Whether there's an aviso newer than the last visit to Avisos, for the bell. One listener for the whole app, not one per header.
 */
export function useUnreadNotices() {
	shared ??= effectScope(true).run(create)!;
	return shared;
}
