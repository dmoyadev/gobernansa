import type { ClaimStatus, InsuranceClaim, Issue, IssueComment, IssuePrivate, IssueStatus } from '@gobernansa/shared/domain/issue.ts';
import type { Provider } from '@gobernansa/shared/domain/provider.ts';
import type { User } from '@gobernansa/shared/domain/user.ts';
import type { WorkOrder } from '@gobernansa/shared/domain/workOrder.ts';
import type { MaybeRefOrGetter } from 'vue';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { claimStatus, issueLocationTypes, issueStatus } from '@gobernansa/shared/domain/issue.ts';
import { isEmail } from '@gobernansa/shared/domain/mail.ts';
import { newWorkOrderToken } from '@gobernansa/shared/domain/workOrder.ts';
import { db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, deleteField, doc, increment, limit, orderBy, query, serverTimestamp, Timestamp, where, writeBatch } from 'firebase/firestore';
import { computed, toValue } from 'vue';
import { useCollection, useDocument } from 'vuefire';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { queueMail, WEBAPP_URL, workOrderMail } from '@/modules/mail/application/mail.ts';

function issuesRef(communityId: string) {
	return collection(db, 'communities', communityId, 'issues');
}

// The parte de trabajo's page, in the webapp: providers open it without an account
export function workOrderUrl(token: string) {
	return `${WEBAPP_URL}/gremio/${token}`;
}

// Newest first, the same queries as the webapp's so they use its indexes. Live, so neighbours' new ones show up
export function useIssues(communityId: string, status: MaybeRefOrGetter<IssueStatus | undefined>, max: MaybeRefOrGetter<number>) {
	return useCollection<Issue>(computed(() => {
		const statusValue = toValue(status);
		return query(
			issuesRef(communityId),
			where('deletedAt', '==', null),
			...(statusValue ? [where('status', '==', statusValue)] : []),
			orderBy('createdAt', 'desc'),
			limit(toValue(max)),
		);
	}));
}

// Reported by the administration, e.g. after a call. The same fields as the webapp's, so neighbours see it as any other.
// The id comes from the form (newId), so sending it twice writes the same issue
export async function createIssue(communityId: string, uid: string, issueId: string, fields: Pick<Issue, 'title' | 'description' | 'category' | 'location'>) {
	const issueRef = doc(issuesRef(communityId), issueId);
	const batch = writeBatch(db);
	batch.set(issueRef, {
		...fields,
		status: 'open',
		communityId,
		votesScore: 0,
		votesCount: 0,
		commentsCount: 0,
		createdBy: uid,
		updatedBy: uid,
		createdAt: serverTimestamp(),
		updatedAt: serverTimestamp(),
		deletedAt: null,
	});
	logActivity(batch, communityId, { area: 'issue', summary: `Abrió la incidencia «${fields.title}»`, link: `/communities/${communityId}/issues/${issueRef.id}` });
	await batch.commit();
}

