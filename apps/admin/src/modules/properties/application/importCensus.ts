import type { CensusRow } from '@gobernansa/shared/domain/census.ts';
import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { User } from '@gobernansa/shared/domain/user.ts';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { plural } from '@gobernansa/shared/utils/helpers.ts';
import { collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { invite } from '@/modules/people/application/usePeople.ts';

// Per batch, leaving room in its 500 writes for the activity entry and, when it's created, the community and its own
const BATCH_PROPERTIES = 497;

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
	const batches = Math.max(Math.ceil(changed.length / BATCH_PROPERTIES), create ? 1 : 0);
	for (let index = 0; index < batches; index++) {
		const chunk = changed.slice(index * BATCH_PROPERTIES, (index + 1) * BATCH_PROPERTIES);
		const batch = writeBatch(db);
		if (create && !index) {
			batch.set(doc(db, 'communities', communityId), { ...create, createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid });
			logActivity(batch, communityId, { area: 'community', summary: `Creó la comunidad «${create.name}» al importar ${file}`, link: `/communities/${communityId}` });
		}
		for (const row of chunk) {
			if (row.property) {
				// An update replaces the mandate whole, as a merge would keep the old one's fields
				batch.update(doc(propertiesRef, row.property.id), { ...row.data, updatedAt: now, updatedBy: uid });
			} else {
				batch.set(doc(propertiesRef), { ...row.data, communityId, ownerUid: '', createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid });
			}
		}
		if (chunk.length) {
			const added = chunk.filter(row => !row.property).length;
			const parts = [added && plural(added, 'propiedad nueva', 'propiedades nuevas'), chunk.length - added && plural(chunk.length - added, 'actualizada', 'actualizadas')];
			logActivity(batch, communityId, {
				area: 'property',
				summary: `Importó el censo de ${file}: ${parts.filter(Boolean).join(' y ')}${!index && rest ? `; ${rest}` : ''}`,
				link: `/communities/${communityId}/properties`,
			});
		}
		await batch.commit();
	}
}

/**
 * Invites each owner once as a neighbour, but those who already have a profile or an invitation in the community, as
 * its people page checks. One by one: an email invited to another community fails on its own without stopping the rest.
 * byEmail also queues each one's invitation email, as the people page does
 */
export async function inviteOwners(communityId: string, owners: { name: string; email: string }[], byEmail: boolean) {
	const [users, invitations] = await Promise.all([
		getDocs(query(collection(db, 'users'), where('communityId', '==', communityId))),
		getDocs(query(collection(db, 'invitations'), where('communityId', '==', communityId))),
	]);
	const taken = new Set([...users.docs.map(user => (user.data() as User).email?.toLowerCase()), ...invitations.docs.map(invitation => invitation.id)]);
	const pending = [...new Map(owners.filter(owner => !taken.has(owner.email)).map(owner => [owner.email, owner])).values()];
	const results = await Promise.allSettled(pending.map(async ({ name, email }) => invite({ email, name: name || email, role: 'user', communityId }, undefined, byEmail)));
	return { sent: results.filter(result => result.status === 'fulfilled').length, failed: results.filter(result => result.status === 'rejected').length };
}
