import type { Timestamp } from '@firebase/firestore';

export interface Datable {
	createdBy: string;
	updatedBy: string;
	createdAt: Timestamp;
	updatedAt: Timestamp;
}

export interface Deletable {
	deletedBy?: string;
	deletedAt?: Timestamp;
}
