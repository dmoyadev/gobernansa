<script setup lang="ts">
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { useTemplateRef } from 'vue';
import useAuth from '@/modules/auth/application/useAuth.ts';
import TheToolbar from './TheToolbar.vue';

// Shown in the toolbar on scroll, the route title by default
defineProps<{ title?: string }>();

const { user } = useAuth();
const $header = useTemplateRef('$header');
</script>

<template>
	<header ref="$header">
		<TheToolbar :title="title || String($route.meta.title || '')" :reveal="$header">
			<LnxButton
				v-if="user"
				to="/profile"
				mode="clear"
				shape="circle"
			>
				<LnxIcon icon="lucide:bell" />
			</LnxButton>
		</TheToolbar>

		<slot />
	</header>
</template>

<style scoped lang="scss">
header {
	// The fixed toolbar takes the place of the logo row
	padding: calc(var(--toolbar-height) - var(--lnx-spacing-2)) var(--lnx-spacing-4) 0;
	display: flex;
	flex-direction: column;
	justify-content: space-between;
	gap: var(--lnx-spacing-2);

	:deep(p) {
		margin-top: calc(-1 * var(--lnx-spacing-2));
		color: var(--color-gray-68);
		font-weight: var(--lnx-font-weight-light);
	}
}
</style>
