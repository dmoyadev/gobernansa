<script setup lang="ts">
import { LnxButton } from 'lnxjs-components';
</script>

<template>
	<main>
		Esta página no existe

		<LnxButton to="/">
			Volver al inicio
		</LnxButton>
	</main>
</template>

<style lang="scss" scoped>
main {
	min-height: 100svh;
	padding: 16px;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 16px;
}
</style>
