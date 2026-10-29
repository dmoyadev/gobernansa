<template>
	<RouterView />
</template>

<style>
body {
	background: var(--color-gray-1);
}

/* The components' reset unstyles every native input, so checkboxes not hidden behind a chip (.sr-only) would be invisible */
input:is([type='checkbox'], [type='radio']) {
	appearance: auto;
	accent-color: var(--color-primary);
}

/* Same reset, loaded after this: placeholders of native fields would look like text already typed */
body ::placeholder {
	color: var(--color-gray-5);
}
</style>
