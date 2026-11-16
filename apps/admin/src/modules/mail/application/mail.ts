import type { MailContent, MailKind, MailMode } from '@gobernansa/shared/domain/mail.ts';
import type { Meeting } from '@gobernansa/shared/domain/meeting.ts';
import type { NoticeKind, NoticeOwner } from '@gobernansa/shared/domain/minutes.ts';
import type { Role } from '@gobernansa/shared/domain/user.ts';
import type { WorkOrder } from '@gobernansa/shared/domain/workOrder.ts';
import type { DocumentData, DocumentReference } from 'firebase/firestore';
import { mailId, renderMail } from '@gobernansa/shared/domain/mail.ts';
import { meetingTypes } from '@gobernansa/shared/domain/meeting.ts';
import { formatInviteCode } from '@gobernansa/shared/domain/user.ts';
import { auth, db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { doc, serverTimestamp } from 'firebase/firestore';

// 'extension' once Firebase's Trigger Email extension is installed (docs/firebase.md). Until then they're kept, nothing is sent
export const MAIL_MODE: MailMode = import.meta.env.VITE_MAIL_MODE === 'extension' ? 'extension' : 'demo';

// The neighbours' app, for the links that go to it
export const WEBAPP_URL = (import.meta.env.VITE_WEBAPP_URL as string | undefined) || 'https://gobernansa.dmoya.dev';

// The access letter's link (B2.4), which its QR has: the code in the hash, so it never reaches a server's logs
export function letterUrl(code: string) {
	return `${WEBAPP_URL}/login#codigo-${code}`;
}

// The access letter as an email written from the office's own mail app: nothing is queued, so it's sent even on the free plan
export function letterMailto(to: string, name: string, code: string, community: string) {
	const body = [
		`Hola, ${name}:`,
		`Ya puedes entrar en la app de ${community || 'tu comunidad'}. Abre este enlace en tu móvil:`,
		letterUrl(code),
		`O entra en ${new URL(WEBAPP_URL).host} y escribe tu código: ${formatInviteCode(code)}`,
		'Este código es tu llave: te sirve para entrar desde cualquier móvil. No lo compartas.',
	].join('\n\n');
	return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(`Tu acceso a la app de ${community || 'tu comunidad'}`)}&body=${encodeURIComponent(body)}`;
}

// What a toast says of an email it queued: in demo mode it isn't sent, it stays in the outbox
export function mailOutcome(to: string) {
	return MAIL_MODE === 'demo' ? 'el email queda en el correo saliente (modo de prueba)' : `email enviado a ${to}`;
}

export interface MailDraft extends MailContent {
	to: string;
	communityId: string;
	kind: MailKind;
	// Inside the admin
	link: string;
	replyTo?: string;
}

/**
 * The one place emails are queued: added to the batch of the change they come from, so both are saved or neither. Replies
 * go to whoever sent it unless another address is given
 */
export function queueMail(batch: { set: (ref: DocumentReference, data: DocumentData) => unknown }, { to, communityId, kind, link, replyTo = auth.currentUser?.email ?? '', ...content }: MailDraft) {
	batch.set(doc(db, 'mail', mailId()), {
		to: [to.trim()],
		...(replyTo ? { replyTo } : {}),
		message: renderMail(content),
		communityId,
		kind,
		mode: MAIL_MODE,
		link,
		createdAt: serverTimestamp(),
		createdBy: auth.currentUser!.uid,
	});
}

export function communityLine(community: { name?: string; address?: string }) {
	return community.name ? `Comunidad de propietarios ${community.name}${community.address ? `, ${community.address}` : ''}` : '';
}

const INVITATION_TEXT: Record<Role, (inviter: string, community: string) => string> = {
	user: (inviter, community) => `${inviter} te ha invitado a la app de vecinos de la comunidad ${community}. Desde ella puedes avisar de incidencias, seguir las juntas y los comunicados, reservar zonas comunes y ver tus recibos.`,
	manager: (inviter, community) => `${inviter} te ha dado acceso a gobernança admin para gestionar la comunidad ${community}: sus incidencias, vecinos, juntas y cuentas.`,
	admin: inviter => `${inviter} te ha dado acceso a gobernança admin, la plataforma para llevar tus comunidades: incidencias, juntas, cobros, contabilidad y modelos fiscales.`,
	superadmin: inviter => `${inviter} te ha dado acceso a gobernança admin como parte del equipo de gobernança.`,
};

// Neighbours to the webapp, everyone else to the admin
export function invitationMail({ name, email, role }: { name: string; email: string; role: Role }, community: string, inviter: string): MailContent {
	const neighbour = role === 'user';
	return {
		subject: neighbour ? `Te invitamos a la app de la comunidad ${community}` : 'Tu acceso a gobernança admin',
		title: neighbour ? 'Ya puedes entrar en la app de tu comunidad' : 'Ya puedes entrar en gobernança admin',
		blocks: [
			`Hola, ${name}:`,
			INVITATION_TEXT[role](inviter, community),
			`Crea tu cuenta con este email, ${email}: en la página de entrada pulsa «Me han invitado: crear cuenta», elige tu contraseña y confirma tu email.`,
		],
		action: { label: 'Crear mi cuenta', url: `${window.location.origin}/login` },
		footer: community ? [communityLine({ name: community })] : [],
	};
}

const dayFormat = new Intl.DateTimeFormat('es-ES', { dateStyle: 'full' });
const PARAGRAPHS_REGEX = /\n{2,}/;
const timeFormat = new Intl.DateTimeFormat('es-ES', { timeStyle: 'short' });

// The convocatoria or the acta, to one owner. Those with an account get the button to the meeting in the app
export function meetingMail(meeting: Meeting, kind: NoticeKind, owner: NoticeOwner & { absent: boolean }, community: { name: string; address?: string }, minutes = ''): MailContent {
	const date = meeting.date.toDate();
	const what = `la junta ${meetingTypes[meeting.type].toLowerCase()} «${meeting.title}»`;
	const action = owner.uid ? { label: kind === 'call' ? 'Ver la convocatoria' : 'Ver el acta en la app', url: `${WEBAPP_URL}/neighborhood/meetings/${meeting.id}` } : undefined;
	const footer = [communityLine(community), 'La administración de la comunidad'];
	const hello = owner.name ? `Hola, ${owner.name}:` : 'Hola:';
	if (kind === 'call') {
		return {
			subject: `Convocatoria: ${meeting.title} · ${community.name}`,
			title: `Convocatoria de junta ${meetingTypes[meeting.type].toLowerCase()}`,
			blocks: [
				hello,
				`Como propietario de ${owner.propertyNames.join(', ')}, se te convoca a ${what} de la comunidad ${community.name}.`,
				[
					`Fecha: ${dayFormat.format(date)}, a las ${timeFormat.format(date)}`,
					...(meeting.place ? [`Lugar: ${meeting.place}`] : []),
					...(meeting.link ? [`Enlace para unirse: ${meeting.link}`] : []),
				].join('\n'),
				'Orden del día:',
				meeting.agenda.map(item => item.title),
				owner.uid
					? 'En la app puedes confirmar si asistes, delegar tu voto y votar los puntos cuando se abra la votación.'
					: 'Si no puedes asistir, puedes delegar tu voto por escrito en otra persona para que te represente.',
			],
			action,
			footer,
		};
	}
	return {
		subject: `Acta: ${meeting.title} · ${community.name}`,
		title: `Acta de la junta del ${dayFormat.format(date)}`,
		blocks: [
			hello,
			`Te enviamos el acta de ${what}, firmada por el presidente y el secretario.`,
			...(owner.absent
				? [`Como no asististe ni te representaron, puedes manifestar tu discrepancia con los acuerdos en los 30 días naturales siguientes a esta notificación${owner.uid ? ', desde la app' : ', escribiendo a la administración'}. Si no lo haces, tu voto cuenta a favor (art. 17.8 de la Ley de Propiedad Horizontal).`]
				: []),
			...minutes.split(PARAGRAPHS_REGEX).filter(Boolean),
		],
		action,
		footer,
	};
}

// To the provider, with the link to the parte
export function workOrderMail({ community, issue, expectedAt, contact, provider }: Pick<WorkOrder, 'community' | 'issue' | 'expectedAt' | 'contact' | 'provider'>, url: string): MailContent {
	const details = [
		...(issue.location ? [`Ubicación: ${issue.location}`] : []),
		...(expectedAt ? [`Fecha prevista: ${dayFormat.format(expectedAt.toDate())}`] : []),
	];
	return {
		subject: `Parte de trabajo: ${issue.title} · ${community.name}`,
		title: `Tienes un trabajo en ${community.name}`,
		blocks: [
			`Hola, ${provider.name}:`,
			`La administración de la comunidad ${community.name} te envía este trabajo: «${issue.title}».`,
			...(issue.description ? [issue.description] : []),
			...(details.length ? [details] : []),
			'En el enlace tienes los detalles y las fotos. Desde ahí puedes aceptarlo, programar la visita y avisarnos al terminar, sin crear una cuenta.',
		],
		action: { label: 'Ver el parte de trabajo', url },
		footer: [communityLine(community), [contact.name, contact.phone].filter(Boolean).join(' · ')],
	};
}
