<script setup lang="ts">
import { LnxIcon } from 'lnxjs-components';
import { applyUpdate, online, updateReady } from '../application/pwa.ts';
import { quotaExhausted } from '../infrastructure/monitoring.ts';
</script>

<template>
	<!-- Each app places it. Read out as they appear -->
	<div class="app-status" aria-live="polite">
		<!-- Fixed until the page is loaded again: until then every screen fails, so it says why -->
		<p v-if="quotaExhausted" class="pill">
			<LnxIcon icon="lucide:circle-alert" :size="16" />
			El servicio ha alcanzado su límite diario y vuelve hacia las 9:00
		</p>
		<p v-if="!online" class="pill">
			<LnxIcon icon="lucide:wifi-off" :size="16" />
			Sin conexión
		</p>
		<p v-if="updateReady" class="pill">
			<LnxIcon icon="lucide:refresh-cw" :size="16" />
			Nueva versión disponible
			<button type="button" @click="applyUpdate()">
				Actualizar
			</button>
		</p>
	</div>
</template>

<style scoped lang="scss">
.app-status {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: var(--lnx-spacing-2);
	pointer-events: none;
}

.pill {
	padding: var(--lnx-spacing-2) var(--lnx-spacing-3);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
	border-radius: var(--lnx-radius-4);
	background: var(--color-gray-9);
	color: var(--color-gray-0);
	box-shadow: 0 8px 8px -4px rgba(0, 0, 0, 0.2);
	font-size: var(--lnx-font-size-small);
	line-height: 1.3;
	pointer-events: auto;
}

button {
	margin: calc(-1 * var(--lnx-spacing-1)) 0;
	padding: var(--lnx-spacing-1) var(--lnx-spacing-2);
	border-radius: var(--lnx-radius-3);
	color: inherit;
	font-weight: var(--lnx-font-weight-bold);
	cursor: pointer;

	&:hover {
		background: #FFFFFF1F;
	}
}
</style>
