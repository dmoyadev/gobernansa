import type { FeeInvoice, InvoiceDraft, Office, OfficeData } from '@gobernansa/shared/domain/billing.ts';
import type { Budget, VatRate } from '@gobernansa/shared/domain/finance.ts';
import type { VerifactuLink, VerifactuRecord } from '@gobernansa/shared/domain/verifactu.ts';
import type { FirestoreError, Transaction } from 'firebase/firestore';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { counterKey, expenseIdOf, feeInvoiceAmounts, invoiceNumber, invoiceTypes } from '@gobernansa/shared/domain/billing.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { aeatDate, altaRecord, anulacionRecord, generationTime, simulatedSubmission } from '@gobernansa/shared/domain/verifactu.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { arrayUnion, collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, Timestamp, where, writeBatch } from 'firebase/firestore';
import { computed } from 'vue';
import { useCurrentUser, useDocument } from 'vuefire';

// Each invoice writes itself, its record and the activity entry, plus the office once: within the 500 writes of a
// transaction. ponytail: an office with more communities bills them in several runs
export const MAX_RUN_INVOICES = 160;

function signedUid() {
	const uid = auth.currentUser?.uid;
	if (!uid) {
		throw new Error('The admin must be signed in to invoice');
	}
	return uid;
}

function officeRef(uid: string) {
	return doc(db, 'offices', uid);
}

function invoicesRef(uid: string) {
	return collection(db, 'offices', uid, 'invoices');
}

function recordsRef(uid: string) {
	return collection(db, 'offices', uid, 'verifactu');
}

// The signed in administrator's, a single document kept live
export function useOffice() {
	const user = useCurrentUser();
	return useDocument<Office>(computed(() => user.value ? officeRef(user.value.uid) : null));
}

export async function saveOffice(data: OfficeData, exists: boolean) {
	const uid = signedUid();
	const now = serverTimestamp();
	await writeBatch(db).set(officeRef(uid), {
		...data,
		updatedAt: now,
		updatedBy: uid,
		...(exists ? {} : { createdAt: now, createdBy: uid }),
	}, { merge: true }).commit();
}

function toInvoices(docs: { id: string; data: () => unknown }[]) {
	return docs.map(invoice => ({ ...invoice.data() as FeeInvoice, id: invoice.id }));
}

// The year's invoices once, newest number first
export async function loadInvoices(year: number) {
	const snapshot = await getDocs(query(invoicesRef(signedUid()), where('year', '==', year)));
	return toInvoices(snapshot.docs).sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
}

export async function loadInvoice(id: string) {
	const snapshot = await getDoc(doc(invoicesRef(signedUid()), id));
	return snapshot.exists() ? toInvoices([snapshot])[0] : undefined;
}

export async function loadInvoiceRecords(invoiceId: string) {
	const snapshot = await getDocs(query(recordsRef(signedUid()), where('invoiceId', '==', invoiceId)));
	return snapshot.docs.map(record => ({ ...record.data(), id: record.id }) as VerifactuRecord).sort((a, b) => a.seq - b.seq);
}

// The year's records once, in the chain's order
export async function loadRecords(year: number) {
	const snapshot = await getDocs(query(recordsRef(signedUid()), where('year', '==', year)));
	return snapshot.docs.map(record => ({ ...record.data(), id: record.id }) as VerifactuRecord).sort((a, b) => a.seq - b.seq);
}

// The office as it is in the transaction, and where its chain goes on. A new NIF is another issuer, with its own chain
async function readOffice(tx: Transaction, uid: string) {
	const snapshot = await tx.get(officeRef(uid));
	if (!snapshot.exists()) {
		throw new Error('Faltan los datos fiscales del despacho');
	}
	const office = snapshot.data() as Office;
	return { office, chain: office.chain?.nif === office.nif ? office.chain : null, seq: office.recordCount ?? 0 };
}

function link(record: Pick<VerifactuRecord, 'issuer' | 'number' | 'date' | 'huella'>): VerifactuLink {
	return { nif: record.issuer.nif, number: record.number, date: record.date, huella: record.huella };
}

export interface IssueDraft extends InvoiceDraft {
	vatRate: VatRate;
	withholdingRate: number;
}

