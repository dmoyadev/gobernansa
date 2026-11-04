<script setup lang="ts">
import { LnxIcon } from 'lnxjs-components';
import { computed } from 'vue';
import { applyUpdate, online, updateReady } from '../application/pwa.ts';
import { quotaExhausted, RELEASE } from '../infrastructure/monitoring.ts';
import { remote } from '../infrastructure/remoteConfig.ts';

// ROB-5: a release below the minimum set in the console can't go on; releases sort as text (2026.11.04-1200-…)
const outdated = computed(() => RELEASE !== 'local' && !!remote.minVersion && RELEASE < remote.minVersion);
</script>

<template>
	<!-- Each app places it. Read out as they appear -->
	<div class="app-status" aria-live="polite">
		<!-- Fixed until the page is loaded again: until then every screen fails, so it says why -->
		<p v-if="quotaExhausted" class="pill">
			<LnxIcon icon="lucide:circle-alert" :size="16" />
			El servicio ha alcanzado su límite diario y vuelve hacia las 9:00
		</p>
		<p v-if="remote.maintenance" class="pill">
			<LnxIcon icon="lucide:wrench" :size="16" />
			{{ remote.maintenance }}
		</p>
		<p v-if="!online" class="pill">
			<LnxIcon icon="lucide:wifi-off" :size="16" />
			Sin conexión
		</p>
		<p v-if="updateReady && !outdated" class="pill">
			<LnxIcon icon="lucide:refresh-cw" :size="16" />
			Nueva versión disponible
			<button type="button" @click="applyUpdate()">
				Actualizar
			</button>
		</p>
		<!-- Over everything: an old release may write data the new rules or pages no longer expect. Inside the root, so
		each app's class for placing the pills still reaches it -->
		<Teleport to="body">
			<div v-if="outdated" class="outdated" role="alertdialog" aria-modal="true" aria-labelledby="outdated-title">
				<div class="outdated-card">
					<LnxIcon icon="lucide:refresh-cw" :size="24" />
					<p id="outdated-title">
						Hay una versión nueva y esta ya no se puede usar. Actualiza para seguir.
					</p>
					<button type="button" @click="applyUpdate()">
						Actualizar
					</button>
				</div>
			</div>
		</Teleport>
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

.outdated {
	position: fixed;
	inset: 0;
	z-index: 1000;
	padding: var(--lnx-spacing-4);
	display: grid;
	place-items: center;
	background: rgba(0, 0, 0, 0.5);
}

.outdated-card {
	max-width: 360px;
	padding: var(--lnx-spacing-5);
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: var(--lnx-spacing-3);
	border-radius: var(--lnx-radius-4);
	background: var(--color-gray-9);
	color: var(--color-gray-0);
	text-align: center;
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
