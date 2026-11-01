import type { Claim, DebtCase, DebtCaseStatus, Monitorio } from '@gobernansa/shared/domain/arrears.ts';
import type { LateInterest } from '@gobernansa/shared/domain/community.ts';
import type { Charge } from '@gobernansa/shared/domain/finance.ts';
import type { Property } from '@gobernansa/shared/domain/property.ts';
import type { MailDraft } from '@/modules/mail/application/mail.ts';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { claimChannels, claimLevels, debtCaseStatus, formatRate } from '@gobernansa/shared/domain/arrears.ts';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { INTEREST_BATCH_ID } from '@gobernansa/shared/domain/finance.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { arrayRemove, arrayUnion, collection, deleteField, doc, getDoc, getDocs, query, serverTimestamp, Timestamp, where, writeBatch } from 'firebase/firestore';
import { newId } from '@/app/ux/navigation.ts';
import { queueMail } from '@/modules/mail/application/mail.ts';
import { toDueDate } from './useFinances.ts';

// Days a recibo de intereses gives to pay it, as the first reminder
const INTEREST_DUE_DAYS = 15;

function debtCasesRef(communityId: string) {
	return collection(db, 'communities', communityId, 'debtCases');
}

function signedUid() {
	const uid = auth.currentUser?.uid;
	if (!uid) {
		throw new Error('The admin must be signed in to claim debts');
	}
	return uid;
}

function link(communityId: string) {
	return `/communities/${communityId}/arrears`;
}

// One per property ever claimed, so few: read whole, once
export async function loadDebtCases(communityId: string) {
	const snapshot = await getDocs(debtCasesRef(communityId));
	return snapshot.docs.map(debtCase => ({ ...debtCase.data(), id: debtCase.id }) as DebtCase);
}

export async function loadDebtCase(communityId: string, propertyId: string) {
	const snapshot = await getDoc(doc(debtCasesRef(communityId), propertyId));
	return snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } as DebtCase : undefined;
}

// The case is created with the first claim. Claiming again reopens a closed one, a monitorio under way stays so
// With mail, the letter is queued by email in the same write
export async function recordClaim(communityId: string, property: Pick<Property, 'id' | 'name'>, claim: Claim, current?: DebtCase, mail?: MailDraft) {
	const uid = signedUid();
	const now = serverTimestamp();
	const batch = writeBatch(db);
	if (mail) {
		queueMail(batch, mail);
	}
	batch.set(doc(debtCasesRef(communityId), property.id), {
		propertyId: property.id,
		propertyName: property.name,
		status: current?.status === 'monitorio' ? 'monitorio' : 'claimed',
		claims: arrayUnion(claim),
		updatedAt: now,
		updatedBy: uid,
		...(current ? {} : { createdAt: now, createdBy: uid }),
	}, { merge: true });
	logActivity(batch, communityId, {
		area: 'finance',
		summary: `Reclamó a ${property.name} ${formatCents(claim.amount)}: ${claimLevels[claim.level].label.toLowerCase()} por ${claimChannels[claim.channel].toLowerCase()}${claim.tracking ? ` (${claim.tracking})` : ''}`,
		link: link(communityId),
	});
	await batch.commit();
}

// One recorded by mistake
export async function removeClaim(communityId: string, debtCase: Pick<DebtCase, 'id' | 'propertyName'>, claim: Claim) {
	const batch = writeBatch(db);
	batch.update(doc(debtCasesRef(communityId), debtCase.id), {
		claims: arrayRemove(claim),
		updatedAt: serverTimestamp(),
		updatedBy: signedUid(),
	});
	logActivity(batch, communityId, {
		area: 'finance',
		summary: `Quitó la reclamación del ${claim.date.split('-').reverse().join('/')} a ${debtCase.propertyName}`,
		link: link(communityId),
	});
	await batch.commit();
}

// Undoes removeClaim or recordClaim: the claims as they were, in their order, and the status. A case that didn't
// exist is deleted
export async function restoreClaims(communityId: string, { id, propertyName, claims, status }: Pick<DebtCase, 'id' | 'propertyName' | 'claims' | 'status'>, exists = true) {
	const batch = writeBatch(db);
	if (exists) {
		batch.update(doc(debtCasesRef(communityId), id), { claims, status, updatedAt: serverTimestamp(), updatedBy: signedUid() });
	} else {
		batch.delete(doc(debtCasesRef(communityId), id));
	}
	logActivity(batch, communityId, {
		area: 'finance',
		summary: exists ? `Restauró las reclamaciones a ${propertyName}` : `Deshizo la reclamación a ${propertyName}`,
		link: link(communityId),
	});
	await batch.commit();
}

