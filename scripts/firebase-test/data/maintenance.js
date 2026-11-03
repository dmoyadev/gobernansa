import { createHash } from 'node:crypto';
import { taxDeadlines } from '../../../packages/shared/domain/aeat.ts';
import { DEFAULT_MONTHLY_VOTES, getVotingMonth, issueLocationTypes } from '../../../packages/shared/domain/issue.ts';
import { obligationTypes } from '../../../packages/shared/domain/obligation.ts';
import { audit, commonAreas, communities, days, images, now, office, properties, providerById, providers, uids, userById, year } from './cast.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const monthStart = getVotingMonth(now).start.getTime();
// As WorkOrderPanel words the visit it tells neighbours about
const dayFormat = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' });
const timeFormat = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' });
const insurer = providerById('prov_insurance').name;

function latest(...dates) {
	return new Date(Math.max(...dates.filter(Boolean).map(date => date.getTime())));
}

// Places as the apps offer them: a common area or a property by its name, or one typed in
function area(communityId, id) {
	return { type: 'common_area', reference: commonAreas[communityId].find(item => item.id === id).name };
}
function typed(reference) {
	return { type: 'common_area', reference };
}
function home(propertyId) {
	return { type: 'property', propertyId, reference: properties.find(property => property.id === propertyId).name };
}

// A message, or a status change by the administration: both are listed as the issue's history.
// hidden: [day, time, who] by the administration; deleted: [day, time] by its author
function say(who, day, time, message, extra = {}) {
	return { who, at: days(day, time), message, ...extra };
}
function move(who, day, time, status) {
	return { who, at: days(day, time), status };
}
function visit(provider, day, time) {
	const at = days(day, time);
	return `Visita programada: ${providerById(provider).name} vendrá el ${dayFormat.format(at)} a las ${timeFormat.format(at)}.`;
}

/*
 * Status, resolvedAt, updatedAt and the counters come from the comments and votes. votes: [who, score, when], when 'm'
 * this month (it uses one of their monthly votes: Javier has spent his five) or days from today. claim: its history as
 * [day, time, status, note]. Work orders go below, the private document points to the issue's one not revoked
 */
