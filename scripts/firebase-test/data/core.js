import { Buffer } from 'node:buffer';
import { formatRate, SUGGESTED_INTEREST_RATE } from '../../../packages/shared/domain/arrears.ts';
import { getBookingFees } from '../../../packages/shared/domain/community.ts';
import { ownersOf } from '../../../packages/shared/domain/minutes.ts';
import { formatCents } from '../../../packages/shared/domain/money.ts';
import { roles } from '../../../packages/shared/domain/user.ts';
import { commonAreas, communities, days, office, properties, propertiesOf, providerById, uids, userById, users } from './cast.js';
import { debtCases, firstRemittances } from './charges.js';
import { seedVolume, VOLUME, communities as volumeCommunities } from './volume.js';

const PDF_SPECIAL_REGEX = /[\\()]/g;

// Titles of other groups' docs the log names (maintenance's issues, meetings' juntas and comunicados)
const leak = '«Fuga de agua en el garaje»';
const noise = '«Ruido nocturno constante»';
const elevator = '«El ascensor se para entre el segundo y el tercero»';
const sockets = '«Saltan chispas en el enchufe del cuarto de contadores»';
const stairs = '«La escalera lleva dos semanas sin fregar»';
const terrace = '«Filtración en la azotea después de las lluvias»';
const video = '«La del vídeo y el título súper largo que alguien ha confundido con la descripción así que se va de madre»';
const humidity = '«Humedad en el techo del baño»';
const irrigation = '«El riego automático del jardín no funciona»';
const portal = '«El portal se queda sin fregar los sábados»';
const ordinary = '«Junta general ordinaria»';
const extraordinary = '«Junta extraordinaria: impermeabilización del garaje»';
const draft = '«Junta extraordinaria: puntos de recarga en el garaje»';
const officeHours = '«Nuevo horario de atención de la administración»';
const holiday = '«Oficina cerrada por festivo local»';

const lateInterest = { rate: SUGGESTED_INTEREST_RATE, graceDays: 30 };
// The ordinary meeting, held about 45 days ago, at the same time of year as the previous ones
const held = days(-45, '00:00');
const yearsBefore = n => new Date(held.getFullYear() - n, held.getMonth(), held.getDate());

const fiscal = id => Object.fromEntries(Object.entries(communities.find(community => community.id === id)).filter(([key]) => key !== 'id'));
const phoneOf = uid => properties.find(property => property.ownerUid === uid).ownerPhone;

function providerContact(type, providerId, extra) {
	const { name, phone, email } = providerById(providerId);
	return { type, name, phone, email, ...extra };
}

const officeContact = {
	type: 'admin',
	name: office.name,
	phone: office.phone,
	whatsapp: '600 000 101',
	email: office.email,
	// ISO weekdays (1 is Monday) and 24 hour times. Split: mornings all week, afternoons but Friday
	schedule: [{ days: [1, 2, 3, 4, 5], from: '09:00', to: '14:00' }, { days: [1, 2, 3, 4], from: '16:30', to: '19:00' }],
};

const documentUrl = (community, file) => `https://example.com/${community}/${file}.pdf`;

