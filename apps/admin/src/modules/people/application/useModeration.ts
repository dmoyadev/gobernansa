import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { doc, writeBatch } from 'firebase/firestore';

// Blocked neighbours can still read, the rules stop them from reporting, commenting, voting or booking
export async function setBlocked(uid: string, communityId: string, blocked: boolean, name: string): Promise<void> {
	const batch = writeBatch(db);
	batch.update(doc(db, 'users', uid), { blocked });
	logActivity(batch, communityId, {
		area: 'moderation',
		summary: `${blocked ? 'Bloqueó' : 'Desbloqueó'} a ${name}`,
		link: `/communities/${communityId}/people`,
	});
	await batch.commit();
}
