<script setup lang="ts">
import { BUTTON_MODES, BUTTON_SHAPES, BUTTON_VARIANTS, LnxButton, LnxIcon } from 'lnxjs-components';
import IsotypeSVG from '../components/IsotypeSVG.vue';
import { scrollTop } from '../utils/helpers.ts';

const tabs = [
	{
		icon: IsotypeSVG,
		isCustomIcon: true,
		text: 'Inicio',
		route: '/',
	},
	{
		icon: 'mdi:home-warning',
		text: 'Incidencias',
		route: '/issues',
	},
	{
		icon: 'mdi:plus',
		text: 'Añadir Incidencia',
		route: '/issues/new',
		isCTA: true,
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
			:variant="tab.isCTA ? BUTTON_VARIANTS.DANGER : BUTTON_VARIANTS.GRAYSCALE"
			:mode="tab.isCTA ? BUTTON_MODES.SOLID : BUTTON_MODES.CLEAR"
			:shape="tab.isCTA ? BUTTON_SHAPES.CIRCLE : BUTTON_SHAPES.ICON"
			:class="{ cta: tab.isCTA }"
			@click="scrollTop()"
		>
			<LnxIcon v-if="!tab.isCustomIcon" :icon="tab.icon as string" :size="24" />
			<component :is="tab.icon" v-else heigth="20" width="20" />
		</LnxButton>
	</nav>
</template>

<style>
:root {
	--tab-height: calc(58px + 16px) /* nav height + bottom padding */;
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
	height: 58px;
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
			--lnx-button-color: var(--color-secondary-accent) !important;
			color: var(--color-secondary-accent) !important;
		}

		&.cta {
			margin-top: -8px;
			box-shadow: 0 8px 8px -4px rgba(0, 0, 0, 0.2);
		}

		span {
			font-size: var(--font-size-small);
		}
	}
}
</style>
