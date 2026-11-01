import type { Budget, BudgetItem, Charge, Expense, FeePlan } from '@gobernansa/shared/domain/finance.ts';
import type { Property } from '@gobernansa/shared/domain/property.ts';
import type { User } from '@gobernansa/shared/domain/user.ts';
import type { MaybeRefOrGetter } from 'vue';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { chargeTypes, feeBatchId, feePeriodicities, payableAmount } from '@gobernansa/shared/domain/finance.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, deleteField, doc, getDoc, getDocs, query, serverTimestamp, Timestamp, where, writeBatch } from 'firebase/firestore';
import { computed, toValue } from 'vue';
import { useCollection, useDocument } from 'vuefire';

// A batch takes up to 500 writes, one of them is the activity entry
const CHARGES_PER_BATCH = 499;

const propertiesRef = collection(db, 'properties');

function chargesRef(communityId: string) {
	return collection(db, 'communities', communityId, 'charges');
}

export function budgetRef(communityId: string, year: number) {
	return doc(db, 'communities', communityId, 'budgets', String(year));
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

// 'YYYY-MM-DD' from a date input, at the end of that day so it isn't overdue until the day after
export function toDueDate(date: string) {
	return Timestamp.fromDate(new Date(`${date}T23:59:59`));
}

// With the owner's name: properties added before the census only keep the owner's account, so it's taken from their profile
export function useCommunityProperties(communityId: string) {
	const properties = useCollection<Property>(query(propertiesRef, where('communityId', '==', communityId)));
	const people = useCollection<User>(query(collection(db, 'users'), where('communityId', '==', communityId)));
	return {
		data: computed(() => {
			const names = Object.fromEntries(people.value.map(person => [person.id, person.name]));
			return properties.value.map(property => property.ownerName || !names[property.ownerUid]
				? property
				// vuefire keeps id out of the spread (it isn't enumerable)
				: { ...property, id: property.id, ownerName: names[property.ownerUid] });
		}),
		pending: properties.pending,
		error: computed(() => properties.error.value ?? people.error.value),
	};
}

// Only the unpaid ones are kept live, the paid ones pile up month after month and are loaded per property on demand
export function useUnpaidCharges(communityId: string) {
	return useCollection<Charge>(query(chargesRef(communityId), where('paidAt', '==', null)));
}

// Every charge of a property, paid or not, once
export async function loadPropertyCharges(communityId: string, propertyId: string) {
	const snapshot = await getDocs(query(chargesRef(communityId), where('propertyId', '==', propertyId)));
	return snapshot.docs.map(charge => ({ ...charge.data(), id: charge.id }) as Charge)
		.sort((a, b) => b.dueDate.toMillis() - a.dueDate.toMillis());
}

export interface ChargeIssue {
	type: Charge['type'];
	concept: string;
	dueDate: Timestamp;
	// reserve: the part of it for the fondo de reserva
	shares: { property: Property; cents: number; reserve?: number }[];
	// Made beforehand, one per share: issuing again after a failure rewrites the same charges instead of duplicating them
	batchId: string;
	ids: string[];
}

// One charge per property sharing a batchId, so a fee run or a derrama can be told apart later
export async function issueCharges(communityId: string, { type, concept, dueDate, shares, batchId, ids }: ChargeIssue) {
	const uid = signedUid();
	const now = serverTimestamp();
	const total = shares.reduce((sum, share) => sum + share.cents, 0);

	// ponytail: past 499 properties the run is split in several batches, a failure halfway leaves the first ones issued
	for (let start = 0; start < shares.length; start += CHARGES_PER_BATCH) {
		const batch = writeBatch(db);
		for (const [index, { property, cents, reserve }] of shares.slice(start, start + CHARGES_PER_BATCH).entries()) {
			batch.set(doc(chargesRef(communityId), ids[start + index]), {
				communityId,
				propertyId: property.id,
				propertyName: property.name,
				ownerUid: property.ownerUid ?? '',
				...(property.ownerName ? { ownerName: property.ownerName } : {}),
				type,
				concept,
				amount: cents,
				dueDate,
				paidAt: null,
				batchId,
				...(reserve ? { reserve } : {}),
				createdAt: now,
				createdBy: uid,
				updatedAt: now,
				updatedBy: uid,
			});
		}
		logActivity(batch, communityId, {
			area: 'finance',
			summary: `Emitió ${chargeTypes[type].toLowerCase()} «${concept}» a ${shares.length} propiedades por ${formatCents(total)}`,
			link: `/communities/${communityId}/charges`,
		});
		await batch.commit();
	}
}

// paidAt is given, so undoing puts back the exact date it had
export async function setChargePaid(communityId: string, charge: Charge, paidAt: Timestamp | null) {
	const paid = !!paidAt;
	const uid = signedUid();
	// A payment from the app marked unpaid is reverted: the charge drops it, the payment stays marked so. Undoing it
	// (paid again, with the charge as it was) brings it back
	const revert = !paid && !!charge.payment;
	const batch = writeBatch(db);
	batch.update(doc(chargesRef(communityId), charge.id), {
		paidAt,
		...(charge.payment ? { payment: paid ? charge.payment : deleteField() } : {}),
		updatedAt: serverTimestamp(),
		updatedBy: uid,
	});
	if (charge.payment) {
		batch.update(doc(db, 'communities', communityId, 'payments', charge.payment.id), paid
			? { revertedAt: deleteField(), revertedBy: deleteField() }
			: { revertedAt: serverTimestamp(), revertedBy: uid });
	}
	logActivity(batch, communityId, {
		area: 'finance',
		summary: `Marcó «${charge.concept}» de ${charge.propertyName} como ${paid ? 'pagado' : 'pendiente'}${revert ? ', anulando su pago de prueba' : ''}`,
		link: `/communities/${communityId}/charges`,
	});
	await batch.commit();
}

// Whether neighbours can pay from the app. Only the test mode exists for now, off removes the field
export async function saveOnlinePayments(communityId: string, mode: 'test' | null) {
	const batch = writeBatch(db);
	batch.update(doc(db, 'communities', communityId), { onlinePayments: mode ?? deleteField(), updatedAt: serverTimestamp(), updatedBy: signedUid() });
	logActivity(batch, communityId, {
		area: 'finance',
		summary: mode ? 'Activó los pagos online de los vecinos en modo de prueba' : 'Desactivó los pagos online de los vecinos',
		link: `/communities/${communityId}/charges`,
	});
	await batch.commit();
}

export async function deleteCharge(communityId: string, charge: Charge) {
	const batch = writeBatch(db);
	batch.delete(doc(chargesRef(communityId), charge.id));
	logActivity(batch, communityId, {
		area: 'finance',
		summary: `Borró «${charge.concept}» de ${charge.propertyName} (${formatCents(charge.amount)})`,
		link: `/communities/${communityId}/charges`,
	});
	await batch.commit();
}

// Undoes deleteCharge: the same charge again, with its id and the data it had
export async function restoreCharge(communityId: string, { id, ...charge }: Charge) {
	const batch = writeBatch(db);
	batch.set(doc(chargesRef(communityId), id), { ...charge, updatedAt: serverTimestamp(), updatedBy: signedUid() });
	logActivity(batch, communityId, {
		area: 'finance',
		summary: `Restauró «${charge.concept}» de ${charge.propertyName} (${formatCents(charge.amount)})`,
		link: `/communities/${communityId}/charges`,
	});
	await batch.commit();
}

// What the certificate and the statement need, read once: the property and every charge it has had
export async function loadPropertyAccount(communityId: string, propertyId: string) {
	const [property, charges] = await Promise.all([
		getDoc(doc(propertiesRef, propertyId)),
		getDocs(query(chargesRef(communityId), where('propertyId', '==', propertyId))),
	]);
	const found = property.exists() ? { ...property.data(), id: property.id } as Property : undefined;
	// Properties added before the census only keep the owner's account
	if (found && !found.ownerName && found.ownerUid) {
		// A profile that no longer exists can't be read either (the rules check its community), the certificate goes without a name then
		const owner = await getDoc(doc(db, 'users', found.ownerUid)).catch(() => undefined);
		found.ownerName = (owner?.data() as User | undefined)?.name;
	}
	return {
		property: found,
		charges: charges.docs.map(charge => ({ ...charge.data(), id: charge.id }) as Charge),
	};
}

export function useBudget(communityId: string, year: MaybeRefOrGetter<number>) {
	return useDocument<Budget>(computed(() => budgetRef(communityId, toValue(year))));
}

export interface BudgetData {
	items: BudgetItem[];
	reserve: number;
	reserveOpening: number;
}

export async function saveBudget(communityId: string, year: number, { items, reserve, reserveOpening }: BudgetData, exists: boolean) {
	const uid = signedUid();
	const now = serverTimestamp();
	const batch = writeBatch(db);
	batch.set(budgetRef(communityId, year), {
		year,
		items,
		reserve,
		reserveOpening,
		updatedAt: now,
		updatedBy: uid,
		...(exists ? {} : { createdAt: now, createdBy: uid }),
	}, { merge: true });
	logActivity(batch, communityId, {
		area: 'finance',
		summary: `Guardó el presupuesto de ${year}: ${formatCents(items.reduce((sum, item) => sum + item.amount, 0))} en ${items.length} partidas${reserve ? ` y ${formatCents(reserve)} al fondo de reserva` : ''}`,
		link: `/communities/${communityId}/budget`,
	});
	await batch.commit();
}

export function useExpenses(communityId: string, year: MaybeRefOrGetter<number>) {
	return useCollection<Expense>(computed(() => query(expensesRef(communityId), where('year', '==', toValue(year)))));
}

export type ExpenseData = Pick<Expense, 'itemId' | 'concept' | 'amount' | 'date' | 'provider' | 'invoiceNumber' | 'base' | 'vatRate' | 'vat'
	| 'withholdingRate' | 'withholding' | 'withholdingType' | 'dueDate' | 'paidAt' | 'paymentMethod' | 'fromReserve'>;

// id made when the form opens, so sending it twice writes one expense. Fields left out aren't written
export async function addExpense(communityId: string, id: string, data: ExpenseData) {
	const expense = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) as ExpenseData;
	const uid = signedUid();
	const now = serverTimestamp();
	const batch = writeBatch(db);
	batch.set(doc(expensesRef(communityId), id), {
		...expense,
		year: expense.date.toDate().getFullYear(),
		createdAt: now,
		createdBy: uid,
		updatedAt: now,
		updatedBy: uid,
	});
	logActivity(batch, communityId, {
		area: 'finance',
		summary: `Añadió el gasto «${expense.concept}» de ${formatCents(expense.amount)}`,
		link: `/communities/${communityId}/budget`,
	});
	await batch.commit();
}

