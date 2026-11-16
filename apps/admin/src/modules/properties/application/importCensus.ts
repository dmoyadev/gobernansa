import type { CensusRow } from '@gobernansa/shared/domain/census.ts';
import type { Community } from '@gobernansa/shared/domain/community.ts';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { plural } from '@gobernansa/shared/utils/helpers.ts';
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { createCommunity } from '@/modules/communities/application/useCommunities.ts';
import { moveUnpaidCharges } from './useProperties.ts';

// Per batch, leaving room in its 500 writes for the activity entry
const BATCH_PROPERTIES = 499;

const propertiesRef = collection(db, 'properties');

/**
 * Writes the new and changed rows of a community's census, creating the community first when `create` has its data.
 * Each batch logs what it imported. Nothing is ever removed, and the owners stay without an account (ownerUid '')
 */
export async function importCensus(communityId: string, rows: CensusRow[], file: string, create?: Pick<Community, 'name' | 'address' | 'cif' | 'iban'>) {
	const uid = auth.currentUser!.uid;
	const now = serverTimestamp();
	const changed = rows.filter(row => row.status === 'new' || row.status === 'update');
	// MON-4: what the file had that wasn't written, in the first entry
	const unchanged = rows.filter(row => row.status === 'unchanged').length;
	const rejected = rows.filter(row => row.status === 'error').length;
	const rest = [unchanged && plural(unchanged, 'fila sin cambios', 'filas sin cambios'), rejected && plural(rejected, 'fila rechazada', 'filas rechazadas')].filter(Boolean).join(' y ');
	if (create) {
		await createCommunity(communityId, create, `Creó la comunidad «${create.name}» al importar ${file}`);
	}
	for (let index = 0; index * BATCH_PROPERTIES < changed.length; index++) {
		const chunk = changed.slice(index * BATCH_PROPERTIES, (index + 1) * BATCH_PROPERTIES);
		const batch = writeBatch(db);
		for (const row of chunk) {
			if (row.property) {
				// An update replaces the mandate whole, as a merge would keep the old one's fields
				batch.update(doc(propertiesRef, row.property.id), { ...row.data, updatedAt: now, updatedBy: uid });
			} else {
				batch.set(doc(propertiesRef), { ...row.data, communityId, ownerUid: '', createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid });
			}
		}
		const added = chunk.filter(row => !row.property).length;
		const parts = [added && plural(added, 'propiedad nueva', 'propiedades nuevas'), chunk.length - added && plural(chunk.length - added, 'actualizada', 'actualizadas')];
		logActivity(batch, communityId, {
			area: 'property',
			summary: `Importó el censo de ${file}: ${parts.filter(Boolean).join(' y ')}${!index && rest ? `; ${rest}` : ''}`,
			link: `/communities/${communityId}/properties`,
		});
		await batch.commit();
	}
	// A new owner takes on the unpaid charges, one batch per property as each has a few
	for (const row of changed.filter(row => row.property && ('ownerUid' in row.data || 'ownerName' in row.data))) {
		const batch = writeBatch(db);
		if (await moveUnpaidCharges(batch, communityId, row.property!.id, row.data.ownerUid ?? row.property!.ownerUid, row.data.ownerName ?? row.property!.ownerName ?? '')) {
			await batch.commit();
		}
	}
}
