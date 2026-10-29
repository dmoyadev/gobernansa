import type { Timestamp } from 'firebase/firestore';
import type { Datable } from './audit.ts';

export interface Event extends Datable {
	id: string;
	title: string;
	description?: string;
	type: 'community' | 'maintenance' | 'improvements' | 'notice' | 'other';
	date: Timestamp;
	communityId: string;
	// The same notice sent to several communities at once shares it
	broadcastId?: string;
}

export const eventTypes: Record<Event['type'], { label: string; icon: string }> = {
	community: { label: 'Comunidad', icon: 'lucide:users' },
	maintenance: { label: 'Mantenimiento', icon: 'lucide:wrench' },
	improvements: { label: 'Mejoras', icon: 'lucide:lightbulb' },
	notice: { label: 'Comunicado', icon: 'lucide:megaphone' },
	other: { label: 'Otro', icon: 'lucide:info' },
};
