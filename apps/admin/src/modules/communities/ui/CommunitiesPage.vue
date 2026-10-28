<script setup lang="ts">
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { useCommunities } from '../application/useCommunities.ts';

const { communities, loading, error } = useCommunities();
</script>

<template>
	<header class="page-header">
		<div>
			<h1>Comunidades</h1>
			<p v-if="!loading && !error">
				{{ communities.length === 1 ? '1 comunidad' : `${communities.length} comunidades` }}
			</p>
		</div>

		<LnxButton to="/communities/new">
			<LnxIcon icon="lucide:plus" />
			Nueva comunidad
		</LnxButton>
	</header>

	<p v-if="error" class="error" role="alert">
		No se han podido cargar las comunidades: {{ error.message }}
	</p>

	<ul v-else-if="loading" class="list" aria-busy="true">
		<li v-for="index in 3" :key="index" class="row">
			<span class="skeleton-item skeleton-item--icon" />
			<span class="skeleton-item" />
		</li>
	</ul>

	<ul v-else-if="communities.length" class="list">
		<li v-for="community in communities" :key="community.id">
			<RouterLink class="row" :to="`/communities/${community.id}`">
				<span class="icon">
					<LnxIcon icon="lucide:building-2" :size="20" />
				</span>
				<span class="body">
					<strong>{{ community.name || 'Sin nombre' }}</strong>
					<small>{{ community.address }}</small>
				</span>
				<span class="meta">
					<span>
						<LnxIcon icon="lucide:phone" :size="14" />
						{{ community.contacts?.length ?? 0 }}
						<span class="sr-only">contactos</span>
					</span>
					<span>
						<LnxIcon icon="lucide:file-text" :size="14" />
						{{ community.documents?.length ?? 0 }}
						<span class="sr-only">documentos</span>
					</span>
				</span>
				<LnxIcon class="chevron" icon="lucide:chevron-right" :size="18" />
			</RouterLink>
		</li>
	</ul>

	<section v-else class="empty">
		<LnxIcon icon="lucide:building-2" :size="40" />
		<p>Aún no hay comunidades. Crea la primera para que sus vecinos puedan usar gobernança.</p>
	</section>
</template>

<style lang="scss" scoped>
.page-header {
	margin-bottom: var(--lnx-spacing-5);
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: var(--lnx-spacing-3);

	h1 {
		font-size: var(--lnx-font-size-title);
	}

	p {
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
	}
}

.error {
	color: var(--color-secondary-accent);
}

.list {
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;

	> li + li {
		border-top: 1px solid var(--color-gray-2);
	}
}

.row {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-3);
	padding: var(--lnx-spacing-3) var(--lnx-spacing-4);
	color: inherit;
	text-decoration: none;

	&:is(a):hover {
		background: var(--color-gray-1);
	}

	.icon {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border-radius: var(--lnx-radius-circle);
		background: var(--color-gray-2);
		color: var(--color-primary);
	}

	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;

		strong {
			color: var(--color-gray-9);
		}

		small {
			overflow: hidden;
			color: var(--color-gray-6);
			font-size: var(--lnx-font-size-small);
			white-space: nowrap;
			text-overflow: ellipsis;
		}
	}

	.meta {
		display: flex;
		gap: var(--lnx-spacing-3);
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);

		> span {
			display: flex;
			align-items: center;
			gap: var(--lnx-spacing-1);
		}
	}

	.chevron {
		color: var(--color-gray-5);
	}
}

.empty {
	padding: var(--lnx-spacing-7) var(--lnx-spacing-4);
	border: 1px dashed var(--color-gray-4);
	border-radius: var(--lnx-radius-3);
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: var(--lnx-spacing-3);
	color: var(--color-gray-6);
	text-align: center;
}
</style>
