import type { RouteLocationNormalized } from 'vue-router';
import { createRouter, createWebHistory } from 'vue-router';
import { getCurrentUser } from 'vuefire';

const router = createRouter({
	history: createWebHistory(import.meta.env.BASE_URL),
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
					meta: { title: 'Vecinos y gestores' },
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
					name: 'Notificaciones',
					component: async () => import('@/modules/notifications/ui/NotificationsPage.vue'),
					meta: { title: 'Notificaciones' },
					props: true,
				},
				{
					path: 'communities/:id/properties',
					name: 'Propiedades',
					component: async () => import('@/modules/properties/ui/PropertiesPage.vue'),
					meta: { title: 'Propiedades' },
					props: true,
				},
				{
					path: 'communities/:id/people/:uid/documents',
					name: 'Documentos del vecino',
					component: async () => import('@/modules/people/ui/PersonDocumentsPage.vue'),
					meta: { title: 'Documentos del vecino' },
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
					path: 'communities/:id/charges',
					name: 'Recibos y morosidad',
					component: async () => import('@/modules/finances/ui/ChargesPage.vue'),
					meta: { title: 'Recibos y morosidad' },
					props: true,
				},
				{
					path: 'communities/:id/charges/certificate/:propertyId',
					name: 'Certificado de pagos',
					component: async () => import('@/modules/finances/ui/CertificatePage.vue'),
					meta: { title: 'Certificado de pagos' },
					props: true,
				},
				{
					path: 'communities/:id/budget',
					name: 'Presupuesto',
					component: async () => import('@/modules/finances/ui/BudgetPage.vue'),
					meta: { title: 'Presupuesto' },
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
					path: 'communities/:id/bookings',
					name: 'Reservas',
					component: async () => import('@/modules/bookings/ui/BookingsPage.vue'),
					meta: { title: 'Reservas' },
					props: true,
				},
				{
					path: 'communities/:id/activity',
					name: 'Registro de actividad',
					component: async () => import('@/modules/activity/ui/ActivityPage.vue'),
					meta: { title: 'Registro de actividad' },
					props: true,
				},
				{
					path: 'communities/:id/:section(info|contacts|documents|locations|finances)',
					name: 'Editar comunidad',
					component: async () => import('@/modules/communities/ui/CommunityFormPage.vue'),
					meta: { title: 'Editar comunidad' },
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
