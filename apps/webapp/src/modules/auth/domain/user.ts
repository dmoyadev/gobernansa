import type { Timestamp } from 'firebase/firestore';

// Papers of the user's properties, only the user and whoever manages their community can see them
export interface UserDocument {
	id: string;
	name: string;
	// MIME type, to open the file with the right app
	type: string;
	size: number;
	category: 'deed' | 'permit' | 'receipt' | 'other';
	propertyId?: string;
	// Name of whoever manages the community, when they sent it to the neighbour
	uploadedBy?: string;
	createdAt: Timestamp;
}

export const userDocumentCategories: { value: UserDocument['category']; label: string; icon: string }[] = [
	{ value: 'deed', label: 'Escrituras', icon: 'lucide:landmark' },
	{ value: 'permit', label: 'Permisos', icon: 'lucide:stamp' },
	{ value: 'receipt', label: 'Recibos', icon: 'lucide:receipt-text' },
	{ value: 'other', label: 'Otros', icon: 'lucide:file' },
];
