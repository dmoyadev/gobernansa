import type { Datable } from '@gobernansa/shared/domain/audit.ts';
import type { Timestamp } from 'firebase/firestore';

export interface Event extends Datable {
	id: string;
	title: string;
	description?: string;
	type: 'community' | 'maintenance' | 'improvements' | 'other';
	date: Timestamp;
	communityId: string;
}
