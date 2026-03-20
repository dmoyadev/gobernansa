import type { Ref } from 'vue';
import { ref, watch } from 'vue';

/**
 * Use local storage to store data reactively
 *
 * @example
 * const data = useStorage<number>('current-page', 1);
 *
 * @template T
 * @param {string} key - The key to store the data under
 * @param {T | undefined} defaultData - The data to store
 *
 * @returns {Ref<T>} - The data stored in local storage
 */
export function useStorage<T>(key: string, defaultData?: T): Ref<T> {
	const refData = ref(defaultData) as Ref<T>;

	// Start by reading the data from local storage
	const storedData = JSON.parse(localStorage.getItem(key) ?? 'null') ?? undefined;
	if (storedData) {
		refData.value = storedData;
	} else {
		// If there is no data stored, set the data to the default value
		write();
	}

	// Watch the data for changes and write them to local storage
	watch(refData, write, { deep: true });
	function write() {
		// If the data is null or empty, remove it from local storage
		if (refData.value == null || refData.value === '') {
			localStorage.removeItem(key);
			return;
		}

		localStorage.setItem(key, JSON.stringify(refData.value));
	}

	return refData;
}
