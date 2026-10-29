import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { Charge } from '@gobernansa/shared/domain/finance.ts';
import type { Issue, IssueStatus } from '@gobernansa/shared/domain/issue.ts';
import type { Obligation } from '@gobernansa/shared/domain/obligation.ts';
import { isOverdue } from '@gobernansa/shared/domain/finance.ts';
import { obligationStatus } from '@gobernansa/shared/domain/obligation.ts';
import { db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { collection, getCountFromServer, getDocs, limit, query, Timestamp, where } from 'firebase/firestore';

const DAY = 86_400_000;
// Resolution times are averaged over this window, older ones say little about how it goes now
const RESOLUTION_WINDOW_DAYS = 180;
// ponytail: a cap per community so picking every status doesn't read years of closed issues; paginate if a community outgrows it
const INBOX_MAX_PER_COMMUNITY = 300;

export type InboxIssue = Issue & { communityName: string };

export function ageInDays(issue: Pick<Issue, 'createdAt'>, now = Date.now()) {
	return issue.createdAt ? Math.floor((now - issue.createdAt.toMillis()) / DAY) : 0;
}

// Once, with equality filters only so no composite index is needed. Oldest first, they've waited the longest
export async function loadInbox(communities: Community[], statuses: IssueStatus[]): Promise<InboxIssue[]> {
	if (!statuses.length) {
		return [];
	}

	const perCommunity = await Promise.all(communities.map(async (community) => {
		const snapshot = await getDocs(query(
			collection(db, 'communities', community.id, 'issues'),
			where('deletedAt', '==', null),
			where('status', 'in', statuses),
			limit(INBOX_MAX_PER_COMMUNITY),
		));
		// From the path: issues reported before communityId existed don't have it
		return snapshot.docs.map(issueDoc => ({ ...issueDoc.data() as Issue, id: issueDoc.id, communityId: community.id, communityName: community.name }));
	}));
	return perCommunity.flat().sort((a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0));
}

export interface CommunityStats {
	community: Community;
	openIssues: number;
	// Sum and count, so the totals average every issue and not each community's average
	resolutionDaysSum: number;
	resolvedCount: number;
	registered: number;
	homes: number;
	overdueObligations: number;
	soonObligations: number;
	overdueAmount: number;
	overdueCharges: number;
}

// Counts are aggregation queries (1 read per 1000 counted). Only the lists that need a client side check are read
export async function loadCommunityStats(community: Community): Promise<CommunityStats> {
	const communityRef = (name: string) => collection(db, 'communities', community.id, name);
	const now = new Date();
	const since = Timestamp.fromMillis(now.getTime() - RESOLUTION_WINDOW_DAYS * DAY);

	const [open, resolved, registered, homes, obligations, unpaid] = await Promise.all([
		getCountFromServer(query(communityRef('issues'), where('deletedAt', '==', null), where('status', 'in', ['open', 'in_progress']))),
		// A single range filter uses the automatic index. Reopened ones keep resolvedAt, so status is checked here
		getDocs(query(communityRef('issues'), where('resolvedAt', '>=', since))),
		getCountFromServer(query(collection(db, 'users'), where('communityId', '==', community.id), where('role', '==', 'user'))),
		getCountFromServer(query(collection(db, 'properties'), where('communityId', '==', community.id), where('type', '==', 'home'))),
		getDocs(communityRef('obligations')),
		getDocs(query(communityRef('charges'), where('paidAt', '==', null))),
	]);

	const resolvedIssues = resolved.docs
		.map(issueDoc => issueDoc.data() as Issue)
		.filter(issue => !issue.deletedAt && (issue.status === 'resolved' || issue.status === 'closed') && issue.createdAt && issue.resolvedAt);
	const obligationStatuses = obligations.docs.map(obligationDoc => obligationStatus(obligationDoc.data() as Obligation, now));
	const overdueCharges = unpaid.docs.map(chargeDoc => chargeDoc.data() as Charge).filter(charge => isOverdue(charge, now));

	return {
		community,
		openIssues: open.data().count,
		resolutionDaysSum: resolvedIssues.reduce((sum, issue) => sum + (issue.resolvedAt!.toMillis() - issue.createdAt.toMillis()) / DAY, 0),
		resolvedCount: resolvedIssues.length,
		registered: registered.data().count,
		homes: homes.data().count,
		overdueObligations: obligationStatuses.filter(status => status === 'overdue').length,
		soonObligations: obligationStatuses.filter(status => status === 'soon').length,
		overdueAmount: overdueCharges.reduce((sum, charge) => sum + charge.amount, 0),
		overdueCharges: overdueCharges.length,
	};
}
