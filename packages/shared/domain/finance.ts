import type { Timestamp } from 'firebase/firestore';
import type { Datable } from './audit.ts';

// Recibos and derramas, one per property, at communities/{communityId}/charges. Owners see theirs. Amounts in cents (see money.ts)
export interface Charge extends Datable {
	id: string;
	communityId: string;
	propertyId: string;
	propertyName: string;
	// The owner when it was issued, '' when they hadn't signed up
	ownerUid: string;
	ownerName?: string;
	type: 'fee' | 'levy';
	// e.g. "Cuota enero 2027" or "Derrama fachada"
	concept: string;
	amount: number;
	dueDate: Timestamp;
	paidAt: Timestamp | null;
	// The charges of the same derrama or batch of fees share it
	batchId?: string;
}

export const chargeTypes: Record<Charge['type'], string> = {
	fee: 'Recibo',
	levy: 'Derrama',
};

// Unpaid after its due date
export function isOverdue(charge: Pick<Charge, 'paidAt' | 'dueDate'>, now = new Date()) {
	return !charge.paidAt && charge.dueDate.toMillis() < now.getTime();
}

// Presupuesto anual, at communities/{communityId}/budgets/{year}
export interface Budget extends Datable {
	id: string;
	year: number;
	items: BudgetItem[];
}

// Partida, e.g. "Limpieza" or "Ascensor"
export interface BudgetItem {
	// Kept when it's renamed, expenses point to it
	id: string;
	name: string;
	amount: number;
}

// Gasto, at communities/{communityId}/expenses
export interface Expense extends Datable {
	id: string;
	year: number;
	itemId: string;
	concept: string;
	amount: number;
	date: Timestamp;
	provider?: { id: string; name: string };
}
