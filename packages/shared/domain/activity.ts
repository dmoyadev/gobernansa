import type { Timestamp } from 'firebase/firestore';

// Who changed what in a community, at communities/{communityId}/activity. Written along with each change from the admin platform, never edited
export interface Activity {
	id: string;
	at: Timestamp;
	by: string;
	byName: string;
	// What kind of change, to filter and pick an icon, e.g. 'issue' or 'meeting'
	area: ActivityArea;
	// In the past tense, e.g. 'Cambió el estado de «Fuga en el garaje» a Solucionada'
	summary: string;
	// Where to see what changed, inside the admin platform
	link?: string;
}

export type ActivityArea = 'community' | 'people' | 'property' | 'issue' | 'event' | 'meeting' | 'finance' | 'obligation' | 'booking' | 'provider' | 'moderation';

export const activityAreas: Record<ActivityArea, { label: string; icon: string }> = {
	community: { label: 'Comunidad', icon: 'lucide:building-2' },
	people: { label: 'Vecinos y gestores', icon: 'lucide:users' },
	property: { label: 'Propiedades', icon: 'lucide:house' },
	issue: { label: 'Incidencias', icon: 'lucide:message-square-warning' },
	event: { label: 'Comunicados', icon: 'lucide:megaphone' },
	meeting: { label: 'Juntas', icon: 'lucide:gavel' },
	finance: { label: 'Cuentas', icon: 'lucide:landmark' },
	obligation: { label: 'Obligaciones', icon: 'lucide:calendar-check' },
	booking: { label: 'Reservas', icon: 'lucide:calendar-clock' },
	provider: { label: 'Proveedores', icon: 'lucide:hard-hat' },
	moderation: { label: 'Moderación', icon: 'lucide:shield-alert' },
};
