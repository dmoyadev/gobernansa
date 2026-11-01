<script setup lang="ts">
import { LnxIcon } from 'lnxjs-components';
import BackButton from '@/app/ux/BackButton.vue';
import { financeGroups } from '../sections.ts';

defineProps<{ id: string }>();
</script>

<template>
	<header class="page-header">
		<BackButton :to="`/communities/${id}`" label="Volver a la comunidad" />
		<h1>Finanzas</h1>
	</header>

	<section v-for="group in financeGroups" :key="group.title" class="group">
		<h2>{{ group.title }}</h2>
		<ul>
			<li v-for="section in group.sections" :key="section.key">
				<RouterLink class="link" :to="`/communities/${id}/${section.key}`">
					<LnxIcon :icon="section.icon" :size="20" aria-hidden="true" />
					<span>
						<strong>{{ section.title }}</strong>
						<small>{{ section.details }}</small>
					</span>
				</RouterLink>
			</li>
		</ul>
	</section>
</template>

<style lang="scss" scoped>
.page-header {
	margin-bottom: var(--lnx-spacing-5);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);

	h1 {
		flex: 1;
		font-size: var(--lnx-font-size-title);
	}
}

.group {
	margin-bottom: var(--lnx-spacing-6);

	h2 {
		margin-bottom: var(--lnx-spacing-3);
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: .04em;
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: var(--lnx-spacing-3);
	}
}

.link {
	height: 100%;
	padding: var(--lnx-spacing-4);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;
	display: flex;
	align-items: flex-start;
	gap: var(--lnx-spacing-3);
	color: var(--color-gray-7);
	text-decoration: none;
	transition: border-color .2s, box-shadow .2s;

	&:hover,
	&:focus-visible {
		border-color: var(--color-primary-light);
		box-shadow: 0 2px 4px #0000000F, 0 8px 24px #0000000F;
	}

	span {
		display: flex;
		flex-direction: column;
		gap: var(--lnx-spacing-1);
	}

	strong {
		color: var(--color-gray-9);
	}

	small {
		font-size: var(--lnx-font-size-small);
	}
}
</style>
