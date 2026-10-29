import type { Provider } from '@gobernansa/shared/domain/provider.ts';
import type { Unsubscribe } from 'firebase/firestore';
import type { MaybeRefOrGetter } from 'vue';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { computed, onScopeDispose, ref, toValue, watch } from 'vue';

export const providersRef = collection(db, 'providers');

/**
 * The providers shared with a community or, without one, every one the user can see: all for the team, those of their
 * communities for administrators and their community's for managers. Live, sorted by name.
 * One array-contains query per community, as the rules check them, merged by id (a provider shared by several shows once)
 */
export function useProviders(communityId?: MaybeRefOrGetter<string | undefined>) {
	const { user } = useAuth();
	const byCommunity = ref<Record<string, Provider[]>>({});
	const pending = ref(true);
	const error = ref<Error>();
	let unsubscribes: Unsubscribe[] = [];

	function stop() {
		unsubscribes.forEach(unsubscribe => unsubscribe());
		unsubscribes = [];
	}

	// '*' stands for the whole collection, only the team can query it
	const sources = computed(() => {
		const id = toValue(communityId);
		const profile = user.value;
		if (id) {
			return [id];
		}
		if (!profile) {
			return [];
		}
		if (profile.role === 'superadmin') {
			return ['*'];
		}
		return (profile.role === 'admin' ? profile.communityIds ?? [] : [profile.communityId]).filter(Boolean);
	});

	watch(() => sources.value.join(), () => {
		stop();
		byCommunity.value = {};
		error.value = undefined;
		pending.value = !!sources.value.length && !!user.value;
		// Loading until every query has answered once
		const answered = new Set<string>();
		unsubscribes = sources.value.map(source => onSnapshot(
			source === '*' ? providersRef : query(providersRef, where('communityIds', 'array-contains', source)),
			(snapshot) => {
				byCommunity.value = { ...byCommunity.value, [source]: snapshot.docs.map(provider => ({ ...provider.data(), id: provider.id }) as Provider) };
				answered.add(source);
				pending.value = answered.size < sources.value.length;
			},
			(e) => {
				error.value = e;
				pending.value = false;
			},
		));
	}, { immediate: true });
	onScopeDispose(stop);

	return {
		providers: computed(() => {
			const unique = new Map(Object.values(byCommunity.value).flat().map(provider => [provider.id, provider]));
			return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
		}),
		loading: pending,
		error,
	};
}
