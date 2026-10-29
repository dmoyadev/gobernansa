import type { Budget, BudgetItem, Charge, Expense } from '@gobernansa/shared/domain/finance.ts';
import type { Property } from '@gobernansa/shared/domain/property.ts';
import type { User } from '@gobernansa/shared/domain/user.ts';
import type { MaybeRefOrGetter } from 'vue';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { chargeTypes } from '@gobernansa/shared/domain/finance.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, doc, getDoc, getDocs, query, serverTimestamp, Timestamp, where, writeBatch } from 'firebase/firestore';
import { computed, toValue } from 'vue';
import { useCollection, useDocument } from 'vuefire';

// A batch takes up to 500 writes, one of them is the activity entry
const CHARGES_PER_BATCH = 499;

const propertiesRef = collection(db, 'properties');

function chargesRef(communityId: string) {
	return collection(db, 'communities', communityId, 'charges');
}

function budgetRef(communityId: string, year: number) {
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
	shares: { property: Property; cents: number }[];
}

// One charge per property sharing a batchId, so a fee run or a derrama can be told apart later
export async function issueCharges(communityId: string, { type, concept, dueDate, shares }: ChargeIssue) {
	const uid = signedUid();
	const batchId = doc(chargesRef(communityId)).id;
	const now = serverTimestamp();
	const total = shares.reduce((sum, share) => sum + share.cents, 0);

	// ponytail: past 499 properties the run is split in several batches, a failure halfway leaves the first ones issued
	for (let start = 0; start < shares.length; start += CHARGES_PER_BATCH) {
		const batch = writeBatch(db);
		for (const { property, cents } of shares.slice(start, start + CHARGES_PER_BATCH)) {
			batch.set(doc(chargesRef(communityId)), {
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

export async function setChargePaid(communityId: string, charge: Charge, paid: boolean) {
	const batch = writeBatch(db);
	batch.update(doc(chargesRef(communityId), charge.id), {
		paidAt: paid ? Timestamp.now() : null,
		updatedAt: serverTimestamp(),
		updatedBy: signedUid(),
	});
	logActivity(batch, communityId, {
		area: 'finance',
		summary: `Marcó «${charge.concept}» de ${charge.propertyName} como ${paid ? 'pagado' : 'pendiente'}`,
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

// What the certificate needs, read once
export async function loadCertificate(communityId: string, propertyId: string) {
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
		unpaid: charges.docs.map(charge => ({ ...charge.data(), id: charge.id }) as Charge).filter(charge => !charge.paidAt),
	};
}

export function useBudget(communityId: string, year: MaybeRefOrGetter<number>) {
	return useDocument<Budget>(computed(() => budgetRef(communityId, toValue(year))));
}

export async function saveBudget(communityId: string, year: number, items: BudgetItem[], exists: boolean) {
	const uid = signedUid();
	const now = serverTimestamp();
	const batch = writeBatch(db);
	batch.set(budgetRef(communityId, year), {
		year,
		items,
		updatedAt: now,
		updatedBy: uid,
		...(exists ? {} : { createdAt: now, createdBy: uid }),
	}, { merge: true });
	logActivity(batch, communityId, {
		area: 'finance',
		summary: `Guardó el presupuesto de ${year}: ${formatCents(items.reduce((sum, item) => sum + item.amount, 0))} en ${items.length} partidas`,
		link: `/communities/${communityId}/budget`,
	});
	await batch.commit();
}

export function useExpenses(communityId: string, year: MaybeRefOrGetter<number>) {
	return useCollection<Expense>(computed(() => query(expensesRef(communityId), where('year', '==', toValue(year)))));
}

export type ExpenseData = Pick<Expense, 'itemId' | 'concept' | 'amount' | 'date' | 'provider'>;

export async function addExpense(communityId: string, { provider, ...expense }: ExpenseData) {
	const uid = signedUid();
	const now = serverTimestamp();
	const batch = writeBatch(db);
	batch.set(doc(expensesRef(communityId)), {
		...expense,
		...(provider ? { provider } : {}),
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
