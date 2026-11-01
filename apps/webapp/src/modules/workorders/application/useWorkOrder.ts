import type { WorkOrder, WorkOrderStep } from '@gobernansa/shared/domain/workOrder.ts';
import { db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { doc, serverTimestamp, Timestamp, updateDoc } from 'firebase/firestore';
import { useDocument } from 'vuefire';

const TOKEN_REGEX = /^[\w-]{22,64}$/;

// The parte de trabajo the link points to, the page's only read. Live, so one revoked meanwhile stops at once
export function useWorkOrder(token: string) {
	const workOrderRef = TOKEN_REGEX.test(token) ? doc(db, 'workOrders', token) : null;
	const workOrder = useDocument<WorkOrder>(workOrderRef);

	// One step at a time, as the rules ask, with the visit date or the photos that go with it
	async function report(step: Omit<WorkOrderStep, 'at'>, photos: string[] = []) {
		await updateDoc(workOrderRef!, {
			status: step.status,
			...(step.scheduledAt ? { scheduledAt: step.scheduledAt } : {}),
			...(photos.length ? { photos } : {}),
			history: [...workOrder.value!.history, { ...step, at: Timestamp.now() }],
			updatedAt: serverTimestamp(),
		});
	}

	return { workOrder, report };
}
