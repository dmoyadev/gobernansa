import type { Timestamp } from 'firebase/firestore';
import type { Datable } from '@/shared/domain/audit.ts';

export interface Event extends Datable {
	id: string;
	title: string;
	description?: string;
	type: 'community' | 'maintenance' | 'improvements' | 'other';
	date: Timestamp;
	communityId: string;
}
