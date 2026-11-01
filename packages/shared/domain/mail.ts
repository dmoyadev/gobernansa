import type { Timestamp } from 'firebase/firestore';

/*
 * Correo saliente, at mail/{id}: the shape of Firebase's "Trigger Email from Firestore" extension (to, cc, bcc, replyTo,
 * message), so once it's installed with an SMTP provider it sends each one created and writes back its delivery. Until then
 * (mode 'demo') they're only kept. The rest is ours: where it comes from, for the outbox page. Never changed by the apps
 */
export interface Mail {
	id: string;
	to: string[];
	cc?: string[];
	bcc?: string[];
	// Whoever queued it, so replies reach the administration and not the sending address
	replyTo?: string;
	message: MailMessage;
	// '' for the team's, e.g. an administrator's invitation
	communityId: string;
	kind: MailKind;
	mode: MailMode;
	// Where to see what it's about, inside the admin, '' if nowhere
	link: string;
	createdAt: Timestamp;
	createdBy: string;
	// Written by the extension only
	delivery?: {
		state: 'PENDING' | 'PROCESSING' | 'RETRY' | 'SUCCESS' | 'ERROR';
		attempts?: number;
		error?: string | null;
		endTime?: Timestamp | null;
		info?: { accepted?: string[]; rejected?: string[] };
	};
}

export interface MailMessage {
	subject: string;
	text: string;
	html: string;
}

export type MailMode = 'demo' | 'extension';

export type MailKind = 'invitation' | 'meeting-call' | 'meeting-minutes' | 'work-order' | 'claim';

export const mailKinds: Record<MailKind, { label: string; icon: string }> = {
	'invitation': { label: 'Invitación', icon: 'lucide:user-plus' },
	'meeting-call': { label: 'Convocatoria', icon: 'lucide:gavel' },
	'meeting-minutes': { label: 'Acta', icon: 'lucide:file-signature' },
	'work-order': { label: 'Parte de trabajo', icon: 'lucide:clipboard-list' },
	'claim': { label: 'Reclamación', icon: 'lucide:file-warning' },
};

export type MailStatus = 'test' | 'pending' | 'sent' | 'error';

export const mailStatus: Record<MailStatus, { label: string; icon: string }> = {
	test: { label: 'Prueba', icon: 'lucide:flask-conical' },
	pending: { label: 'Pendiente', icon: 'lucide:clock' },
	sent: { label: 'Enviado', icon: 'lucide:check' },
	error: { label: 'Error', icon: 'lucide:circle-alert' },
};

// The extension's delivery.state, in the outbox's details
export const deliveryStates: Record<NonNullable<Mail['delivery']>['state'], string> = {
	PENDING: 'Pendiente',
	PROCESSING: 'Enviando',
	RETRY: 'Reintentando',
	SUCCESS: 'Entregado',
	ERROR: 'Error',
};

export function statusOf(mail: Pick<Mail, 'mode' | 'delivery'>): MailStatus {
	const state = mail.delivery?.state;
	if (state === 'SUCCESS') {
		return 'sent';
	}
	if (state === 'ERROR') {
		return 'error';
	}
	return (state || mail.mode === 'extension') ? 'pending' : 'test';
}

// One address, as the rules take them. Census and directory emails are typed by hand, a bad one would fail the whole batch
const EMAIL_REGEX = /^[^\s@]{1,64}@[^\s@]{1,255}$/;

export function isEmail(email?: string): email is string {
	return !!email && EMAIL_REGEX.test(email.trim());
}

// Newest first in id order: listed by id, the outbox's communityId filter needs no index (by createdAt it would need one).
// The device's clock, so two sent within its drift may swap places
export function mailId(now = Date.now()) {
	return `${(8.64e15 - now).toString(36).padStart(11, '0')}-${crypto.randomUUID().slice(0, 8)}`;
}

export interface MailContent {
	subject: string;
	// The heading inside the email
	title: string;
	// Paragraphs, keeping their line breaks, or bulleted lists
	blocks: (string | string[])[];
	// The one button
	action?: { label: string; url: string };
	// Who it comes from, a line each: the community, the administration
	footer: string[];
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' };
const ESCAPED_REGEX = /[&<>"']/g;

function escape(text: string) {
	return text.replace(ESCAPED_REGEX, char => ESCAPES[char]);
}

const FONT = 'font-family:Helvetica,Arial,sans-serif;';

// Inline styles and layout tables, what email clients render. Light only, with contrast over 7:1 and the link written out
// under the button for clients that hide buttons
export function renderMail({ subject, title, blocks, action, footer }: MailContent): MailMessage {
	const html = blocks.map(block => Array.isArray(block)
		? `<ul style="margin:0 0 16px;padding-left:20px;">${block.map(item => `<li style="margin:0 0 4px;">${escape(item)}</li>`).join('')}</ul>`
		: `<p style="margin:0 0 16px;">${escape(block).replaceAll('\n', '<br>')}</p>`).join('');
	const button = action
		? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="border-radius:8px;background:#094067;">`
		+ `<a href="${escape(action.url)}" target="_blank" style="display:inline-block;padding:12px 24px;border-radius:8px;color:#ffffff;font-weight:700;text-decoration:none;">${escape(action.label)}</a></td></tr></table>`
		+ `<p style="margin:0;font-size:14px;color:#4a5568;">Si el botón no funciona, copia este enlace en el navegador:<br><a href="${escape(action.url)}" target="_blank" style="color:#094067;word-break:break-all;">${escape(action.url)}</a></p>`
		: '';
	const from = [...footer.filter(Boolean), 'Enviado con gobernança'];
	return {
		subject,
		html: `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(subject)}</title></head>`
			+ `<body style="margin:0;padding:0;background:#f7fafc;">`
			+ `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7fafc;"><tr><td align="center" style="padding:24px 12px;">`
			+ `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">`
			+ `<tr><td style="padding:24px 32px 0;${FONT}font-size:20px;font-weight:700;color:#094067;">gobernança</td></tr>`
			+ `<tr><td style="padding:16px 32px 32px;${FONT}font-size:16px;line-height:1.5;color:#1a202c;">`
			+ `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#1a202c;">${escape(title)}</h1>${html}${button}</td></tr></table>`
			+ `<p style="max-width:560px;margin:16px auto 0;${FONT}font-size:13px;line-height:1.5;color:#4a5568;">${from.map(escape).join('<br>')}</p>`
			+ `</td></tr></table></body></html>`,
		text: [
			'gobernança',
			title,
			...blocks.map(block => Array.isArray(block) ? block.map(item => `- ${item}`).join('\n') : block),
			...(action ? [`${action.label}: ${action.url}`] : []),
			`--\n${from.join('\n')}`,
		].join('\n\n'),
	};
}
