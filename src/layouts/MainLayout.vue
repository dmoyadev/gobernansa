<script setup lang="ts">

</script>

<template>
	<main>
		<slot />
	</main>
</template>

<style scoped lang="scss">
main {
	min-height: 100svh;
	padding: var(--lnx-spacing-4) var(--lnx-spacing-4) calc(var(--lnx-spacing-4) + var(--tab-height));
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-4);

	pre {
		max-width: 100%;
		max-height: 200px;
		overflow: auto;
	}
}
</style>