const issues = {
	comm1: [
		{
			id: 'issue_1',
			title: 'Luz fundida en el portal',
			description: 'No funciona desde hace 2 días. Por la noche no se ve ni la cerradura.',
			category: 'maintenance',
			by: 'lucia',
			at: [-2, '21:40'],
			location: area('comm1', 'portal'),
			comments: [
				say('lucia', -1, '19:05', 'Sigue sin arreglarse'),
				say('javier', -1, '22:30', 'Confirmo, no hay luz. Esta noche he tenido que alumbrar con el móvil.'),
			],
			votes: [['lucia', 1, 'm'], ['javier', 1, 'm'], ['rosa', 1, 'm']],
		},
		{
			id: 'issue_2',
			title: 'Ruido nocturno constante',
			description: 'El vecino del 3A pone música y arrastra muebles casi todas las noches, pasada la una.',
			category: 'nuisance',
			by: 'maria',
			at: [-9, '08:15'],
			// Neighbours can only pick a property of theirs: where she hears it
			location: home('prop4'),
			assignedTo: 'carmen',
			comments: [
				say('maria', -9, '08:20', 'Pasa casi todas las noches'),
				move('carmen', -8, '10:00', 'in_progress'),
				say('carmen', -8, '10:05', 'Hemos hablado con el vecino, os mantenemos informados'),
				// Why Andrés is blocked: Carmen hid it and blocked him
				say('andres', -7, '23:50', 'Aquí cada uno hace en su casa lo que quiere. Dejad de meteros en mi vida, cotillas.', { hidden: [-6, '09:00', 'carmen'] }),
				say('rosa', -6, '12:30', 'Yo vivo al lado y también lo oigo, sobre todo los fines de semana.'),
				say('javier', -3, '18:00', 'Mejor lo hablamos en persona en la junta', { deleted: [-3, '18:04'] }),
			],
			votes: [['maria', 1, 'm'], ['javier', 1, 'm'], ['rosa', 1, -5], ['lucia', -1, -6]],
		},
		{
			id: 'issue_3',
			title: 'La del vídeo y el título súper largo que alguien ha confundido con la descripción así que se va de madre',
			description: 'Una jardinera de la segunda planta se ha volcado con el viento y ha dejado tierra por todo el rellano. Os dejo el vídeo.',
			category: 'landscaping',
			by: 'lucia',
			at: [-62, '17:20'],
			location: typed('Segunda planta'),
			assets: [images.video],
			assignedTo: 'carmen',
			comments: [
				move('carmen', -61, '09:30', 'in_progress'),
				say('carmen', -61, '09:35', 'Lo recoge el conserje esta mañana.'),
				move('carmen', -61, '13:00', 'resolved'),
				move('office', -55, '10:00', 'closed'),
			],
			votes: [['lucia', 1, -61], ['javier', 1, -61], ['maria', -1, -60], ['carmen', 1, -61]],
		},
		{
			id: 'issue_leak',
			title: 'Fuga de agua en el garaje',
			description: 'Cae agua del techo junto a la plaza 12 y se está formando un charco enorme. Parece que viene de una tubería del sótano.',
			category: 'maintenance',
			by: 'lucia',
			at: [-25, '08:05'],
			location: area('comm1', 'garaje'),
			assets: [images.leak, images.flood],
			provider: 'prov_plumbing',
			expectedAt: -22,
			comments: [
				say('javier', -25, '09:40', 'En mi trastero también hay humedad en la pared del fondo.'),
				move('office', -25, '10:15', 'in_progress'),
				say('office', -25, '10:20', 'Avisamos ahora a Fontanería Hermanos Ortiz y abrimos un parte al seguro. Por favor, no aparquéis en las plazas 11 a 13 hasta que vengan.'),
				say('office', -24, '12:00', visit('prov_plumbing', -22, '09:00')),
				say('lucia', -21, '19:30', '¡Gracias! Ya no cae agua.'),
				move('office', -10, '11:00', 'resolved'),
				say('office', -10, '11:05', 'Reparación terminada y revisada. El perito del seguro ya ha pasado; os avisamos cuando se cierre el siniestro.'),
				say('carmen', -10, '20:30', 'Gracias a todos por la paciencia. Ya se puede aparcar otra vez en las plazas 11 a 13.'),
			],
			votes: [['lucia', 1, -25], ['javier', 1, -25], ['carmen', 1, -25], ['rosa', 1, -24], ['maria', 1, -24]],
			admin: {
				note: 'Cambiaron el tramo de bajante del sótano. La factura de Hermanos Ortiz está pagada y el seguro nos ha devuelto la reparación menos la franquicia.',
				claim: {
					number: `${year}/004512`,
					history: [
						[-25, '10:30', 'opened', 'Parte abierto por teléfono'],
						[-18, '12:00', 'expert', 'El perito viene el jueves a las 10'],
						[-9, '13:20', 'accepted', 'Cubren la reparación menos la franquicia de 150 €'],
						// The indemnity the books have in the bank 4 days ago
						[-4, '12:30', 'paid', 'Ingresados 630,45 €: la factura con IVA menos la franquicia'],
					],
				},
			},
		},
		{
			id: 'issue_elevator',
			title: 'El ascensor se para entre el segundo y el tercero',
			description: 'Esta mañana se ha quedado parado unos minutos entre plantas con mi madre dentro. Al final arrancó solo, pero da miedo.',
			category: 'maintenance',
			by: 'rosa',
			at: [-6, '09:20'],
			location: area('comm1', 'ascensor'),
			provider: 'prov_elevator',
			expectedAt: 2,
			comments: [
				say('carmen', -6, '10:00', 'A mí me pasó la semana pasada. Hay que mirarlo ya.'),
				move('office', -6, '10:30', 'in_progress'),
				say('office', -6, '10:35', 'Avisado Ascensores del Sur. Si se para, pulsad el botón de alarma: llama directamente al servicio técnico.'),
				say('maria', -2, '20:10', '¿Se sabe cuándo vienen?'),
				say('office', -1, '09:15', 'Hemos enviado un parte nuevo al técnico de zona, os avisamos en cuanto confirme la visita.'),
			],
			votes: [['rosa', 1, 'm'], ['lucia', 1, 'm'], ['javier', 1, 'm'], ['maria', 1, 'm'], ['carmen', 1, 'm']],
			admin: { note: 'Contrato de mantenimiento: la visita entra en la cuota. Si hay que cambiar piezas, pedir presupuesto antes.' },
		},
		{
			id: 'issue_pool',
			title: 'El agua de la piscina huele mucho a cloro',
			description: 'Desde el fin de semana pican los ojos al bañarse y el agua huele muchísimo a cloro.',
			category: 'services',
			by: 'javier',
			at: [-118, '16:45'],
			location: area('comm1', 'piscina'),
			comments: [
				move('office', -118, '18:00', 'in_progress'),
				say('office', -118, '18:05', 'El socorrista ha bajado la dosificación. Mañana medimos otra vez.'),
				say('maria', -117, '12:00', 'Hoy ya está mucho mejor.'),
				move('office', -116, '10:00', 'resolved'),
				move('office', -100, '10:00', 'closed'),
			],
			votes: [['javier', 1, -118], ['maria', 1, -118], ['lucia', 1, -117]],
		},
		{
			id: 'issue_irrigation',
			title: 'El riego automático del jardín no funciona',
			description: 'Los aspersores de la zona del seto no saltan y el césped de ese lado se está secando.',
			category: 'landscaping',
			by: 'maria',
			at: [-18, '11:00'],
			location: area('comm1', 'jardin'),
			// Its date has passed and there's no parte yet
			provider: 'prov_garden',
			expectedAt: -3,
			comments: [
				move('carmen', -17, '09:00', 'in_progress'),
				say('carmen', -17, '09:05', 'Viene Jardines del Guadalquivir a revisar la programadora.'),
				say('lucia', -4, '18:20', 'El seto ya está amarillo...'),
			],
			votes: [['maria', 1, -18], ['carmen', 1, -17], ['lucia', 1, -10]],
			admin: { by: 'carmen', note: 'Esperando la pieza de la programadora, la piden a fábrica.' },
		},
		{
			id: 'issue_stairs',
			title: 'La escalera lleva dos semanas sin fregar',
			description: 'Del segundo para arriba hay polvo y manchas en los escalones. ¿Ha cambiado el horario de limpieza?',
			category: 'cleaning',
			by: 'rosa',
			at: [-4, '10:30'],
			location: area('comm1', 'escalera'),
			provider: 'prov_cleaning',
			expectedAt: 1,
			comments: [
				move('office', -3, '09:00', 'in_progress'),
				say('office', -3, '09:05', 'Lo hemos comunicado a Limpiezas Jaén. Esta semana repasan toda la escalera.'),
			],
			votes: [['rosa', 1, 'm'], ['javier', 1, 'm']],
			admin: { note: 'Recordarles que la escalera se friega martes y viernes.' },
		},
		{
			// Francisco López has no account, so he called the office
			id: 'issue_sockets',
			title: 'Saltan chispas en el enchufe del cuarto de contadores',
			description: 'Ha llamado Francisco López (Piso 4A): al enchufar la aspiradora en el cuarto de contadores saltaron chispas y se fue la luz de la escalera.',
			category: 'maintenance',
			by: 'office',
			at: [-5, '17:30'],
			location: typed('Cuarto de contadores'),
			provider: 'prov_electric',
			expectedAt: 3,
			comments: [
				move('office', -5, '17:40', 'in_progress'),
				say('office', -5, '17:45', 'No uséis ese enchufe hasta que lo revise el electricista.'),
			],
			votes: [['carmen', 1, 'm']],
			admin: { note: 'Diferencial del cuarto bajado hasta que venga alguien. Si Lumen no puede, buscar otro electricista.' },
		},
		{
			id: 'issue_chargers',
			title: 'Propuesta: puntos de recarga para coches eléctricos en el garaje',
			description: 'Cada vez somos más con coche eléctrico. Propongo hacer una preinstalación común en el garaje y que cada uno pague su punto.',
			category: 'other',
			by: 'javier',
			at: [-24, '21:10'],
			location: area('comm1', 'garaje'),
			comments: [
				say('maria', -23, '09:30', 'No me parece justo que lo paguemos todos si no tenemos coche eléctrico.'),
				say('lucia', -23, '13:15', 'Yo me lo compraría si pudiera cargarlo en casa. ¡A favor!'),
				say('carmen', -20, '10:00', 'Lo llevamos al orden del día de la junta extraordinaria, con dos presupuestos.'),
			],
			votes: [['javier', 1, 'm'], ['lucia', 1, 'm'], ['rosa', 1, 'm'], ['carmen', 1, 'm'], ['maria', -1, 'm']],
		},
		{
			// Reported twice, the second one taken back by its author
			id: 'issue_duplicate',
			title: 'No hay luz en el portal',
			description: 'Por la noche está todo a oscuras.',
			category: 'maintenance',
			by: 'javier',
			at: [-1, '22:10'],
			location: area('comm1', 'portal'),
			deleted: [-1, '22:25'],
			comments: [],
			votes: [],
		},
		{
			id: 'issue_humidity',
			title: 'Humedad en el techo del baño',
			description: 'Me ha salido una mancha de humedad en el techo del baño que crece cada día. Creo que viene de la bajante común.',
			category: 'maintenance',
			by: 'rosa',
			at: [-52, '19:00'],
			location: home('prop9'),
			assets: [images.inside],
			provider: 'prov_plumbing',
			expectedAt: -48,
			comments: [
				move('office', -51, '09:30', 'in_progress'),
				say('office', -51, '09:35', 'Pasará Fontanería Hermanos Ortiz a ver si es de la bajante o del piso de arriba.'),
				say('rosa', -47, '20:00', 'Ya han venido: era la bajante y la han cambiado.'),
				move('office', -45, '10:00', 'resolved'),
				move('office', -30, '12:00', 'closed'),
				say('office', -30, '12:05', 'El seguro de la comunidad no cubre los daños dentro de la vivienda; Rosa lo ha dado a su seguro de hogar. Cerramos la incidencia.'),
			],
			votes: [['rosa', 1, -52], ['carmen', 1, -50]],
			admin: {
				note: 'Bajante comunitaria cambiada. La pintura del techo la paga el seguro de hogar de la propietaria.',
				claim: {
					number: `${year}/003871`,
					history: [
						[-51, '09:40', 'opened'],
						[-44, '11:00', 'expert', 'El perito confirma que la avería es de la bajante'],
						[-33, '16:30', 'rejected', 'Los daños interiores del 3B no entran en la póliza'],
					],
				},
			},
		},
		{
			id: 'issue_padel',
			title: 'La red de la pista de pádel está rota',
			description: 'Se ha descosido la red por el lado de la puerta y cuelga hasta el suelo.',
			category: 'services',
			by: 'javier',
			at: [-35, '19:45'],
			location: area('comm1', 'padel'),
			comments: [
				move('carmen', -34, '09:00', 'in_progress'),
				say('carmen', -34, '09:05', 'Hay una red de repuesto en el cuarto de la piscina, la cambiamos esta semana.'),
				move('carmen', -31, '18:00', 'resolved'),
				say('javier', -30, '20:00', 'Perfecta, gracias.'),
			],
			votes: [['javier', 1, -35], ['lucia', 1, -34]],
		},
		{
			// Closed without being resolved: nothing to fix
			id: 'issue_barbecue',
			title: 'Dejaron la barbacoa sucia el fin de semana',
			description: 'La parrilla con restos de comida y bolsas de basura al lado. Atrae a los gatos.',
			category: 'cleaning',
			by: 'maria',
			at: [-12, '10:15'],
			location: area('comm1', 'barbacoa'),
			comments: [
				say('rosa', -12, '13:00', 'Es verdad, yo también lo vi.'),
				move('carmen', -11, '09:30', 'closed'),
				say('carmen', -11, '09:35', 'Hemos hablado con quien la usó y la limpió al día siguiente. Recordad dejarla como os la encontráis.'),
			],
			votes: [['maria', 1, -12], ['rosa', 1, -12]],
		},
	],
	// Its neighbours came in 37 days ago, as core's log has it
	comm2: [
		{
			id: 'issue_garage_door',
			title: 'La puerta del garaje no cierra del todo',
			description: 'Se queda abierta un palmo y pita. Cualquiera puede entrar por debajo.',
			category: 'maintenance',
			by: 'elena',
			at: [-3, '08:40'],
			location: area('comm2', 'garaje'),
			comments: [say('pablo', -2, '21:00', 'Esta mañana estaba igual.')],
			votes: [['elena', 1, 'm'], ['pablo', 1, 'm'], ['tomas', 1, 'm']],
		},
		{
			id: 'issue_terrace',
			title: 'Filtración en la azotea después de las lluvias',
			description: 'En el techo del 2º A ha salido una mancha justo debajo de la azotea. Creo que la tela asfáltica está levantada.',
			category: 'maintenance',
			by: 'pablo',
			at: [-20, '18:30'],
			location: area('comm2', 'azotea'),
			assets: [images.flood],
			provider: 'prov_plumbing',
			// Put off for the rain after the parte was sent, so it offers to update the provider's date
			expectedAt: 4,
			touched: [-5, '10:00', 'tomas'],
			comments: [
				move('tomas', -19, '09:00', 'in_progress'),
				say('tomas', -19, '09:10', 'Avisamos ahora al fontanero para revisar los sumideros y abrimos un parte al seguro.'),
				say('elena', -10, '19:00', 'Con la lluvia de ayer ha vuelto a gotear.'),
			],
			votes: [['pablo', 1, -20], ['elena', 1, -19], ['tomas', 1, -19]],
			admin: {
				by: 'tomas',
				// The junta approved waterproofing it the day this was reported
				note: 'La junta ya aprobó impermeabilizar la azotea y la obra empieza en unos días. El parte cubre los daños del techo del 2º A.',
				claim: {
					number: `${year}/005207`,
					history: [
						[-19, '09:15', 'opened', 'Parte abierto en la web de la aseguradora'],
						[-6, '12:00', 'expert', 'El perito viene el martes por la mañana'],
					],
				},
			},
		},
		{
			id: 'issue_portal_cleaning',
			title: 'El portal se queda sin fregar los sábados',
			description: 'Los sábados no viene nadie y el lunes el portal está lleno de barro.',
			category: 'cleaning',
			by: 'elena',
			at: [-33, '12:00'],
			location: area('comm2', 'portal'),
			provider: 'prov_cleaning',
			expectedAt: -29,
			comments: [
				move('tomas', -32, '10:00', 'in_progress'),
				say('tomas', -32, '10:05', 'Hablamos con Limpiezas Jaén para añadir el sábado al contrato.'),
				move('tomas', -27, '10:00', 'resolved'),
				say('elena', -24, '11:30', 'Ahora sí, gracias.'),
			],
			votes: [['elena', 1, -33], ['pablo', 1, -32]],
			admin: { by: 'tomas', note: 'Añaden el sábado sin subir la cuota del contrato.' },
		},
		{
			id: 'issue_music',
			title: 'Música alta en el 2º B los fines de semana',
			description: 'Viernes y sábados hasta las 3 de la mañana. Ya se lo he dicho y no hace caso.',
			category: 'nuisance',
			by: 'pablo',
			at: [-35, '09:00'],
			location: home('c2prop5'),
			comments: [
				move('tomas', -34, '10:00', 'in_progress'),
				say('tomas', -34, '10:05', 'Enviamos una carta a la propietaria recordando las normas de convivencia.'),
				move('tomas', -25, '10:00', 'resolved'),
				move('tomas', -12, '10:00', 'closed'),
			],
			votes: [['pablo', 1, -35], ['elena', -1, -34]],
		},
	],
};

