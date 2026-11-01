import type { Timestamp } from 'firebase/firestore';
import type { Tally } from './meeting.ts';
import type { Property } from './property.ts';
import { normalize } from '../utils/helpers.ts';

// The acta of a held meeting, at meetings/{meetingId}/minutes/record: apart from the meeting, which every neighbour lists, so
// the signatures don't weigh on the list. Its text and signers are edited until both have signed, then it's sealed with its
// hash and never changes again
export interface Minutes {
	id: string;
	communityId: string;
	meetingId: string;
	text: string;
	president: Signer;
	secretary: Signer;
	signatures: Partial<Record<SignerRole, Signature>>;
	// SHA-256 of the text and the signatures, in hex (minutesHash). '' until sealed
	hash: string;
	closedAt: Timestamp | null;
	updatedAt: Timestamp;
	updatedBy: string;
}

export const MINUTES_ID = 'record';

export type SignerRole = 'president' | 'secretary';

export const signerRoles: Record<SignerRole, string> = {
	president: 'Presidente',
	secretary: 'Secretario',
};

export interface Signer {
	uid: string;
	name: string;
}

// Firma electrónica simple: the stroke drawn plus who was signed in, dated by the server. byUid is the signer, or whoever
// manages the community when it's signed in person on the administration's screen
export interface Signature extends Signer {
	// SignaturePad's SVG path
	path: string;
	signedAt: Timestamp;
	byUid: string;
	byEmail: string;
}

export function isFullySigned(minutes: Pick<Minutes, 'signatures'>) {
	return !!minutes.signatures.president && !!minutes.signatures.secretary;
}

// What the seal covers: the text and each signature, who and when, in a fixed order so anyone can compute it again
export async function minutesHash({ communityId, meetingId, text, signatures }: Omit<Minutes, 'id'>) {
	const signed = (['president', 'secretary'] as const).map((role) => {
		const { uid, name, path, signedAt, byUid, byEmail } = signatures[role]!;
		return { role, uid, name, byUid, byEmail, signedAt: signedAt.toDate().toISOString(), path };
	});
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ communityId, meetingId, text, signed })));
	return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export type NoticeKind = 'call' | 'minutes';

export const noticeKinds: Record<NoticeKind, string> = {
	call: 'Convocatoria',
	minutes: 'Acta',
};

// The convocatoria or the acta sent to one owner, at meetings/{meetingId}/notices/{kind}_{uid}, or {kind}_p{propertyId} (their
// first) without an account. In the app when they have an account, and certified by post in test mode: a made-up reference, nothing is sent
export interface MeetingNotice {
	id: string;
	kind: NoticeKind;
	uid: string;
	name: string;
	email: string;
	propertyIds: string[];
	propertyNames: string[];
	coefficient: number;
	// Neither attended nor was represented, so they can dissent from the voted agreements (items) for 30 days
	absent: boolean;
	items: string[];
	app: boolean;
	certified: { mode: 'test'; reference: string };
	sentAt: Timestamp;
	sentBy: string;
	// Set by the owner: when they opened it and when they acknowledged it
	readAt?: Timestamp | null;
	receivedAt: Timestamp | null;
	// By item id
	dissent: Record<string, Timestamp>;
	// By item id, received by post, burofax or in person and recorded by the administration: the day it arrived
	recordedDissent?: Record<string, RecordedDissent>;
}

export interface RecordedDissent {
	receivedOn: Timestamp;
	recordedAt: Timestamp;
	recordedBy: string;
}

// From the app or recorded by the administration
export function dissentAt(notice: Pick<MeetingNotice, 'dissent' | 'recordedDissent'>, itemId: string) {
	return notice.dissent[itemId] ?? notice.recordedDissent?.[itemId]?.receivedOn;
}

export type NoticeOwner = Pick<MeetingNotice, 'uid' | 'name' | 'email' | 'propertyIds' | 'propertyNames' | 'coefficient'> & {
	// What the notice id takes after the kind
	key: string;
};

// The census by owner, each with all their properties. Those without an owner recorded are left out
export function ownersOf(properties: Property[], names: Record<string, string> = {}): NoticeOwner[] {
	const owners = new Map<string, NoticeOwner>();
	for (const property of [...properties].sort((a, b) => a.id.localeCompare(b.id))) {
		const group = property.ownerUid || property.ownerEmail?.trim().toLowerCase() || normalize(property.ownerName);
		if (!group) {
			continue;
		}
		const owner = owners.get(group) ?? {
			key: property.ownerUid || `p${property.id}`,
			uid: property.ownerUid,
			name: property.ownerName || names[property.ownerUid] || '',
			email: property.ownerEmail?.trim() ?? '',
			propertyIds: [],
			propertyNames: [],
			coefficient: 0,
		};
		owner.propertyIds.push(property.id);
		owner.propertyNames.push(property.name);
		owner.coefficient = Math.round((owner.coefficient + (property.coefficient ?? 0)) * 10_000) / 10_000;
		owners.set(group, owner);
	}
	return [...owners.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

// Art. 17.8 LPH: 30 natural days from the notice. The rules count them the same way
export function dissentDeadline(notice: Pick<MeetingNotice, 'sentAt'>) {
	return new Date(notice.sentAt.toMillis() + 30 * 86_400_000);
}

// Art. 17.8 LPH: absent owners who, duly notified, don't dissent within 30 days count in favour, those who do against.
// Provisional until every absent owner's 30 days are over
export function tallyWithAbsent(tally: Tally[], notices: MeetingNotice[], itemId: string, now = Date.now()) {
	const absent = notices.filter(notice => notice.kind === 'minutes' && notice.absent && notice.items.includes(itemId));
	const sum = (owners: MeetingNotice[], field: (notice: MeetingNotice) => number) => owners.reduce((total, notice) => total + field(notice), 0);
	const added = {
		yes: absent.filter(notice => !dissentAt(notice, itemId)),
		no: absent.filter(notice => dissentAt(notice, itemId)),
		abstain: [],
	};
	const deadline = Math.max(0, ...absent.map(notice => dissentDeadline(notice).getTime()));
	return {
		tally: tally.map(entry => ({
			...entry,
			votes: entry.votes + sum(added[entry.choice], notice => notice.propertyIds.length),
			coefficient: Math.round((entry.coefficient + sum(added[entry.choice], notice => notice.coefficient)) * 100) / 100,
		})),
		absent: absent.length,
		deadline: deadline ? new Date(deadline) : undefined,
		final: now >= deadline,
	};
}
