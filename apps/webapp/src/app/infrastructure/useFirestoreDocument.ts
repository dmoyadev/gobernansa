import type {
	CollectionReference,
	DocumentData,
	DocumentReference,
	DocumentSnapshot,
	Firestore,
	QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { Ref } from 'vue';
import {
	collection,
	doc,
	onSnapshot,
} from 'firebase/firestore';
import { onScopeDispose, ref, watch } from 'vue';

/* -------------------------------------------------------------------------- */
/*                              Mapping utilities                             */
/* -------------------------------------------------------------------------- */

export function mapFirestoreDoc<T>(doc: DocumentSnapshot | QueryDocumentSnapshot): T {
	return {
		id: doc.id,
		...doc.data(),
	} as T;
}

/* -------------------------------------------------------------------------- */
/*                             Firestore path utils                           */
/* -------------------------------------------------------------------------- */

export function communityCollection<T = DocumentData>(
	db: Firestore,
	communityId: string,
	path: string,
): CollectionReference<T> {
	return collection(
		db,
		'communities',
		communityId,
		path,
	) as CollectionReference<T>;
}

export function communityDoc<T = DocumentData>(
	db: Firestore,
	communityId: string,
	collectionPath: string,
	docId: string,
): DocumentReference<T> {
	return doc(
		db,
		'communities',
		communityId,
		collectionPath,
		docId,
	) as DocumentReference<T>;
}

/* -------------------------------------------------------------------------- */
/*                             Generic document hook                          */
/* -------------------------------------------------------------------------- */

export interface UseFirestoreDocumentOptions<T> {
	path: Ref<DocumentReference | undefined>;
	filter?: (data: T) => boolean;
}

// Live: whoever has it open sees each change as it's made. fetch listens again, e.g. after an error
export function useFirestoreDocument<T>({ path, filter }: UseFirestoreDocumentOptions<T>) {
	const data = ref<T>();
	const loading = ref(false);
	const error = ref<Error>();
	let stop: (() => void) | undefined;

	function fetch() {
		stop?.();
		stop = undefined;
		error.value = undefined;
		if (!path.value) {
			data.value = undefined;
			return;
		}

		loading.value = true;
		stop = onSnapshot(path.value, (snap) => {
			const mapped = snap.exists() ? mapFirestoreDoc<T>(snap) : undefined;
			data.value = mapped && (!filter || filter(mapped)) ? mapped : undefined;
			loading.value = false;
		}, (err) => {
			error.value = err;
			loading.value = false;
		});
	}

	// Only the path, so a new reference to the same document doesn't listen again
	watch(() => path.value?.path, fetch, { immediate: true });
	onScopeDispose(() => stop?.());

	return {
		data,
		loading,
		error,
		fetch,
	};
}