// Invoices still owed, few at a time, so kept live. Older expenses have no paidAt and don't match
export function useUnpaidInvoices(communityId: string) {
	return useCollection<Expense>(query(expensesRef(communityId), where('paidAt', '==', null)));
}

// paidAt is given, so undoing puts back the exact date it had
export async function setExpensePaid(communityId: string, expense: Expense, paidAt: Timestamp | null) {
	const batch = writeBatch(db);
	batch.update(doc(expensesRef(communityId), expense.id), {
		paidAt,
		updatedAt: serverTimestamp(),
		updatedBy: signedUid(),
	});
	logActivity(batch, communityId, {
		area: 'finance',
		summary: `Marcó la factura «${expense.concept}»${expense.provider ? ` de ${expense.provider.name}` : ''} como ${paidAt ? 'pagada' : 'pendiente'} (${formatCents(payableAmount(expense))})`,
		link: `/communities/${communityId}/payables`,
	});
	await batch.commit();
}

export async function deleteExpense(communityId: string, expense: Expense) {
	const batch = writeBatch(db);
	batch.delete(doc(expensesRef(communityId), expense.id));
	logActivity(batch, communityId, {
		area: 'finance',
		summary: `Borró el gasto «${expense.concept}» de ${formatCents(expense.amount)}`,
		link: `/communities/${communityId}/budget`,
	});
	await batch.commit();
}

