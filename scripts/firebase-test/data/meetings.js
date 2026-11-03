import { createHash } from 'node:crypto';
import { claimLevels } from '../../../packages/shared/domain/arrears.ts';
import { formatIban } from '../../../packages/shared/domain/community.ts';
import { renderMail } from '../../../packages/shared/domain/mail.ts';
import { isApproved, meetingTypes, tallyVotes } from '../../../packages/shared/domain/meeting.ts';
import { ownersOf } from '../../../packages/shared/domain/minutes.ts';
import { formatCents } from '../../../packages/shared/domain/money.ts';
import { audit, communities, days, isoDate, now, office, propertiesOf, providerById, uids, userById } from './cast.js';
import { debtCases, openCharges } from './charges.js';
import maintenance from './maintenance.js';

// The juntas with their answers, votes, acta and notices, the timeline's events and the outbox, in demo mode.
// comm1 has a held ordinary with its sealed acta and notices, an extraordinary convened with remote voting, a draft and a
// cancelled one; comm2 a held ordinary whose acta waits for the secretary's signature

const PARAGRAPHS_REGEX = /\n{2,}/;
const WEBAPP_URL = 'https://gobernansa.dmoya.dev';
const ADMIN_URL = 'https://admin.gobernansa.dmoya.dev';

const communityById = Object.fromEntries(communities.map(community => [community.id, community]));
const nameOf = uid => userById(uid).name;
const emailOf = uid => userById(uid).email;

const percent = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatPercent = value => `${percent.format(value)} %`;
const fullFormat = new Intl.DateTimeFormat('es-ES', { dateStyle: 'full', timeStyle: 'short' });
const dayFormat = new Intl.DateTimeFormat('es-ES', { dateStyle: 'full' });
const timeFormat = new Intl.DateTimeFormat('es-ES', { timeStyle: 'short' });
const longFormat = new Intl.DateTimeFormat('es', { dateStyle: 'long' });
const at = (date, seconds) => new Date(date.getTime() + seconds * 1000);

// As the admin words a result in the acta, over the whole coefficient (100 in every community of the cast)
function describeResult(tally) {
	if (!tally.some(entry => entry.votes)) {
		return 'No se emitieron votos.';
	}
	const [yes, no, abstain] = ['yes', 'no', 'abstain'].map(choice => tally.find(entry => entry.choice === choice));
	const count = (votes, one, many) => `${votes} ${votes === 1 ? one : many}`;
	return `${isApproved(tally) ? 'Se aprueba' : 'No se aprueba'} con ${count(yes.votes, 'voto', 'votos')} a favor (${formatPercent(yes.coefficient)}), `
		+ `${no.votes} en contra (${formatPercent(no.coefficient)}) y ${count(abstain.votes, 'abstención', 'abstenciones')} (${formatPercent(abstain.coefficient)}).`;
}

// A stroke in SignaturePad's 400×150 box, whole numbers as the rules take them, and the underline
function stroke(seed) {
	const points = Array.from({ length: 30 }, (_, i) => `${i ? 'L' : 'M'}${40 + i * 10} ${Math.round(70 + 28 * Math.sin(i * 0.9 + seed) * Math.cos(i * 0.3 + seed * 2))}`);
	return `${points.join(' ')} M${50 + seed * 7} 122 L${300 + seed * 9} 116`;
}

// The made-up reference of the test mode's certified post, fixed per notice
function tracking(path) {
	return `PRUEBA-BF${String(Number.parseInt(createHash('sha256').update(path).digest('hex').slice(0, 8), 16) % 1e9).padStart(9, '0')}`;
}

// minutesHash() of packages/shared/domain/minutes.ts, synchronous: the text and each signature in a fixed order
function minutesHash({ communityId, meetingId, text, signatures }) {
	const signed = ['president', 'secretary'].map((role) => {
		const { uid, name, path, signedAt, byUid, byEmail } = signatures[role];
		return { role, uid, name, byUid, byEmail, signedAt: signedAt.toISOString(), path };
	});
	return createHash('sha256').update(JSON.stringify({ communityId, meetingId, text, signed })).digest('hex');
}

function communityLine({ name, address }) {
	return name ? `Comunidad de propietarios ${name}${address ? `, ${address}` : ''}` : '';
}

