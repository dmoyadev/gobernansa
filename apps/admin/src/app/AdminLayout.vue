<script setup lang="ts">
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed } from 'vue';

const { user, logout } = useAuth();

// The profile is read after signing in. Missing or unreadable, the account can't be an administrator's. Neighbours use the webapp
const access = computed(() => {
	if (user.error.value || user.value === null) {
		return 'denied';
	}
	if (!user.value) {
		return 'loading';
	}
	return user.value.role === 'user' ? 'denied' : 'granted';
});
</script>

<template>
	<header class="topbar">
		<RouterLink to="/" class="brand">
			<img src="@gobernansa/shared/assets/logo.svg" alt="gobernança" width="120" height="40">
			<span class="badge">Admin</span>
		</RouterLink>

		<nav v-if="access === 'granted'">
			<RouterLink to="/">
				<LnxIcon icon="lucide:building-2" :size="18" />
				Comunidades
			</RouterLink>
			<RouterLink v-if="user?.role === 'superadmin'" to="/admins">
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

		<section v-else class="status">
			<LnxIcon icon="lucide:shield-x" :size="40" />
			<h1>Sin acceso</h1>
			<p>Tu cuenta no tiene permisos de administración. Si crees que es un error, pide acceso al equipo de gobernança.</p>
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

		&.router-link-active {
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
