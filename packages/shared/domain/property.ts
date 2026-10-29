import type { Datable } from './audit.ts';

export interface Property extends Datable {
	id: string;
	name: string;
	type: 'home' | 'parking' | 'storage' | 'other';
	communityId: string;
	// The owner's account, '' while they haven't signed up. ownerName and ownerEmail are kept either way, for the census
	ownerUid: string;
	ownerName?: string;
	ownerEmail?: string;
	// Who lives there when it's rented
	tenantName?: string;
	tenantEmail?: string;
	// Share of the community's expenses and votes, as a percentage (e.g. 3.25). The census should add up to 100
	coefficient?: number;
}

// As deeds write it, e.g. "20,5 %"
export function formatCoefficient(coefficient = 0) {
	return `${coefficient.toLocaleString('es', { maximumFractionDigits: 4 })} %`;
}

// The sum of the coefficients, rounded to 2 decimals as deeds have them
export function totalCoefficient(properties: Pick<Property, 'coefficient'>[]) {
	return Math.round(properties.reduce((total, property) => total + (property.coefficient ?? 0), 0) * 100) / 100;
}

/**
 * Splits an amount in cents between properties by their coefficient, so receipts and budgets add up to the cent:
 * each one gets its share rounded down, and the cents left go to the biggest remainders.
 * Properties without a coefficient pay nothing
 */
export function splitByCoefficient<T extends Pick<Property, 'coefficient'>>(cents: number, properties: T[]) {
	const total = properties.reduce((sum, property) => sum + (property.coefficient ?? 0), 0);
	if (!total) {
		return properties.map(property => ({ property, cents: 0 }));
	}

	const shares = properties.map((property) => {
		const exact = cents * (property.coefficient ?? 0) / total;
		return { property, cents: Math.floor(exact), remainder: exact - Math.floor(exact) };
	});
	let left = cents - shares.reduce((sum, share) => sum + share.cents, 0);
	for (const share of [...shares].sort((a, b) => b.remainder - a.remainder)) {
		if (left <= 0) {
			break;
		}
		share.cents++;
		left--;
	}
	return shares.map(({ property, cents }) => ({ property, cents }));
}

export const propertyTypeLabels: Record<Property['type'], string> = {
	home: 'Vivienda',
	parking: 'Plaza de garaje',
	storage: 'Trastero',
	other: 'Otro',
};

export const propertyTypeIcons: Record<Property['type'], string> = {
	home: 'lucide:house',
	parking: 'lucide:car',
	storage: 'lucide:package',
	other: 'lucide:map-pin',
};