// meetingMail() of the admin's mail.ts: the convocatoria or the acta to one owner, with the button to the app when they have an account
function meetingMail(meeting, kind, owner, minutes = '') {
	const community = communityById[meeting.communityId];
	const what = `la junta ${meetingTypes[meeting.type].toLowerCase()} «${meeting.title}»`;
	const action = owner.uid ? { label: kind === 'call' ? 'Ver la convocatoria' : 'Ver el acta en la app', url: `${WEBAPP_URL}/neighborhood/meetings/${meeting.id}` } : undefined;
	const footer = [communityLine(community), 'La administración de la comunidad'];
	const hello = `Hola, ${owner.name}:`;
	if (kind === 'call') {
		return {
			subject: `Convocatoria: ${meeting.title} · ${community.name}`,
			title: `Convocatoria de junta ${meetingTypes[meeting.type].toLowerCase()}`,
			blocks: [
				hello,
				`Como propietario de ${owner.propertyNames.join(', ')}, se te convoca a ${what} de la comunidad ${community.name}.`,
				[
					`Fecha: ${dayFormat.format(meeting.date)}, a las ${timeFormat.format(meeting.date)}`,
					...(meeting.place ? [`Lugar: ${meeting.place}`] : []),
					...(meeting.link ? [`Enlace para unirse: ${meeting.link}`] : []),
				].join('\n'),
				'Orden del día:',
				meeting.agenda.map(([, title]) => title),
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
		title: `Acta de la junta del ${dayFormat.format(meeting.date)}`,
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

// The outbox entry, as queueMail() writes it, kept to give them their ids once all are known
function mail(createdAt, createdBy, { to, communityId, kind, link, replyTo = emailOf(createdBy), ...content }) {
	return { createdAt, data: { to: [to], replyTo, message: renderMail(content), communityId, kind, mode: 'demo', link, createdAt, createdBy } };
}

/*
 * Each meeting. agenda: [id, title, description, votable]. voters: [propertyId, who cast it, when], the ones ballots go
 * in order of, and choices per item a letter each (y, n, a, - for none). Notices: [readAt, receivedAt] by owner key
 */
const meetings = [
	{
		communityId: 'comm1',
		id: 'meeting_ordinary',
		title: 'Junta general ordinaria',
		type: 'ordinary',
		date: days(-45, '19:00'),
		place: 'Sala común de la comunidad',
		link: '',
		status: 'held',
		created: -80,
		agenda: [
			['informe', 'Informe de la presidenta', 'Resumen del año: obras hechas, incidencias y estado de la morosidad.', false],
			['cuentas', `Aprobación de las cuentas del ejercicio ${days(-45).getFullYear() - 1}`, 'Liquidación de ingresos y gastos y estado del fondo de reserva a 31 de diciembre.', true],
			['presupuesto', `Ratificación del presupuesto y las cuotas de ${days(-45).getFullYear()}`, 'Presupuesto ordinario, con el 10 % para el fondo de reserva, y cuotas trimestrales por coeficiente, fijas para garajes y trasteros.', true],
			['cargos', 'Renovación de cargos', 'Se propone a Carmen Ruiz como presidenta y a Rosa Delgado como secretaria por un año más.', true],
			['deuda', 'Liquidación de la deuda de Piso 2B y autorización para reclamarla', 'Aprobación de la deuda pendiente a la fecha de la junta y autorización a la presidenta y a la administración para iniciar el proceso monitorio (art. 21 LPH).', true],
			['piscina', 'Ampliación del horario de la piscina hasta las 22:00', 'Propuesta de varios vecinos para abrirla una hora más por la tarde en temporada de baño.', true],
			// Its two recibos are the charges group's levy-roof
			['cubierta', 'Impermeabilización de la cubierta y derrama para pagarla', 'Renovar la tela asfáltica de la cubierta para acabar con las filtraciones del cuarto piso: 6.000 € por coeficiente, en dos recibos de 3.000 €.', true],
			['ruegos', 'Ruegos y preguntas', '', false],
		],
		attendance: [
			[uids.carmen, 'attending', '', days(-65, '18:20')],
			[uids.lucia, 'attending', '', days(-60, '21:05')],
			[uids.rosa, 'attending', '', days(-62, '09:40')],
			[uids.javier, 'delegated', 'Irene Campos', days(-50, '13:15')],
			[uids.maria, 'absent', '', days(-67, '22:30')],
		],
		// Lucía and Carmen voted from the app while voting was open, the office recorded the rest during the meeting
		voters: [
			['prop1', uids.lucia, days(-48, '22:10')],
			['prop5', uids.lucia, days(-48, '22:11')],
			['prop3', uids.carmen, days(-47, '09:05')],
			['prop12', uids.carmen, days(-47, '09:06')],
			['prop9', uids.office, days(-45, '19:40')],
			['prop2', uids.office, days(-45, '19:41')],
			['prop6', uids.office, days(-45, '19:41')],
			['prop7', uids.office, days(-45, '19:42')],
		],
		choices: { cuentas: 'yyyyyyya', presupuesto: 'yyyyyyyn', cargos: 'yyyyyyyy', deuda: 'yyyyyyyy', piscina: 'yynnnnna', cubierta: 'yyyyyyyn' },
		call: {
			sentAt: days(-70, '10:00'),
			states: { [uids.carmen]: [-70, -70], [uids.lucia]: [-69, -69], [uids.javier]: [-66, null], [uids.maria]: [-68, -68], [uids.rosa]: [-70, -69] },
		},
		minutes: {
			president: uids.carmen,
			secretary: uids.rosa,
			preparedAt: days(-40, '12:00'),
			// Carmen from the app, Rosa in person on the office's screen
			signatures: { president: [uids.carmen, days(-38, '11:20')], secretary: [uids.office, days(-37, '17:05')] },
			text: (meeting, result) => [
				'Acta de la junta ordinaria de propietarios',
				`Comunidad: ${communityById.comm1.name}\nFecha: ${fullFormat.format(meeting.date)}\nLugar: ${meeting.place}`,
				'Asistentes',
				'Presentes: Carmen Ruiz (13,00 %), Lucía Martín (14,00 %), Rosa Delgado (11,50 %) e Inversiones Jaén S.L., representada por su administrador (11,50 %).',
				'Representados: Javier Ortega, representado por Irene Campos (13,00 %).',
				'En total, 5 propietarios presentes o representados, que suman el 63,00 % de las cuotas de participación. Asisten también Fincas Jaén S.L., administradora de la comunidad, y Laura Pérez, abogada, para el punto de la deuda. La junta se constituye en segunda convocatoria a las 19:30.',
				'Orden del día y acuerdos',
				`1. Informe de la presidenta\nLa presidenta resume las obras del año, entre ellas la nueva bomba de la depuradora de la piscina y el cambio de la bajante junto al 3B, y recuerda que Piso 2B acumula recibos pendientes. Punto informativo, sin votación.`,
				`2. ${meeting.agenda[1][1]}\nSe presentan la liquidación del ejercicio y el saldo del fondo de reserva. ${result('cuentas')}`,
				`3. ${meeting.agenda[2][1]}\nSe ratifican el presupuesto y las cuotas trimestrales que se vienen cobrando este año, por coeficiente y con cuota fija para garajes y trasteros, con el 10 % del presupuesto para el fondo de reserva. ${result('presupuesto')}`,
				`4. Renovación de cargos\nCarmen Ruiz continúa como presidenta y Rosa Delgado como secretaria. ${result('cargos')}`,
				`5. ${meeting.agenda[4][1]}\nSe aprueba la liquidación de la deuda de Piso 2B a la fecha de la junta y se faculta a la presidenta y a la administración para reclamarla por el proceso monitorio. ${result('deuda')}`,
				`6. ${meeting.agenda[5][1]}\nVarios vecinos alegan el ruido en las viviendas que dan a la piscina. ${result('piscina')} Se mantiene el horario actual.`,
				`7. ${meeting.agenda[6][1]}\nSe encarga la renovación de la tela asfáltica de la cubierta y se aprueba una derrama de 6.000 € por coeficiente en dos recibos de 3.000 €. ${result('cubierta')}`,
				'8. Ruegos y preguntas\nSe pide mejorar la señalización de las plazas del garaje y estudiar la instalación de puntos de recarga para coches eléctricos. La administración pedirá presupuesto a Electricidad Lumen.',
				'Y sin más asuntos que tratar, se levanta la sesión a las 21:05, de lo que como secretaria doy fe con el visto bueno de la presidenta.',
			].join('\n\n'),
		},
		// The 30 days to dissent end in 5 days, so the tally with the absent is still provisional
		minutesNotices: {
			sentAt: days(-25, '09:30'),
			states: { [uids.carmen]: [-25, -25], [uids.lucia]: [-24, -24], [uids.maria]: [-24, -23], [uids.andres]: [-20, null], [uids.rosa]: [-25, null] },
			dissent: { [uids.maria]: { deuda: days(-18, '21:14') } },
			// Francisco López has no account: his letter came by post
			recordedDissent: { pprop10: { piscina: { receivedOn: days(-12, '00:00'), recordedAt: days(-11, '10:15'), recordedBy: uids.office } } },
		},
		updated: days(-25, '09:30'),
	},
	{
		communityId: 'comm1',
		id: 'meeting_extra',
		title: 'Junta extraordinaria: impermeabilización del garaje',
		type: 'extraordinary',
		date: days(10, '19:30'),
		place: 'Sala común de la comunidad',
		link: 'https://meet.jit.si/residencial-los-olivos-junta',
		status: 'convened',
		votingOpen: true,
		created: -8,
		agenda: [
			['garaje', 'Impermeabilización del techo del garaje', 'Tras la fuga reparada en el garaje, Fontanería Hermanos Ortiz presupuesta impermeabilizar el forjado bajo el jardín para evitar nuevas filtraciones: 18.400 € más IVA.', true],
			['derrama', 'Derrama para financiar la obra', 'Derrama de 22.264 € (IVA incluido) repartida por coeficiente en dos recibos, en enero y en marzo.', true],
			['ruegos', 'Ruegos y preguntas', '', false],
		],
		attendance: [
			[uids.carmen, 'attending', '', days(-5, '12:30')],
			[uids.lucia, 'attending', '', days(-4, '20:45')],
			[uids.javier, 'delegated', 'Lucía Martín', days(-3, '08:50')],
			// Can't come, so she votes from the app
			[uids.rosa, 'absent', '', days(-2, '08:10')],
		],
		voters: [
			['prop1', uids.lucia, days(-3, '21:30')],
			['prop5', uids.lucia, days(-3, '21:31')],
			['prop9', uids.rosa, days(-2, '08:15')],
			['prop3', uids.carmen, days(-1, '19:45')],
		],
		choices: { garaje: 'yyyy', derrama: 'yyn-' },
		call: {
			sentAt: days(-5, '10:00'),
			states: { [uids.carmen]: [-5, -5], [uids.lucia]: [-4, -4], [uids.javier]: [-3, null], [uids.maria]: [-1, null], [uids.rosa]: [-2, -2] },
		},
		// When voting was opened, after sending the convocatoria
		updated: days(-5, '10:05'),
	},
	// Neighbours don't see it until it's convened
	{
		communityId: 'comm1',
		id: 'meeting_draft',
		title: 'Junta extraordinaria: puntos de recarga en el garaje',
		type: 'extraordinary',
		date: days(40, '19:00'),
		place: 'Sala común de la comunidad',
		link: '',
		status: 'draft',
		created: -3,
		agenda: [
			['recarga', 'Preinstalación comunitaria de recarga para vehículos eléctricos', 'Una línea desde el cuadro general del garaje para que cada plaza pueda conectar su punto de recarga.', true],
			['presupuesto', 'Elección del presupuesto', 'Dos presupuestos, a falta del de Electricidad Lumen, que viene a hacer la visita técnica.', true],
		],
	},
	{
		communityId: 'comm1',
		id: 'meeting_cancelled',
		title: 'Junta extraordinaria: cambio de empresa de limpieza',
		type: 'extraordinary',
		date: days(-100, '19:00'),
		place: 'Sala común de la comunidad',
		link: '',
		status: 'cancelled',
		created: -115,
		agenda: [
			['limpieza', 'Cambio de la empresa de limpieza', 'Desconvocada: Limpiezas Jaén mejoró su oferta y se mantiene el contrato.', true],
		],
		updated: days(-104, '11:00'),
	},
	{
		communityId: 'comm2',
		id: 'meeting_ordinary',
		title: 'Junta general ordinaria',
		type: 'ordinary',
		date: days(-20, '19:30'),
		place: 'Sala de reuniones',
		link: '',
		status: 'held',
		created: -36,
		agenda: [
			['cuentas', `Aprobación de las cuentas del ejercicio ${days(-20).getFullYear() - 1}`, 'Liquidación de ingresos y gastos del año pasado.', true],
			['presupuesto', `Aprobación del presupuesto de ${days(-20).getFullYear()}`, 'Presupuesto ordinario y cuotas mensuales por coeficiente.', true],
			['azotea', 'Impermeabilización de la azotea', 'Obra para acabar con las humedades de los segundos, con una derrama por coeficiente.', true],
			['ruegos', 'Ruegos y preguntas', '', false],
		],
		attendance: [
			[uids.tomas, 'attending', '', days(-30, '19:10')],
			[uids.elena, 'attending', '', days(-28, '14:25')],
			[uids.pablo, 'delegated', 'Tomás Vidal', days(-22, '10:00')],
		],
		// Antonia Herrera came in person without an account, Tomás recorded hers and Pablo's
		voters: [
			['c2prop1', uids.tomas, days(-20, '19:50')],
			['c2prop3', uids.tomas, days(-20, '19:50')],
			['c2prop4', uids.elena, days(-21, '18:30')],
			['c2prop5', uids.tomas, days(-20, '19:51')],
		],
		choices: { cuentas: 'yyyy', presupuesto: 'yyay', azotea: 'nyyy' },
		call: {
			sentAt: days(-35, '10:00'),
			states: { [uids.tomas]: [-35, -35], [uids.elena]: [-33, null] },
		},
		// Tomás signed, Elena still has to: the webapp asks her to
		minutes: {
			president: uids.tomas,
			secretary: uids.elena,
			preparedAt: days(-15, '11:00'),
			signatures: { president: [uids.tomas, days(-14, '20:10')] },
			text: (meeting, result) => [
				'Acta de la junta ordinaria de propietarios',
				`Comunidad: ${communityById.comm2.name}\nFecha: ${fullFormat.format(meeting.date)}\nLugar: ${meeting.place}`,
				'Asistentes',
				'Presentes: Antonia Herrera (16,00 %), Elena Castro (17,00 %) y Tomás Vidal (17,00 %).',
				'Representados: Pablo Gil, representado por Tomás Vidal (17,00 %).',
				'En total, 4 propietarios presentes o representados, que suman el 67,00 % de las cuotas de participación.',
				'Orden del día y acuerdos',
				`1. ${meeting.agenda[0][1]}\n${result('cuentas')}`,
				`2. ${meeting.agenda[1][1]}\n${result('presupuesto')}`,
				`3. Impermeabilización de la azotea\nSe encarga la obra y se aprueba una derrama por coeficiente en dos recibos. ${result('azotea')}`,
				'4. Ruegos y preguntas\nSe pide cambiar el horario de la limpieza de la escalera a primera hora de la mañana.',
				'Y sin más asuntos que tratar, se levanta la sesión a las 20:40.',
			].join('\n\n'),
		},
		// Preparing the acta was the last change to the meeting: signing only adds to minutesSigned
		updated: days(-15, '11:00'),
	},
];

const CHOICES = { y: 'yes', n: 'no', a: 'abstain' };

function ballotsOf(meeting) {
	const census = Object.fromEntries(propertiesOf(meeting.communityId).map(property => [property.id, property]));
	return Object.entries(meeting.choices ?? {}).flatMap(([itemId, letters]) => meeting.voters
		.map(([propertyId, voterId, votedAt], index) => letters[index] in CHOICES && {
			id: `${itemId}_${propertyId}`,
			itemId,
			propertyId,
			propertyName: census[propertyId].name,
			coefficient: census[propertyId].coefficient,
			choice: CHOICES[letters[index]],
			voterId,
			voterName: nameOf(voterId),
			votedAt,
		})
		.filter(Boolean));
}

function seedMeeting(set, meeting, outbox) {
	const path = `communities/${meeting.communityId}/meetings/${meeting.id}`;
	const ballots = ballotsOf(meeting);
	const votable = meeting.agenda.filter(([, , , isVotable]) => isVotable).map(([id]) => id);
	const result = itemId => describeResult(tallyVotes(ballots, itemId));

	// Signed and sealed as the app does it: the hash once both have signed, from the stored signing times
	let minutes;
	if (meeting.minutes) {
		const { president, secretary, preparedAt, signatures } = meeting.minutes;
		const signers = { president, secretary };
		minutes = {
			communityId: meeting.communityId,
			meetingId: meeting.id,
			text: meeting.minutes.text(meeting, result),
			president: { uid: president, name: nameOf(president) },
			secretary: { uid: secretary, name: nameOf(secretary) },
			signatures: Object.fromEntries(Object.entries(signatures).map(([role, [byUid, signedAt]], index) => [role, {
				uid: signers[role],
				name: nameOf(signers[role]),
				path: stroke(index + (meeting.communityId === 'comm1' ? 1 : 3)),
				signedAt,
				byUid,
				byEmail: emailOf(byUid),
			}])),
			hash: '',
			closedAt: null,
			updatedAt: preparedAt,
			updatedBy: uids.office,
		};
		if (minutes.signatures.president && minutes.signatures.secretary) {
			minutes.hash = minutesHash(minutes);
			minutes.closedAt = at(minutes.signatures.secretary.signedAt, 2);
		}
		set(`${path}/minutes/record`, minutes);
	}

	const sent = { call: meeting.call?.sentAt, minutes: meeting.minutesNotices?.sentAt };
	set(path, {
		communityId: meeting.communityId,
		title: meeting.title,
		type: meeting.type,
		date: meeting.date,
		place: meeting.place,
		link: meeting.link,
		agenda: meeting.agenda.map(([id, title, description, isVotable]) => ({ id, title, description, votable: isVotable })),
		status: meeting.status,
		votingOpen: meeting.votingOpen ?? false,
		minutesSigners: minutes ? [minutes.president.uid, minutes.secretary.uid] : undefined,
		// In the order they signed
		minutesSigned: minutes ? Object.values(minutes.signatures).sort((a, b) => a.signedAt - b.signedAt).map(signature => signature.uid) : undefined,
		notifiedAt: sent.call ? { call: sent.call, minutes: sent.minutes } : undefined,
		// What the admin keeps from the ballots once held, for the webapp
		results: meeting.status === 'held' ? Object.fromEntries(votable.map(itemId => [itemId, tallyVotes(ballots, itemId)])) : undefined,
		...audit(meeting.created),
		updatedAt: meeting.updated ?? days(meeting.created),
	});

	for (const [uid, status, delegateName, updatedAt] of meeting.attendance ?? []) {
		set(`${path}/attendance/${uid}`, { uid, name: nameOf(uid), status, delegateName: status === 'delegated' ? delegateName : '', updatedAt });
	}
	for (const { id, ...ballot } of ballots) {
		set(`${path}/ballots/${id}`, ballot);
	}

	// One per owner of the census (ownersOf groups their properties), absent when they neither answered they'd come or
	// delegate nor voted, as MeetingNotices works it out
	const wasThere = owner => (meeting.attendance ?? []).some(([uid, status]) => uid === owner.uid && status !== 'absent')
		|| ballots.some(ballot => owner.propertyIds.includes(ballot.propertyId));
	for (const kind of ['call', 'minutes']) {
		const notices = kind === 'call' ? meeting.call : meeting.minutesNotices;
		if (!notices) {
			continue;
		}
		for (const { key, ...owner } of ownersOf(propertiesOf(meeting.communityId))) {
			const id = `${kind}_${key}`;
			const [read, received] = notices.states[key] ?? [null, null];
			const absent = kind === 'minutes' && !wasThere(owner);
			const time = notices.sentAt.toTimeString().slice(0, 5);
			set(`${path}/notices/${id}`, {
				kind,
				...owner,
				absent,
				items: kind === 'minutes' ? votable : [],
				app: !!owner.uid,
				certified: { mode: 'test', reference: tracking(`${path}/${id}`) },
				sentAt: notices.sentAt,
				sentBy: uids.office,
				// Opened a few minutes after it arrived, acknowledged a bit later
				readAt: read === null ? null : at(days(read, time), 25 * 60),
				receivedAt: received === null ? null : at(days(received, time), 40 * 60),
				dissent: notices.dissent?.[key] ?? {},
				recordedDissent: notices.recordedDissent?.[key],
			});
			outbox.push(mail(notices.sentAt, uids.office, {
				...meetingMail(meeting, kind, { ...owner, absent }, minutes?.text),
				to: owner.email,
				communityId: meeting.communityId,
				kind: kind === 'call' ? 'meeting-call' : 'meeting-minutes',
				link: `/communities/${meeting.communityId}/meetings/${meeting.id}`,
			}));
		}
	}
}

// The day the next quarterly fee falls due, as the charges group issues them
const nextFeeDue = openCharges.comm1.filter(charge => charge.id.startsWith('fees-') && charge.dueDate > isoDate(0)).map(charge => charge.dueDate).sort()[0];
const nextFee = Math.round((new Date(`${nextFeeDue}T00:00`) - days(0, '00:00')) / 86_400_000);

// Last week's Saturday, when the sala is free in the morning (bookings group)
const lastSaturday = -1 - (now.getDay() || 7);

// The timeline: [days from today, type, title, description, by, published as [day, time]]. Published by the office unless
// the president did, 3 days before it happens unless it reports something
// The works match accounting's invoices and maintenance's issues and obligations
const events = {
	comm1: [
		[-150, 'maintenance', 'Nueva bomba de la depuradora de la piscina', 'Jardines del Guadalquivir ha cambiado la bomba de depuración, que ya no daba más de sí. Se ha pagado con el fondo de reserva y la piscina abrirá en su fecha.', uids.office, [-140, '12:00']],
		[25, 'maintenance', 'Revisión anual de extintores', 'Extintores Jaén revisa los extintores del garaje, el portal y el cuarto de contadores. Quedarán etiquetados con la fecha de la próxima revisión.'],
		[-92, 'notice', 'Normas de uso de la pista de pádel', 'La pista se reserva desde la app en turnos de 90 minutos, hasta tres por semana y vivienda. Máximo cuatro personas por turno.', uids.carmen],
		[-84, 'other', 'Corte de agua por obras en la calle', 'El ayuntamiento cortará el agua de 9:00 a 13:00 por obras en la red de la calle de los Olivos. Guardad agua para esas horas.'],
		[-70, 'notice', 'Convocada la junta general ordinaria', 'Tienes la convocatoria y el orden del día en la app, en Juntas. Desde allí puedes confirmar si vienes o delegar tu voto.', uids.office, [-70, '10:10']],
		[-70, 'maintenance', 'Poda de los árboles del jardín', 'Jardines del Guadalquivir poda los árboles y recorta los setos. El jardín estará cerrado por la mañana.'],
		[-60, 'maintenance', 'Revisión mensual del ascensor', 'Ascensores del Sur hace la revisión de mantenimiento. El ascensor estará parado unos 30 minutos.'],
		[-52, 'community', 'Torneo de pádel entre vecinos', 'Parejas mixtas y por edades. Apuntaos en la conserjería antes del viernes. Habrá merienda al terminar.', uids.carmen],
		[-45, 'other', 'Junta general ordinaria', 'Se aprueban las cuentas, la renovación de cargos, la reclamación de la deuda de Piso 2B y la derrama para impermeabilizar la cubierta, y se ratifica el presupuesto. No se aprueba ampliar el horario de la piscina.', uids.office, [-45, '21:20']],
		[-47, 'maintenance', 'Cambiada la bajante junto al 3B', 'Fontanería Hermanos Ortiz ha sustituido el tramo de bajante comunitaria que daba humedades al 3B. Si veis manchas en los techos junto a la bajante, avisad con una incidencia.', uids.office, [-47, '12:00']],
		[-30, 'maintenance', 'Revisión mensual del ascensor', 'Ascensores del Sur hace la revisión de mantenimiento. El ascensor estará parado unos 30 minutos.'],
		[-25, 'notice', 'Acta de la junta ordinaria disponible', 'El acta firmada por la presidenta y la secretaria ya está en la app. Si no asististe, tienes 30 días para manifestar tu discrepancia con los acuerdos.', uids.office, [-25, '09:35']],
		[-20, 'maintenance', 'Limpieza a fondo del garaje', 'Limpiezas Jaén limpia el garaje con máquina fregadora. Dejad libres las plazas de 8:00 a 12:00.'],
		[-25, 'notice', 'Fuga de agua en el garaje', 'Cae agua de una tubería del techo del garaje, junto a la plaza 12. Ya hemos avisado al fontanero: no aparquéis en las plazas 11 a 13 hasta que la reparen.', uids.office, [-25, '10:25']],
		[-21, 'maintenance', 'Reparada la fuga del garaje', 'Fontanería Hermanos Ortiz ha cambiado el tramo de bajante dañado. Hemos dado parte al seguro por los daños en las plazas afectadas.', uids.office, [-21, '16:00']],
		[lastSaturday, 'community', 'Taller de reciclaje para niños', 'El sábado por la mañana en la sala común: juguetes hechos con materiales reciclados. De 5 a 12 años.', uids.carmen],
		[-5, 'notice', 'Convocada una junta extraordinaria', 'Para impermeabilizar el techo del garaje y aprobar su derrama. Puedes votar desde la app hasta el día de la junta.', uids.office, [-5, '10:10']],
		[-2, 'other', 'Recogida de muebles y enseres', 'El ayuntamiento recoge ese día los muebles viejos. Dejadlos junto a los contenedores la noche antes, nunca en el portal.'],
		[0, 'maintenance', 'Revisión mensual del ascensor', 'Ascensores del Sur hace la revisión de mantenimiento. El ascensor estará parado unos 30 minutos.'],
		[3, 'maintenance', 'Desinsectación de zonas comunes', 'Limpiezas Jaén tratará el garaje, los trasteros y los cuartos de contadores. No dejéis mascotas sueltas en esas zonas ese día.'],
		[6, 'community', 'Merienda vecinal en el jardín', 'Cada uno trae algo para compartir. Si llueve, la hacemos en la sala común.', uids.carmen],
		[10, 'other', 'Junta extraordinaria de propietarios', 'Impermeabilización del techo del garaje y derrama para pagarla. En la sala común y también en línea.'],
		[14, 'improvements', 'Visita técnica para los puntos de recarga', 'Electricidad Lumen viene a ver el cuadro del garaje para presupuestar la preinstalación de recarga de coches eléctricos.'],
		[21, 'maintenance', 'Revisión de la instalación eléctrica del garaje', 'Revisión periódica obligatoria. Habrá cortes de luz breves en el garaje durante la mañana.'],
		[28, 'maintenance', 'Revisión mensual del ascensor', 'Ascensores del Sur hace la revisión de mantenimiento. El ascensor estará parado unos 30 minutos.'],
		[nextFee, 'notice', 'Cobro de la cuota trimestral', 'El recibo del trimestre se cargará en la cuenta domiciliada. Quien pague por transferencia puede hacerlo desde la app.'],
	],
	comm2: [
		[-30, 'maintenance', 'Revisión del ascensor', 'Ascensores del Sur hace la revisión de mantenimiento. El ascensor estará parado unos 30 minutos.'],
		[-35, 'notice', 'Convocada la junta general ordinaria', 'Tienes la convocatoria en la app. Si no puedes venir, delega tu voto.', uids.tomas, [-35, '10:10']],
		[-20, 'other', 'Junta general ordinaria', 'Se aprueban las cuentas, el presupuesto y la impermeabilización de la azotea. El acta se enviará cuando esté firmada.', uids.office, [-20, '20:55']],
		[-8, 'maintenance', 'Limpieza de cristales del portal', 'Limpiezas Jaén limpia los cristales y la puerta del portal por fuera y por dentro.'],
		[4, 'improvements', 'Empieza la impermeabilización de la azotea', 'La obra dura unas dos semanas. La azotea estará cerrada y no se podrá tender en ella.'],
		[12, 'community', 'Intercambio de libros', 'Trae los libros que ya no leas a la sala de reuniones y llévate otros. Por la tarde, de 18:00 a 20:00.', uids.tomas],
	],
};

// Comunicados sent from the admin to both communities at once: one copy each, sharing the broadcast id
const broadcasts = [
	['broadcast_office_hours', -15, 'Nuevo horario de atención de la administración', 'Fincas Jaén atiende de lunes a jueves de 9:00 a 14:00 y de 16:30 a 19:00, y los viernes de 9:00 a 14:00. Las urgencias, al 953 000 101.'],
	['broadcast_holiday', 7, 'Oficina cerrada por festivo local', 'Ese día la oficina de Fincas Jaén estará cerrada. Para averías urgentes, llamad al teléfono de urgencias de vuestra comunidad.'],
];

function seedEvents(set) {
	for (const [communityId, list] of Object.entries(events)) {
		list.forEach(([n, type, title, description, by = uids.office, published], index) => {
			set(`events/${communityId}_event_${index + 1}`, { title, description, type, date: days(n, '00:00'), communityId, ...audit(published ? days(...published) : Math.min(n, 0) - 3, by) });
		});
	}
	for (const [broadcastId, n, title, description] of broadcasts) {
		for (const communityId of ['comm1', 'comm2']) {
			set(`events/${broadcastId}-${communityId}`, { title, description, type: 'notice', date: days(n, '00:00'), communityId, broadcastId, ...audit(Math.min(n, 0) - 2) });
		}
	}
}

// workOrderMail() of the admin for every parte, from the copy maintenance writes of it (its issues aren't exported)
function workOrderMails() {
	const mails = [];
	maintenance.seed((path, order) => {
		if (!path.startsWith('workOrders/')) {
			return;
		}
		const { community, issue, expectedAt, contact, provider } = order;
		mails.push(mail(order.createdAt, order.createdBy, {
			to: providerById(provider.id).email,
			communityId: order.communityId,
			kind: 'work-order',
			link: `/communities/${order.communityId}/issues/${order.issueId}`,
			replyTo: contact.email,
			subject: `Parte de trabajo: ${issue.title} · ${community.name}`,
			title: `Tienes un trabajo en ${community.name}`,
			blocks: [
				`Hola, ${provider.name}:`,
				`La administración de la comunidad ${community.name} te envía este trabajo: «${issue.title}».`,
				issue.description,
				[`Ubicación: ${issue.location}`, ...(expectedAt ? [`Fecha prevista: ${dayFormat.format(expectedAt)}`] : [])],
				'En el enlace tienes los detalles y las fotos. Desde ahí puedes aceptarlo, programar la visita y avisarnos al terminar, sin crear una cuenta.',
			],
			action: { label: 'Ver el parte de trabajo', url: `${WEBAPP_URL}/gremio/${path.slice('workOrders/'.length)}` },
			footer: [communityLine(community), `${contact.name} · ${contact.phone}`],
		}));
	});
	return mails;
}

// invitationMail() and the claim letter of the admin, for the other kinds of the outbox
function otherMails() {
	const comm1 = communityById.comm1;
	// Andrés's reminder by email, the first claim of his debt case: only last year's Q4 was overdue then, nothing paid of it yet
	const andres = propertiesOf('comm1').find(property => property.id === 'prop8');
	const reminder = debtCases.prop8.claims[0];
	const overdue = openCharges.comm1.filter(charge => charge.propertyId === andres.id && charge.dueDate < reminder.date);
	const invitation = (createdAt, by, { name, email, communityId, role }) => {
		const community = communityId ? communityById[communityId].name : '';
		const inviter = nameOf(by);
		const text = {
			user: `${inviter} te ha invitado a la app de vecinos de la comunidad ${community}. Desde ella puedes avisar de incidencias, seguir las juntas y los comunicados, reservar zonas comunes y ver tus recibos.`,
			manager: `${inviter} te ha dado acceso a gobernança admin para gestionar la comunidad ${community}: sus incidencias, vecinos, juntas y cuentas.`,
			admin: `${inviter} te ha dado acceso a gobernança admin, la plataforma para llevar tus comunidades: incidencias, juntas, cobros, contabilidad y modelos fiscales.`,
		}[role];
		const neighbour = role === 'user';
		return mail(createdAt, by, {
			to: email,
			communityId,
			kind: 'invitation',
			link: communityId ? `/communities/${communityId}/people` : '/admins',
			subject: neighbour ? `Te invitamos a la app de la comunidad ${community}` : 'Tu acceso a gobernança admin',
			title: neighbour ? 'Ya puedes entrar en la app de tu comunidad' : 'Ya puedes entrar en gobernança admin',
			blocks: [
				`Hola, ${name}:`,
				text,
				`Entra con este email, ${email}, y te enviaremos un enlace para acceder sin contraseña. Tu cuenta se crea la primera vez que entras.`,
			],
			action: { label: neighbour ? 'Entrar en la app' : 'Entrar en gobernança admin', url: neighbour ? WEBAPP_URL : ADMIN_URL },
			footer: community ? [communityLine({ name: community })] : [],
		});
	};
	return [
		// The team's, with no community: the office's own access, named as its invitation (and so its profile) is
		invitation(days(-400, '10:30'), uids.team, { name: nameOf(uids.office), email: office.email, communityId: '', role: 'admin' }),
		// As core's activity log and invitations have them
		invitation(days(-37, '09:20'), uids.office, { name: nameOf(uids.tomas), email: emailOf(uids.tomas), communityId: 'comm2', role: 'manager' }),
		// Neither has signed in yet
		invitation(days(-6, '10:45'), uids.office, { name: 'Francisco López', email: 'lynx9011+user9@gmail.com', communityId: 'comm1', role: 'user' }),
		invitation(days(-4, '11:30'), uids.office, { name: 'Antonia Herrera', email: 'antonia.herrera@example.com', communityId: 'comm2', role: 'manager' }),
		...workOrderMails(),
		mail(new Date(`${reminder.date}T11:10`), uids.office, {
			to: andres.ownerEmail,
			communityId: 'comm1',
			kind: 'claim',
			link: `/communities/comm1/arrears/${andres.id}/claim`,
			subject: `${claimLevels.reminder.title}: ${andres.name} · Comunidad ${comm1.name}`,
			title: claimLevels.reminder.title,
			blocks: [
				`Estimado/a ${andres.ownerName}:`,
				`Le recordamos que, según la contabilidad de la comunidad, a fecha de hoy figuran pendientes de pago los siguientes recibos de ${andres.name}. Es posible que se trate de un olvido: le rogamos que los abone en los próximos ${claimLevels.reminder.days} días y, si ya lo ha hecho, que nos lo comunique y disculpe las molestias.`,
				overdue.map(charge => `${charge.concept} (vencido el ${longFormat.format(new Date(`${charge.dueDate}T00:00`))}): ${formatCents(reminder.amount)}`),
				`Total adeudado: ${formatCents(reminder.amount)}`,
				`Puede abonarlo por transferencia a la cuenta de la comunidad ${formatIban(comm1.iban)} (${comm1.bank}), indicando como concepto «${andres.name}».`,
				`Atentamente,\nLa administración de la Comunidad de propietarios ${comm1.name}`,
			],
			footer: [communityLine(comm1), `CIF ${comm1.cif}`],
		}),
	];
}

export default {
	id: 'meetings',
	label: 'Juntas, comunicados y correo',
	hint: 'Juntas con asistencia, votos, actas firmadas y notificaciones, el cronograma de avisos y el correo saliente',
	requires: ['core', 'maintenance', 'charges'],
	collections: ['events', 'mail'],
	communityCollections: ['meetings'],
	seed(set) {
		const outbox = otherMails();
		for (const meeting of meetings) {
			seedMeeting(set, meeting, outbox);
		}
		seedEvents(set);
		// Newest first in id order, as the outbox lists them. Fixed ids, unlike mailId(), so seeding again overwrites them
		outbox
			.sort((a, b) => b.createdAt - a.createdAt)
			.forEach(({ data }, index) => set(`mail/seed-${String(index + 1).padStart(3, '0')}`, data));
	},
};