// Undoes deleteExpense: the same expense again, with its id and the data it had
export async function restoreExpense(communityId: string, { id, ...expense }: Expense) {
	const batch = writeBatch(db);
	batch.set(doc(expensesRef(communityId), id), { ...expense, updatedAt: serverTimestamp(), updatedBy: signedUid() });
	logActivity(batch, communityId, {
		area: 'finance',
		summary: `Restauró el gasto «${expense.concept}» de ${formatCents(expense.amount)}`,
		link: `/communities/${communityId}/budget`,
	});
	await batch.commit();
}

// The year's expenses once, for the fondo de reserva's balance
export async function loadExpenses(communityId: string, year: number) {
	const snapshot = await getDocs(query(expensesRef(communityId), where('year', '==', year)));
	return snapshot.docs.map(expense => ({ ...expense.data(), id: expense.id }) as Expense);
}

// The fees already issued from the year's budget, paid or not, once
export async function loadFees(communityId: string, year: number) {
	const snapshot = await getDocs(query(chargesRef(communityId), where('batchId', '==', feeBatchId(year))));
	return snapshot.docs.map(charge => ({ ...charge.data(), id: charge.id }) as Charge);
}

// The plan is kept in the budget first, then each period is issued with only the fees still missing: retrying after a
// failure, or after adding a property, issues what's left and never touches what was already issued (or paid)
export async function issueFees(communityId: string, year: number, plan: FeePlan, periods: Omit<ChargeIssue, 'type' | 'batchId'>[]) {
	const batch = writeBatch(db);
	batch.set(budgetRef(communityId, year), { fees: plan, updatedAt: serverTimestamp(), updatedBy: signedUid() }, { merge: true });
	logActivity(batch, communityId, {
		area: 'finance',
		summary: `Generó las cuotas de ${year} del presupuesto: ${feePeriodicities[plan.months].toLowerCase()}, desde el ${plan.firstDue.split('-').reverse().join('/')}`,
		link: `/communities/${communityId}/fees`,
	});
	await batch.commit();
	// Read again right before writing: a fee paid or issued elsewhere since the page loaded must not be overwritten unpaid
	const issued = new Set((await loadFees(communityId, year)).map(fee => fee.id));
	for (const period of periods) {
		const missing = period.ids.flatMap((id, index) => issued.has(id) ? [] : [{ id, share: period.shares[index] }]);
		if (missing.length) {
			await issueCharges(communityId, { ...period, shares: missing.map(({ share }) => share), ids: missing.map(({ id }) => id), type: 'fee', batchId: feeBatchId(year) });
		}
	}
}

