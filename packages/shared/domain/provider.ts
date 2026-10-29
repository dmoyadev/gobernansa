import type { Timestamp } from 'firebase/firestore';
import type { Datable } from './audit.ts';

export type ProviderCategory = 'plumbing' | 'electricity' | 'elevator' | 'cleaning' | 'gardening' | 'locksmith' | 'painting' | 'pest_control' | 'fire_safety' | 'insurance' | 'other';

// Shared by the communities in communityIds, so an administrator keeps one directory for all of theirs
export interface Provider extends Datable {
	id: string;
	name: string;
	category: ProviderCategory;
	phone?: string;
	email?: string;
	cif?: string;
	notes?: string;
	communityIds: string[];
	// Counters, written along with each rating. The average is ratingSum / ratingCount
	ratingSum: number;
	ratingCount: number;
}

// One per person and provider, stored with their uid as id
export interface ProviderRating {
	id: string;
	score: 1 | 2 | 3 | 4 | 5;
	comment?: string;
	communityId: string;
	authorId: string;
	authorName: string;
	createdAt: Timestamp;
}

export const providerCategories: Record<ProviderCategory, { label: string; icon: string }> = {
	plumbing: { label: 'Fontanería', icon: 'lucide:droplets' },
	electricity: { label: 'Electricidad', icon: 'lucide:zap' },
	elevator: { label: 'Ascensores', icon: 'lucide:arrow-down-up' },
	cleaning: { label: 'Limpieza', icon: 'lucide:brush-cleaning' },
	gardening: { label: 'Jardinería', icon: 'lucide:sprout' },
	locksmith: { label: 'Cerrajería', icon: 'lucide:key-round' },
	painting: { label: 'Pintura y albañilería', icon: 'lucide:paint-roller' },
	pest_control: { label: 'Control de plagas', icon: 'lucide:bug' },
	fire_safety: { label: 'Protección contra incendios', icon: 'lucide:fire-extinguisher' },
	insurance: { label: 'Seguros', icon: 'lucide:shield-check' },
	other: { label: 'Otros', icon: 'lucide:hammer' },
};

export function averageRating(provider: Pick<Provider, 'ratingSum' | 'ratingCount'>) {
	return provider.ratingCount ? provider.ratingSum / provider.ratingCount : undefined;
}
