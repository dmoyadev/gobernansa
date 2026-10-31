import type { Expense } from '@gobernansa/shared/domain/finance.ts';
import type { PaymentOrder } from '@gobernansa/shared/domain/sepa.ts';
import type { Timestamp, WriteBatch } from 'firebase/firestore';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, deleteField, doc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';

// Each transfer writes its invoice, plus the order and the activity entry: within the 500 writes of a batch
export const MAX_PAYMENT_ITEMS = 480;

function ordersRef(communityId: string) {
	return collection(db, 'communities', communityId, 'paymentOrders');
}

function expensesRef(communityId: string) {
	return collection(db, 'communities', communityId, 'expenses');
}

function signedUid() {
	const uid = auth.currentUser?.uid;
	if (!uid) {
		throw new Error('The admin must be signed in to change the accounts');
	}
	return uid;
}

function link(communityId: string) {
	return `/communities/${communityId}/payments`;
}

// Those still tied to it, an invoice deleted since can't be updated
async function orderInvoices(communityId: string, orderId: string) {
	return (await getDocs(query(expensesRef(communityId), where('paymentOrderId', '==', orderId)))).docs;
}

// ponytail: every order once, a few a month; filter by date when a community piles up hundreds
export async function loadPaymentOrders(communityId: string) {
	const snapshot = await getDocs(ordersRef(communityId));
	return snapshot.docs.map(order => ({ ...order.data(), id: order.id }) as PaymentOrder)
		.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
}

export type PaymentOrderData = Pick<PaymentOrder, 'reference' | 'executionDate' | 'issuedAt' | 'debtor' | 'items' | 'total'>;

// The invoices are tied to it so they can't go in another one
export async function createPaymentOrder(communityId: string, id: string, data: PaymentOrderData) {
	const uid = signedUid();
	const now = serverTimestamp();
	const batch = writeBatch(db);
	batch.set(doc(ordersRef(communityId), id), { ...data, status: 'generated', createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid });
	for (const item of data.items) {
		batch.update(doc(expensesRef(communityId), item.expenseId), { paymentOrderId: id, updatedAt: now, updatedBy: uid });
	}
	logActivity(batch, communityId, {
		area: 'finance',
		summary: `Generó la orden de pago ${data.reference}: ${data.items.length} transferencias a proveedores por ${formatCents(data.total)}, el ${data.executionDate.split('-').reverse().join('/')}`,
		link: link(communityId),
	});
	await batch.commit();
}

// Only one not executed: its invoices are free to go in another
export async function deletePaymentOrder(communityId: string, order: PaymentOrder) {
	const uid = signedUid();
	const invoices = await orderInvoices(communityId, order.id);
	const batch = writeBatch(db);
	batch.delete(doc(ordersRef(communityId), order.id));
	for (const invoice of invoices) {
		batch.update(invoice.ref, { paymentOrderId: deleteField(), updatedAt: serverTimestamp(), updatedBy: uid });
	}
	logActivity(batch, communityId, {
		area: 'finance',
		summary: `Borró la orden de pago ${order.reference} (${order.items.length} transferencias por ${formatCents(order.total)})`,
		link: link(communityId),
	});
	await batch.commit();
}

/**
 * Executed marks its invoices paid on the day the bank sent the transfers. Going back (undo) marks unpaid again only
 * those it paid, not those paid by hand meanwhile. `also` adds to the same batch, e.g. the bank movement that paid it.
 * Returns the order as it's now
 */
export async function setPaymentOrderExecuted(communityId: string, order: PaymentOrder, at: Timestamp | null, also?: (batch: WriteBatch) => void) {
	const uid = signedUid();
	const now = serverTimestamp();
	const status: PaymentOrder['status'] = at ? 'executed' : 'generated';
	const invoices = await orderInvoices(communityId, order.id);
	const executedAt = order.executedAt?.toMillis();
	const batch = writeBatch(db);
	batch.update(doc(ordersRef(communityId), order.id), { status, executedAt: at, updatedAt: now, updatedBy: uid });
	for (const invoice of invoices) {
		const paidAt = (invoice.data() as Expense).paidAt;
		if (at ? !paidAt : paidAt?.toMillis() === executedAt) {
			batch.update(invoice.ref, { paidAt: at, updatedAt: now, updatedBy: uid });
		}
	}
	logActivity(batch, communityId, {
		area: 'finance',
		summary: at
			? `Marcó la orden de pago ${order.reference} como ejecutada: ${order.items.length} facturas pagadas por ${formatCents(order.total)}`
			: `Deshizo la ejecución de la orden de pago ${order.reference}`,
		link: link(communityId),
	});
	also?.(batch);
	await batch.commit();
	return { ...order, status, executedAt: at } as PaymentOrder;
}
