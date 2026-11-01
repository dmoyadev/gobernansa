<script setup lang="ts">
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { managesCommunity } from '@gobernansa/shared/domain/user.ts';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed, useTemplateRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useCommunityManagers } from '@/modules/people/application/usePeople.ts';
import { useSearchHighlight } from './useSearchHighlight.ts';
import { shortcutTitle, useShortcut } from './ux/shortcuts.ts';
import Toaster from './ux/Toaster.vue';
import WorkspaceNav from './workspace/WorkspaceNav.vue';
import { workspaceMove, workspacePage } from './workspace/workspaces.ts';
import WorkspaceTabs from './workspace/WorkspaceTabs.vue';

const route = useRoute();
const { user, logout } = useAuth();

// The profile is read after signing in. Missing, unreadable or a neighbour's (they use the webapp), the account can't use the admin.
// Pages marked `superadmin` are the team's, `office` ones the administrators' (not managers'), and each community's are for whoever manages it
const access = computed(() => {
	if (user.error.value || user.value === null || user.value?.role === 'user') {
		return 'denied';
	}
	if (!user.value) {
		return 'loading';
	}
	const { id } = route.params;
	if ((route.meta.superadmin && user.value.role !== 'superadmin') || (route.meta.office && user.value.role === 'manager') || (typeof id === 'string' && !managesCommunity(user.value, id))) {
		return 'forbidden';
	}
	return 'granted';
});

// Neighbours are told who can give them access
const managers = useCommunityManagers(() => user.value?.role === 'user' ? user.value.communityId : undefined);

// Search results open their page with the text they matched highlighted
useSearchHighlight(useTemplateRef('content'));

// Pages of a workspace (meta.workspace, workspaces.ts) have its nav beside them, mounted while moving between them
const current = computed(() => access.value === 'granted' ? workspacePage(route) : undefined);
// Which way the page moves between two of the same workspace, for the transition (interactions.scss): a section's tabs
// sideways, otherwise down or up the nav. Set before the old page is captured
const router = useRouter();
router.beforeEach((to, from) => {
	const [next, previous] = [to, from].map(workspacePage);
	const move = next && previous && next.workspace === previous.workspace && next.page !== previous.page
		? workspaceMove(next.workspace, previous.page, next.page)
		: undefined;
	if (move) {
		document.documentElement.dataset.workspaceMove = move;
	} else {
		delete document.documentElement.dataset.workspaceMove;
	}
});

// G then a letter goes to each section, as in other tools
const SECTIONS = [
	{ to: '/', label: 'Comunidades', icon: 'lucide:building-2', combo: 'g c' },
	{ to: '/dashboard', label: 'Panel', icon: 'lucide:chart-no-axes-column', combo: 'g d' },
	{ to: '/issues', label: 'Incidencias', icon: 'lucide:inbox', combo: 'g i' },
	{ to: '/announcements', label: 'Comunicados', icon: 'lucide:megaphone', combo: 'g m' },
	{ to: '/providers', label: 'Proveedores', icon: 'lucide:hard-hat', combo: 'g p' },
	{ to: '/billing', label: 'Honorarios', icon: 'lucide:receipt-text', combo: 'g f', office: true },
	{ to: '/admins', label: 'Administradores', icon: 'lucide:shield-user', combo: 'g a', superadmin: true },
];
const sections = computed(() => SECTIONS.filter(section => (!section.superadmin || user.value?.role === 'superadmin') && (!section.office || user.value?.role !== 'manager')));
for (const section of SECTIONS) {
	useShortcut(section.combo, () => {
		if (sections.value.includes(section) && access.value !== 'loading' && access.value !== 'denied') {
			void router.push(section.to);
		}
	}, `Ir a ${section.label.toLowerCase()}`);
}

// Pages already visited are kept, with their data and scroll, so going back to them is instant.
// ponytail: their live listeners keep running (and reading on changes) while hidden; lower this if reads grow
const KEPT_PAGES = 6;
</script>

