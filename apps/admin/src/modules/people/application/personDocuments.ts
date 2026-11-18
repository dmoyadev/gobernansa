import type { Property } from '@gobernansa/shared/domain/property.ts';
import type { User } from '@gobernansa/shared/domain/user.ts';
import type { Timestamp } from 'firebase/firestore';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { Bytes, collection, doc, getDoc, orderBy, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { useCollection, useDocument } from 'vuefire';

/*
 * A neighbour's documents, sent from the administration. Files live inside Firestore documents to stay on the free plan,
 * as the webapp does: listed from users/{uid}/documents, their content in users/{uid}/documentFiles
 */

// The same shape as the webapp's, which lists them to the neighbour along with the ones they upload
export interface PersonDocument {
	id: string;
	name: string;
	type: string;
	size: number;
	category: 'deed' | 'permit' | 'receipt' | 'other';
	propertyId?: string;
	createdAt: Timestamp;
	// Who sent it from the administration, none for the ones the neighbour uploaded
	uploadedBy?: string;
}

function documentsRef(uid: string) {
	return collection(db, 'users', uid, 'documents');
}

function fileRef(uid: string, id: string) {
	return doc(db, 'users', uid, 'documentFiles', id);
}

function link(communityId: string, uid: string) {
	return `/communities/${communityId}/people/${uid}/documents`;
}

// Live: the neighbour, their documents listed without their files, and their homes in the community
export function usePersonDocuments(communityId: string, uid: string) {
	return {
		person: useDocument<User>(doc(db, 'users', uid)),
		documents: useCollection<PersonDocument>(query(documentsRef(uid), orderBy('createdAt', 'desc'))),
		properties: useCollection<Property>(query(collection(db, 'properties'), where('communityId', '==', communityId), where('ownerUid', '==', uid))),
	};
}

// The file and its entry under the id given, so sending it again after a failure writes the same one. 3 writes with the activity
export async function sendPersonDocument(communityId: string, uid: string, id: string, file: File, details: Pick<PersonDocument, 'category' | 'propertyId' | 'uploadedBy'>, personName: string) {
	const batch = writeBatch(db);
	batch.set(fileRef(uid, id), { data: Bytes.fromUint8Array(new Uint8Array(await file.arrayBuffer())) });
	batch.set(doc(documentsRef(uid), id), {
		name: file.name,
		type: file.type,
		size: file.size,
		category: details.category,
		...(details.propertyId ? { propertyId: details.propertyId } : {}),
		createdAt: serverTimestamp(),
		uploadedBy: details.uploadedBy,
	});
	logActivity(batch, communityId, { area: 'people', summary: `Envió «${file.name}» a ${personName}`, link: link(communityId, uid) });
	await batch.commit();
}

// Its content, only read to download it. 1 read
export async function loadDocumentFile(uid: string, id: string) {
	return ((await getDoc(fileRef(uid, id))).data()?.data as Bytes | undefined)?.toUint8Array();
}

export async function removePersonDocument(communityId: string, uid: string, document: PersonDocument, personName: string) {
	const batch = writeBatch(db);
	batch.delete(doc(documentsRef(uid), document.id));
	batch.delete(fileRef(uid, document.id));
	logActivity(batch, communityId, { area: 'people', summary: `Borró «${document.name}» de los documentos de ${personName}`, link: link(communityId, uid) });
	await batch.commit();
}