export async function setDebtCaseStatus(communityId: string, debtCase: Pick<DebtCase, 'id' | 'propertyName'>, status: DebtCaseStatus) {
	const batch = writeBatch(db);
	batch.update(doc(debtCasesRef(communityId), debtCase.id), { status, updatedAt: serverTimestamp(), updatedBy: signedUid() });
	logActivity(batch, communityId, {
		area: 'finance',
		summary: `Marcó la deuda de ${debtCase.propertyName} como ${debtCaseStatus[status].toLowerCase()}`,
		link: link(communityId),
	});
	await batch.commit();
}

export async function saveMonitorio(communityId: string, property: Pick<Property, 'id' | 'name'>, monitorio: Monitorio, exists: boolean) {
	const uid = signedUid();
	const now = serverTimestamp();
	const batch = writeBatch(db);
	batch.set(doc(debtCasesRef(communityId), property.id), {
		propertyId: property.id,
		propertyName: property.name,
		status: 'monitorio',
		// A merge set merges the map too: a junta picked before and now typed by hand would keep its id
		monitorio: { ...monitorio, ...(monitorio.meetingId ? {} : { meetingId: deleteField() }) },
		updatedAt: now,
		updatedBy: uid,
		...(exists ? {} : { createdAt: now, createdBy: uid, claims: [] }),
	}, { merge: true });
	logActivity(batch, communityId, {
		area: 'finance',
		summary: `Preparó el monitorio contra ${property.name} por ${formatCents(monitorio.amount)}, liquidación aprobada en la junta del ${monitorio.meetingDate.split('-').reverse().join('/')}`,
		link: link(communityId),
	});
	await batch.commit();
}

// Off with null. Only the office, from the arrears page
export async function saveLateInterest(communityId: string, settings: LateInterest | null) {
	const batch = writeBatch(db);
	batch.update(doc(db, 'communities', communityId), { lateInterest: settings ?? deleteField(), updatedAt: serverTimestamp(), updatedBy: signedUid() });
	logActivity(batch, communityId, {
		area: 'finance',
		summary: settings
			? `Aplicó intereses de demora del ${formatRate(settings.rate)} anual${settings.graceDays ? ` tras ${settings.graceDays} días de gracia` : ''}`
			: 'Dejó de aplicar intereses de demora',
		link: link(communityId),
	});
	await batch.commit();
}

// Every recibo de intereses, paid or not, to know until when each charge was charged already. Few, read once
export async function loadInterestCharges(communityId: string) {
	const snapshot = await getDocs(query(collection(db, 'communities', communityId, 'charges'), where('batchId', '==', INTEREST_BATCH_ID)));
	return snapshot.docs.map(charge => ({ ...charge.data(), id: charge.id }) as Charge);
}

/**
 * Recibo de intereses de demora for what a property's overdue charges owe until `to` ('YYYY-MM-DD'), collected like any
 * other charge. It keeps which charges and until when, so their interest is counted from then on. Gives it back
 */
export async function issueInterestCharge(communityId: string, property: Pick<Property, 'id' | 'name' | 'ownerUid' | 'ownerName'>, chargeIds: string[], amount: number, to: string) {
	const uid = signedUid();
	const due = new Date();
	due.setDate(due.getDate() + INTEREST_DUE_DAYS);
	const charge = {
		communityId,
		propertyId: property.id,
		propertyName: property.name,
		ownerUid: property.ownerUid ?? '',
		...(property.ownerName ? { ownerName: property.ownerName } : {}),
		type: 'fee' as const,
		concept: `Intereses de demora hasta el ${to.split('-').reverse().join('/')}`,
		amount,
		dueDate: toDueDate(toDateString(due)),
		paidAt: null,
		batchId: INTEREST_BATCH_ID,
		interest: { chargeIds, to },
	};
	const id = newId();
	const batch = writeBatch(db);
	batch.set(doc(db, 'communities', communityId, 'charges', id), { ...charge, createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), updatedBy: uid });
	logActivity(batch, communityId, {
		area: 'finance',
		summary: `Emitió a ${property.name} un recibo de ${formatCents(amount)} por los intereses de demora de ${chargeIds.length} ${chargeIds.length === 1 ? 'recibo' : 'recibos'} hasta el ${to.split('-').reverse().join('/')}`,
		link: `/communities/${communityId}/charges`,
	});
	await batch.commit();
	const now = Timestamp.now();
	return { ...charge, id, createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid } as Charge;
}
