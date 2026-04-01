<script setup lang="ts">
import { LnxButton, LnxIcon } from 'lnxjs-components';
import useAuth from '../composables/useAuth.ts';

const { user } = useAuth();
</script>

<template>
	<header>
		<div class="top-menu">
			<img src="/logo.svg" class="logo" alt="Logo" width="120" height="40">

			<LnxButton
				v-if="user"
				to="/profile"
				mode="clear"
				shape="circle"
			>
				<LnxIcon icon="mdi:bell-outline" />
			</LnxButton>
		</div>

		<slot />
	</header>
</template>

<style scoped lang="scss">
header {
	padding: var(--lnx-spacing-4) var(--lnx-spacing-4) 0;
	display: flex;
	flex-direction: column;
	justify-content: space-between;
	gap: var(--lnx-spacing-2);

	.top-menu {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--lnx-spacing-2);

		* {
			flex-shrink: 0;
		}

		.logo {
			margin-bottom: -4px;
			margin-right: auto;
		}
	}
}
</style>
