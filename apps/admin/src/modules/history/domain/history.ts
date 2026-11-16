import type { ActionType } from '@gobernansa/shared/infrastructure/actions.ts';
import type { DocumentData, Timestamp } from 'firebase/firestore';

// A change to a document, at audit/{eventId}, written by the functions (functions/index.js)
export interface Change {
	id: string;
	path: string;
	// The collection it's in, the last one of the path: 'issues' for communities/{c}/issues/{i}
	collection: string;
	docId: string;
	communityId?: string;
	op: ChangeOp;
	// The top-level fields that differ, all of them when created or removed
	changed: string[];
	// As it was and as it was left, null when it didn't exist. With truncated, only the changed fields, and it can't be restored
	before: DocumentData | null;
	after: DocumentData | null;
	truncated?: boolean;
	// Who, as Firestore tells it: 'service_account', 'unauthenticated', 'system', 'unknown'...
	authType: string;
	actorId: string | null;
	actorName: string | null;
	actorEmail: string | null;
	// Taken from the document itself (updatedBy and the like), as the event didn't say
	actorInferred?: boolean;
	// Made by restoring the version of that other change
	restoredFrom?: string;
	at: Timestamp;
}

export type ChangeOp = 'create' | 'update' | 'delete';

// Something a user did, at actions/{id}, written by each app (packages/shared/infrastructure/actions.ts)
export interface Action {
	id: string;
	uid: string;
	email?: string;
	name?: string;
	app: 'webapp' | 'admin';
	type: ActionType;
	path?: string;
	detail?: string;
	meta?: Record<string, unknown>;
	communityId?: string;
	viewAs?: string;
	device?: string;
	// Missing until the server dates it
	at?: Timestamp;
}

export const changeOps: Record<ChangeOp, { label: string; filter: string; icon: string }> = {
	create: { label: 'Creado', filter: 'Creaciones', icon: 'lucide:file-plus' },
	update: { label: 'Modificado', filter: 'Modificaciones', icon: 'lucide:file-pen' },
	delete: { label: 'Borrado', filter: 'Borrados', icon: 'lucide:file-x' },
};

export const actionTypes: Record<ActionType, { label: string; icon: string }> = {
	'signin': { label: 'Inicio de sesión', icon: 'lucide:log-in' },
	'signout': { label: 'Cierre de sesión', icon: 'lucide:log-out' },
	'page': { label: 'Pantalla', icon: 'lucide:app-window' },
	'print': { label: 'Impresión', icon: 'lucide:printer' },
	'download': { label: 'Descarga', icon: 'lucide:download' },
	'view-as': { label: 'Ver como vecino', icon: 'lucide:eye' },
	'view-as-exit': { label: 'Dejar de ver como vecino', icon: 'lucide:eye-off' },
	'password': { label: 'Cambio de contraseña', icon: 'lucide:key-round' },
	'email': { label: 'Email añadido', icon: 'lucide:at-sign' },
	'restore': { label: 'Restauración', icon: 'lucide:history' },
};

// Each collection by what it holds (firestore.rules), for the filter and the list
export const collections: Record<string, string> = {
	accounting: 'Plan de cuentas',
	activity: 'Registro de actividad',
	attendance: 'Asistencia a juntas',
	auth: 'Cuentas de acceso',
	ballots: 'Votos en juntas',
	bankMovements: 'Movimientos del banco',
	bookings: 'Reservas',
	budgets: 'Presupuestos',
	charges: 'Recibos',
	comments: 'Comentarios',
	communities: 'Comunidades',
	debtCases: 'Reclamaciones de deuda',
	devices: 'Dispositivos con avisos',
	documentFiles: 'Archivos de documentos',
	documents: 'Documentos de vecinos',
	events: 'Comunicados',
	expenses: 'Gastos',
	fiscalYears: 'Cierres de ejercicio',
	invitations: 'Invitaciones',
	invoices: 'Facturas de honorarios',
	issues: 'Incidencias',
	journalEntries: 'Asientos',
	mail: 'Correo',
	meetings: 'Juntas',
	minutes: 'Actas',
	notices: 'Notificaciones de juntas',
	obligations: 'Obligaciones',
	offices: 'Despachos',
	paymentOrders: 'Órdenes de pago',
	payments: 'Pagos',
	private: 'Datos internos de incidencias',
	properties: 'Propiedades',
	providers: 'Proveedores',
	ratings: 'Valoraciones de proveedores',
	remittances: 'Remesas',
	users: 'Usuarios',
	verifactu: 'Registros Verifactu',
	votes: 'Votos de incidencias',
	workOrders: 'Partes de trabajo',
};

// Who made a change when it's not a user of the apps
const NOT_USERS: Record<string, string> = {
	unauthenticated: 'Alguien sin sesión (un proveedor con su parte)',
	system: 'El sistema',
	service_account: 'Un proceso del servidor',
	api_key: 'Una clave de API',
};

export function changeAuthor(change: Change) {
	return change.actorName || change.actorEmail || (change.actorId ? `Usuario ${change.actorId}` : NOT_USERS[change.authType] ?? 'Desconocido');
}

// What the document is called, from its own data, for the list
const TITLE_FIELDS = ['title', 'name', 'subject', 'reference', 'summary', 'email'];
export function changeTitle(change: Change) {
	const data = change.after ?? change.before;
	const title = TITLE_FIELDS.map(field => data?.[field] as unknown).find(value => typeof value === 'string' && value) as string | undefined;
	return title ?? change.docId;
}