// Fixed so a second run overwrites them, and the mail of the leak's links to its own
export function workOrderToken(key) {
	return createHash('sha256').update(`gobernança-demo-${key}`).digest('base64url').slice(0, 32);
}

/*
 * Partes de trabajo, one in each state. steps: [day, time, status, note, visit as [day, time]]. The elevator's first
 * link was revoked when the office sent a new one. Tokens are fixed so a second run overwrites them: anyone who reads
 * this file can open them, fine for demo data only
 */
export const workOrders = [
	{ key: 'leak', communityId: 'comm1', issueId: 'issue_leak', by: 'office', at: [-25, '10:45'], photos: [images.inside], steps: [
		[-25, '10:50', 'accepted', 'Nos lo apuntamos.'],
		[-24, '11:30', 'scheduled', 'Pasamos el primer día libre a las 9; que alguien nos abra el garaje.', [-22, '09:00']],
		[-21, '14:10', 'done', 'Cambiados 2 m de bajante de PVC y sellada la unión. Queda una mancha en el techo que se secará en unos días.'],
	] },
	{ key: 'elevator-old', communityId: 'comm1', issueId: 'issue_elevator', by: 'office', at: [-6, '10:40'], revokedAt: [-1, '09:12'], steps: [
		[-5, '08:30', 'accepted', 'Lo miramos esta semana.'],
	] },
	{ key: 'elevator', communityId: 'comm1', issueId: 'issue_elevator', by: 'office', at: [-1, '09:12'], steps: [
		[-1, '12:40', 'scheduled', 'Vamos el técnico y un ayudante. Necesitamos acceso al cuarto de máquinas.', [2, '09:30']],
	] },
	{ key: 'stairs', communityId: 'comm1', issueId: 'issue_stairs', by: 'office', at: [-3, '09:10'], steps: [] },
	{ key: 'sockets', communityId: 'comm1', issueId: 'issue_sockets', by: 'office', at: [-5, '17:50'], steps: [
		[-4, '08:45', 'rejected', 'Esta semana no podemos, tenemos a todo el equipo en una obra. Lo sentimos.'],
	] },
	{ key: 'terrace', communityId: 'comm2', issueId: 'issue_terrace', by: 'tomas', at: [-19, '09:20'], expectedAt: -12, steps: [
		[-18, '08:00', 'accepted', 'De acuerdo. En cuanto deje de llover subimos a mirarlo.'],
	] },
].map((order) => {
	const issue = issues[order.communityId].find(item => item.id === order.issueId);
	// The issue's date when the parte was sent, unless it moved since
	const expectedAt = order.expectedAt ?? issue.expectedAt;
	return {
		...order,
		token: workOrderToken(order.key),
		by: uids[order.by],
		at: days(...order.at),
		expectedAt: expectedAt === undefined ? null : days(expectedAt, '00:00'),
		providerId: issue.provider,
	};
});

