import type { Property } from '@gobernansa/shared/domain/property.ts';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { propertyTypeLabels } from '@gobernansa/shared/domain/property.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, deleteField, doc, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { useCollection } from 'vuefire';

const propertiesRef = collection(db, 'properties');

// What the inputs edit, as typed. The coefficient is a percentage, '' when the deed doesn't say
export type PropertyForm = Pick<Property, 'name' | 'type' | 'ownerUid'>
	& Record<'ownerName' | 'ownerEmail' | 'tenantName' | 'tenantEmail' | 'coefficient', string>;

// All of the community's, live. Sorted by the page, so no index is needed
export function useProperties(communityId: string) {
	return useCollection<Property>(query(propertiesRef, where('communityId', '==', communityId)));
}

export function toPropertyForm(property?: Property): PropertyForm {
	return {
		name: property?.name ?? '',
		type: property?.type ?? 'home',
		ownerUid: property?.ownerUid ?? '',
		ownerName: property?.ownerName ?? '',
		ownerEmail: property?.ownerEmail ?? '',
		tenantName: property?.tenantName ?? '',
		tenantEmail: property?.tenantEmail ?? '',
		coefficient: property?.coefficient?.toString() ?? '',
	};
}

/**
 * Creates it when there's no id. ownerUid '' is an owner without an account, kept by name and email for the census.
 * Merged, so the fields left empty are removed
 */
export async function saveProperty(communityId: string, id: string | undefined, form: PropertyForm) {
	const uid = auth.currentUser!.uid;
	const propertyRef = id ? doc(propertiesRef, id) : doc(propertiesRef);
	const now = serverTimestamp();
	const name = form.name.trim();
	const text = (value: string) => value.trim() || deleteField();
	// The rules only check it's a number, and NaN is one
	const coefficient = form.coefficient.trim() ? Number(form.coefficient.replace(',', '.')) : undefined;
	if (coefficient !== undefined && !(coefficient >= 0 && coefficient <= 100)) {
		throw new Error('el coeficiente debe estar entre 0 y 100.');
	}

	const batch = writeBatch(db);
	batch.set(propertyRef, {
		name,
		type: form.type,
		ownerUid: form.ownerUid,
		ownerName: text(form.ownerName),
		ownerEmail: text(form.ownerEmail.toLowerCase()),
		tenantName: text(form.tenantName),
		tenantEmail: text(form.tenantEmail.toLowerCase()),
		coefficient: coefficient ?? deleteField(),
		updatedAt: now,
		updatedBy: uid,
		...(id ? {} : { communityId, createdAt: now, createdBy: uid }),
	}, { merge: true });
	logActivity(batch, communityId, {
		area: 'property',
		summary: `${id ? 'Editó' : 'Añadió'} la propiedad «${name}» (${propertyTypeLabels[form.type]})`,
		link: `/communities/${communityId}/properties`,
	});
	await batch.commit();
}

export async function deleteProperty(property: Property) {
	const batch = writeBatch(db);
	batch.delete(doc(propertiesRef, property.id));
	logActivity(batch, property.communityId, {
		area: 'property',
		summary: `Borró la propiedad «${property.name}»`,
		link: `/communities/${property.communityId}/properties`,
	});
	await batch.commit();
}
