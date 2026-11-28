<script setup lang="ts">
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { ref, watch } from 'vue';
import { communityName } from '../application/useUserCommunity.ts';

// For neighbours with a home in several communities (a flat in one, a garage in another): which one the app shows
const { user, communities, switchCommunity } = useAuth();
const names = ref<Record<string, string>>({});

// Read once, a few at most
watch(communities, async (ids) => {
	const loaded = await Promise.all(ids.map(async id => [id, await communityName(id)] as const));
	names.value = Object.fromEntries(loaded);
}, { immediate: true });
</script>

<template>
	<label v-if="communities.length > 1" class="switcher">
		<span class="text-cursive">Estás viendo</span>
		<select :value="user?.communityId" @change="switchCommunity(($event.target as HTMLSelectElement).value)">
			<option v-for="id in communities" :key="id" :value="id">
				{{ names[id] ?? '…' }}
			</option>
		</select>
	</label>
</template>

<style lang="scss" scoped>
.switcher {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--lnx-spacing-2);

	select {
		// Even padding, not a height: lnx's reset leaves the text at the top of a taller select
		padding: var(--lnx-spacing-2);
		border: 1px solid var(--color-gray-4);
		border-radius: var(--lnx-radius-2);
		background: var(--color-gray-0);
		color: var(--color-gray-9);
		font: inherit;
		font-weight: var(--lnx-font-weight-bold);
	}
}
</style>
