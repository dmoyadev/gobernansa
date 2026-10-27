import type { Datable } from '@/shared/domain/audit.ts';
import { normalize } from '@/shared/utils/helpers.ts';

export interface Community extends Datable {
	id: string;
	name: string;
	address: string;
	constructionYear: number;
	// Offered as places when reporting an issue, e.g. "Portal" or "Garaje"
	commonAreas?: string[];
}

// Each community names its areas freely, so the icon is guessed from the name (accents and case ignored)
// shortcut: unknown names get a generic building, store a type per area if that's not enough
const COMMON_AREA_ICONS: [RegExp, string][] = [
	[/portal|entrada|vestibulo|recibidor/, 'lucide:door-open'],
	[/escalera/, 'lucide:door-stairwell'],
	[/ascensor/, 'lucide:arrow-down-up'],
	[/garaje|parking|aparcamiento/, 'lucide:car'],
	[/piscina/, 'lucide:waves-ladder'],
	// Before gardens, so "parque infantil" isn't taken as one
	[/infantil|columpio/, 'lucide:baby'],
	[/jardin|parque|zona verde/, 'lucide:trees'],
	[/pista|tenis|padel|deporte/, 'lucide:volleyball'],
	[/gimnasio/, 'lucide:dumbbell'],
	[/trastero/, 'lucide:package'],
	[/azotea|terraza|tejado/, 'lucide:sun'],
	[/basura|contenedor|reciclaje/, 'lucide:trash-2'],
	[/buzon|correo/, 'lucide:mail'],
];

export function getCommonAreaIcon(name: string) {
	const normalized = normalize(name);
	return COMMON_AREA_ICONS.find(([pattern]) => pattern.test(normalized))?.[1] ?? 'lucide:building-2';
}