export function useIssue(communityId: string, issueId: string) {
	const issueRef = doc(issuesRef(communityId), issueId);
	const privateRef = doc(issueRef, 'private', 'admin');
	const link = `/communities/${communityId}/issues/${issueId}`;
	const issue = useDocument<Issue>(issueRef);
	// The internal note and the insurance claim, only the administration can read it
	const adminData = useDocument<IssuePrivate>(privateRef);
	// Ordered by date only, so no composite index is needed. Removed ones are left out here
	const allComments = useCollection<IssueComment>(query(collection(issueRef, 'comments'), orderBy('createdAt')));
	const comments = computed(() => allComments.value.filter(comment => !comment.deletedAt));
	const title = () => issue.value?.title || 'Incidencia';
	// The provider's parte de trabajo, by the token kept in the private document. Live, to see their answers as they come
	const workOrderDoc = useDocument<WorkOrder>(computed(() => adminData.value?.workOrder ? doc(db, 'workOrders', adminData.value.workOrder) : null));
	// Only the current one, as the listener keeps the last document when the token changes or goes. Undefined while it
	// loads, so a new link isn't made over one not shown yet
	const workOrder = computed(() => {
		const token = adminData.value?.workOrder;
		if (adminData.pending.value) {
			return undefined;
		}
		if (!token) {
			return null;
		}
		return workOrderDoc.value?.id === token ? workOrderDoc.value : workOrderDoc.pending.value ? undefined : null;
	});

	// The link stops working. The caller clears the token from the private document in the same batch
	function addRevoke(batch: ReturnType<typeof writeBatch>) {
		if (adminData.value?.workOrder) {
			batch.update(doc(db, 'workOrders', adminData.value.workOrder), { revokedAt: serverTimestamp(), updatedAt: serverTimestamp() });
		}
	}

	function newComment(author: User & { id: string }, fields: Pick<IssueComment, 'message'> & Partial<IssueComment>) {
		return {
			type: 'message',
			...fields,
			authorId: author.id,
			authorName: author.name || '',
			authorRole: author.role,
			createdAt: serverTimestamp(),
			updatedAt: serverTimestamp(),
			createdBy: author.id,
			updatedBy: author.id,
			deletedAt: null,
		};
	}

	// Listed with the comments, so neighbours see when and who changed it. resolvedAt is kept when it's reopened.
	// Other fields go in the same update, a batch with two updates to one document is checked against each separately
	function addStatusChange(batch: ReturnType<typeof writeBatch>, author: User & { id: string }, status: IssueStatus, fields: object = {}, commentRef = doc(collection(issueRef, 'comments'))) {
		batch.update(issueRef, {
			...fields,
			status,
			updatedAt: serverTimestamp(),
			updatedBy: author.id,
			...(status === 'resolved' ? { resolvedAt: serverTimestamp() } : {}),
		});
		batch.set(commentRef, newComment(author, { type: 'status', status, message: '' }));
	}

	// commentId: the status comment's, known beforehand so the change can be undone
	async function changeStatus(author: User & { id: string }, status: IssueStatus, commentId: string) {
		const batch = writeBatch(db);
		addStatusChange(batch, author, status, {}, doc(issueRef, 'comments', commentId));
		const label = issueStatus.find(option => option.value === status)?.label;
		logActivity(batch, communityId, { area: 'issue', summary: `Cambió el estado de «${title()}» a ${label}`, link });
		await batch.commit();
	}

	// Undoes changeStatus: the previous status and solved date, and its comment removed so neighbours don't see a change
	// that didn't stay
	async function revertStatus(author: User & { id: string }, previous: Pick<Issue, 'status' | 'resolvedAt'>, commentId: string) {
		const batch = writeBatch(db);
		batch.update(issueRef, {
			status: previous.status,
			resolvedAt: previous.resolvedAt ?? deleteField(),
			updatedAt: serverTimestamp(),
			updatedBy: author.id,
		});
		batch.update(doc(issueRef, 'comments', commentId), { deletedAt: serverTimestamp(), deletedBy: author.id });
		const label = issueStatus.find(option => option.value === previous.status)?.label;
		logActivity(batch, communityId, { area: 'issue', summary: `Devolvió «${title()}» a ${label}`, link });
		await batch.commit();
	}

	// Who goes and when, the note stays in the private document. Sending someone to an open issue starts it
	async function assign(author: User & { id: string }, provider: Pick<Provider, 'id' | 'name'> | undefined, expectedAt: Date | undefined, note: string) {
		const batch = writeBatch(db);
		const fields = {
			provider: provider ? { id: provider.id, name: provider.name } : deleteField(),
			expectedAt: expectedAt ? Timestamp.fromDate(expectedAt) : deleteField(),
		};
		if (provider && issue.value?.status === 'open') {
			addStatusChange(batch, author, 'in_progress', fields);
		} else {
			batch.update(issueRef, { ...fields, updatedAt: serverTimestamp(), updatedBy: author.id });
		}
		// The previous provider's parte de trabajo goes with them
		const revoke = provider?.id !== issue.value?.provider?.id && !!adminData.value?.workOrder;
		if (revoke) {
			addRevoke(batch);
		}
		batch.set(privateRef, { note, ...(revoke ? { workOrder: deleteField() } : {}), updatedAt: serverTimestamp(), updatedBy: author.id }, { merge: true });
		logActivity(batch, communityId, {
			area: 'issue',
			summary: provider ? `Asignó «${title()}» a ${provider.name}` : `Quitó el proveedor de «${title()}»`,
			link,
		});
		await batch.commit();
	}

	// Opens the claim or updates it. Each status change or note goes to its history, with the client's time as
	// serverTimestamp can't go inside arrays
	async function saveClaim(author: User & { id: string }, fields: { insurer: string; number: string; status: ClaimStatus; note: string }) {
		const now = Timestamp.now();
		const current = adminData.value?.claim;
		const entry = { at: now, status: fields.status, ...(fields.note ? { note: fields.note } : {}) };
		const claim: InsuranceClaim = current
			? {
					...current,
					insurer: fields.insurer,
					number: fields.number,
					status: fields.status,
					history: fields.note || fields.status !== current.status ? [...current.history, entry] : current.history,
				}
			: { insurer: fields.insurer, number: fields.number, status: fields.status, openedAt: now, history: [entry] };

		const batch = writeBatch(db);
		batch.set(privateRef, { claim, updatedAt: serverTimestamp(), updatedBy: author.id }, { merge: true });
		batch.update(issueRef, { insuranceClaim: true, updatedAt: serverTimestamp(), updatedBy: author.id });
		logActivity(batch, communityId, {
			area: 'issue',
			summary: current
				? `Actualizó el parte al seguro de «${title()}»: ${claimStatus[fields.status].label}`
				: `Abrió un parte al seguro por «${title()}» con ${fields.insurer}`,
			link,
		});
		await batch.commit();
	}

	/**
	 * Sends the assigned provider a parte de trabajo: the one place they're made, so whatever goes with sending one goes
	 * here. A copy of what they need to do the job, without the neighbours' data. Replaces the current one
	 *
	 * @returns {Promise<string>} The token, the link's last part
	 */
	// With the provider's email (from the directory) the link also goes to them by email
	async function createWorkOrder(author: User & { id: string }, email?: string) {
		const current = issue.value;
		if (!current?.provider) {
			throw new Error('Assign a provider first');
		}
		// Read once, for the address and the administration's contact
		const community = await loadCommunity(communityId);
		const office = community?.contacts?.find(contact => contact.type === 'admin');
		const contact = { name: office?.name || author.name || 'Administración', phone: office?.phone, whatsapp: office?.whatsapp, email: office?.email || author.email };
		const token = newWorkOrderToken();
		const copy = {
			community: { name: community?.name ?? '', address: community?.address ?? '' },
			issue: {
				title: current.title,
				description: current.description || '',
				category: current.category,
				location: current.location ? [issueLocationTypes[current.location.type], current.location.reference].filter(Boolean).join(' · ') : '',
				assets: current.assets ?? [],
			},
			expectedAt: current.expectedAt ?? null,
			contact: Object.fromEntries(Object.entries(contact).filter(([, value]) => value)) as WorkOrder['contact'],
			provider: current.provider,
		};
		const emailed = isEmail(email);

		const batch = writeBatch(db);
		addRevoke(batch);
		batch.set(doc(db, 'workOrders', token), {
			communityId,
			issueId,
			...copy,
			status: 'sent',
			history: [],
			createdAt: serverTimestamp(),
			createdBy: author.id,
			updatedAt: serverTimestamp(),
			revokedAt: null,
		});
		batch.set(privateRef, { workOrder: token, updatedAt: serverTimestamp(), updatedBy: author.id }, { merge: true });
		if (emailed) {
			queueMail(batch, { ...workOrderMail(copy, workOrderUrl(token)), to: email, communityId, kind: 'work-order', link, replyTo: contact.email });
		}
		logActivity(batch, communityId, { area: 'issue', summary: `Creó un parte de trabajo de «${title()}» para ${current.provider.name}${emailed ? ' y se lo envió por email' : ''}`, link });
		await batch.commit();
		return token;
	}

	// The issue's expected date to the provider's link, after it changed for the same provider
	async function updateWorkOrderDate() {
		const token = adminData.value?.workOrder;
		if (!token) {
			return;
		}
		const batch = writeBatch(db);
		batch.update(doc(db, 'workOrders', token), { expectedAt: issue.value?.expectedAt ?? null, updatedAt: serverTimestamp() });
		logActivity(batch, communityId, { area: 'issue', summary: `Cambió la fecha prevista del parte de trabajo de «${title()}»`, link });
		await batch.commit();
	}

	async function revokeWorkOrder(author: User & { id: string }) {
		const batch = writeBatch(db);
		addRevoke(batch);
		batch.set(privateRef, { workOrder: deleteField(), updatedAt: serverTimestamp(), updatedBy: author.id }, { merge: true });
		logActivity(batch, communityId, { area: 'issue', summary: `Anuló el parte de trabajo de «${title()}»`, link });
		await batch.commit();
	}

	async function reply(author: User & { id: string }, message: string) {
		const batch = writeBatch(db);
		batch.set(doc(collection(issueRef, 'comments')), newComment(author, { message }));
		batch.update(issueRef, { commentsCount: increment(1) });
		logActivity(batch, communityId, { area: 'issue', summary: `Respondió en «${title()}»`, link });
		await batch.commit();
	}

	// Hidden comments stay for the administration, neighbours stop seeing them
	async function setHidden(uid: string, comment: IssueComment, hidden: boolean) {
		const batch = writeBatch(db);
		batch.update(doc(issueRef, 'comments', comment.id), { hiddenAt: hidden ? serverTimestamp() : null, hiddenBy: uid });
		logActivity(batch, communityId, {
			area: 'moderation',
			summary: `${hidden ? 'Ocultó' : 'Volvió a mostrar'} un comentario de ${comment.authorName || 'un vecino'} en «${title()}»`,
			link,
		});
		await batch.commit();
	}

	// Kept but hidden, as the webapp does
	async function remove(uid: string) {
		const batch = writeBatch(db);
		batch.update(issueRef, { deletedAt: serverTimestamp(), deletedBy: uid });
		logActivity(batch, communityId, { area: 'issue', summary: `Borró la incidencia «${title()}»` });
		await batch.commit();
	}

	// Undoes remove. The rules ask deletedBy to be whoever writes it, so it stays with them
	async function restore(uid: string) {
		const batch = writeBatch(db);
		batch.update(issueRef, { deletedAt: null, deletedBy: uid });
		logActivity(batch, communityId, { area: 'issue', summary: `Restauró la incidencia «${title()}»`, link });
		await batch.commit();
	}

	return {
		issue,
		adminData,
		workOrder,
		comments,
		loading: issue.pending,
		error: computed(() => issue.error.value ?? allComments.error.value ?? adminData.error.value),
		changeStatus,
		revertStatus,
		assign,
		createWorkOrder,
		updateWorkOrderDate,
		revokeWorkOrder,
		saveClaim,
		reply,
		setHidden,
		remove,
		restore,
	};
}