<template>
	<header class="topbar">
		<RouterLink to="/">
			<img src="@gobernansa/shared/assets/logo.svg" alt="gobernança" width="120" height="40">
		</RouterLink>

		<nav v-if="access === 'granted' || access === 'forbidden'" aria-label="Principal">
			<RouterLink v-for="section in sections" :key="section.to" :to="section.to" :title="shortcutTitle(section.label, section.combo)">
				<LnxIcon :icon="section.icon" :size="18" />
				{{ section.label }}
			</RouterLink>
		</nav>

		<span v-if="user" class="user">{{ user.name || user.email }}</span>
		<LnxButton mode="clear" shape="circle" aria-label="Cerrar sesión" title="Cerrar sesión" @click="logout()">
			<LnxIcon icon="lucide:log-out" />
		</LnxButton>
	</header>

	<!-- The workspace's nav beside main, not in it: main holds only the page -->
	<div class="frame" :class="{ workspace: current }">
		<WorkspaceNav v-if="current" :key="current.workspace.title" :workspace="current.workspace" :page="current.page" />
		<main ref="content">
			<WorkspaceTabs v-if="current" :workspace="current.workspace" :page="current.page" />
			<!-- Always there, so a page without access in between doesn't throw away the kept ones. The community form isn't
				kept: each section saves the whole community, and a kept one would write back the others' old values -->
			<RouterView v-slot="{ Component, route: page }">
				<KeepAlive :max="KEPT_PAGES" exclude="CommunityFormPage">
					<component :is="Component" v-if="access === 'granted'" :key="page.path" />
				</KeepAlive>
			</RouterView>

			<p v-if="access === 'loading'" class="status">
				<span class="skeleton-item" />
			</p>

			<section v-else-if="access === 'forbidden'" class="status">
				<LnxIcon icon="lucide:shield-x" :size="40" />
				<h1>Sin acceso</h1>
				<p>No tienes permisos para ver esta página.</p>
				<LnxButton to="/" mode="outline">
					<LnxIcon icon="lucide:arrow-left" />
					Volver a comunidades
				</LnxButton>
			</section>

			<section v-else-if="access === 'denied'" class="status">
				<LnxIcon icon="lucide:shield-x" :size="40" />
				<h1>Sin acceso</h1>
				<template v-if="managers.length">
					<p>Tu cuenta no tiene permisos de administración. Si los necesitas, pídeselos a:</p>
					<ul class="managers">
						<li v-for="person in managers" :key="person.email">
							<strong>{{ person.name }}</strong>
							<a :href="`mailto:${person.email}`">{{ person.email }}</a>
						</li>
					</ul>
				</template>
				<p v-else>
					Tu cuenta no tiene permisos de administración. Si crees que es un error, pide acceso al equipo de gobernança.
				</p>
				<LnxButton mode="outline" @click="logout()">
					<LnxIcon icon="lucide:log-out" />
					Cerrar sesión
				</LnxButton>
			</section>
		</main>
	</div>

	<Toaster />
</template>

<style lang="scss" scoped>
.topbar {
	position: sticky;
	top: 0;
	z-index: 10;
	height: 64px;
	padding: 0 var(--lnx-spacing-5);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-5);
	background: var(--color-gray-0);
	box-shadow: 0 1px 0 var(--color-gray-3);
}

.topbar nav {
	flex: 1;
	display: flex;
	gap: var(--lnx-spacing-2);

	a {
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-2);
		padding: var(--lnx-spacing-2) var(--lnx-spacing-3);
		border-radius: var(--lnx-radius-3);
		color: var(--color-gray-7);
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
		text-decoration: none;

		&:hover {
			background: var(--color-gray-1);
			color: var(--color-gray-9);
		}

		&:active {
			scale: var(--press-scale);
		}

		&.router-link-exact-active,
		&.router-link-active:not([href="/"]) {
			background: var(--color-gray-2);
			color: var(--color-primary);
		}
	}
}

.user {
	margin-left: auto;
	overflow: hidden;
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
	white-space: nowrap;
	text-overflow: ellipsis;
}

.frame {
	max-width: 960px;
	margin: 0 auto;
	padding: var(--lnx-spacing-6) var(--lnx-spacing-5) var(--lnx-spacing-8);

	// The nav on the left, the page as wide as the others
	&.workspace {
		max-width: calc(960px + 220px + var(--lnx-spacing-6));
		display: grid;
		grid-template-columns: 220px minmax(0, 1fr);
		align-items: start;
		gap: var(--lnx-spacing-6);
	}
}

.status {
	max-width: 420px;
	margin: var(--lnx-spacing-8) auto 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: var(--lnx-spacing-3);
	text-align: center;
	color: var(--color-gray-7);
}

.managers {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);

	li {
		display: flex;
		flex-direction: column;
	}

	a {
		color: var(--color-primary);
		font-size: var(--lnx-font-size-small);
		overflow-wrap: anywhere;
	}
}

// Eight sections don't fit with their names below desktop widths: icons only, the name stays for screen readers
@media (max-width: 1240px) {
	.topbar nav a {
		padding: var(--lnx-spacing-2);
		font-size: 0;
	}

	.frame.workspace {
		grid-template-columns: 180px minmax(0, 1fr);
		gap: var(--lnx-spacing-5);
	}
}

// Below this the page beside the nav gets too narrow for the wide tables: the nav as a strip above it
@media (max-width: 900px) {
	.frame.workspace {
		grid-template-columns: minmax(0, 1fr);
		gap: var(--lnx-spacing-4);
	}
}

// Certificates and minutes are printed (or saved as PDF) from their page, without the admin's frame
@media print {
	.topbar {
		display: none;
	}

	.frame,
	.frame.workspace {
		max-width: none;
		padding: 0;
		display: block;
	}
}

@media (max-width: 640px) {
	.topbar {
		padding: 0 var(--lnx-spacing-4);
		gap: var(--lnx-spacing-3);
	}

	.brand img {
		width: 96px;
	}

	.topbar nav a {
		padding: var(--lnx-spacing-2);
		font-size: 0; // Icon only, the label stays for screen readers through the link's text
	}

	.user {
		display: none;
	}

	.frame {
		padding: var(--lnx-spacing-5) var(--lnx-spacing-4) var(--lnx-spacing-7);
	}
}
</style>

<style lang="scss">
// Not scoped: it styles text of any page, marked by useSearchHighlight
::highlight(search) {
	background: #fde68a;
	color: inherit;
}
</style>
