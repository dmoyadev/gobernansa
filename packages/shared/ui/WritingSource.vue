<script setup lang="ts">
// Which version wrote a suggestion or a text: the browser's own on-device one, or the basic rules. Neither sends anything
import type { WritingSource } from '../application/writing.ts';
import { LnxIcon } from 'lnxjs-components';

defineProps<{ source: WritingSource }>();
</script>

<template>
	<span class="writing-source" :title="source === 'device' ? 'Hecho por tu navegador, sin enviar nada' : 'Con reglas fijas, sin enviar nada'">
		<LnxIcon :icon="source === 'device' ? 'lucide:cpu' : 'lucide:list-checks'" :size="12" />
		{{ source === 'device' ? 'En tu dispositivo' : 'Básico' }}
	</span>
</template>

<style lang="scss" scoped>
.writing-source {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 1px var(--lnx-spacing-2);
	border-radius: 999px;
	background: var(--color-gray-2);
	color: var(--color-gray-7);
	font-size: .75rem;
	font-weight: var(--lnx-font-weight-bold);
	white-space: nowrap;
}
</style>
