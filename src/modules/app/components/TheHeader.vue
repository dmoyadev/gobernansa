<script setup lang="ts">
import useAuth from '../composables/useAuth.ts';

const { user } = useAuth();
</script>

<template>
<header>
	<h1></h1>
	<img
		:src="`https://api.dicebear.com/9.x/initials/svg?radius=50&size=50&seed=${user?.name || 'User'}`"
		alt="User avatar"
		width="50"
		height="50"
	>
</header>
</template>

<style scoped lang="scss">

</style>