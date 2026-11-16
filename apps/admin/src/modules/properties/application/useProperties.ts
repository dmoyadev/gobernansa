import type { Property } from '@gobernansa/shared/domain/property.ts';
import type { WriteBatch } from 'firebase/firestore';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { isValidNif, normalizeTaxId } from '@gobernansa/shared/domain/fiscal.ts';
import { propertyTypeLabels } from '@gobernansa/shared/domain/property.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { plural } from '@gobernansa/shared/utils/helpers.ts';
import { collection, deleteField, doc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { useCollection } from 'vuefire';

const propertiesRef = collection(db, 'properties');

// What the inputs edit, as typed. The coefficient is a percentage, '' when the deed doesn't say
export type PropertyForm = Pick<Property, 'name' | 'type' | 'ownerUid'>
	& Record<'ownerName' | 'ownerEmail' | 'ownerNif' | 'ownerPhone' | 'tenantName' | 'tenantEmail' | 'coefficient', string>;

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
		ownerNif: property?.ownerNif ?? '',
		ownerPhone: property?.ownerPhone ?? '',
		tenantName: property?.tenantName ?? '',
		tenantEmail: property?.tenantEmail ?? '',
		coefficient: property?.coefficient?.toString() ?? '',
	};
}

/**
 * The unpaid charges of a property go to whoever owns it now: debts follow the property when it's sold, and an owner
 * linked to their account sees the ones issued before. Those in a remittance are left as they are, being debited from
 * the account they were sent with. How many it moved
 */
export async function moveUnpaidCharges(batch: WriteBatch, communityId: string, propertyId: string, ownerUid: string, ownerName: string) {
	const unpaid = await getDocs(query(collection(db, 'communities', communityId, 'charges'), where('propertyId', '==', propertyId), where('paidAt', '==', null)));
	const moved = unpaid.docs.filter(charge => !charge.data().remittanceId);
	for (const charge of moved) {
		batch.update(charge.ref, { ownerUid, ownerName: ownerName || deleteField(), updatedAt: serverTimestamp(), updatedBy: auth.currentUser!.uid });
	}
	return moved.length;
}

/**
 * Creates it with newId when there's no id, so sending it twice writes the same one. ownerUid '' is an owner without an
 * account, kept by name and email for the census. Merged, so the fields left empty are removed
 */
export async function saveProperty(communityId: string, id: string | undefined, form: PropertyForm, newId?: string, previous?: Property) {
	const uid = auth.currentUser!.uid;
	const propertyRef = doc(propertiesRef, id ?? newId ?? doc(propertiesRef).id);
	const now = serverTimestamp();
	const name = form.name.trim();
	const text = (value: string) => value.trim() || deleteField();
	// The rules only check it's a number, and NaN is one
	const coefficient = form.coefficient.trim() ? Number(form.coefficient.replace(',', '.')) : undefined;
	if (coefficient !== undefined && !(coefficient >= 0 && coefficient <= 100)) {
		throw new Error('el coeficiente debe estar entre 0 y 100.');
	}

	if (form.ownerNif.trim() && !isValidNif(form.ownerNif)) {
		throw new Error('el NIF del propietario no es válido.');
	}

	const batch = writeBatch(db);
	batch.set(propertyRef, {
		name,
		type: form.type,
		ownerUid: form.ownerUid,
		ownerName: text(form.ownerName),
		ownerEmail: text(form.ownerEmail.toLowerCase()),
		ownerNif: text(normalizeTaxId(form.ownerNif)),
		ownerPhone: text(form.ownerPhone),
		tenantName: text(form.tenantName),
		tenantEmail: text(form.tenantEmail.toLowerCase()),
		// A tenant who leaves takes their account with them
		...(form.tenantName.trim() ? {} : { tenantUid: deleteField() }),
		coefficient: coefficient ?? deleteField(),
		updatedAt: now,
		updatedBy: uid,
		...(id ? {} : { communityId, createdAt: now, createdBy: uid }),
	}, { merge: true });
	const ownerChanged = !!previous && (previous.ownerUid !== form.ownerUid || (previous.ownerName ?? '') !== form.ownerName.trim());
	const moved = ownerChanged ? await moveUnpaidCharges(batch, communityId, previous.id, form.ownerUid, form.ownerName.trim()) : 0;
	logActivity(batch, communityId, {
		area: 'property',
		summary: `${id ? 'Editó' : 'Añadió'} la propiedad «${name}» (${propertyTypeLabels[form.type]})${moved ? ` y pasó ${plural(moved, 'recibo pendiente', 'recibos pendientes')} a ${form.ownerName.trim() || 'su propietario'}` : ''}`,
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

// Undoes deleteProperty with what the page still had of it, under the same id so whatever pointed to it finds it again
export async function restoreProperty(property: Property) {
	const batch = writeBatch(db);
	batch.set(doc(propertiesRef, property.id), { ...property });
	logActivity(batch, property.communityId, {
		area: 'property',
		summary: `Restauró la propiedad «${property.name}»`,
		link: `/communities/${property.communityId}/properties`,
	});
	await batch.commit();
}