// Raters are those the rules let share each provider: the office, and the managers of their communities
const ratings = {
	prov_cleaning: [['office', 4, 'Cumplen, aunque algún sábado han fallado.', -200], ['carmen', 3, 'La escalera a veces se queda sin fregar.', -3], ['tomas', 4, 'Atentos cuando se les avisa.', -30]],
	prov_lawyer: [['office', 5, 'Muy rápida con los burofax y los monitorios.', -60]],
	prov_elevator: [['office', 4, 'Revisión mensual puntual.', -150], ['carmen', 2, 'Tardan en venir cuando se para.', -5], ['tomas', 4, '', -25]],
	prov_plumbing: [['office', 5, 'Vinieron en dos días por la fuga del garaje y lo dejaron todo limpio.', -20], ['carmen', 5, '', -20], ['tomas', 4, 'Buen precio, algo lentos con los presupuestos.', -18]],
	prov_electric: [['office', 3, 'Rechazó el aviso del cuarto de contadores por falta de personal.', -4]],
	prov_garden: [['carmen', 4, 'El jardín está precioso, pero la pieza del riego se retrasa.', -8]],
	prov_insurance: [['office', 3, 'El perito tarda en venir.', -9]],
};

/*
 * [id, type, title (the type's own when null), due in days, every months, provider, last done in days, notes]. Due
 * dates are local midnights, as the form saves them; recurring ones done moved theirs on by everyMonths. Only Hecha
 * saves lastDoneAt, so one done before `since` (comm1 in the app, Tomás in comm2) has none
 */
