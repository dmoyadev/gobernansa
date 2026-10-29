import type { ClaimStatus, InsuranceClaim, Issue, IssueComment, IssuePrivate, IssueStatus } from '@gobernansa/shared/domain/issue.ts';
import type { Provider } from '@gobernansa/shared/domain/provider.ts';
import type { User } from '@gobernansa/shared/domain/user.ts';
import type { MaybeRefOrGetter } from 'vue';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { claimStatus, issueStatus } from '@gobernansa/shared/domain/issue.ts';
import { db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, deleteField, doc, increment, limit, orderBy, query, serverTimestamp, Timestamp, where, writeBatch } from 'firebase/firestore';
import { computed, toValue } from 'vue';
import { useCollection, useDocument } from 'vuefire';

function issuesRef(communityId: string) {
	return collection(db, 'communities', communityId, 'issues');
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
	function addStatusChange(batch: ReturnType<typeof writeBatch>, author: User & { id: string }, status: IssueStatus, fields: object = {}) {
		batch.update(issueRef, {
			...fields,
			status,
			updatedAt: serverTimestamp(),
			updatedBy: author.id,
			...(status === 'resolved' ? { resolvedAt: serverTimestamp() } : {}),
		});
		batch.set(doc(collection(issueRef, 'comments')), newComment(author, { type: 'status', status, message: '' }));
	}

	async function changeStatus(author: User & { id: string }, status: IssueStatus) {
		const batch = writeBatch(db);
		addStatusChange(batch, author, status);
		const label = issueStatus.find(option => option.value === status)?.label;
		logActivity(batch, communityId, { area: 'issue', summary: `Cambió el estado de «${title()}» a ${label}`, link });
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
		batch.set(privateRef, { note, updatedAt: serverTimestamp(), updatedBy: author.id }, { merge: true });
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

	return {
		issue,
		adminData,
		comments,
		loading: issue.pending,
		error: computed(() => issue.error.value ?? allComments.error.value ?? adminData.error.value),
		changeStatus,
		assign,
		saveClaim,
		reply,
		setHidden,
		remove,
	};
}
