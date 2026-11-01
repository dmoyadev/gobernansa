export interface FinanceSection {
	// The page it opens, /communities/:id/<key>
	key: string;
	title: string;
	icon: string;
	description: string;
	details: string;
}

// The community's finance pages by what they're for, as the Finanzas page lists them and the community's tiles take them
export const financeGroups: { title: string; sections: FinanceSection[] }[] = [
	{
		title: 'Cobros a los propietarios',
		sections: [
			{ key: 'charges', title: 'Recibos y morosidad', icon: 'lucide:receipt-text', description: 'Cuotas, derramas y certificados', details: 'Emite cuotas y derramas, sigue los impagos y genera certificados de pagos.' },
			{ key: 'fees', title: 'Cuotas y fondo de reserva', icon: 'lucide:calendar-sync', description: 'Cuotas del año desde el presupuesto', details: 'Genera de una vez las cuotas del año por coeficiente y sigue el saldo del fondo de reserva.' },
			{ key: 'mandates', title: 'Mandatos SEPA', icon: 'lucide:file-signature', description: 'Domiciliaciones por propiedad', details: 'Cuenta, titular y referencia del mandato de cada propiedad que paga domiciliado.' },
			{ key: 'remittances', title: 'Remesas de recibos', icon: 'lucide:landmark', description: 'Recibos domiciliados y devoluciones', details: 'Genera el fichero SEPA para cobrar los recibos domiciliados desde el banco y registra las devoluciones.' },
			{ key: 'statements', title: 'Estados de cuenta', icon: 'lucide:scroll-text', description: 'Cargos, abonos y saldo por propietario', details: 'El saldo de cada propietario, deudor o al corriente, y su estado de cuenta imprimible.' },
			{ key: 'arrears', title: 'Gestión de morosidad', icon: 'lucide:mail-warning', description: 'Antigüedad de la deuda, reclamaciones y monitorio', details: 'La deuda de cada moroso por antigüedad, cartas de reclamación por niveles, burofax y el certificado para el procedimiento monitorio.' },
		],
	},
	{
		title: 'Gastos y proveedores',
		sections: [
			{ key: 'budget', title: 'Presupuesto', icon: 'lucide:chart-pie', description: 'Partidas, gastos y reparto', details: 'Reparte el presupuesto en partidas, registra los gastos y facturas y compara lo previsto con lo gastado.' },
			{ key: 'payables', title: 'Facturas pendientes', icon: 'lucide:file-clock', description: 'Lo que se debe a proveedores', details: 'Facturas de proveedores por pagar, por vencimiento, con las vencidas destacadas.' },
			{ key: 'payments', title: 'Pagos a proveedores', icon: 'lucide:send', description: 'Transferencias SEPA de las facturas', details: 'Genera el fichero SEPA de transferencias para pagar de una vez las facturas pendientes desde el banco.' },
		],
	},
	{
		title: 'Banco',
		sections: [
			{ key: 'bank', title: 'Conciliación bancaria', icon: 'lucide:arrow-left-right', description: 'Extractos y movimientos del banco', details: 'Importa el extracto del banco (Norma 43 o CSV) y concilia cada movimiento con sus recibos, facturas, remesas y pagos.' },
		],
	},
	{
		title: 'Contabilidad y fiscalidad',
		sections: [
			{ key: 'accounting', title: 'Contabilidad', icon: 'lucide:book-open-check', description: 'Diario, mayor, balances y cierre', details: 'Asientos por partida doble de recibos, facturas, cobros y pagos, con el diario, el mayor, los balances y el cierre del ejercicio.' },
			{ key: 'annual-report', title: 'Liquidación del ejercicio', icon: 'lucide:file-chart-column', description: 'Cuentas del año para la junta', details: 'Ingresos y gastos frente al presupuesto, fondo de reserva, saldo en bancos, morosos y presupuesto propuesto, listo para la convocatoria.' },
			{ key: 'taxes', title: 'Modelos fiscales', icon: 'lucide:file-badge', description: '347, 111, 190 y 184 para la AEAT', details: 'Operaciones con terceros, retenciones a profesionales e ingresos atribuidos a los propietarios, con el fichero para presentarlos en la Sede.' },
			{ key: 'exchange', title: 'Exportar e importar', icon: 'lucide:arrow-down-up', description: 'Excel, ContaPlus y saldos de otro programa', details: 'Descarga recibos, saldos, morosos, facturas y el diario en CSV o para ContaPlus, e importa la deuda de cada propiedad desde otro programa.' },
		],
	},
];

export const financeSections = new Map(financeGroups.flatMap(group => group.sections).map(section => [section.key, section]));