const since = { comm1: -390, comm2: -36 };
const obligations = {
	comm1: [
		['iee', 'iee', null, -12, 120, null, null, 'Edificio de 1990: toca la segunda inspección. Pedidos presupuestos a dos arquitectos técnicos.'],
		['elevator_inspection', 'elevator', 'Inspección periódica del ascensor (OCA)', 20, 24, 'prov_elevator', -710, 'La coordina el mantenedor con el organismo de control.'],
		// On the days meetings' calendar has it
		['elevator_service', 'other', 'Revisión mensual del ascensor', 0, 1, 'prov_elevator', -30, 'Incluida en el contrato de mantenimiento.'],
		['extinguishers', 'extinguishers', null, 25, 12, 'prov_fire', -340, 'Extintores del garaje, el portal y el cuarto de contadores.'],
		['legionella', 'legionella', 'Control de legionela de la piscina', 195, 12, null, -170, 'Análisis del agua antes de abrir la piscina.'],
		['insurance', 'insurance', 'Renovación del seguro multirriesgo', 58, 12, 'prov_insurance', -307, 'Póliza 123456. Pedir otra oferta antes de renovar.'],
		['garage_door', 'other', 'Revisión de la puerta automática del garaje', -3, 6, 'prov_electric', -186, null],
		['pest_control', 'other', 'Desratización del garaje y los sótanos', 180, 6, null, -2, null],
		// The day meetings' calendar has it
		['garage_electrical', 'other', 'Inspección periódica de la instalación eléctrica del garaje (OCA)', 21, 60, 'prov_electric', null, 'Obligatoria cada 5 años en garajes.'],
	],
	comm2: [
		['elevator_inspection', 'elevator', 'Inspección periódica del ascensor (OCA)', -20, 24, 'prov_elevator', -750, 'El organismo de control aún no ha dado fecha.'],
		['insurance', 'insurance', 'Renovación del seguro de la comunidad', 12, 12, 'prov_insurance', -353, null],
		['extinguishers', 'extinguishers', null, 150, 12, null, -215, null],
		['terrace_drains', 'other', 'Limpieza de la azotea y los sumideros', 152, 6, 'prov_cleaning', -30, 'Antes de las lluvias de otoño y de primavera.'],
	],
};

