import type { Datable } from '@/shared/domain/audit.ts';

export interface Property extends Datable {
	id: string;
	name: string;
	type: 'home' | 'parking' | 'storage' | 'other';
	communityId: string;
	ownerUid: string;
}

export const propertyTypeIcons: Record<Property['type'], string> = {
	home: 'lucide:house',
	parking: 'lucide:car',
	storage: 'lucide:package',
	other: 'lucide:map-pin',
};
