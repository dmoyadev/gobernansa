import type { RouteLocationNormalized, RouteRecordRaw } from 'vue-router';
import { createRouter, createWebHistory } from 'vue-router';
import { getCurrentUser } from 'vuefire';

export const routes: Array<RouteRecordRaw> = [
	{
		path: '/login',
		name: 'Login',
		component: async () => import('./modules/app/pages/LoginPage.vue'),
		meta: {
			title: 'Iniciar sesión',
			isPublic: true,
		},
	},

	{
		path: '/logout',
		name: 'Logout',
		component: async () => import('./modules/app/pages/LoginPage.vue'),
		meta: {
			title: 'Cerrar sesión',
			isPublic: true,
		},
		beforeEnter: (to) => {
			window.location.href = `/login${to.query?.redirect ? (`?redirect=${String(to.query.redirect)}`) : ''}`;
		},
	},

	{
		path: '/',
		name: 'Tabs',
		component: async () => import('./modules/app/components/TabsLayout.vue'),
		children: [
			{
				path: '/',
				name: 'Home',
				component: async () => import('./modules/app/pages/HomePage.vue'),
				meta: { title: '' },
			},
			{
				path: '/issues',
				children: [
					{
						path: '',
						name: 'Incidencias',
						component: async () => import('./modules/app/pages/IssuesPage.vue'),
						meta: { title: 'Incidencias' },
					},
					{
						path: 'new',
						name: 'Nueva incidencia',
						component: async () => import('./modules/app/pages/IssuesCreatePage.vue'),
						meta: { title: 'Nueva incidencia' },
					},
					{
						path: ':id',
						name: 'Detalle de incidencia',
						component: async () => import('./modules/app/pages/IssuesDetailPage.vue'),
						meta: { title: 'Detalle de incidencia' },
						props: true,
					}
				],
			},
			{
				path: '/neighborhood',
				name: 'Comunidad',
				component: async () => import('./modules/app/pages/NeighborhoodPage.vue'),
				meta: { title: 'Comunidad' },
			},
			{
				path: '/profile',
				name: 'Perfil',
				component: async () => import('./modules/app/pages/ProfilePage.vue'),
				meta: { title: 'Perfil' },
			},
		],
	},

	{
		path: '/:pathMatch(.*)*',
		name: 'NotFound',
		component: async () => import('./modules/app/pages/NotFoundPage.vue'),
		meta: {
			title: 'Not Found',
			isPublic: true,
		},
	},
];

const router = createRouter({
	history: createWebHistory(import.meta.env.BASE_URL),
	routes,
});

router.beforeEach(async (to) => {
	setDocumentTitle(to);
	const redirection = await checkAuth(to);
	return redirection || true;
});

/**
 * Set the document title with the app title as suffix and
 * adding the id to the title if it's a dynamic route.
 *
 * @param {RouteLocationNormalized} to - The route to which we are navigating
 */
function setDocumentTitle(to: RouteLocationNormalized) {
	const titleSuffix = import.meta.env.MODE !== 'production'
		? (` ${((import.meta.env.VITE_ENV_NAME as string | undefined) || import.meta.env.MODE).toUpperCase()}`)
		: '';
	document.title = `${to.meta?.title ? (`${String(to.meta.title)} | `) : ''}gobernança${titleSuffix}`;
}

export async function checkAuth(to: RouteLocationNormalized) {
	if (to.meta?.isPublic) return;

	const user = await getCurrentUser();
	if (!user) {
		return `/logout${to.name === 'Login' ? '' : `?unauthorized=${to.fullPath}`}`;
	}
}

export default router;