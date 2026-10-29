import type { Timestamp } from 'firebase/firestore';
import type { Datable } from './audit.ts';

export type ObligationType = 'iee' | 'elevator' | 'extinguishers' | 'legionella' | 'insurance' | 'other';

// Inspections, revisions and renewals the community must keep, at communities/{communityId}/obligations
export interface Obligation extends Datable {
	id: string;
	communityId: string;
	type: ObligationType;
	title: string;
	dueAt: Timestamp;
	// When it's done, the next due date is this many months later. Missing for one-off ones
	everyMonths?: number;
	lastDoneAt?: Timestamp;
	provider?: { id: string; name: string };
	notes?: string;
}

// everyMonths is what's usual, each region and installation may need a different one
export const obligationTypes: Record<ObligationType, { label: string; icon: string; everyMonths?: number }> = {
	iee: { label: 'Inspección técnica del edificio (IEE)', icon: 'lucide:building', everyMonths: 120 },
	elevator: { label: 'Inspección del ascensor', icon: 'lucide:arrow-down-up', everyMonths: 24 },
	extinguishers: { label: 'Revisión de extintores', icon: 'lucide:fire-extinguisher', everyMonths: 12 },
	legionella: { label: 'Control de legionela', icon: 'lucide:droplets', everyMonths: 12 },
	insurance: { label: 'Renovación del seguro', icon: 'lucide:shield-check', everyMonths: 12 },
	other: { label: 'Otra', icon: 'lucide:calendar-check' },
};

// Days before the due date it starts being warned about
export const OBLIGATION_WARNING_DAYS = 30;

export function obligationStatus(obligation: Pick<Obligation, 'dueAt'>, now = new Date()): 'overdue' | 'soon' | 'ok' {
	const days = (obligation.dueAt.toMillis() - now.getTime()) / 86_400_000;
	if (days < 0) {
		return 'overdue';
	}
	return days <= OBLIGATION_WARNING_DAYS ? 'soon' : 'ok';
}

export const obligationStatusLabels: Record<ReturnType<typeof obligationStatus>, string> = {
	overdue: 'Vencida',
	soon: 'Vence pronto',
	ok: 'Al día',
};
