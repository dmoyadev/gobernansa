import { Timestamp } from '@firebase/firestore';

export interface Datable {
	createdBy: string;
	updatedBy: string;
	createdAt: Timestamp;
	updatedAt: Timestamp;
}