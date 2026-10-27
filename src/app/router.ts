import type { RouteLocationNormalized, RouteRecordRaw } from 'vue-router';
import { nextTick } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import { getCurrentUser } from 'vuefire';

export const routes: Array<RouteRecordRaw> = [
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
		path: '/logout',
		name: 'Logout',
		component: async () => import('@/modules/auth/ui/LoginPage.vue'),
		meta: {
			title: 'Cerrar sesión',
			isPublic: true,
		},
		beforeEnter: (to) => {
			const unauthorized = to.query?.unauthorized;
			window.location.href = `/login${unauthorized ? `?${new URLSearchParams({ unauthorized: String(unauthorized) }).toString()}` : ''}`;
		},
	},

	{
		path: '/',
		name: 'Tabs',
		component: async () => import('./TabsLayout.vue'),
		children: [
			{
				path: '/',
				name: 'Home',
				component: async () => import('./HomePage.vue'),
				meta: { title: '' },
			},
			{
				path: '/issues',
				children: [
					{
						path: '',
						name: 'Incidencias',
						component: async () => import('@/modules/issues/ui/IssuesPage.vue'),
						meta: { title: 'Incidencias' },
					},
					{
						path: 'new',
						name: 'Nueva incidencia',
						component: async () => import('@/modules/issues/ui/IssuesCreatePage.vue'),
						meta: { title: 'Nueva incidencia' },
					},
					{
						path: ':id',
						name: 'Detalle de incidencia',
						component: async () => import('@/modules/issues/ui/IssuesDetailPage.vue'),
						meta: { title: 'Detalle de incidencia' },
						props: true,
					},
				],
			},
			{
				path: '/neighborhood',
				children: [
					{
						path: '',
						name: 'Comunidad',
						component: async () => import('@/modules/community/ui/CommunityPage.vue'),
						meta: { title: 'Comunidad' },
					},
					{
						path: 'timeline',
						name: 'Cronograma',
						component: async () => import('@/modules/events/ui/TimelinePage.vue'),
						meta: { title: 'Cronograma' },
					},
				],
			},
			{
				path: '/profile',
				name: 'Perfil',
				component: async () => import('@/modules/auth/ui/ProfilePage.vue'),
				meta: { title: 'Perfil' },
			},
		],
	},

	{
		path: '/:pathMatch(.*)*',
		name: 'NotFound',
		component: async () => import('./NotFoundPage.vue'),
		meta: {
			title: 'Not Found',
			isPublic: true,
		},
	},
];

// Safari animates its own swipe-back gesture, so running ours too would play the page change twice.
// Registered before the router's own listener, which may run the navigation guards before ours runs
let browserAnimatedNavigation = false;
window.addEventListener('popstate', (event) => {
	browserAnimatedNavigation = event.hasUAVisualTransition;
});

const router = createRouter({
	history: createWebHistory(import.meta.env.BASE_URL),
	routes,
	// Going back restores where the page was, so the issue just closed is in view
	scrollBehavior: (_to, _from, savedPosition) => savedPosition ?? { top: 0 },
});

router.beforeEach(async (to) => {
	setDocumentTitle(to);
	const redirection = await checkAuth(to);
	return redirection || true;
});

/*
 * Animate page changes with the View Transitions API. The transition snapshots the old page,
 * then waits until the navigation has rendered the new one, so it must always be released:
 * the browser freezes rendering while it waits.
 */
let finishViewTransition: (() => void) | undefined;

function releaseViewTransition() {
	finishViewTransition?.();
	finishViewTransition = undefined;
}

router.beforeResolve(async (to, from) => {
	releaseViewTransition();
	const skip = browserAnimatedNavigation;
	browserAnimatedNavigation = false;
	// Also skips the first load and query-only changes
	if (skip || !('startViewTransition' in document) || !from.matched.length || to.path === from.path) {
		return;
	}

	document.documentElement.dataset.transition = getTransitionDirection(to, from);
	await new Promise<void>((resolve) => {
		const transition = document.startViewTransition(async () => new Promise<void>((done) => {
			finishViewTransition = done;
			resolve();
		}));
		const cleanUp = () => delete document.documentElement.dataset.transition;
		// A skipped transition (e.g. hidden tab) may never run its update, so it must not block the navigation
		transition.ready.catch(() => {
			cleanUp();
			resolve();
		});
		void transition.finished.finally(cleanUp);
	});
});

router.afterEach(async () => {
	await nextTick();
	releaseViewTransition();
});
router.onError(releaseViewTransition);

// The tab bar lists the sections in the same order as these routes
const tabSections = routes
	.find(route => route.name === 'Tabs')
	?.children
	?.map(route => route.path.split('/')[1]) ?? [];

/**
 * Switching tabs slides the whole page towards the tab's side, going deeper inside a
 * section (list → detail) slides forward, coming back slides back, and anything else fades.
 *
 * @param {RouteLocationNormalized} to - The route to which we are navigating
 * @param {RouteLocationNormalized} from - The route we are leaving
 */
function getTransitionDirection(to: RouteLocationNormalized, from: RouteLocationNormalized) {
	const toSection = to.path.split('/')[1];
	const fromSection = from.path.split('/')[1];
	if (toSection !== fromSection) {
		const toTab = tabSections.indexOf(toSection);
		const fromTab = tabSections.indexOf(fromSection);
		if (toTab === -1 || fromTab === -1) {
			return 'fade';
		}

		return toTab > fromTab ? 'tab-forward' : 'tab-back';
	}

	const toDepth = to.path.split('/').filter(Boolean).length;
	const fromDepth = from.path.split('/').filter(Boolean).length;
	if (toDepth === fromDepth) {
		return 'fade';
	}

	return toDepth > fromDepth ? 'forward' : 'back';
}

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
	if (to.meta?.isPublic) {
		return;
	}

	const user = await getCurrentUser();
	if (!user) {
		return { path: '/logout', query: { unauthorized: to.fullPath } };
	}
}

export default router;
