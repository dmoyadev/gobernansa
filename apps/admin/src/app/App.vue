<script setup lang="ts">
import AppStatus from '@gobernansa/shared/ui/AppStatus.vue';
</script>

<template>
	<RouterView />
	<AppStatus class="app-status" />
</template>

<style scoped>
/* Under the top bar, clear of the toasts at the bottom */
.app-status {
	position: fixed;
	z-index: 20;
	top: calc(64px + var(--lnx-spacing-3));
	right: var(--lnx-spacing-5);
}

@media print {
	.app-status {
		display: none;
	}
}
</style>

<style>
body {
	background: var(--color-gray-1);
}

/* Same reset, loaded after this: placeholders of native fields would look like text already typed */
body ::placeholder {
	color: var(--color-gray-5);
}
</style>
