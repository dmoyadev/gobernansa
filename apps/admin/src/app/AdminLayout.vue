<script setup lang="ts">
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { managesCommunity } from '@gobernansa/shared/domain/user.ts';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useCommunityManagers } from '@/modules/people/application/usePeople.ts';

const route = useRoute();
const { user, logout } = useAuth();

// The profile is read after signing in. Missing, unreadable or a neighbour's (they use the webapp), the account can't use the admin.
// Pages marked `superadmin` are the team's, and each community's are for whoever manages it
const access = computed(() => {
	if (user.error.value || user.value === null || user.value?.role === 'user') {
		return 'denied';
	}
	if (!user.value) {
		return 'loading';
	}
	const { id } = route.params;
	if ((route.meta.superadmin && user.value.role !== 'superadmin') || (typeof id === 'string' && !managesCommunity(user.value, id))) {
		return 'forbidden';
	}
	return 'granted';
});

// Neighbours are told who can give them access
const managers = useCommunityManagers(() => user.value?.role === 'user' ? user.value.communityId : undefined);
</script>

<template>
	<header class="topbar">
		<RouterLink to="/" class="brand">
			<img src="@gobernansa/shared/assets/logo.svg" alt="gobernança" width="120" height="40">
			<span class="badge">Admin</span>
		</RouterLink>

		<nav v-if="access === 'granted' || access === 'forbidden'">
			<RouterLink to="/" title="Comunidades">
				<LnxIcon icon="lucide:building-2" :size="18" />
				Comunidades
			</RouterLink>
			<RouterLink to="/dashboard" title="Panel">
				<LnxIcon icon="lucide:chart-no-axes-column" :size="18" />
				Panel
			</RouterLink>
			<RouterLink to="/issues" title="Incidencias">
				<LnxIcon icon="lucide:inbox" :size="18" />
				Incidencias
			</RouterLink>
			<RouterLink to="/announcements" title="Comunicados">
				<LnxIcon icon="lucide:megaphone" :size="18" />
				Comunicados
			</RouterLink>
			<RouterLink to="/providers" title="Proveedores">
				<LnxIcon icon="lucide:hard-hat" :size="18" />
				Proveedores
			</RouterLink>
			<RouterLink v-if="user?.role === 'superadmin'" to="/admins" title="Administradores">
				<LnxIcon icon="lucide:shield-user" :size="18" />
				Administradores
			</RouterLink>
		</nav>

		<span v-if="user" class="user">{{ user.name || user.email }}</span>
		<LnxButton mode="clear" shape="circle" aria-label="Cerrar sesión" @click="logout()">
			<LnxIcon icon="lucide:log-out" />
		</LnxButton>
	</header>

	<main>
		<RouterView v-if="access === 'granted'" />

		<p v-else-if="access === 'loading'" class="status">
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

		<section v-else class="status">
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

.brand {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);

	.badge {
		padding: 2px var(--lnx-spacing-2);
		border-radius: var(--lnx-radius-5);
		background: var(--color-primary);
		color: var(--color-primary-accent);
		font-size: var(--lnx-font-size-legal);
		font-weight: var(--lnx-font-weight-bold);
		letter-spacing: .04em;
		text-transform: uppercase;
	}
}

nav {
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

main {
	max-width: 960px;
	margin: 0 auto;
	padding: var(--lnx-spacing-6) var(--lnx-spacing-5) var(--lnx-spacing-8);
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

// Seven sections don't fit with their names below desktop widths: icons only, the name stays for screen readers
@media (max-width: 1240px) {
	nav a {
		padding: var(--lnx-spacing-2);
		font-size: 0;
	}
}

// Certificates and minutes are printed (or saved as PDF) from their page, without the admin's frame
@media print {
	.topbar {
		display: none;
	}

	main {
		max-width: none;
		padding: 0;
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

	nav a {
		padding: var(--lnx-spacing-2);
		font-size: 0; // Icon only, the label stays for screen readers through the link's text
	}

	.user {
		display: none;
	}

	main {
		padding: var(--lnx-spacing-5) var(--lnx-spacing-4) var(--lnx-spacing-7);
	}
}
</style>