const communityDocs = {
	'communities/comm1': {
		...fiscal('comm1'),
		commonAreas: commonAreas.comm1,
		// Mirrors the areas' price and fianza, as the admin platform saves them, for the rules
		bookingFees: getBookingFees(commonAreas.comm1),
		// Neighbours pay their charges and bookings from the app with the test checkout (4242 4242 4242 4242)
		onlinePayments: 'test',
		lateInterest,
		bankFeed: { mode: 'demo', connectedAt: days(-54, '11:20'), syncedAt: days(-1, '08:30') },
		monthlyVotes: 5,
		contacts: [
			officeContact,
			{ type: 'president', name: userById(uids.carmen).name, phone: phoneOf(uids.carmen), whatsapp: phoneOf(uids.carmen) },
			{
				type: 'janitor',
				name: 'Antonio García',
				phone: '600 000 103',
				whatsapp: '600 000 103',
				schedule: [
					{ days: [1, 2, 3, 4, 5], from: '08:00', to: '14:00' },
					{ days: [1, 2, 3, 4, 5], from: '17:00', to: '20:00' },
					{ days: [6], from: '09:00', to: '13:00' },
				],
			},
			providerContact('insurance', 'prov_insurance', { name: `${providerById('prov_insurance').name} · Póliza 123456` }),
			providerContact('elevator', 'prov_elevator'),
			providerContact('cleaning', 'prov_cleaning'),
			providerContact('gardening', 'prov_garden'),
			providerContact('other', 'prov_plumbing', { name: `${providerById('prov_plumbing').name} · Urgencias 24 h`, whatsapp: providerById('prov_plumbing').phone }),
			providerContact('other', 'prov_electric'),
		],
		documents: [
			{ type: 'statutes', title: 'Estatutos de la comunidad', url: documentUrl('los-olivos', 'estatutos'), date: new Date(1990, 5, 1) },
			{ type: 'regulations', title: 'Normas de régimen interno: piscina y zonas comunes', url: documentUrl('los-olivos', 'normas'), date: new Date(2019, 3, 10) },
			{ type: 'regulations', title: 'Normas de reserva de la pista de pádel, la sala común y la barbacoa', url: documentUrl('los-olivos', 'normas-reservas'), date: days(-58, '00:00') },
			// Renewed then, as maintenance's insurance obligation has it in both communities
			{ type: 'insurance', title: 'Póliza multirriesgo · Seguros La Previsora', url: documentUrl('los-olivos', 'poliza-seguro'), date: days(-307, '00:00') },
			{ type: 'minutes', title: `Junta general ordinaria ${held.getFullYear()}`, url: documentUrl('los-olivos', `actas/${held.getFullYear()}-ordinaria`), date: held },
			{ type: 'minutes', title: 'Junta extraordinaria: cámaras de seguridad', url: documentUrl('los-olivos', `actas/${held.getFullYear() - 1}-extraordinaria`), date: new Date(held.getFullYear() - 1, 1, 20) },
			{ type: 'minutes', title: `Junta general ordinaria ${held.getFullYear() - 1}`, url: documentUrl('los-olivos', `actas/${held.getFullYear() - 1}-ordinaria`), date: yearsBefore(1) },
			{ type: 'minutes', title: `Junta general ordinaria ${held.getFullYear() - 2}`, url: documentUrl('los-olivos', `actas/${held.getFullYear() - 2}-ordinaria`), date: yearsBefore(2) },
		],
		createdAt: days(-400),
		createdBy: uids.team,
		updatedAt: days(-1, '08:30'),
		updatedBy: uids.office,
	},
	// Lighter: no fianzas nor price to book, online payments, bank feed nor late interest, and the default monthly votes
	'communities/comm2': {
		...fiscal('comm2'),
		commonAreas: commonAreas.comm2,
		bookingFees: getBookingFees(commonAreas.comm2),
		contacts: [
			officeContact,
			{ type: 'president', name: userById(uids.tomas).name, phone: phoneOf(uids.tomas), whatsapp: phoneOf(uids.tomas) },
			providerContact('elevator', 'prov_elevator'),
			providerContact('insurance', 'prov_insurance'),
		],
		documents: [
			{ type: 'statutes', title: 'Estatutos de la comunidad', url: documentUrl('mirador-del-castillo', 'estatutos'), date: new Date(2006, 8, 15) },
			{ type: 'insurance', title: 'Póliza multirriesgo · Seguros La Previsora', url: documentUrl('mirador-del-castillo', 'poliza-seguro'), date: days(-353, '00:00') },
			{ type: 'minutes', title: `Junta general ordinaria ${held.getFullYear() - 1}`, url: documentUrl('mirador-del-castillo', `actas/${held.getFullYear() - 1}-ordinaria`), date: new Date(held.getFullYear() - 1, 4, 22) },
		],
		createdAt: days(-42, '09:00'),
		createdBy: uids.team,
		updatedAt: days(-38, '12:40'),
		updatedBy: uids.office,
	},
	// Just created by the team from the form, which saves the lists empty: the community page flags what's missing
	'communities/comm3': {
		...fiscal('comm3'),
		contacts: [],
		documents: [],
		createdAt: days(-2, '17:05'),
		createdBy: uids.team,
		updatedAt: days(-2, '17:05'),
		updatedBy: uids.team,
	},
};

