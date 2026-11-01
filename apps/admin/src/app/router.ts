import type { RouteLocationNormalized } from 'vue-router';
import { createRouter, createWebHistory } from 'vue-router';
import { getCurrentUser } from 'vuefire';

const router = createRouter({
	history: createWebHistory(import.meta.env.BASE_URL),
	// Back and forward return to where the page was left, a new page starts at its top
	scrollBehavior: (to, from, savedPosition) => savedPosition ?? (to.path === from.path ? undefined : { top: 0 }),
	routes: [
		{
			path: '/login',
			name: 'Login',
			component: async () => import('@/modules/auth/ui/LoginPage.vue'),
			meta: {
				title: 'Iniciar sesión',
				isPublic: true,
			},
		},

		{
			path: '/',
			component: async () => import('./AdminLayout.vue'),
			children: [
				{
					path: '',
					name: 'Comunidades',
					component: async () => import('@/modules/communities/ui/CommunitiesPage.vue'),
					meta: { title: 'Comunidades' },
				},
				{
					path: 'communities/new',
					name: 'Nueva comunidad',
					component: async () => import('@/modules/communities/ui/CommunityFormPage.vue'),
					meta: { title: 'Nueva comunidad', superadmin: true },
				},
				{
					path: 'communities/:id',
					name: 'Comunidad',
					component: async () => import('@/modules/communities/ui/CommunityPage.vue'),
					meta: { title: 'Comunidad' },
					props: true,
				},
				{
					path: 'communities/:id/people',
					name: 'Vecinos y gestores',
					component: async () => import('@/modules/people/ui/PeoplePage.vue'),
					meta: { title: 'Vecinos y gestores', workspace: 'neighbours', page: 'people' },
					props: true,
				},
				{
					path: 'communities/:id/issues',
					name: 'Incidencias',
					component: async () => import('@/modules/issues/ui/IssuesPage.vue'),
					meta: { title: 'Incidencias' },
					props: true,
				},
				{
					path: 'communities/:id/issues/:issueId',
					name: 'Incidencia',
					component: async () => import('@/modules/issues/ui/IssuePage.vue'),
					meta: { title: 'Incidencia' },
					props: true,
				},
				{
					path: 'communities/:id/notifications',
					name: 'Avisos',
					component: async () => import('@/modules/notifications/ui/NotificationsPage.vue'),
					meta: { title: 'Avisos' },
					props: true,
				},
				{
					path: 'communities/:id/properties',
					name: 'Propiedades',
					component: async () => import('@/modules/properties/ui/PropertiesPage.vue'),
					meta: { title: 'Propiedades', workspace: 'neighbours', page: 'properties' },
					props: true,
				},
				{
					path: 'communities/:id/people/:uid/documents',
					name: 'Documentos del vecino',
					component: async () => import('@/modules/people/ui/PersonDocumentsPage.vue'),
					meta: { title: 'Documentos del vecino', workspace: 'neighbours', page: 'people' },
					props: true,
				},
				{
					path: 'communities/:id/meetings',
					name: 'Juntas',
					component: async () => import('@/modules/meetings/ui/MeetingsPage.vue'),
					meta: { title: 'Juntas' },
					props: true,
				},
				{
					path: 'communities/:id/meetings/:meetingId',
					name: 'Junta',
					component: async () => import('@/modules/meetings/ui/MeetingPage.vue'),
					meta: { title: 'Junta' },
					props: true,
				},
				{
					path: 'communities/:id/finances',
					name: 'Finanzas',
					component: async () => import('@/modules/finances/ui/FinancesPage.vue'),
					meta: { title: 'Finanzas', workspace: 'finances', page: 'finances' },
					props: true,
				},
				{
					path: 'communities/:id/charges',
					name: 'Recibos',
					component: async () => import('@/modules/finances/ui/ChargesPage.vue'),
					meta: { title: 'Recibos', workspace: 'finances', page: 'charges' },
					props: true,
				},
				{
					path: 'communities/:id/charges/certificate/:propertyId',
					name: 'Certificado de pagos',
					component: async () => import('@/modules/finances/ui/CertificatePage.vue'),
					meta: { title: 'Certificado de pagos', workspace: 'finances', page: 'charges' },
					props: true,
				},
				{
					path: 'communities/:id/arrears',
					name: 'Morosidad',
					component: async () => import('@/modules/finances/ui/ArrearsPage.vue'),
					meta: { title: 'Morosidad', workspace: 'finances', page: 'arrears' },
					props: true,
				},
				{
					path: 'communities/:id/arrears/:propertyId/claim',
					name: 'Carta de reclamación',
					component: async () => import('@/modules/finances/ui/ClaimPage.vue'),
					meta: { title: 'Carta de reclamación', workspace: 'finances', page: 'arrears' },
					props: true,
				},
				{
					path: 'communities/:id/arrears/:propertyId/monitorio',
					name: 'Procedimiento monitorio',
					component: async () => import('@/modules/finances/ui/MonitorioPage.vue'),
					meta: { title: 'Procedimiento monitorio', workspace: 'finances', page: 'arrears' },
					props: true,
				},
				{
					path: 'communities/:id/budget',
					name: 'Presupuesto',
					component: async () => import('@/modules/finances/ui/BudgetPage.vue'),
					meta: { title: 'Presupuesto', workspace: 'finances', page: 'budget' },
					props: true,
				},
				{
					path: 'communities/:id/fees',
					name: 'Cuotas y fondo de reserva',
					component: async () => import('@/modules/finances/ui/FeesPage.vue'),
					meta: { title: 'Cuotas y fondo de reserva', workspace: 'finances', page: 'fees' },
					props: true,
				},
				{
					path: 'communities/:id/statements',
					name: 'Estados de cuenta',
					component: async () => import('@/modules/finances/ui/StatementsPage.vue'),
					meta: { title: 'Estados de cuenta', workspace: 'finances', page: 'statements' },
					props: true,
				},
				{
					path: 'communities/:id/statements/:propertyId',
					name: 'Estado de cuenta',
					component: async () => import('@/modules/finances/ui/StatementPage.vue'),
					meta: { title: 'Estado de cuenta', workspace: 'finances', page: 'statements' },
					props: true,
				},
				{
					path: 'communities/:id/payables',
					name: 'Facturas pendientes',
					component: async () => import('@/modules/finances/ui/PayablesPage.vue'),
					meta: { title: 'Facturas pendientes', workspace: 'finances', page: 'payables' },
					props: true,
				},
				{
					path: 'communities/:id/payments',
					name: 'Pagos a proveedores',
					component: async () => import('@/modules/finances/ui/PaymentsPage.vue'),
					meta: { title: 'Pagos a proveedores', workspace: 'finances', page: 'payments' },
					props: true,
				},
				{
					path: 'communities/:id/bank',
					name: 'Conciliación bancaria',
					component: async () => import('@/modules/finances/ui/BankPage.vue'),
					meta: { title: 'Conciliación bancaria', workspace: 'finances', page: 'bank' },
					props: true,
				},
				{
					path: 'communities/:id/accounting',
					name: 'Contabilidad',
					component: async () => import('@/modules/finances/ui/AccountingPage.vue'),
					meta: { title: 'Contabilidad', workspace: 'finances', page: 'accounting' },
					props: true,
				},
				{
					path: 'communities/:id/annual-report',
					name: 'Liquidación del ejercicio',
					component: async () => import('@/modules/finances/ui/AnnualReportPage.vue'),
					meta: { title: 'Liquidación del ejercicio', workspace: 'finances', page: 'annual-report' },
					props: true,
				},
				{
					path: 'communities/:id/taxes',
					name: 'Modelos fiscales',
					component: async () => import('@/modules/finances/ui/TaxesPage.vue'),
					meta: { title: 'Modelos fiscales', workspace: 'finances', page: 'taxes' },
					props: true,
				},
				{
					path: 'communities/:id/exchange',
					name: 'Exportar e importar',
					component: async () => import('@/modules/finances/ui/ExchangePage.vue'),
					meta: { title: 'Exportar e importar', workspace: 'finances', page: 'exchange' },
					props: true,
				},
				{
					path: 'communities/:id/mandates',
					name: 'Mandatos SEPA',
					component: async () => import('@/modules/finances/ui/MandatesPage.vue'),
					meta: { title: 'Mandatos SEPA', workspace: 'finances', page: 'mandates' },
					props: true,
				},
				{
					path: 'communities/:id/remittances',
					name: 'Remesas',
					component: async () => import('@/modules/finances/ui/RemittancesPage.vue'),
					meta: { title: 'Remesas', workspace: 'finances', page: 'remittances' },
					props: true,
				},
				{
					path: 'communities/:id/obligations',
					name: 'Obligaciones',
					component: async () => import('@/modules/obligations/ui/ObligationsPage.vue'),
					meta: { title: 'Obligaciones' },
					props: true,
				},
				{
					path: 'communities/:id/locations',
					name: 'Zonas comunes',
					component: async () => import('@/modules/bookings/ui/CommonAreasPage.vue'),
					meta: { title: 'Zonas comunes' },
					props: true,
				},
				{
					path: 'communities/:id/locations/:areaId',
					name: 'Reservas',
					component: async () => import('@/modules/bookings/ui/BookingsPage.vue'),
					meta: { title: 'Reservas' },
					props: true,
				},
				// Older links, from the activity log or bookmarks, to the pages merged into others
				{ path: 'communities/:id/bookings', redirect: to => `/communities/${to.params.id as string}/locations` },
				{
					path: 'communities/:id/activity',
					name: 'Registro de actividad',
					component: async () => import('@/modules/activity/ui/ActivityPage.vue'),
					meta: { title: 'Registro de actividad' },
					props: true,
				},
				{
					path: 'communities/:id/:section(info|contacts|documents|settings)',
					name: 'Editar comunidad',
					component: async () => import('@/modules/communities/ui/CommunityFormPage.vue'),
					meta: { title: 'Editar comunidad', workspace: 'community' },
					props: true,
				},
				{
					path: 'dashboard',
					name: 'Panel',
					component: async () => import('@/modules/portfolio/ui/DashboardPage.vue'),
					meta: { title: 'Panel de cartera' },
				},
				{
					path: 'issues',
					name: 'Bandeja de incidencias',
					component: async () => import('@/modules/portfolio/ui/InboxPage.vue'),
					meta: { title: 'Bandeja de incidencias' },
				},
				{
					path: 'announcements',
					name: 'Comunicados',
					component: async () => import('@/modules/announcements/ui/AnnouncementsPage.vue'),
					meta: { title: 'Comunicados' },
				},
				{
					path: 'providers',
					name: 'Proveedores',
					component: async () => import('@/modules/providers/ui/ProvidersPage.vue'),
					meta: { title: 'Proveedores' },
				},
				{
					path: 'billing',
					name: 'Honorarios',
					component: async () => import('@/modules/billing/ui/BillingPage.vue'),
					meta: { title: 'Honorarios', office: true },
				},
				{
					path: 'billing/new',
					name: 'Nueva factura',
					component: async () => import('@/modules/billing/ui/InvoiceFormPage.vue'),
					meta: { title: 'Nueva factura', office: true },
				},
				{
					path: 'billing/office',
					name: 'Datos fiscales del despacho',
					component: async () => import('@/modules/billing/ui/OfficePage.vue'),
					meta: { title: 'Datos fiscales del despacho', office: true },
				},
				{
					path: 'billing/registry',
					name: 'Registro Verifactu',
					component: async () => import('@/modules/billing/ui/RegistryPage.vue'),
					meta: { title: 'Registro Verifactu', office: true },
				},
				{
					path: 'billing/:invoiceId/rectify',
					name: 'Factura rectificativa',
					component: async () => import('@/modules/billing/ui/InvoiceFormPage.vue'),
					meta: { title: 'Factura rectificativa', office: true },
					props: true,
				},
				{
					path: 'billing/:invoiceId',
					name: 'Factura de honorarios',
					component: async () => import('@/modules/billing/ui/InvoicePage.vue'),
					meta: { title: 'Factura de honorarios', office: true },
					props: true,
				},
				{
					path: 'admins',
					name: 'Administradores',
					component: async () => import('@/modules/people/ui/PeoplePage.vue'),
					meta: { title: 'Administradores', superadmin: true },
				},
			],
		},

		{
			path: '/:pathMatch(.*)*',
			redirect: '/',
		},
	],
});

router.beforeEach(async (to) => {
	setDocumentTitle(to);
	const redirection = await checkAuth(to);
	return redirection || true;
});

function setDocumentTitle(to: RouteLocationNormalized) {
	const titleSuffix = import.meta.env.MODE !== 'production'
		? (` ${((import.meta.env.VITE_ENV_NAME as string | undefined) || import.meta.env.MODE).toUpperCase()}`)
		: '';
	document.title = `${to.meta?.title ? (`${String(to.meta.title)} | `) : ''}gobernança admin${titleSuffix}`;
}

// Only checks there's a session: what its profile may open (`superadmin` pages, each community's) is checked by the layout, and enforced by the security rules
async function checkAuth(to: RouteLocationNormalized) {
	if (to.meta?.isPublic) {
		return;
	}

	const user = await getCurrentUser();
	if (!user) {
		return { path: '/login', query: { redirect: to.fullPath } };
	}
}

export default router;
