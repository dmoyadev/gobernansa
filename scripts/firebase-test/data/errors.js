import { createHash } from 'node:crypto';
import { days, now, uids, userById } from './cast.js';

// Errores de las apps, for the team's page: every kind, status and app, what makes a group urgent or come back, a merge
// in each status, an old resolved one and expired samples for Limpiar caducadas

const WEBAPP = 'https://gobernansa.dmoya.dev/assets';
const ADMIN = 'https://admin.gobernansa.dmoya.dev/assets';
// What Vue's production build says of where it failed: rendering, and a component's event handler
const VUE_RENDER = 'https://vuejs.org/error-reference/#runtime-1';
const VUE_HANDLER = 'https://vuejs.org/error-reference/#runtime-5';
const SAMPLE_DAYS = 30;
// maintenance.js's issue with a video
const VIDEO_ISSUE = 'La del vídeo y el título súper largo que alguien ha confundido con la descripción así que se va de madre';

const hoursAgo = hours => new Date(now.getTime() - hours * 60 * 60 * 1000);

// As CI names them: build date and time, and commit
function release(n, time, commit) {
	const date = days(n, time);
	const pad = value => String(value).padStart(2, '0');
	return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}-${time.replace(':', '')}-${commit}`;
}
const r = {
	old: release(-200, '09:30', 'e41b2c9'),
	oldFix: release(-185, '17:05', '7d03a1f'),
	r3: release(-41, '11:20', 'c19f4e2'),
	r4: release(-27, '16:45', '5ab88d0'),
	r5: release(-18, '10:10', '0f6e3b7'),
	r6: release(-11, '19:30', '93c2d5a'),
	r7: release(-5, '12:15', 'b7e10f4'),
	r8: release(-1, '09:40', '2d4a9c6'),
};

// Each one's browser, as monitoring.ts reads it from the user agent
const devices = {
	[uids.team]: { browser: 'Chrome 142', os: 'macOS' },
	[uids.office]: { browser: 'Edge 142', os: 'Windows' },
	[uids.carmen]: { browser: 'Safari 26', os: 'iOS 26.0' },
	[uids.lucia]: { browser: 'Safari 26', os: 'iOS 26.1', standalone: true },
	[uids.javier]: { browser: 'Chrome 142', os: 'Android 16' },
	[uids.maria]: { browser: 'Samsung Internet 28', os: 'Android 15', standalone: true },
	[uids.andres]: { browser: 'Opera 124', os: 'Windows' },
	[uids.rosa]: { browser: 'Chrome 142', os: 'Android 14' },
	[uids.elena]: { browser: 'Chrome 142', os: 'Windows' },
	[uids.pablo]: { browser: 'Chrome 141', os: 'Android 16' },
};

// The same as monitoring.ts: 16 characters of the SHA-1 of the app, the kind, the normalized message, the file and the action
function fingerprint({ app, kind, code, message, file, action = '' }) {
	return createHash('sha1').update([app, kind === 'firebase' ? `firebase:${code}` : kind, message, file, action].join('\n')).digest('hex').slice(0, 16);
}

// What the user did, [seconds before the error, 'kind: text'], with the time as the browser writes it
function trail(at, entries) {
	return entries.map(([seconds, text]) => `${new Date(at.getTime() - seconds * 1000).toLocaleTimeString('es', { hour12: false })} ${text}`);
}

const chromeStack = (raw, base, chunks) => [raw, ...chunks.map(([chunk, line, column]) => `    at ${base}/${chunk}.js:${line}:${column}`)].join('\n');
const safariStack = (base, chunks) => chunks.map(([chunk, line, column]) => `@${base}/${chunk}.js:${line}:${column}`).join('\n');

// message is already normalized (markers for quoted texts, numbers and ids), as the group keeps it; each sample has the
// raw one. Samples [at, uid, release, route, extra]: communityId is the page's in the admin, the user's in the webapp
const groups = [
	{
		key: 'perm_arrears',
		app: 'admin',
		kind: 'firebase',
		code: 'permission-denied',
		message: 'Missing or insufficient permissions.',
		file: 'index.js',
		action: 'No se han podido guardar',
		count: 9,
		sessions: 3,
		firstSeen: days(-1, '10:52'),
		lastSeen: hoursAgo(3),
		releases: [r.r8],
		routes: ['Morosidad'],
		status: 'new',
		samples: [
			[days(-1, '10:52'), uids.office, r.r8, 'Morosidad', { communityId: 'comm1', source: 'action', trail: [[40, 'pantalla: Finanzas'], [31, 'clic: Morosidad'], [18, 'pantalla: Morosidad'], [9, 'clic: Aplicar intereses de demora'], [2, 'clic: Guardar']] }],
			[days(-1, '16:40'), uids.office, r.r8, 'Morosidad', { communityId: 'comm2', source: 'action', trail: [[25, 'pantalla: Finanzas'], [15, 'clic: Morosidad'], [14, 'pantalla: Morosidad'], [3, 'clic: Guardar']] }],
			[hoursAgo(3), uids.office, r.r8, 'Morosidad', { communityId: 'comm1', source: 'action', trail: [[12, 'pantalla: Morosidad'], [6, 'clic: Guardar'], [1, 'clic: Guardar']] }],
		],
		stack: [ADMIN, [['index-Bf3xT0aQ', 13, 48211], ['index-Bf3xT0aQ', 13, 51007], ['ArrearsPage-Hn2vKq8L', 1, 6230]]],
	},
	{
		key: 'index_receipts',
		app: 'webapp',
		kind: 'firebase',
		code: 'failed-precondition',
		message: 'The query requires an index. You can create it here: https://console.firebase.google.com/v<n>/r/project/dmoyadev-gobernansa/firestore/indexes?create_composite=<id>',
		raw: 'The query requires an index. You can create it here: https://console.firebase.google.com/v1/r/project/dmoyadev-gobernansa/firestore/indexes?create_composite=ClNwcm9qZWN0cy9kbW95YWRldi1nb2Jlcm5hbnNhL2RhdGFiYXNlcy8oZGVmYXVsdCkvY29sbGVjdGlvbkdyb3Vwcy9jaGFyZ2VzL2luZGV4ZXMvXxABGgwKCG93bmVyVWlkEAEaCgoGcGFpZEF0EAIaDAoIX19uYW1lX18QAg',
		file: 'index.js',
		action: 'Cargar los recibos pagados',
		count: 11,
		sessions: 3,
		firstSeen: days(-5, '13:02'),
		lastSeen: hoursAgo(1),
		releases: [r.r7, r.r8],
		routes: ['Mis recibos'],
		status: 'new',
		samples: [
			[days(-5, '13:02'), uids.maria, r.r7, 'Mis recibos', { trail: [[22, 'pantalla: Comunidad'], [9, 'clic: Mis recibos'], [8, 'pantalla: Mis recibos'], [2, 'clic: Ver pagados y justificantes']] }],
			[days(-3, '20:41'), uids.lucia, r.r7, 'Mis recibos', { trail: [[61, 'pantalla: Home'], [48, 'pantalla: Comunidad'], [20, 'clic: Mis recibos'], [19, 'pantalla: Mis recibos'], [5, 'clic: Ver pagados y justificantes']] }],
			[hoursAgo(1), uids.elena, r.r8, 'Mis recibos', { trail: [[15, 'pantalla: Comunidad'], [7, 'clic: Mis recibos'], [6, 'pantalla: Mis recibos'], [1, 'clic: Ver pagados y justificantes']] }],
		],
		stack: [WEBAPP, [['index-Dk40pLwY', 14, 30122], ['index-Dk40pLwY', 14, 30815]]],
	},
	// Reported the next morning, when it's back: no stack, and the screen where it ran out
	{
		key: 'quota',
		app: 'webapp',
		kind: 'firebase',
		code: 'resource-exhausted',
		message: 'Cuota diaria de Firestore agotada',
		file: '',
		count: 2,
		sessions: 2,
		firstSeen: days(-3, '09:04'),
		lastSeen: days(-3, '09:31'),
		releases: [r.r7],
		routes: ['Incidencias', 'Home'],
		status: 'new',
		samples: [
			[days(-3, '09:04'), uids.lucia, r.r7, 'Incidencias', { source: 'quota', info: `Agotada el ${days(-4, '22:47').toLocaleString('es')}`, trail: [[2, 'pantalla: Home']] }],
			[days(-3, '09:31'), uids.carmen, r.r7, 'Home', { source: 'quota', info: `Agotada el ${days(-4, '23:15').toLocaleString('es')}`, trail: [] }],
		],
	},
	{
		key: 'issue_detail',
		app: 'webapp',
		kind: 'js',
		code: 'js',
		message: 'Cannot read properties of undefined (reading <texto>)',
		raw: 'Cannot read properties of undefined (reading \'toDate\')',
		file: 'IssuesDetailPage.js',
		count: 14,
		sessions: 4,
		firstSeen: days(-11, '21:14'),
		lastSeen: hoursAgo(2),
		releases: [r.r6, r.r7, r.r8],
		routes: ['Detalle de incidencia'],
		status: 'new',
		samples: [
			[days(-11, '21:14'), uids.javier, r.r6, 'Detalle de incidencia', { source: 'vue', info: `${VUE_RENDER} en IssueComments`, trail: [[30, 'pantalla: Incidencias'], [12, 'clic: Fuga de agua en el garaje'], [3, 'pantalla: Detalle de incidencia']] }],
			[days(-6, '18:02'), uids.rosa, r.r6, 'Detalle de incidencia', { source: 'vue', info: `${VUE_RENDER} en IssueComments`, trail: [[19, 'pantalla: Incidencias'], [8, 'clic: Fuga de agua en el garaje'], [2, 'pantalla: Detalle de incidencia']] }],
			[days(-2, '11:37'), uids.andres, r.r7, 'Detalle de incidencia', { source: 'vue', info: `${VUE_RENDER} en IssueComments`, online: false, trail: [[95, 'pantalla: Incidencias'], [70, 'conexión: Sin conexión'], [20, 'clic: Fuga de agua en el garaje'], [4, 'pantalla: Detalle de incidencia']] }],
			[hoursAgo(2), uids.maria, r.r8, 'Detalle de incidencia', { source: 'vue', info: `${VUE_RENDER} en IssueComments`, trail: [[14, 'pantalla: Incidencias'], [5, 'clic: Fuga de agua en el garaje'], [1, 'pantalla: Detalle de incidencia']] }],
		],
		stack: [WEBAPP, [['IssuesDetailPage-D4kq9PzX', 1, 4821], ['index-Dk40pLwY', 13, 22013], ['index-Dk40pLwY', 13, 22941]]],
	},
	{
		key: 'charges',
		app: 'webapp',
		kind: 'js',
		code: 'js',
		message: 'Cannot read properties of null (reading <texto>)',
		raw: 'Cannot read properties of null (reading \'paidAt\')',
		file: 'ChargesPage.js',
		count: 6,
		sessions: 2,
		firstSeen: days(-4, '18:20'),
		lastSeen: days(-1, '20:05'),
		releases: [r.r7, r.r8],
		routes: ['Mis recibos'],
		status: 'new',
		samples: [
			[days(-4, '18:20'), uids.maria, r.r7, 'Mis recibos', { source: 'vue', info: `${VUE_RENDER} en ChargesPage`, trail: [[11, 'pantalla: Comunidad'], [4, 'clic: Mis recibos'], [1, 'pantalla: Mis recibos']] }],
			[days(-1, '20:05'), uids.pablo, r.r8, 'Mis recibos', { source: 'vue', info: `${VUE_RENDER} en ChargesPage`, trail: [[7, 'pantalla: Comunidad'], [3, 'clic: Mis recibos'], [2, 'pantalla: Mis recibos']] }],
		],
		stack: [WEBAPP, [['ChargesPage-Wq7cN1sE', 1, 3390], ['index-Dk40pLwY', 13, 22013]]],
	},
	// The same failure from the receipt, merged into the one above: it takes its status
	{
		key: 'receipt',
		app: 'webapp',
		kind: 'js',
		code: 'js',
		message: 'Cannot read properties of null (reading <texto>)',
		raw: 'Cannot read properties of null (reading \'paidAt\')',
		file: 'ReceiptPage.js',
		count: 3,
		sessions: 2,
		firstSeen: days(-4, '18:31'),
		lastSeen: days(-2, '10:12'),
		releases: [r.r7],
		routes: ['Justificante de pago'],
		status: 'new',
		mergedInto: 'charges',
		samples: [
			[days(-4, '18:31'), uids.maria, r.r7, 'Justificante de pago', { source: 'vue', info: `${VUE_RENDER} en ReceiptPage`, trail: [[16, 'pantalla: Mis recibos'], [6, 'clic: Ver justificante'], [1, 'pantalla: Justificante de pago']] }],
			[days(-2, '10:12'), uids.javier, r.r7, 'Justificante de pago', { source: 'vue', info: `${VUE_RENDER} en ReceiptPage`, trail: [[9, 'pantalla: Mis recibos'], [2, 'clic: Ver justificante']] }],
		],
		stack: [WEBAPP, [['ReceiptPage-Lr5tB0aV', 1, 2177], ['index-Dk40pLwY', 13, 22013]]],
	},
	// A tab opened before the last deploy, and its release is the old one
	{
		key: 'load_bank',
		app: 'admin',
		kind: 'carga',
		code: 'carga',
		message: `Failed to fetch dynamically imported module: ${ADMIN}/BankPage.js`,
		raw: `Failed to fetch dynamically imported module: ${ADMIN}/BankPage-Cx8dPq1a.js`,
		file: '',
		count: 2,
		sessions: 1,
		firstSeen: days(-1, '10:03'),
		lastSeen: days(-1, '10:09'),
		releases: [r.r7],
		routes: ['Finanzas'],
		status: 'new',
		samples: [
			[days(-1, '10:03'), uids.office, r.r7, 'Finanzas', { communityId: 'comm1', source: 'router', trail: [[1500, 'pantalla: Finanzas'], [1320, 'versión: Nueva versión disponible'], [4, 'clic: Conciliación bancaria']] }],
		],
	},
	{
		key: 'load_bookings',
		app: 'webapp',
		kind: 'carga',
		code: 'carga',
		message: `Failed to fetch dynamically imported module: ${WEBAPP}/BookingsPage.js`,
		raw: `Failed to fetch dynamically imported module: ${WEBAPP}/BookingsPage-Tg3mE8wQ.js`,
		file: '',
		count: 8,
		sessions: 3,
		firstSeen: days(-17, '19:25'),
		lastSeen: days(-11, '20:10'),
		releases: [r.r4, r.r5],
		routes: ['Comunidad'],
		status: 'resolved',
		resolved: { at: days(-10, '18:00'), in: r.r6, note: 'Las pestañas abiertas antes de desplegar pedían partes que ya no existen: ahora la app se recarga sola al cambiar de pantalla.' },
		samples: [
			[days(-17, '19:25'), uids.javier, r.r4, 'Comunidad', { source: 'router', trail: [[40, 'pantalla: Home'], [15, 'pantalla: Comunidad'], [6, 'clic: Reservas']] }],
			[days(-16, '12:02'), uids.rosa, r.r4, 'Comunidad', { source: 'router', trail: [[18, 'pantalla: Comunidad'], [3, 'clic: Reservas']] }],
			[days(-11, '20:10'), uids.maria, r.r5, 'Comunidad', { source: 'router', trail: [[2400, 'pantalla: Home'], [1800, 'versión: Nueva versión disponible'], [20, 'pantalla: Comunidad'], [5, 'clic: Reservas']] }],
		],
	},
	// Safari's words for the same, merged into it once resolved
	{
		key: 'load_safari',
		app: 'webapp',
		kind: 'carga',
		code: 'carga',
		message: 'Importing a module script failed.',
		file: '',
		count: 3,
		sessions: 2,
		firstSeen: days(-16, '08:30'),
		lastSeen: days(-11, '19:52'),
		releases: [r.r4, r.r5],
		routes: ['Comunidad', 'Home'],
		status: 'resolved',
		mergedInto: 'load_bookings',
		resolved: { at: days(-10, '18:05'), in: r.r6 },
		samples: [
			[days(-16, '08:30'), uids.lucia, r.r4, 'Comunidad', { source: 'router', trail: [[30, 'pantalla: Home'], [14, 'pantalla: Comunidad'], [6, 'clic: Reservas']] }],
			[days(-11, '19:52'), uids.carmen, r.r5, 'Home', { source: 'router', trail: [[900, 'pantalla: Home'], [3, 'clic: Incidencias']] }],
		],
	},
	// Resolved and seen again since: it goes first, as come back
	{
		key: 'minutes',
		app: 'admin',
		kind: 'js',
		code: 'js',
		message: 'Cannot read properties of undefined (reading <texto>)',
		raw: 'Cannot read properties of undefined (reading \'signedAt\')',
		file: 'MeetingPage.js',
		count: 12,
		sessions: 4,
		firstSeen: days(-40, '12:30'),
		lastSeen: hoursAgo(5),
		releases: [r.r3, r.r5, r.r8],
		routes: ['Junta'],
		status: 'resolved',
		resolved: { at: days(-9, '12:30'), in: r.r6, note: 'Las actas sin firmas todavía rompían la vista previa. Probado con la junta ordinaria.' },
		samples: [
			[days(-40, '12:30'), uids.office, r.r3, 'Junta', { communityId: 'comm1', source: 'vue', info: `${VUE_RENDER} en MeetingMinutes`, trail: [[60, 'pantalla: Juntas'], [20, 'clic: Junta general ordinaria'], [19, 'pantalla: Junta']] }],
			[days(-39, '10:15'), uids.carmen, r.r3, 'Junta', { communityId: 'comm1', source: 'vue', info: `${VUE_RENDER} en MeetingMinutes`, trail: [[35, 'pantalla: Juntas'], [3, 'clic: Junta general ordinaria'], [2, 'pantalla: Junta']] }],
			[days(-14, '16:05'), uids.office, r.r5, 'Junta', { communityId: 'comm2', source: 'vue', info: `${VUE_RENDER} en MeetingMinutes`, trail: [[25, 'pantalla: Juntas'], [9, 'clic: Junta general ordinaria'], [8, 'pantalla: Junta']] }],
			[hoursAgo(5), uids.office, r.r8, 'Junta', { communityId: 'comm2', source: 'vue', info: `${VUE_RENDER} en MeetingMinutes`, trail: [[80, 'pantalla: Comunidad'], [50, 'pantalla: Juntas'], [12, 'clic: Junta general ordinaria'], [11, 'pantalla: Junta']] }],
		],
		stack: [ADMIN, [['MeetingPage-Pz6yR2kd', 1, 15388], ['index-Bf3xT0aQ', 13, 21870]]],
		userDevice: { [uids.carmen]: { browser: 'Chrome 142', os: 'macOS' } },
	},
	{
		key: 'remittances',
		app: 'admin',
		kind: 'js',
		code: 'js',
		message: '<x> is not iterable',
		raw: 't is not iterable',
		file: 'RemittancesPage.js',
		count: 3,
		sessions: 2,
		firstSeen: days(-4, '11:30'),
		lastSeen: days(-1, '12:47'),
		releases: [r.r7, r.r8],
		routes: ['Remesas'],
		status: 'new',
		samples: [
			[days(-4, '11:30'), uids.office, r.r7, 'Remesas', { communityId: 'comm1', source: 'vue', info: `${VUE_HANDLER} en RemittancesPage`, trail: [[45, 'pantalla: Remesas'], [20, 'clic: Importar devoluciones'], [2, 'clic: Registrar 2 devoluciones']] }],
			[days(-1, '12:45'), uids.team, r.r8, 'Remesas', { communityId: 'comm1', source: 'vue', info: `${VUE_HANDLER} en RemittancesPage`, trail: [[30, 'pantalla: Comunidad'], [15, 'pantalla: Remesas'], [6, 'clic: Importar devoluciones'], [1, 'clic: Registrar 1 devolución']] }],
		],
		stack: [ADMIN, [['RemittancesPage-Ks3dF9uM', 1, 8814], ['index-Bf3xT0aQ', 13, 23506]]],
	},
	// A stale link to an issue that is no longer in the database, as after a demo reset
	{
		key: 'issue_gone',
		app: 'admin',
		kind: 'firebase',
		code: 'not-found',
		message: 'No document to update: projects/dmoyadev-gobernansa/databases/(default)/documents/communities/comm<n>/issues/<id>',
		raw: 'No document to update: projects/dmoyadev-gobernansa/databases/(default)/documents/communities/comm1/issues/Hq3kP9xLm2RtV7sYb1Nc',
		file: 'index.js',
		action: 'No se ha podido cambiar el estado',
		count: 2,
		sessions: 2,
		firstSeen: days(-7, '17:22'),
		lastSeen: days(-2, '13:05'),
		releases: [r.r6, r.r7],
		routes: ['Incidencia'],
		status: 'new',
		samples: [
			[days(-7, '17:22'), uids.carmen, r.r6, 'Incidencia', { communityId: 'comm1', source: 'action', trail: [[300, 'pantalla: Incidencias'], [240, 'clic: Luz fundida en la escalera'], [239, 'pantalla: Incidencia'], [4, 'clic: Solucionada']] }],
			[days(-2, '13:05'), uids.team, r.r7, 'Incidencia', { communityId: 'comm1', source: 'action', trail: [[600, 'pantalla: Bandeja de incidencias'], [590, 'clic: Timbre del portal sin funcionar'], [589, 'pantalla: Incidencia'], [2, 'clic: Actuando']] }],
		],
		stack: [ADMIN, [['index-Bf3xT0aQ', 13, 48211], ['IssuePage-Vb8nJ4tX', 1, 9930]]],
		userDevice: { [uids.carmen]: { browser: 'Chrome 142', os: 'macOS' } },
	},
	// The video in an issue, stopped before it starts: the browser's, nothing to fix
	{
		key: 'video',
		app: 'webapp',
		kind: 'js',
		code: 'js',
		message: 'The play() request was interrupted by a call to pause(). https://goo.gl/LdLk<n>',
		raw: 'The play() request was interrupted by a call to pause(). https://goo.gl/LdLk22',
		file: '',
		count: 7,
		sessions: 3,
		firstSeen: days(-38, '18:55'),
		lastSeen: days(-3, '21:40'),
		releases: [r.r3, r.r4, r.r7],
		routes: ['Detalle de incidencia', 'Incidencias'],
		status: 'ignored',
		samples: [
			[days(-38, '18:55'), uids.javier, r.r3, 'Detalle de incidencia', { source: 'promise', trail: [[20, 'pantalla: Incidencias'], [10, `clic: ${VIDEO_ISSUE}`], [9, 'pantalla: Detalle de incidencia']] }],
			[days(-20, '22:14'), uids.rosa, r.r4, 'Incidencias', { source: 'promise', trail: [[30, `clic: ${VIDEO_ISSUE}`], [29, 'pantalla: Detalle de incidencia'], [1, 'pantalla: Incidencias']] }],
			[days(-3, '21:40'), uids.maria, r.r7, 'Detalle de incidencia', { source: 'promise', trail: [[40, 'pantalla: Incidencias'], [26, `clic: ${VIDEO_ISSUE}`], [25, 'pantalla: Detalle de incidencia']] }],
		],
	},
	// Resolved half a year ago and not seen since: Limpiar caducadas removes it. Its samples expired long before
	{
		key: 'old_charge',
		app: 'admin',
		kind: 'firebase',
		code: 'invalid-argument',
		message: 'Function addDoc() called with invalid data. Unsupported field value: undefined (found in field dueDate in document communities/comm<n>/charges/<id>)',
		file: 'index.js',
		action: 'No se ha podido crear',
		count: 4,
		sessions: 2,
		firstSeen: days(-201, '10:15'),
		lastSeen: days(-200, '13:00'),
		releases: [r.old],
		routes: ['Recibos'],
		status: 'resolved',
		resolved: { at: days(-184, '10:00'), in: r.oldFix, note: 'Faltaba la fecha de vencimiento al duplicar un recibo.' },
		samples: [],
	},
];

const idOf = Object.fromEntries(groups.map(group => [group.key, fingerprint(group)]));

export default {
	id: 'errors',
	label: 'Errores de las apps (equipo)',
	hint: 'Errores agrupados de las dos apps, con muestras, para la página Errores del equipo',
	requires: [],
	collections: ['errors'],
	communityCollections: [],
	seed(set) {
		for (const { key, raw, action, samples, stack, userDevice = {}, resolved, mergedInto, ...group } of groups) {
			const id = idOf[key];
			set(`errors/${id}`, {
				app: group.app,
				kind: group.kind,
				code: group.code,
				message: group.message,
				file: group.file,
				count: group.count,
				sessions: group.sessions,
				firstSeen: group.firstSeen,
				lastSeen: group.lastSeen,
				firstRelease: group.releases[0],
				lastRelease: group.releases.at(-1),
				releases: group.releases,
				routes: group.routes,
				status: group.status,
				resolvedAt: resolved?.at,
				resolvedBy: resolved ? uids.team : undefined,
				resolvedIn: resolved?.in,
				note: resolved?.note,
				mergedInto: mergedInto && idOf[mergedInto],
			});

			samples.forEach(([at, uid, sampleRelease, route, { communityId, source = 'manual', info, online = true, trail: entries }], index) => {
				const user = userById(uid);
				const device = userDevice[uid] ?? devices[uid];
				const message = raw ?? group.message;
				const name = group.kind === 'firebase' ? 'FirebaseError' : 'TypeError';
				set(`errors/${id}/samples/${key}_${index + 1}`, {
					at,
					expiresAt: new Date(at.getTime() + SAMPLE_DAYS * 24 * 60 * 60 * 1000),
					release: sampleRelease,
					app: group.app,
					route,
					communityId: communityId ?? user.communityId,
					uid,
					role: user.role,
					browser: device.browser,
					os: device.os,
					standalone: !!device.standalone,
					online,
					message,
					stack: !stack ? '' : device.browser.startsWith('Safari') ? safariStack(...stack) : chromeStack(`${name}: ${message}`, ...stack),
					trail: trail(at, entries),
					context: { source, action, code: group.kind === 'firebase' ? group.code : undefined, info },
				});
			});
		}
	},
};
