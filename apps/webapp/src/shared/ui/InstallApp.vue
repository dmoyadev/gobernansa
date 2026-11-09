<script setup lang="ts">
import { canInstall, install, installed, isIos } from '@gobernansa/shared/application/pwa.ts';
import IsotypeSVG from '@gobernansa/shared/ui/IsotypeSVG.vue';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { useStorage } from '@/shared/utils/useStorage.ts';

// The home page suggests it and can close it for good, the profile always offers it.
// Safari has no install prompt: it's added from its share menu
defineProps<{ dismissible?: boolean }>();
const dismissed = useStorage('install-hint-dismissed', false);
</script>

<template>
	<aside v-if="!installed && (canInstall || isIos) && !(dismissible && dismissed)" class="install">
		<span class="app-icon" aria-hidden="true">
			<IsotypeSVG width="26" height="26" />
		</span>

		<div class="body">
			<strong>Instalar la app</strong>
			<p v-if="canInstall">
				Ábrela desde la pantalla de inicio, como cualquier otra.
			</p>
			<ol v-else>
				<li>
					Toca <LnxIcon icon="lucide:share" :size="14" /> <b>Compartir</b> (si no lo ves, está en el menú ···)
				</li>
				<li>
					Elige <LnxIcon icon="lucide:square-plus" :size="14" /> <b>Añadir a pantalla de inicio</b>
				</li>
			</ol>
		</div>

		<LnxButton v-if="canInstall" class="size-small" @click="install()">
			Instalar
		</LnxButton>
		<LnxButton
			v-if="dismissible"
			class="close size-small"
			mode="clear"
			shape="circle"
			variant="grayscale"
			aria-label="No volver a mostrar"
			@click="dismissed = true"
		>
			<LnxIcon icon="lucide:x" />
		</LnxButton>
	</aside>
</template>

<style scoped lang="scss">
.install {
	padding: var(--lnx-spacing-3);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-3);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;
}

// The installed app's icon
.app-icon {
	flex-shrink: 0;
	width: 40px;
	height: 40px;
	display: flex;
	align-items: center;
	justify-content: center;
	border-radius: 10px;
	background: linear-gradient(135deg, #1c4f78 0%, var(--color-primary) 45%, var(--color-primary-dark) 100%);
	color: var(--color-gray-0);
}

.body {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 2px;

	strong {
		color: var(--color-gray-9);
		font-weight: var(--lnx-font-weight-bold);
	}

	p,
	ol {
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
	}

	ol {
		list-style: decimal;
		padding-left: var(--lnx-spacing-4);
	}

	iconify-icon {
		vertical-align: -2px;
		color: var(--color-primary);
	}

	b {
		color: var(--color-gray-8);
		font-weight: var(--lnx-font-weight-bold);
	}
}

.close {
	flex-shrink: 0;
	align-self: flex-start;
	margin: calc(-1 * var(--lnx-spacing-1));
}
</style>
