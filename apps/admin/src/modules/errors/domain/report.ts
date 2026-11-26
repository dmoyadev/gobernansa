import type { ErrorGroup, ErrorSample } from '@gobernansa/shared/domain/errors.ts';
import type { Timestamp } from 'firebase/firestore';
import { errorApps, errorKinds, errorSeverities, errorSeverity, errorStatus, hasReturned } from '@gobernansa/shared/domain/errors.ts';

// Where a sample was caught
export const SOURCES: Record<string, string> = {
	vue: 'Componente',
	window: 'Script',
	promise: 'Promesa sin capturar',
	router: 'Navegación',
	action: 'Acción',
	manual: 'Página',
	quota: 'Cuota',
};

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'medium' });
export const formatTime = (time?: Timestamp) => time ? dateFormat.format(time.toDate()) : '—';

/*
 * Copiar para corregir: everything about a group in one text, with what to do with it, to hand over to whoever fixes it.
 * The last sample whole and the rest one line each. Nobody's uid or community, which the fix doesn't need
 */
export function errorReport(group: ErrorGroup, merged: ErrorGroup[], samples: ErrorSample[]) {
	const [last, ...rest] = samples;
	const severity = errorSeverity(group);
	const resolved = group.status === 'resolved'
		? ` el ${formatTime(group.resolvedAt)}${group.resolvedIn ? ` en ${group.resolvedIn}` : ''}${group.note ? `, con la nota «${group.note}»` : ''}${hasReturned(group) ? '. Ha vuelto después, así que aquella corrección no bastó' : ''}`
		: '';

	const lines = [
		`Corrige este error de producción de gobernança, en apps/${group.app}. Busca la causa raíz en el código, no solo el síntoma, y explica qué fallaba. Si no es un fallo nuestro (una extensión, el navegador o la conexión del usuario), dilo en lugar de cambiar el código.`,
		'',
		'## Error',
		`- Mensaje: ${last?.message || group.message || 'Sin mensaje'}`,
		`- App: ${errorApps[group.app]}`,
		`- Tipo: ${errorKinds[group.kind]} (${group.code})`,
		`- Gravedad: ${errorSeverities[severity.level].label}. ${severity.reason}`,
		`- Fichero: ${group.file ? `${group.file} (el trozo de Vite donde falla, sin su hash)` : 'desconocido'}`,
		`- Veces: ${group.count} en ${group.sessions} ${group.sessions === 1 ? 'sesión' : 'sesiones'}, del ${formatTime(group.firstSeen)} al ${formatTime(group.lastSeen)}`,
		`- Versiones: ${group.releases.join(', ')} (fecha y hora UTC del build y su commit)`,
		`- Pantallas: ${group.routes.join(', ') || '—'}`,
		`- Estado: ${errorStatus[group.status].label}${resolved}`,
		...merged.map(item => `- Mismo fallo, agrupado aparte: ${item.message} en ${item.file || 'un fichero desconocido'} (${item.count} veces)`),
		'',
	];

	if (!last) {
		return [...lines, 'No hay muestras: caducan a los 30 días.'].join('\n');
	}
	const { source, action, info } = last.context;
	return [
		...lines,
		`## Última muestra, del ${formatTime(last.at)} en la versión ${last.release}`,
		`- Pantalla: ${last.route || 'ninguna'}`,
		`- Dispositivo: ${last.browser} en ${last.os}${last.standalone ? ', app instalada' : ''}, ${last.online ? 'con conexión' : 'sin conexión'}`,
		`- Dónde se capturó: ${[SOURCES[source] ?? source, action, info].filter(Boolean).join(' · ')}`,
		'',
		'### Pila',
		...last.stack
			? [`Es del código minificado. Guárdala en pila.txt y tradúcela a las líneas del código con \`npm run symbolicate -- ${last.release} pila.txt\`.`, '', '```', last.stack, '```']
			: ['Sin pila.'],
		'',
		'### Lo que hizo el usuario antes, del más antiguo al último',
		...last.trail.length ? last.trail.map((entry, index) => `${index + 1}. ${entry}`) : ['Nada: falló al abrir la app.'],
		...rest.length
			? ['', '## Otras muestras', ...rest.map(sample => `- ${formatTime(sample.at)} · ${sample.release} · ${sample.route || 'sin pantalla'} · ${sample.browser} en ${sample.os}${sample.message === last.message ? '' : ` · ${sample.message}`}`)]
			: [],
	].join('\n');
}
