<script setup lang="ts">
import { BUTTON_MODES, BUTTON_VARIANTS, LnxButton, LnxIcon } from 'lnxjs-components';

const tabs = [
	{
		icon: 'mdi:view-dashboard',
		text: 'Inicio',
		route: '/',
	},
	{
		icon: 'mdi:home-warning',
		text: 'Incidencias',
		route: '/issues',
	},
	{
		icon: 'mdi:account-group',
		text: 'Comunidad',
		route: '/neighborhood',
	},
	{
		icon: 'mdi:user',
		text: 'Perfil',
		route: '/profile',
	},
];
</script>

<template>
	<RouterView />

	<nav>
		<LnxButton
			v-for="(tab, index) in tabs"
			:key="index"
			:to="tab.route"
			:variant="BUTTON_VARIANTS.GRAYSCALE"
			:mode="BUTTON_MODES.CLEAR"
		>
			<LnxIcon :icon="tab.icon" :size="24" />
		</LnxButton>
	</nav>
</template>

<style>
:root {
	--tab-height: 42px;
}
</style>

<style lang="scss" scoped>
nav {
	z-index: 100;
	position: fixed;
	bottom: 16px;
	left: 50%;
	transform: translate(-50%, 0);
	align-self: center;
	padding: 0 16px;
	border-radius: 80px;
	height: calc(var(--tab-height) + 16px);
	background: var(--color-secondary-alpha);
	backdrop-filter: blur(4px);
	box-shadow: 0 8px 8px -4px rgba(0, 0, 0, 0.2);
	display: flex;
	align-items: center;
	gap: 16px;

	a {
		flex: 1;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		font-weight: var(--font-weight-regular);

		&.router-link-exact-active {
			--lnx-button-color: var(--color-primary) !important;
		}

		span {
			font-size: var(--font-size-small);
		}
	}
}
</style>
