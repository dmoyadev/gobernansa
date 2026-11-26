<script setup lang="ts">
import { ISSUE_ICON } from '@gobernansa/shared/domain/issue.ts';
import IsotypeSVG from '@gobernansa/shared/ui/IsotypeSVG.vue';
import { scrollTop } from '@gobernansa/shared/utils/helpers.ts';
import { BUTTON_MODES, BUTTON_SHAPES, BUTTON_VARIANTS, LnxButton, LnxIcon } from 'lnxjs-components';

const tabs = [
	{
		icon: IsotypeSVG,
		isCustomIcon: true,
		text: 'Inicio',
		route: '/',
	},
	{
		icon: ISSUE_ICON,
		text: 'Incidencias',
		route: '/issues',
	},
	{
		icon: 'lucide:plus',
		text: 'Nuevo',
		route: '/new',
		isCTA: true,
	},
	{
		icon: 'lucide:users',
		text: 'Comunidad',
		route: '/neighborhood',
	},
	{
		icon: 'lucide:user',
		text: 'Perfil',
		route: '/profile',
	},
];
</script>

<template>
	<RouterView />

	<nav class="tab-bar">
		<!-- Named under each icon: «Comunidad» and «Perfil» are two almost identical people, and «Inicio» is the logo -->
		<LnxButton
			v-for="(tab, index) in tabs"
			:key="index"
			:to="tab.route"
			:variant="tab.isCTA ? BUTTON_VARIANTS.DANGER : BUTTON_VARIANTS.GRAYSCALE"
			:mode="tab.isCTA ? BUTTON_MODES.SOLID : BUTTON_MODES.CLEAR"
			:shape="tab.isCTA ? BUTTON_SHAPES.CIRCLE : undefined"
			:class="{ cta: tab.isCTA, home: tab.route === '/' }"
			:aria-label="tab.isCTA ? tab.text : undefined"
			@click="scrollTop()"
		>
			<LnxIcon v-if="!tab.isCustomIcon" :icon="tab.icon as string" :size="22" />
			<component :is="tab.icon" v-else height="20" width="20" />
			<span v-if="!tab.isCTA">{{ tab.text }}</span>
		</LnxButton>
	</nav>
</template>

<style>
:root {
	--tab-bar-height: 58px;
	--tab-bottom: max(16px, env(safe-area-inset-bottom)) /* above the home indicator when installed */;
	--tab-height: calc(var(--tab-bar-height) + var(--tab-bottom)) /* nav height + bottom padding */;
}

/* Wizards (reporting an issue, paying) take the whole screen, so leaving one is only through its back button */
:root:has(.wizard) {
	--tab-bar-height: 0px;
}

:root:has(.wizard) .tab-bar {
	display: none;
}
</style>

<style lang="scss" scoped>
nav {
	view-transition-name: tab-bar;
	z-index: 100;
	position: fixed;
	bottom: var(--tab-bottom);
	left: 50%;
	transform: translate(-50%, 0);
	align-self: center;
	// Wide enough for «Incidencias» and «Comunidad» under their icons on a 375 px phone
	width: min(calc(100% - 32px), 420px);
	padding: 0 12px;
	border-radius: 80px;
	height: 58px;
	background: var(--color-secondary-alpha);
	backdrop-filter: blur(4px);
	box-shadow: 0 8px 8px -4px rgba(0, 0, 0, 0.2);
	display: flex;
	align-items: center;
	gap: 4px;

	a {
		flex: 1;
		height: 100%;
		padding: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		font-weight: var(--font-weight-regular);

		// Lit inside its section too (an issue, a junta), except Inicio, which only lights on itself. The + keeps its
		// colours, the accent would hide it on its own background
		&.router-link-active:not(.cta, .home),
		&.router-link-exact-active:not(.cta) {
			--lnx-button-color: var(--color-secondary-accent) !important;
			color: var(--color-secondary-accent) !important;
			font-weight: var(--font-weight-bold);
		}

		&.cta {
			margin-top: -8px;
			box-shadow: 0 8px 8px -4px rgba(0, 0, 0, 0.2);
		}

		span {
			font-size: var(--lnx-font-size-legal);
			line-height: 1.2;
		}
	}
}
</style>
