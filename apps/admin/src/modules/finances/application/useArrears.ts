import type { Claim, DebtCase, DebtCaseStatus, Monitorio } from '@gobernansa/shared/domain/arrears.ts';
import type { Property } from '@gobernansa/shared/domain/property.ts';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { claimChannels, claimLevels, debtCaseStatus } from '@gobernansa/shared/domain/arrears.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { arrayRemove, arrayUnion, collection, deleteField, doc, getDoc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore';

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
export async function recordClaim(communityId: string, property: Pick<Property, 'id' | 'name'>, claim: Claim, current?: DebtCase) {
	const uid = signedUid();
	const now = serverTimestamp();
	const batch = writeBatch(db);
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
