<script setup lang="ts">
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { useTemplateRef } from 'vue';
import { useUnreadNotices } from '@/modules/events/application/useUnreadNotices.ts';
import TheToolbar from './TheToolbar.vue';

// Shown in the toolbar on scroll, the route title by default. With back, a button to the previous page instead of the logo
defineProps<{ title?: string; back?: string }>();

const { user } = useAuth();
const { unread } = useUnreadNotices();
const $header = useTemplateRef('$header');
</script>

<template>
	<header ref="$header" :class="{ 'with-back': back }">
		<TheToolbar :title="title || String($route.meta.title || '')" :back :reveal="$header">
			<LnxButton
				v-if="user"
				to="/notices"
				mode="clear"
				shape="circle"
				class="bell"
				:aria-label="unread ? 'Avisos, hay nuevos' : 'Avisos'"
			>
				<LnxIcon icon="lucide:bell" />
				<span v-if="unread" class="dot" />
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
		color: var(--color-gray-68);
		font-weight: var(--lnx-font-weight-light);
	}

	// The title goes up into the toolbar's row, beside the back button and clear of the bell
	&.with-back {
		padding-top: calc(env(safe-area-inset-top) + var(--lnx-spacing-4));

		:deep(h1) {
			min-height: 40px;
			margin-top: 0;
			display: flex;
			align-items: center;
			padding: 0 48px 0 calc(32px + var(--lnx-spacing-3));
		}
	}
}

.bell {
	position: relative;

	.dot {
		position: absolute;
		top: 8px;
		right: 8px;
		width: 9px;
		height: 9px;
		border: 2px solid var(--color-gray-0);
		border-radius: var(--lnx-radius-circle);
		background: var(--lnx-color-danger);
	}
}
</style>
