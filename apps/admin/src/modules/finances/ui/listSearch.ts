import type { ShallowRef } from 'vue';
import { normalize } from '@gobernansa/shared/utils/helpers.ts';
import { useShortcut } from 'lnxjs-components';
import { computed, onActivated, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

// A list's search, kept in the address (?q=) so reloading or sharing the link keeps it, and focused with /. The page
// passes the box around its input. A word matches anywhere in the texts given, accents and case aside
export function useListSearch(description: string, box: Readonly<ShallowRef<HTMLElement | null>>) {
	const route = useRoute();
	const router = useRouter();
	// A plain ref the address follows: bound to the route itself, typing fast would drop letters while it navigates
	const search = ref(typeof route.query.q === 'string' ? route.query.q : '');
	const write = () => void router.replace({ query: { ...route.query, q: search.value || undefined } });
	watch(search, write);
	// The page comes back as it was left, so the address says so again
	onActivated(write);

	const words = computed(() => normalize(search.value).split(' ').filter(Boolean));
	function matches(...texts: (string | undefined)[]) {
		const text = normalize(texts.join(' '));
		return words.value.every(word => text.includes(word));
	}

	useShortcut('/', () => box.value?.querySelector('input')?.focus(), { description });

	return { search, matches };
}
