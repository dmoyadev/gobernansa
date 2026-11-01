<script setup lang="ts">
import { MAIL_MODE } from '../application/mail.ts';
</script>

<!-- Beside each action that queues an email, while they're only kept -->
<template>
	<p v-if="MAIL_MODE === 'demo'" class="mail-mode">
		<span class="chip">Modo de prueba</span> No se envía, queda en el <RouterLink to="/mail">correo saliente</RouterLink>.
	</p>
</template>

<style lang="scss" scoped>
.mail-mode {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);

	a {
		color: var(--color-primary);
	}
}

.chip {
	padding: 2px var(--lnx-spacing-2);
	border-radius: 999px;
	background: var(--color-gray-2);
	color: var(--color-gray-7);
	white-space: nowrap;
}
</style>
