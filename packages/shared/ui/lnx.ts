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
		clear: 'Borrar',
		remove: 'Quitar',
		confirm: 'Aceptar',
		cancel: 'Cancelar',
		undo: 'Deshacer',
		undone: 'Deshecho',
		undoFailed: 'No se ha podido deshacer',
		loading: 'Cargando',
		shortcuts: 'Atajos de teclado',
		undoLast: 'Deshacer lo último',
		showPassword: 'Mostrar la contraseña',
		digit: 'Dígito',
		chooseDate: 'Elegir una fecha',
		previousMonth: 'Mes anterior',
		nextMonth: 'Mes siguiente',
		previousYear: 'Año anterior',
		nextYear: 'Año siguiente',
		previousYears: '{n} años anteriores',
		nextYears: '{n} años siguientes',
	},
	onUndoError: error => reportError(error, { source: 'action', action: 'Deshacer' }),
});
