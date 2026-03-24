<script setup lang="ts">
import { LnxButton, LnxIcon } from 'lnxjs-components';
import useAuth from '../composables/useAuth.ts';
import { useUserProperties } from '../composables/useUserProperties.ts';
import { useUserCommunity } from '../composables/useUserCommunity.ts';

const { user } = useAuth();
const { selectedProperty } = useUserProperties();
const { userCommunity } = useUserCommunity();
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

		<div class="greeting">
			<h1 v-if="selectedProperty">¡Hola, {{ selectedProperty.name }}!</h1>
			<h1 v-else>¡Hola!</h1>
			<h2
				v-if="userCommunity"
				class="text-cursive"
			>
				Bienvenido a {{ userCommunity?.name }}
			</h2>
		</div>
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

	.greeting {
		h2 {
			margin-top: calc(-1 * var(--lnx-spacing-3));
			color: var(--lnx-color-gray-6);
			opacity: .7;
		}
	}
}
</style>