// Three of the year's returns, as the Impuestos page adds them (with their ids, so adding them again skips them) on the
// day core's activity log says
const taxIds = [`aeat-111-${year}-4t`, `aeat-190-${year}`, `aeat-347-${year}`];

function castVotes(issue) {
	const createdAt = days(...issue.at).getTime();
	return issue.votes.map(([who, score, when], index) => {
		const at = when === 'm' ? monthStart + (index + 1) * 41 * MINUTE : days(when, '20:00').getTime();
		return { who, score, monthly: when === 'm', votedAt: new Date(Math.min(now.getTime(), Math.max(at, createdAt + HOUR))) };
	});
}

// spent: this month's votes of each neighbour so far
function seedIssue(set, communityId, issue, spent) {
	const path = `communities/${communityId}/issues/${issue.id}`;
	const createdAt = days(...issue.at);
	const moves = issue.comments.filter(comment => comment.status);
	const touched = issue.touched && { at: days(issue.touched[0], issue.touched[1]), who: issue.touched[2] };
	const history = issue.admin?.claim?.history.map(([day, time, status, entryNote]) => ({ at: days(day, time), status, note: entryNote }));
	// Saving the claim touches the issue too
	const claimed = history && { at: history.at(-1).at, who: issue.admin.by ?? 'office' };
	const last = [{ at: createdAt, who: issue.by }, ...moves, touched, claimed].filter(Boolean).sort((a, b) => a.at - b.at).at(-1);
	// Those past the month's votes are left out, as the app would refuse them
	const votes = castVotes(issue).filter((vote) => {
		if (vote.monthly) {
			spent[vote.who] = (spent[vote.who] ?? 0) + 1;
		}
		return !vote.monthly || spent[vote.who] <= DEFAULT_MONTHLY_VOTES;
	});
	const provider = issue.provider && providerById(issue.provider);

	set(path, {
		title: issue.title,
		description: issue.description,
		status: moves.at(-1)?.status ?? 'open',
		category: issue.category,
		communityId,
		assignedTo: issue.assignedTo && uids[issue.assignedTo],
		provider: provider && { id: provider.id, name: provider.name },
		expectedAt: issue.expectedAt === undefined ? undefined : days(issue.expectedAt, '00:00'),
		resolvedAt: moves.findLast(comment => comment.status === 'resolved')?.at,
		insuranceClaim: issue.admin?.claim ? true : undefined,
		votesScore: votes.reduce((sum, vote) => sum + vote.score, 0),
		votesCount: votes.length,
		// As the apps count them: messages written minus those their authors removed (hiding one doesn't change it)
		commentsCount: issue.comments.filter(comment => !comment.status && !comment.deleted).length,
		// The admin platform's form has no attachments
		assets: issue.by === 'office' ? undefined : issue.assets ?? [],
		location: issue.location,
		createdAt,
		updatedAt: last.at,
		createdBy: uids[issue.by],
		updatedBy: uids[last.who],
		deletedAt: issue.deleted ? days(...issue.deleted) : null,
		deletedBy: issue.deleted ? uids[issue.by] : undefined,
	});

	issue.comments.forEach((comment, index) => {
		const author = userById(uids[comment.who]);
		set(`${path}/comments/comment_${index + 1}`, {
			type: comment.status ? 'status' : 'message',
			status: comment.status,
			message: comment.status ? '' : comment.message,
			authorId: author.uid,
			authorName: author.name,
			authorRole: author.role === 'user' ? undefined : author.role,
			createdAt: comment.at,
			updatedAt: comment.at,
			createdBy: author.uid,
			updatedBy: author.uid,
			deletedAt: comment.deleted ? days(...comment.deleted) : null,
			deletedBy: comment.deleted ? author.uid : undefined,
			hiddenAt: comment.hidden && days(comment.hidden[0], comment.hidden[1]),
			hiddenBy: comment.hidden && uids[comment.hidden[2]],
		});
	});

	for (const { who, score, votedAt } of votes) {
		set(`${path}/votes/${issue.id}_${uids[who]}`, { voterId: uids[who], score, votedAt });
	}

	const order = workOrders.find(item => item.issueId === issue.id && item.communityId === communityId && !item.revokedAt);
	if (issue.admin || order) {
		const { by = 'office', note, claim } = issue.admin ?? {};
		set(`${path}/private/admin`, {
			note,
			claim: claim && { insurer, number: claim.number, status: history.at(-1).status, openedAt: history[0].at, history },
			workOrder: order?.token,
			// Written with the assignment, the claim and the parte
			updatedAt: latest(moves[0]?.at, touched?.at, history?.at(-1).at, order?.at),
			updatedBy: uids[by],
		});
	}
}