// Last touched by the office then, as the log has it: the tenant added, the cancelled domiciliación, the mandates saved,
// Pablo's account linked to his flat (the import leaves owners without one)
const propertyChanges = { prop2: [-20, '10:30'], prop4: [-33, '13:00'], c2prop3: [-30, '13:10'], c2prop4: [-30, '13:15'], c2prop5: [-36, '09:34'] };

// Ids are the email in lowercase. Only the team invites with communityIds, an administrator for the new community
const invitations = [
	{ email: 'lynx9011+user9@gmail.com', name: 'Francisco López', role: 'user', communityId: 'comm1', invitedBy: uids.office, invitedAt: days(-6, '10:45') },
	{ email: 'irene.campos@example.com', name: 'Irene Campos', role: 'user', communityId: 'comm1', invitedBy: uids.carmen, invitedAt: days(-15, '19:20') },
	{ email: 'antonia.herrera@example.com', name: 'Antonia Herrera', role: 'manager', communityId: 'comm2', invitedBy: uids.office, invitedAt: days(-4, '11:30') },
	{ email: 'lynx9011+fincas2@gmail.com', name: 'Gestiones Úbeda', role: 'admin', communityId: '', communityIds: ['comm3'], invitedBy: uids.team, invitedAt: days(-1, '16:10') },
];

const officeName = userById(uids.office).name;

// Stored inside Firestore as the apps do. uploadedBy is the office's name for the ones it sent, none for the owner's own
const personDocuments = [
	[uids.lucia, 'doc_deed_prop1', 'Escritura Piso 1A.pdf', 'deed', 'prop1', -150, undefined, ['Escritura de compraventa', 'Residencial Los Olivos · Piso 1A', 'Compradora: Lucía Martín (12345678Z)', 'Notaría de Jaén, protocolo 1.234']],
	[uids.lucia, 'doc_certificate_prop1', 'Certificado de pagos Piso 1A.pdf', 'receipt', 'prop1', -12, officeName, ['Certificado de estar al corriente de pago', 'Residencial Los Olivos · Piso 1A', `${office.name}, administradora de la comunidad, certifica que Lucía Martín (12345678Z)`, 'está al corriente de pago de las cuotas de la comunidad.', `Jaén, ${days(-12).toLocaleDateString('es')}`]],
	[uids.javier, 'doc_permit_prop2', 'Autorización de obra Piso 1B.pdf', 'permit', 'prop2', -48, officeName, ['Autorización de obra', 'Residencial Los Olivos · Piso 1B', 'Se autoriza la reforma de la cocina, sin tocar elementos comunes.', 'Horario de obra: lunes a viernes de 9:00 a 14:00 y de 16:00 a 19:00.']],
	[uids.javier, 'doc_lease_prop2', 'Contrato de alquiler Piso 1B.pdf', 'other', 'prop2', -25, undefined, ['Contrato de arrendamiento de vivienda', 'Residencial Los Olivos · Piso 1B', 'Arrendador: Javier Ortega · Arrendataria: Irene Campos']],
	[uids.maria, 'doc_claim_prop4', 'Requerimiento de pago Piso 2B.pdf', 'other', 'prop4', -30, officeName, ['Segundo aviso de pago', 'Residencial Los Olivos · Piso 2B', 'Le recordamos que tiene cuotas pendientes con la comunidad.', 'Puede pagarlas desde la app o por transferencia a la cuenta de la comunidad.']],
	[uids.carmen, 'doc_deed_prop3', 'Escritura Piso 2A.pdf', 'deed', 'prop3', -200, undefined, ['Escritura de compraventa', 'Residencial Los Olivos · Piso 2A', 'Compradora: Carmen Ruiz (22222222J)']],
	[uids.tomas, 'doc_deed_c2prop3', 'Escritura 1º A.pdf', 'deed', 'c2prop3', -35, undefined, ['Escritura de compraventa', 'Edificio Mirador del Castillo · 1º A', 'Comprador: Tomás Vidal (99999999R)']],
];

