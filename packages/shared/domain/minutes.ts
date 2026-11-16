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
	const bytes = new TextEncoder().encode(JSON.stringify({ communityId, meetingId, text, signed }));
	// Only in secure contexts: a phone opening the local demo over http (npm run demo) hasn't got it
	if (!globalThis.crypto?.subtle) {
		return sha256(bytes);
	}
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

// SHA-256 (FIPS 180-4) in hex, the same as crypto.subtle's
const K = [
	0x428A2F98,
	0x71374491,
	0xB5C0FBCF,
	0xE9B5DBA5,
	0x3956C25B,
	0x59F111F1,
	0x923F82A4,
	0xAB1C5ED5,
	0xD807AA98,
	0x12835B01,
	0x243185BE,
	0x550C7DC3,
	0x72BE5D74,
	0x80DEB1FE,
	0x9BDC06A7,
	0xC19BF174,
	0xE49B69C1,
	0xEFBE4786,
	0x0FC19DC6,
	0x240CA1CC,
	0x2DE92C6F,
	0x4A7484AA,
	0x5CB0A9DC,
	0x76F988DA,
	0x983E5152,
	0xA831C66D,
	0xB00327C8,
	0xBF597FC7,
	0xC6E00BF3,
	0xD5A79147,
	0x06CA6351,
	0x14292967,
	0x27B70A85,
	0x2E1B2138,
	0x4D2C6DFC,
	0x53380D13,
	0x650A7354,
	0x766A0ABB,
	0x81C2C92E,
	0x92722C85,
	0xA2BFE8A1,
	0xA81A664B,
	0xC24B8B70,
	0xC76C51A3,
	0xD192E819,
	0xD6990624,
	0xF40E3585,
	0x106AA070,
	0x19A4C116,
	0x1E376C08,
	0x2748774C,
	0x34B0BCB5,
	0x391C0CB3,
	0x4ED8AA4A,
	0x5B9CCA4F,
	0x682E6FF3,
	0x748F82EE,
	0x78A5636F,
	0x84C87814,
	0x8CC70208,
	0x90BEFFFA,
	0xA4506CEB,
	0xBEF9A3F7,
	0xC67178F2,
];
const rotate = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));

export function sha256(bytes: Uint8Array) {
	// The message, a 1 bit, zeros and its length in bits, to whole blocks of 64 bytes
	const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
	padded.set(bytes);
	padded[bytes.length] = 0x80;
	const view = new DataView(padded.buffer);
	view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000));
	view.setUint32(padded.length - 4, bytes.length * 8);

	const hash = [0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19];
	const w = new Uint32Array(64);
	for (let block = 0; block < padded.length; block += 64) {
		for (let i = 0; i < 64; i++) {
			w[i] = i < 16
				? view.getUint32(block + i * 4)
				: w[i - 16] + (rotate(w[i - 15], 7) ^ rotate(w[i - 15], 18) ^ (w[i - 15] >>> 3)) + w[i - 7] + (rotate(w[i - 2], 17) ^ rotate(w[i - 2], 19) ^ (w[i - 2] >>> 10));
		}
		let [a, b, c, d, e, f, g, h] = hash;
		for (let i = 0; i < 64; i++) {
			const t1 = h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i];
			const t2 = (rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
			[h, g, f, e, d, c, b, a] = [g, f, e, (d + t1) | 0, c, b, a, (t1 + t2) | 0];
		}
		[a, b, c, d, e, f, g, h].forEach((value, i) => hash[i] = (hash[i] + value) | 0);
	}
	return hash.map(value => (value >>> 0).toString(16).padStart(8, '0')).join('');
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
