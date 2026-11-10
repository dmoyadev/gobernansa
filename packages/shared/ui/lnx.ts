import { createLnx } from 'lnxjs-components';
import { reportError } from '../infrastructure/monitoring.ts';

// Spanish for every lnxjs-components control, in both apps
export const lnx = createLnx({
	locale: 'es',
	texts: {
		search: 'Buscar...',
		notFound: 'Sin resultados',
		today: 'Hoy',
		close: 'Cerrar',
		confirm: 'Aceptar',
		cancel: 'Cancelar',
		undo: 'Deshacer',
		undone: 'Deshecho',
		undoFailed: 'No se ha podido deshacer',
		loading: 'Cargando',
		shortcuts: 'Atajos de teclado',
		undoLast: 'Deshacer lo último',
	},
	onUndoError: error => reportError(error, { source: 'action', action: 'Deshacer' }),
});
