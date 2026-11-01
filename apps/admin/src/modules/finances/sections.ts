export interface FinancePage {
	// Its route, /communities/:id/<key>
	key: string;
	title: string;
	description: string;
	// Its own in search, when not its section's
	icon?: string;
}

export interface FinanceSection {
	title: string;
	icon: string;
	// It opens on the first one. With more than one, each is a tab of the section
	pages: FinancePage[];
}

// The community's finance pages by what they're for: the groups and sections of the Finanzas nav, and its tabs
export const financeGroups: { title: string; sections: FinanceSection[] }[] = [
	{
		title: 'Cobros',
		sections: [
			{
				title: 'Recibos',
				icon: 'lucide:receipt-text',
				pages: [
					{ key: 'charges', title: 'Recibos', description: 'Cuotas, derramas y certificados' },
					{ key: 'statements', title: 'Estados de cuenta', description: 'Cargos, abonos y saldo por propietario', icon: 'lucide:scroll-text' },
					{ key: 'arrears', title: 'Morosidad', description: 'Antigüedad de la deuda, reclamaciones, burofax y monitorio', icon: 'lucide:mail-warning' },
				],
			},
			{
				title: 'Domiciliaciones',
				icon: 'lucide:landmark',
				pages: [
					{ key: 'mandates', title: 'Mandatos SEPA', description: 'Domiciliaciones por propiedad', icon: 'lucide:file-signature' },
					{ key: 'remittances', title: 'Remesas', description: 'Recibos domiciliados, fichero SEPA y devoluciones' },
				],
			},
		],
	},
	{
		title: 'Gastos',
		sections: [
			{
				title: 'Presupuesto',
				icon: 'lucide:chart-pie',
				pages: [
					{ key: 'budget', title: 'Presupuesto', description: 'Partidas, gastos, facturas y reparto' },
					{ key: 'fees', title: 'Cuotas y fondo de reserva', description: 'Cuotas del año desde el presupuesto', icon: 'lucide:calendar-sync' },
				],
			},
			{
				title: 'Facturas y pagos',
				icon: 'lucide:file-clock',
				pages: [
					{ key: 'payables', title: 'Facturas pendientes', description: 'Facturas de proveedores por pagar' },
					{ key: 'payments', title: 'Pagos a proveedores', description: 'Transferencias SEPA de las facturas', icon: 'lucide:send' },
				],
			},
		],
	},
	{
		title: 'Banco',
		sections: [
			{ title: 'Conciliación bancaria', icon: 'lucide:arrow-left-right', pages: [{ key: 'bank', title: 'Conciliación bancaria', description: 'Extractos (Norma 43 o CSV) y movimientos del banco' }] },
		],
	},
	{
		title: 'Contabilidad',
		sections: [
			{ title: 'Contabilidad', icon: 'lucide:book-open-check', pages: [{ key: 'accounting', title: 'Contabilidad', description: 'Diario, mayor, balances y cierre' }] },
			{ title: 'Liquidación', icon: 'lucide:file-chart-column', pages: [{ key: 'annual-report', title: 'Liquidación del ejercicio', description: 'Cuentas del año para la junta' }] },
			{ title: 'Modelos fiscales', icon: 'lucide:file-badge', pages: [{ key: 'taxes', title: 'Modelos fiscales', description: '347, 111, 190 y 184 para la AEAT' }] },
			{ title: 'Exportar e importar', icon: 'lucide:arrow-down-up', pages: [{ key: 'exchange', title: 'Exportar e importar', description: 'Excel, ContaPlus y saldos de otro programa' }] },
		],
	},
];

// Each page's section, by its key: what a route's meta.finance names
export const financeSectionOf = new Map(financeGroups.flatMap(group => group.sections).flatMap(section => section.pages.map(page => [page.key, section])));

// The sections as the nav lists them, the summary first
const sectionOrder = financeGroups.flatMap(group => group.sections);

// How the page moves from one finance page to another: sideways within a section's tabs (back when to an earlier one), otherwise
// down or up as their sections are in the nav
export function financeMove(from: string, to: string) {
	const [previous, next] = [financeSectionOf.get(from), financeSectionOf.get(to)];
	if (previous && previous === next) {
		const index = (key: string) => next.pages.findIndex(page => page.key === key);
		return index(to) < index(from) ? 'back' : 'forward';
	}
	const position = (section?: FinanceSection) => section ? sectionOrder.indexOf(section) : -1;
	return position(next) < position(previous) ? 'up' : 'down';
}
