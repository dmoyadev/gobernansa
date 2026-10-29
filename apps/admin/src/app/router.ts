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
					meta: { title: 'Nueva comunidad' },
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
					path: 'communities/:id/:section(info|contacts|documents|locations|finances)',
					name: 'Editar comunidad',
					component: async () => import('@/modules/communities/ui/CommunityFormPage.vue'),
					meta: { title: 'Editar comunidad' },
					props: true,
				},
				{
					path: 'admins',
					name: 'Administradores',
					component: async () => import('@/modules/people/ui/PeoplePage.vue'),
					meta: { title: 'Administradores' },
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

// Only checks there's a session: whether it's an administrator's is checked by the layout, and enforced by the security rules
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