// A copy of what the provider needs, as createWorkOrder makes it from the issue and the community's office contact
function seedWorkOrder(set, order) {
	const issue = issues[order.communityId].find(item => item.id === order.issueId);
	const community = communities.find(item => item.id === order.communityId);
	const provider = providerById(order.providerId);
	const createdAt = order.at;
	const history = order.steps.map(([day, time, status, note, scheduled]) => ({ at: days(day, time), status, note, scheduledAt: scheduled && days(...scheduled) }));
	const revokedAt = order.revokedAt ? days(...order.revokedAt) : null;

	set(`workOrders/${order.token}`, {
		communityId: order.communityId,
		issueId: order.issueId,
		community: { name: community.name, address: community.address },
		issue: {
			title: issue.title,
			description: issue.description,
			category: issue.category,
			location: [issueLocationTypes[issue.location.type], issue.location.reference].filter(Boolean).join(' · '),
			assets: issue.assets ?? [],
		},
		expectedAt: order.expectedAt,
		// The office's contact in core's communities
		contact: { name: office.name, phone: office.phone, whatsapp: '600 000 101', email: office.email },
		provider: { id: provider.id, name: provider.name },
		status: history.at(-1)?.status ?? 'sent',
		scheduledAt: history.findLast(step => step.scheduledAt)?.scheduledAt,
		photos: order.photos,
		history,
		createdAt,
		createdBy: order.by,
		updatedAt: latest(createdAt, history.at(-1)?.at, revokedAt),
		revokedAt,
	});
}