/**
 * Numbers the invoices without gaps, makes each one's Verifactu record chained to the previous one and "sends" it (test
 * mode), all in one transaction with the office's counters and chain: two runs at once can't take the same number or
 * fork the chain. The ids are made beforehand, those already issued (a retried run) are skipped. Returns the new ones
 */
export async function issueInvoices(drafts: IssueDraft[], monthlyFees?: Record<string, number>) {
	const uid = signedUid();
	return runTransaction(db, async (tx) => {
		const { office, ...state } = await readOffice(tx, uid);
		let { chain, seq } = state;
		const existing = await Promise.all(drafts.map(async draft => tx.get(doc(invoicesRef(uid), draft.id))));
		const counters = { ...office.counters };
		const lastDates = { ...office.lastDates };
		const now = serverTimestamp();
		const issued: Omit<FeeInvoice, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>[] = [];

		for (const draft of drafts.filter((_, index) => !existing[index].exists())) {
			const year = Number(draft.date.slice(0, 4));
			const series = draft.type === 'R1' ? office.rectSeries : office.series;
			const key = counterKey(series, year);
			// Numbers follow the dates within a series (RD 1619/2012)
			if (draft.date < (lastDates[key] ?? '')) {
				throw new Error(`la serie ${series} ya tiene una factura del ${aeatDate(lastDates[key])}: la fecha no puede ser anterior`);
			}
			lastDates[key] = draft.date;
			counters[key] = (counters[key] ?? 0) + 1;
			const invoice = {
				id: draft.id,
				number: invoiceNumber(series, year, counters[key]),
				series,
				year,
				date: draft.date,
				type: draft.type,
				issuer: { nif: office.nif, name: office.name, address: office.address, ...(office.iban ? { iban: office.iban } : {}) },
				communityId: draft.communityId,
				recipient: draft.recipient,
				lines: draft.lines,
				vatRate: draft.vatRate,
				withholdingRate: draft.withholdingRate,
				...feeInvoiceAmounts(draft.lines, draft.vatRate, draft.withholdingRate),
				...(draft.period ? { period: draft.period } : {}),
				...(draft.rectifies ? { rectifies: draft.rectifies } : {}),
			};
			const record = await altaRecord(invoice, { seq: ++seq, previous: chain, generatedAt: generationTime(), submission: simulatedSubmission() }, uid);
			const { id, ...data } = invoice;
			tx.set(doc(invoicesRef(uid), id), { ...data, huella: record.huella, createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid });
			tx.set(doc(recordsRef(uid), `${id}-alta`), { ...record, createdAt: now, createdBy: uid });
			if (draft.rectifies) {
				tx.update(doc(invoicesRef(uid), draft.rectifies.id), { rectifiedBy: arrayUnion(invoice.number), updatedAt: now, updatedBy: uid });
			}
			logActivity(tx, draft.communityId, {
				area: 'finance',
				summary: draft.rectifies
					? `Emitió la rectificativa ${invoice.number} de la factura de honorarios ${draft.rectifies.number} por ${formatCents(invoice.total)}`
					: `Emitió a la comunidad la factura de honorarios ${invoice.number} por ${formatCents(invoice.total)}`,
				link: `/communities/${draft.communityId}/payables`,
			});
			chain = link(record);
			issued.push({ ...invoice, huella: record.huella });
		}

		if (issued.length || monthlyFees) {
			tx.update(officeRef(uid), {
				counters,
				lastDates,
				...(chain ? { chain } : {}),
				recordCount: seq,
				...(monthlyFees ? { monthlyFees } : {}),
				updatedAt: now,
				updatedBy: uid,
			});
		}
		return issued;
	});
}

