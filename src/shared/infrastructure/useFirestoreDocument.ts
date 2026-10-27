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
	getDoc,
} from 'firebase/firestore';
import { ref, watchEffect } from 'vue';

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
	immediate?: boolean;
	filter?: (data: T) => boolean;
}
export function useFirestoreDocument<T>({
	path,
	immediate = true,
	filter,
}: UseFirestoreDocumentOptions<T>) {
	const data = ref<T>();
	const loading = ref(false);
	const error = ref<Error>();

	async function fetch() {
		if (!path.value) {
			data.value = undefined;
			return;
		}

		loading.value = true;
		error.value = undefined;

		try {
			const snap = await getDoc(path.value);

			if (!snap.exists()) {
				data.value = undefined;
				return;
			}

			const mapped = mapFirestoreDoc<T>(snap);

			if (filter && !filter(mapped)) {
				data.value = undefined;
				return;
			}

			data.value = mapped;
		} catch (err) {
			error.value = err as Error;
		} finally {
			loading.value = false;
		}
	}

	if (immediate) {
		watchEffect(() => {
			void fetch();
		});
	}

	return {
		data,
		loading,
		error,
		fetch,
	};
}