// Annulling a run, e.g. issued with the wrong periodicity. Only those not paid
export async function deleteCharges(communityId: string, charges: Charge[], label: string) {
	await writeCharges(communityId, charges, `Anuló ${label}: ${charges.length} recibos por ${formatCents(charges.reduce((sum, charge) => sum + charge.amount, 0))}`);
}

// Undoes deleteCharges: the same charges again, with their ids and the data they had
export async function restoreCharges(communityId: string, charges: Charge[], label: string) {
	await writeCharges(communityId, charges, `Restauró ${label}: ${charges.length} recibos`, true);
}

async function writeCharges(communityId: string, charges: Charge[], summary: string, restore = false) {
	const uid = signedUid();
	for (let start = 0; start < charges.length; start += CHARGES_PER_BATCH) {
		const batch = writeBatch(db);
		for (const { id, ...charge } of charges.slice(start, start + CHARGES_PER_BATCH)) {
			if (restore) {
				batch.set(doc(chargesRef(communityId), id), { ...charge, updatedAt: serverTimestamp(), updatedBy: uid });
			} else {
				batch.delete(doc(chargesRef(communityId), id));
			}
		}
		logActivity(batch, communityId, { area: 'finance', summary, link: `/communities/${communityId}/fees` });
		await batch.commit();
	}
}
