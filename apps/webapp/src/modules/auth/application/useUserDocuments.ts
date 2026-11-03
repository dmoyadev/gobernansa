import type { UserDocument } from '../domain/user.ts';
import { MAX_DOCUMENT_SIZE, MAX_DOCUMENTS } from '@gobernansa/shared/domain/user.ts';
import { db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { Bytes, collection, doc, getDoc, orderBy, query, serverTimestamp, writeBatch } from 'firebase/firestore';
import { computed } from 'vue';
import { useCollection, useCurrentUser } from 'vuefire';

export { MAX_DOCUMENT_SIZE, MAX_DOCUMENTS };

/**
 * Documents are listed from users/{uid}/documents, while their content lives in users/{uid}/documentFiles
 * under the same id, so listing them doesn't download every file.
 */
export function useUserDocuments() {
	const user = useCurrentUser();

	const documentsRef = computed(() => user.value
		? query(collection(db, 'users', user.value.uid, 'documents'), orderBy('createdAt', 'desc'))
		: null);
	const documents = useCollection<UserDocument>(documentsRef, { ssrKey: 'userDocuments' });

	function getRefs(id?: string) {
		if (!user.value) {
			throw new Error('The user must be signed in to manage their documents');
		}

		const documentRef = id
			? doc(db, 'users', user.value.uid, 'documents', id)
			: doc(collection(db, 'users', user.value.uid, 'documents'));
		return { documentRef, fileRef: doc(db, 'users', user.value.uid, 'documentFiles', documentRef.id) };
	}

	async function uploadDocument(file: File, category: UserDocument['category'], propertyId?: string) {
		if (file.size > MAX_DOCUMENT_SIZE) {
			throw new Error(`The file is bigger than ${MAX_DOCUMENT_SIZE} bytes`);
		}
		if (documents.value.length >= MAX_DOCUMENTS) {
			throw new Error(`There are already ${MAX_DOCUMENTS} documents`);
		}

		const { documentRef, fileRef } = getRefs();
		const batch = writeBatch(db);
		batch.set(fileRef, { data: Bytes.fromUint8Array(new Uint8Array(await file.arrayBuffer())) });
		batch.set(documentRef, {
			name: file.name,
			type: file.type,
			size: file.size,
			category,
			...(propertyId ? { propertyId } : {}),
			createdAt: serverTimestamp(),
		});
		await batch.commit();
	}

	// Downloads it, phones open it with their viewer
	async function openDocument(document: UserDocument) {
		const { fileRef } = getRefs(document.id);
		const snap = await getDoc(fileRef);
		const bytes = (snap.data()?.data as Bytes | undefined)?.toUint8Array();
		if (!bytes) {
			throw new Error('The document has no file');
		}

		const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: document.type }));
		Object.assign(window.document.createElement('a'), { href: url, download: document.name }).click();
		setTimeout(() => URL.revokeObjectURL(url), 60_000);
	}

	async function deleteDocument(document: UserDocument) {
		const { documentRef, fileRef } = getRefs(document.id);
		const batch = writeBatch(db);
		batch.delete(documentRef);
		batch.delete(fileRef);
		await batch.commit();
	}

	return {
		documents,
		uploadDocument,
		openDocument,
		deleteDocument,
	};
}
