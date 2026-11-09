<script setup lang="ts">
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import AppStatus from '@gobernansa/shared/ui/AppStatus.vue';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { RouterView } from 'vue-router';
import { useUserCommunity } from '@/modules/community/application/useUserCommunity.ts';
import useWebAppZoom from './useWebAppZoom.ts';

useWebAppZoom();
const { user, viewingAs, exitViewAs } = useAuth();
const { userCommunity } = useUserCommunity();
</script>

<template>
	<!-- Pages leave room at the bottom for the notice too, as they do for the tab bar -->
	<div class="app" :class="{ 'with-notice': user?.blocked }">
		<RouterView :key="$route.fullPath" />
	</div>

	<div class="notices">
		<AppStatus />
		<p v-if="viewingAs" class="notice" role="status">
			<LnxIcon icon="lucide:eye" :size="16" />
			<span>Viendo «{{ userCommunity?.name }}» como vecino</span>
			<LnxButton mode="clear" class="size-small" @click="exitViewAs()">
				Salir
			</LnxButton>
		</p>
		<p v-else-if="user?.blocked" class="notice" role="status">
			<LnxIcon icon="lucide:lock" :size="16" />
			<span>Tu cuenta está bloqueada por la administración: puedes consultar, pero no avisar, comentar, votar ni reservar.</span>
		</p>
	</div>
</template>

<style scoped lang="scss">
.app {
	display: contents;

	&.with-notice {
		--tab-height: calc(var(--tab-bar-height, 58px) + max(16px, env(safe-area-inset-bottom)) + 64px);
	}
}

// Above the tab bar, which sits above the home indicator when installed
.notices {
	z-index: 100;
	position: fixed;
	right: var(--lnx-spacing-4);
	bottom: calc(var(--tab-bar-height, 58px) + max(16px, env(safe-area-inset-bottom)) + var(--lnx-spacing-2));
	left: var(--lnx-spacing-4);
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);
	pointer-events: none;
}

.notice {
	pointer-events: auto;
	padding: var(--lnx-spacing-2) var(--lnx-spacing-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-9);
	color: var(--color-gray-0);
	box-shadow: 0 8px 8px -4px rgba(0, 0, 0, 0.2);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
	font-size: var(--lnx-font-size-small);
	line-height: 1.3;

	span {
		flex: 1;
	}

	// The button takes its colour from its variant, which is the brand's dark blue: unreadable on the dark banner
	:deep(button.button-mode-clear) {
		flex-shrink: 0;
		color: var(--color-gray-0);
		font-weight: var(--lnx-font-weight-bold);
	}
}
</style>