export default {
	id: 'maintenance',
	label: 'Incidencias y mantenimiento',
	hint: 'Proveedores con valoraciones, incidencias con comentarios, votos, partes al seguro y partes de trabajo, y obligaciones',
	requires: ['core'],
	collections: ['providers', 'workOrders'],
	communityCollections: ['issues', 'obligations'],
	seed(set) {
		providers.forEach((provider, index) => {
			const { id, notes = '', ...data } = provider;
			const rated = (ratings[id] ?? []).map(([who, score, comment, day]) => ({ who, score, comment, createdAt: days(day, '18:00') }));
			// Fire safety was added by Carmen, comm1's president, the rest by the office
			const by = id === 'prov_fire' ? uids.carmen : uids.office;
			set(`providers/${id}`, {
				...data,
				notes,
				ratingSum: rated.reduce((sum, rating) => sum + rating.score, 0),
				ratingCount: rated.length,
				...audit(-700 + index * 40, by),
			});
			for (const { who, score, comment, createdAt } of rated) {
				const author = userById(uids[who]);
				set(`providers/${id}/ratings/${author.uid}`, {
					score,
					comment,
					// The first of the provider's communities they manage
					communityId: provider.communityIds.find(communityId => author.role === 'admin' ? author.communityIds.includes(communityId) : communityId === author.communityId),
					authorId: author.uid,
					authorName: author.name,
					createdAt,
				});
			}
		});

		// Late in a month, votes cast days ago fall in it too and use up 'm' ones
		const spent = {};
		for (const vote of Object.values(issues).flat().flatMap(castVotes)) {
			if (!vote.monthly && vote.votedAt >= monthStart) {
				spent[vote.who] = (spent[vote.who] ?? 0) + 1;
			}
		}
		for (const [communityId, list] of Object.entries(issues)) {
			list.forEach(issue => seedIssue(set, communityId, issue, spent));
		}
		workOrders.forEach(order => seedWorkOrder(set, order));

		for (const [communityId, list] of Object.entries(obligations)) {
			const by = communityId === 'comm2' ? uids.tomas : uids.office;
			for (const [id, type, title, due, everyMonths, providerId, lastDone, notes] of list) {
				const provider = providerId && providerById(providerId);
				const lastDoneAt = lastDone === null || lastDone < since[communityId] ? undefined : days(lastDone, '10:00');
				const created = audit(Math.max((lastDone ?? -45) - 10, since[communityId]), by);
				set(`communities/${communityId}/obligations/${id}`, {
					communityId,
					type,
					title: title ?? obligationTypes[type].label,
					dueAt: days(due, '00:00'),
					everyMonths,
					lastDoneAt,
					provider: provider ? { id: provider.id, name: provider.name } : undefined,
					notes: notes ?? undefined,
					...created,
					updatedAt: lastDoneAt ?? created.updatedAt,
				});
			}
		}
		for (const deadline of taxDeadlines(year, false, true).filter(item => taxIds.includes(item.id))) {
			set(`communities/comm1/obligations/${deadline.id}`, {
				communityId: 'comm1',
				type: 'other',
				title: deadline.title,
				dueAt: new Date(`${deadline.due}T00:00`),
				notes: 'Presentación en la Sede electrónica de la AEAT',
				...audit(days(-28, '09:50')),
			});
		}
	},
};