// Only for an invoice that was never really issued (e.g. made by mistake): its number stays used, and the registry keeps
// both records. One that reached the community is corrected with a rectificativa instead
export async function annulInvoice(invoice: FeeInvoice) {
	const uid = signedUid();
	await runTransaction(db, async (tx) => {
		const { seq, chain } = await readOffice(tx, uid);
		const record = await anulacionRecord(invoice, { seq: seq + 1, previous: chain, generatedAt: generationTime(), submission: simulatedSubmission() }, uid);
		const now = serverTimestamp();
		tx.set(doc(recordsRef(uid), `${invoice.id}-anulacion`), { ...record, createdAt: now, createdBy: uid });
		tx.update(doc(invoicesRef(uid), invoice.id), { annulled: true, updatedAt: now, updatedBy: uid });
		tx.update(officeRef(uid), { chain: link(record), recordCount: seq + 1, updatedAt: now, updatedBy: uid });
		logActivity(tx, invoice.communityId, {
			area: 'finance',
			summary: `Anuló el registro de la factura de honorarios ${invoice.number} del despacho`,
			link: `/communities/${invoice.communityId}/payables`,
		});
	});
}

/**
 * The invoice as one of the office's in the community's books (a supplier invoice, unpaid), so both sides match. The
 * office is a provider shared with the community, made the first time. The expense's id comes from the invoice's,
 * so recording it twice writes it once
 */
export async function recordInBooks(invoice: FeeInvoice, office: Office, itemId: string) {
	const uid = signedUid();
	// Recorded meanwhile (another tab): it isn't written again over what was paid since
	if ((await getDoc(doc(invoicesRef(uid), invoice.id))).data()?.expenseId) {
		return;
	}
	const write = async (providerId: string, created: boolean) => {
		const now = serverTimestamp();
		const batch = writeBatch(db);
		const providerRef = doc(db, 'providers', providerId);
		if (created) {
			batch.set(providerRef, {
				name: office.name,
				category: 'other',
				phone: '',
				email: office.email ?? '',
				cif: office.nif,
				fiscalName: office.name,
				address: office.address,
				iban: office.iban ?? '',
				notes: 'Administración de fincas',
				communityIds: [invoice.communityId],
				ratingSum: 0,
				ratingCount: 0,
				createdAt: now,
				createdBy: uid,
				updatedAt: now,
				updatedBy: uid,
			});
			batch.update(officeRef(uid), { providerId });
		} else {
			batch.update(providerRef, { communityIds: arrayUnion(invoice.communityId), updatedAt: now, updatedBy: uid });
		}
		const date = Timestamp.fromDate(new Date(`${invoice.date}T12:00`));
		batch.set(doc(db, 'communities', invoice.communityId, 'expenses', expenseIdOf(invoice.id)), {
			year: invoice.year,
			itemId,
			concept: `${invoiceTypes[invoice.type]} de honorarios ${invoice.number}`,
			amount: invoice.total,
			date,
			provider: { id: providerId, name: office.name, nif: invoice.issuer.nif },
			invoiceNumber: invoice.number,
			base: invoice.base,
			vatRate: invoice.vatRate,
			vat: invoice.vat,
			withholdingRate: invoice.withholdingRate,
			withholding: invoice.withholding,
			...(invoice.withholdingRate ? { withholdingType: 'professional' } : {}),
			paidAt: null,
			createdAt: now,
			createdBy: uid,
			updatedAt: now,
			updatedBy: uid,
		});
		batch.update(doc(invoicesRef(uid), invoice.id), { expenseId: expenseIdOf(invoice.id), updatedAt: now, updatedBy: uid });
		logActivity(batch, invoice.communityId, {
			area: 'finance',
			summary: `Anotó la factura de honorarios ${invoice.number} del despacho como gasto por ${formatCents(invoice.total)}`,
			link: `/communities/${invoice.communityId}/payables`,
		});
		await batch.commit();
	};

	if (!office.providerId) {
		return write(doc(collection(db, 'providers')).id, true);
	}
	// Removed from the directory since: made again
	await write(office.providerId, false).catch(async (error: FirestoreError) => {
		if (error.code !== 'not-found' && error.code !== 'permission-denied') {
			throw error;
		}
		await write(doc(collection(db, 'providers')).id, true);
	});
}

// The partidas of the community's budget for the year, to file the expense under one
export async function loadBudgetItems(communityId: string, year: number) {
	const snapshot = await getDoc(doc(db, 'communities', communityId, 'budgets', String(year)));
	return (snapshot.data() as Budget | undefined)?.items ?? [];
}
