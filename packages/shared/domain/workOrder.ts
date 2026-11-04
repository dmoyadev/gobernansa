import type { Timestamp } from 'firebase/firestore';
import type { IssueCategory } from './issue.ts';

export type WorkOrderStatus = 'sent' | 'accepted' | 'rejected' | 'scheduled' | 'done';

/*
 * Parte de trabajo: the link a provider opens on their phone, without an account, to see the job and report back. At
 * workOrders/{token}: the token is the only credential, so the rules let anyone get one by id but never list them.
 * A copy of what the provider needs and nothing more, never the neighbours' personal data. The administration keeps the
 * token in the issue's private document (IssuePrivate.workOrder) and reads it by id
 */
export interface WorkOrder {
	id: string;
	communityId: string;
	issueId: string;
	community: { name: string; address: string };
	// Its category as the community had it, the provider can't read the community. Only its id on older ones
	issue: { title: string; description: string; category: Pick<IssueCategory, 'name' | 'icon'> | string; location: string; assets: string[] };
	expectedAt: Timestamp | null;
	// Who the provider calls: the community's administration contact, filled in with whoever sent it
	contact: { name: string; phone?: string; whatsapp?: string; email?: string };
	provider: { id: string; name: string };
	status: WorkOrderStatus;
	// The visit the provider scheduled, the last one if they changed it
	scheduledAt?: Timestamp;
	// Sent by the provider, only Cloudinary URLs
	photos?: string[];
	// Each step the provider took with what they wrote, oldest first. The rules only let them add one at a time, up to WORK_ORDER_LIMITS.steps
	history: WorkOrderStep[];
	createdAt: Timestamp;
	createdBy: string;
	updatedAt: Timestamp;
	// The link stops working, e.g. when the issue goes to another provider
	revokedAt: Timestamp | null;
}

export interface WorkOrderStep {
	// The device's time, serverTimestamp can't go inside arrays
	at: Timestamp;
	status: WorkOrderStatus;
	note?: string;
	scheduledAt?: Timestamp;
}

export const WORK_ORDER_LIMITS = { steps: 20, note: 2000, photos: 10 };

export const workOrderStatus: Record<WorkOrderStatus, { label: string; icon: string; color: string }> = {
	sent: { label: 'Enviado', icon: 'lucide:send', color: '#4fa2dc' },
	accepted: { label: 'Aceptado', icon: 'lucide:thumbs-up', color: '#0d9488' },
	rejected: { label: 'Rechazado', icon: 'lucide:circle-x', color: '#dc2626' },
	scheduled: { label: 'Visita programada', icon: 'lucide:calendar-clock', color: '#d97706' },
	done: { label: 'Trabajo terminado', icon: 'lucide:circle-check', color: '#11ad70' },
};

// 192 random bits in base64url, too many to guess
export function newWorkOrderToken() {
	const bytes = crypto.getRandomValues(new Uint8Array(24));
	return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_');
}
