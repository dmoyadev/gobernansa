<template>
	<RouterView />
</template>

<style>
body {
	background: var(--color-gray-1);
}

/* Same reset, loaded after this: placeholders of native fields would look like text already typed */
body ::placeholder {
	color: var(--color-gray-5);
}
</style>