// A one page PDF with these lines, the first as its title. Latin-1, Helvetica's encoding here, so accents print
function pdf(lines) {
	const text = lines.map((line, index) => `BT /F1 ${index ? 11 : 16} Tf 56 ${780 - index * 24} Td (${line.replace(PDF_SPECIAL_REGEX, '\\$&')}) Tj ET`).join('\n');
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
		`<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
	];
	let body = '%PDF-1.4\n';
	const offsets = objects.map((object, index) => {
		const offset = body.length;
		body += `${index + 1} 0 obj\n${object}\nendobj\n`;
		return offset;
	});
	const xref = body.length;
	body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
	body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(body, 'latin1');
}

// As the app counts them: each owner of the census once, and those with an email
function notified(communityId) {
	const owners = ownersOf(propertiesOf(communityId));
	return `a ${owners.length} propietarios, ${owners.filter(owner => owner.email).length} por email`;
}
const role = name => roles[name].label.toLowerCase();
const mandateOf = id => properties.find(property => property.id === id).mandate.reference;
const { claims: mariaClaims, monitorio } = debtCases.prop4;

// [days ago, time, who, area, summary, link], as logActivity words them. Links inside the admin platform, null when none.
// Dated as the other groups date what they name (the juntas, the leak, the claims, the documents above); what neighbours
// or managers do from the webapp (Carmen signing the acta, uploading their own documents) isn't logged
const c1 = '/communities/comm1';
const c2 = '/communities/comm2';
const m1 = `${c1}/meetings/meeting_ordinary`;
const m2 = `${c1}/meetings/meeting_extra`;
const m3 = `${c2}/meetings/meeting_ordinary`;
const leakLink = `${c1}/issues/issue_leak`;
const elevatorLink = `${c1}/issues/issue_elevator`;
const socketsLink = `${c1}/issues/issue_sockets`;
const stairsLink = `${c1}/issues/issue_stairs`;
const terraceLink = `${c2}/issues/issue_terrace`;
const humidityLink = `${c1}/issues/issue_humidity`;
const plumber = providerById('prov_plumbing').name;
const insurer = providerById('prov_insurance').name;
// Every provider has an email, so each parte goes to them by email too
const sentOrder = (title, providerId) => `Creó un parte de trabajo de ${title} para ${providerById(providerId).name} y se lo envió por email`;
const activity = {
	comm1: [
		[-80, '10:00', 'office', 'meeting', `Creó la junta ${ordinary}`, m1],
		[-70, '09:55', 'office', 'meeting', `Cambió el estado de la junta ${ordinary} a Convocada`, m1],
		[-70, '10:00', 'office', 'meeting', `Notificó la convocatoria de la junta ${ordinary} ${notified('comm1')}`, m1],
		[-70, '10:05', 'office', 'meeting', `Abrió la votación de la junta ${ordinary}`, m1],
		[-58, '09:40', 'office', 'community', 'Editó los datos de la comunidad', c1],
		[-56, '10:15', 'office', 'booking', 'Añadió la zona común Barbacoa', `${c1}/locations`],
		[-56, '10:22', 'office', 'booking', 'Actualizó las reservas de Sala común', `${c1}/locations`],
		[-55, '10:00', 'office', 'issue', `Cambió el estado de ${video} a Cerrada`, `${c1}/issues/issue_3`],
		[-55, '12:05', 'office', 'finance', 'Activó los pagos online de los vecinos en modo de prueba', `${c1}/charges`],
		[-54, '11:20', 'office', 'finance', 'Conectó la cuenta de la comunidad con el banco de pruebas', `${c1}/bank`],
		[-52, '13:10', 'office', 'finance', `Aplicó intereses de demora del ${formatRate(lateInterest.rate)} anual tras ${lateInterest.graceDays} días de gracia`, `${c1}/arrears`],
		[-51, '09:30', 'office', 'issue', `Asignó ${humidity} a ${plumber}`, humidityLink],
		[-51, '09:35', 'office', 'issue', `Respondió en ${humidity}`, humidityLink],
		[-51, '09:40', 'office', 'issue', `Abrió un parte al seguro por ${humidity} con ${insurer}`, humidityLink],
		[-48, '12:00', 'office', 'people', `Envió «Autorización de obra Piso 1B.pdf» a ${userById(uids.javier).name}`, `${c1}/people/${uids.javier}/documents`],
		[-45, '10:00', 'office', 'issue', `Cambió el estado de ${humidity} a Solucionada`, humidityLink],
		[-45, '21:10', 'office', 'meeting', `Cerró la votación de la junta ${ordinary}`, m1],
		[-45, '21:15', 'office', 'meeting', `Cambió el estado de la junta ${ordinary} a Celebrada`, m1],
		[-44, '11:00', 'office', 'issue', `Actualizó el parte al seguro de ${humidity}: Visita del perito`, humidityLink],
		[-40, '12:00', 'office', 'meeting', `Preparó el acta de la junta ${ordinary}`, m1],
		// Rosa, the secretary, signed on the office's screen after Carmen did from the app: the second signature seals it
		[-37, '17:05', 'office', 'meeting', `Recogió en persona la firma de ${userById(uids.rosa).name} en el acta de la junta ${ordinary}`, m1],
		[-37, '17:05', 'office', 'meeting', `Cerró el acta firmada de la junta ${ordinary}`, m1],
		// The sealed acta added to Documentación
		[-37, '17:20', 'office', 'community', 'Editó los datos de la comunidad', c1],
		[-33, '13:00', 'office', 'finance', `Guardó el mandato SEPA ${mandateOf('prop4')} de Piso 2B (cancelado)`, `${c1}/mandates`],
		[-33, '16:30', 'office', 'issue', `Actualizó el parte al seguro de ${humidity}: Rechazado`, humidityLink],
		[-30, '11:10', 'office', 'finance', `Reclamó a Piso 2B ${formatCents(mariaClaims[1].amount)}: segundo aviso por burofax (${mariaClaims[1].tracking})`, `${c1}/arrears`],
		[-30, '12:00', 'office', 'people', `Envió «Requerimiento de pago Piso 2B.pdf» a ${userById(uids.maria).name}`, `${c1}/people/${uids.maria}/documents`],
		[-30, '12:00', 'office', 'issue', `Cambió el estado de ${humidity} a Cerrada`, humidityLink],
		[-30, '12:05', 'office', 'issue', `Respondió en ${humidity}`, humidityLink],
		[-28, '09:50', 'office', 'obligation', 'Añadió los plazos de 3 declaraciones a la AEAT', `${c1}/obligations`],
		[-25, '09:30', 'office', 'meeting', `Notificó el acta de la junta ${ordinary} ${notified('comm1')}`, m1],
		// Assigned while open, which moves it to Actuando in the same change
		[-25, '10:15', 'office', 'issue', `Asignó ${leak} a ${plumber}`, leakLink],
		[-25, '10:20', 'office', 'issue', `Respondió en ${leak}`, leakLink],
		[-25, '10:25', 'office', 'event', `Publicó el aviso ${leak}`, `${c1}/notifications`],
		[-25, '10:30', 'office', 'issue', `Abrió un parte al seguro por ${leak} con ${providerById('prov_insurance').name}`, leakLink],
		[-25, '10:45', 'office', 'issue', `Creó un parte de trabajo de ${leak} para ${plumber} y se lo envió por email`, leakLink],
		[-25, '11:10', 'office', 'finance', `Reclamó a Piso 3A ${formatCents(debtCases.prop8.claims[1].amount)}: segundo aviso por carta`, `${c1}/arrears`],
		[-24, '12:00', 'office', 'issue', `Respondió en ${leak}`, leakLink],
		[-20, '10:30', 'office', 'property', 'Editó la propiedad «Piso 1B» (Vivienda)', `${c1}/properties`],
		[-18, '12:00', 'office', 'issue', `Actualizó el parte al seguro de ${leak}: Visita del perito`, leakLink],
		// Providers are only assigned from the admin platform
		[-17, '09:00', 'carmen', 'issue', `Asignó ${irrigation} a ${providerById('prov_garden').name}`, `${c1}/issues/issue_irrigation`],
		[-17, '10:00', 'office', 'event', `Envió el comunicado ${officeHours}`, `${c1}/notifications`],
		[-15, '19:20', 'carmen', 'people', 'Invitó a Irene Campos como vecino', `${c1}/people`],
		[-12, '12:00', 'office', 'people', `Envió «Certificado de pagos Piso 1A.pdf» a ${userById(uids.lucia).name}`, `${c1}/people/${uids.lucia}/documents`],
		[-10, '11:00', 'office', 'issue', `Cambió el estado de ${leak} a Solucionada`, leakLink],
		[-10, '11:05', 'office', 'issue', `Respondió en ${leak}`, leakLink],
		[-10, '11:10', 'office', 'finance', `Preparó el monitorio contra Piso 2B por ${formatCents(monitorio.amount)}, liquidación aprobada en la junta del ${monitorio.meetingDate.split('-').reverse().join('/')}`, `${c1}/arrears`],
		[-10, '20:30', 'carmen', 'issue', `Respondió en ${leak}`, leakLink],
		[-9, '13:20', 'office', 'issue', `Actualizó el parte al seguro de ${leak}: Aceptado`, leakLink],
		[-8, '10:00', 'office', 'meeting', `Creó la junta ${extraordinary}`, m2],
		// Andrés' insult in the comments, then blocked: he can't comment since
		[-6, '09:00', 'carmen', 'moderation', `Ocultó un comentario de ${userById(uids.andres).name} en ${noise}`, `${c1}/issues/issue_2`],
		[-6, '09:05', 'carmen', 'moderation', `Bloqueó a ${userById(uids.andres).name}`, `${c1}/people`],
		[-6, '10:30', 'office', 'issue', `Asignó ${elevator} a ${providerById('prov_elevator').name}`, elevatorLink],
		[-6, '10:35', 'office', 'issue', `Respondió en ${elevator}`, elevatorLink],
		[-6, '10:40', 'office', 'issue', sentOrder(elevator, 'prov_elevator'), elevatorLink],
		[-6, '10:45', 'office', 'people', 'Invitó a Francisco López como vecino y le envió la invitación por email', `${c1}/people`],
		[-5, '09:55', 'office', 'meeting', `Cambió el estado de la junta ${extraordinary} a Convocada`, m2],
		[-5, '10:00', 'office', 'meeting', `Notificó la convocatoria de la junta ${extraordinary} ${notified('comm1')}`, m2],
		[-5, '10:05', 'office', 'meeting', `Abrió la votación de la junta ${extraordinary}`, m2],
		// Francisco López called it in, he has no account
		[-5, '17:30', 'office', 'issue', `Abrió la incidencia ${sockets}`, socketsLink],
		[-5, '17:40', 'office', 'issue', `Asignó ${sockets} a ${providerById('prov_electric').name}`, socketsLink],
		[-5, '17:45', 'office', 'issue', `Respondió en ${sockets}`, socketsLink],
		[-5, '17:50', 'office', 'issue', sentOrder(sockets, 'prov_electric'), socketsLink],
		// Support, fixing a typo for the office
		[-5, '18:00', 'team', 'community', 'Editó los datos de la comunidad', c1],
		[-4, '12:30', 'office', 'issue', `Actualizó el parte al seguro de ${leak}: Indemnizado`, leakLink],
		[-3, '09:00', 'office', 'issue', `Asignó ${stairs} a ${providerById('prov_cleaning').name}`, stairsLink],
		[-3, '09:05', 'office', 'issue', `Respondió en ${stairs}`, stairsLink],
		[-3, '09:10', 'office', 'issue', sentOrder(stairs, 'prov_cleaning'), stairsLink],
		[-3, '10:00', 'office', 'meeting', `Creó la junta ${draft}`, `${c1}/meetings/meeting_draft`],
		[-2, '10:00', 'office', 'obligation', `Marcó como hecha «Desratización del garaje y los sótanos», la próxima vence el ${days(180).toLocaleDateString('es')}`, `${c1}/obligations`],
		[-2, '10:00', 'office', 'event', `Envió el comunicado ${holiday}`, `${c1}/notifications`],
		[-1, '08:30', 'office', 'finance', 'Sincronizó los movimientos del banco de pruebas', `${c1}/bank`],
		// A new parte for the zone's technician, which revokes the first one
		[-1, '09:12', 'office', 'issue', sentOrder(elevator, 'prov_elevator'), elevatorLink],
		[-1, '09:15', 'office', 'issue', `Respondió en ${elevator}`, elevatorLink],
	],
	comm2: [
		[-42, '09:00', 'team', 'community', `Creó la comunidad «${fiscal('comm2').name}»`, c2],
		[-42, '09:05', 'team', 'people', `Asignó la comunidad a ${officeName}`, `${c2}/people`],
		[-40, '11:30', 'office', 'property', 'Importó el censo de censo-mirador-del-castillo.xlsx: 6 propiedades nuevas', `${c2}/properties`],
		[-39, '10:10', 'office', 'community', 'Editó los datos de la comunidad', c2],
		[-38, '12:40', 'office', 'booking', 'Añadió la zona común Sala de reuniones', `${c2}/locations`],
		[-37, '09:20', 'office', 'people', `Invitó a ${userById(uids.tomas).name} como ${role('manager')} y le envió la invitación por email`, `${c2}/people`],
		// Once in, the president brings his neighbours
		[-37, '20:10', 'tomas', 'people', `Invitó a ${userById(uids.elena).name} como vecino`, `${c2}/people`],
		[-37, '20:12', 'tomas', 'people', `Invitó a ${userById(uids.pablo).name} como vecino`, `${c2}/people`],
		// Once they signed in, their flats linked to their accounts
		[-36, '09:30', 'office', 'property', 'Editó la propiedad «1º A» (Vivienda)', `${c2}/properties`],
		[-36, '09:32', 'office', 'property', 'Editó la propiedad «1º B» (Vivienda)', `${c2}/properties`],
		[-36, '09:34', 'office', 'property', 'Editó la propiedad «2º A» (Vivienda)', `${c2}/properties`],
		[-36, '10:00', 'office', 'meeting', `Creó la junta ${ordinary}`, m3],
		[-35, '09:55', 'office', 'meeting', `Cambió el estado de la junta ${ordinary} a Convocada`, m3],
		[-35, '10:00', 'office', 'meeting', `Notificó la convocatoria de la junta ${ordinary} ${notified('comm2')}`, m3],
		[-35, '10:05', 'office', 'meeting', `Abrió la votación de la junta ${ordinary}`, m3],
		[-32, '10:00', 'tomas', 'issue', `Asignó ${portal} a ${providerById('prov_cleaning').name}`, `${c2}/issues/issue_portal_cleaning`],
		[-30, '13:10', 'office', 'finance', `Guardó el mandato SEPA ${mandateOf('c2prop3')} de 1º A (activo)`, `${c2}/mandates`],
		[-30, '13:15', 'office', 'finance', `Guardó el mandato SEPA ${mandateOf('c2prop4')} de 1º B (activo)`, `${c2}/mandates`],
		[-20, '20:45', 'office', 'meeting', `Cerró la votación de la junta ${ordinary}`, m3],
		[-20, '20:50', 'office', 'meeting', `Cambió el estado de la junta ${ordinary} a Celebrada`, m3],
		// The president handles it from the admin platform
		[-19, '09:00', 'tomas', 'issue', `Asignó ${terrace} a ${plumber}`, terraceLink],
		[-19, '09:10', 'tomas', 'issue', `Respondió en ${terrace}`, terraceLink],
		[-19, '09:15', 'tomas', 'issue', `Abrió un parte al seguro por ${terrace} con ${insurer}`, terraceLink],
		[-19, '09:20', 'tomas', 'issue', sentOrder(terrace, 'prov_plumbing'), terraceLink],
		[-17, '10:00', 'office', 'event', `Envió el comunicado ${officeHours}`, `${c2}/notifications`],
		[-15, '11:00', 'office', 'meeting', `Preparó el acta de la junta ${ordinary}`, m3],
		[-6, '12:00', 'tomas', 'issue', `Actualizó el parte al seguro de ${terrace}: Visita del perito`, terraceLink],
		// Put off for the rain: a new expected date, saved as an assignment to the same plumber
		[-5, '10:00', 'tomas', 'issue', `Asignó ${terrace} a ${plumber}`, terraceLink],
		[-4, '11:30', 'office', 'people', `Invitó a Antonia Herrera como ${role('manager')} y le envió la invitación por email`, `${c2}/people`],
		[-2, '10:00', 'office', 'event', `Envió el comunicado ${holiday}`, `${c2}/notifications`],
	],
	comm3: [
		[-2, '17:05', 'team', 'community', `Creó la comunidad «${fiscal('comm3').name}»`, '/communities/comm3'],
	],
};

export default {
	id: 'core',
	label: 'Comunidades, propiedades y personas',
	hint: `Las ${VOLUME ? 41 : 3} comunidades, el censo, los usuarios, invitaciones, documentos de vecinos y el registro de actividad${VOLUME ? ', con las 38 de --volume' : ''}`,
	// charges.js only lends ids and amounts, core seeds fine without it
	requires: [],
	collections: ['communities', 'properties', 'users', 'invitations'],
	communityCollections: ['activity'],
	seed(set) {
		for (const [path, data] of Object.entries(communityDocs)) {
			set(path, data);
		}

		for (const { id, ...property } of properties) {
			const createdAt = days(property.communityId === 'comm1' ? -400 : -40, '11:30');
			const changed = propertyChanges[id];
			// With the remittance that carried its first debit, so the next one goes RCUR
			const mandate = property.mandate && { ...property.mandate, firstRemittanceId: firstRemittances[id] };
			set(`properties/${id}`, { ...property, mandate, createdAt, createdBy: uids.office, updatedAt: changed ? days(...changed) : createdAt, updatedBy: uids.office });
		}

		// As the first sign-in makes them from the invitation. Auth accounts are seed.js's
		for (const { uid, ...user } of users) {
			set(`users/${uid}`, uid === uids.office && VOLUME ? { ...user, communityIds: [...user.communityIds, ...volumeCommunities.map(community => community.id)] } : user);
		}
		if (VOLUME) {
			seedVolume(set);
		}

		for (const invitation of invitations) {
			set(`invitations/${invitation.email}`, invitation);
		}

		for (const [uid, id, name, category, propertyId, n, uploadedBy, lines] of personDocuments) {
			const file = pdf(lines);
			set(`users/${uid}/documentFiles/${id}`, { data: file });
			set(`users/${uid}/documents/${id}`, { name, type: 'application/pdf', size: file.length, category, propertyId, createdAt: days(n, '12:00'), uploadedBy });
		}

		for (const [communityId, entries] of Object.entries(activity)) {
			entries.forEach(([n, time, who, area, summary, link], index) => {
				set(`communities/${communityId}/activity/act_${String(index + 1).padStart(2, '0')}`, {
					area,
					summary,
					link: link ?? null,
					at: days(n, time),
					by: uids[who],
					byName: userById(uids[who]).name,
				});
			});
		}
	},
};
