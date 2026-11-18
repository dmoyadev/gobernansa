import type { VitalsDay } from '@gobernansa/shared/domain/vitals.ts';
import { db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';

// The most an 'in' takes
const IN_LIMIT = 30;

// Rendimiento real (MON-6, docs/fiabilidad.md): the days asked for, by id (app_day), those without data left out. 1 read per day found
export async function loadVitals(ids: string[]) {
	const chunks = Array.from({ length: Math.ceil(ids.length / IN_LIMIT) }, (_, index) => ids.slice(index * IN_LIMIT, (index + 1) * IN_LIMIT));
	const pages = await Promise.all(chunks.map(async chunk => getDocs(query(collection(db, 'vitals'), where(documentId(), 'in', chunk)))));
	return pages.flatMap(page => page.docs.map(snapshot => ({ app: snapshot.id.split('_')[0], day: snapshot.data() as VitalsDay })));
}
