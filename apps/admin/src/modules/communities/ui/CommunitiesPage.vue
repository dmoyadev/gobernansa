<script lang="ts">
import { computed, reactive, ref, watch } from 'vue';
</script>

<script setup lang="ts">
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { normalize } from '@gobernansa/shared/utils/helpers.ts';
import { LnxButton, LnxIcon, LnxInput } from 'lnxjs-components';
import { loadNeighbourCount, useCommunities } from '../application/useCommunities.ts';

// Neighbours per community, null while loading and undefined when it failed
// ponytail: kept until the page reloads, a new neighbour shows up then
const neighbours = reactive<Record<string, number | null | undefined>>({});

const { user } = useAuth();
const { communities, loading, error } = useCommunities();

const search = ref('');
const filtered = computed(() => {
	const words = normalize(search.value).split(' ').filter(Boolean);
	return words.length
		? communities.value.filter((community) => {
				const text = normalize(`${community.name ?? ''} ${community.address ?? ''}`);
				return words.every(word => text.includes(word));
			})
		: communities.value;
});
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// One aggregation per community, only for the ones not counted yet: the live list changes on every edit, not just on new ones.
// The counts live in the module (above), so coming back to the list doesn't count them again
watch(() => communities.value.map(community => community.id).join(), () => {
	for (const { id } of communities.value) {
		if (id in neighbours) {
			continue;
		}
		neighbours[id] = null;
		loadNeighbourCount(id)
			.then((count) => {
				neighbours[id] = count;
			})
			.catch(() => {
				neighbours[id] = undefined;
			});
	}
}, { immediate: true });
</script>

<template>
	<header class="page-header">
		<div>
			<h1>Comunidades</h1>
			<p v-if="!loading && !error">
				<template v-if="search.trim()">
					{{ filtered.length }} de {{ plural(communities.length, 'comunidad', 'comunidades') }}
				</template>
				<template v-else>
					{{ plural(communities.length, 'comunidad', 'comunidades') }}
				</template>
			</p>
		</div>

		<!-- Only gobernança's team creates them, and then assigns them to their administrators -->
		<LnxButton v-if="user?.role === 'superadmin'" to="/communities/new">
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

	<template v-else-if="communities.length">
		<LnxInput v-model="search" class="search" type="search" placeholder="Buscar por nombre o dirección">
			<span class="sr-only">Buscar comunidades</span>
			<template #icon>
				<LnxIcon icon="lucide:search" />
			</template>
		</LnxInput>

		<ul v-if="filtered.length" class="list">
			<li v-for="community in filtered" :key="community.id">
				<RouterLink class="row" :to="`/communities/${community.id}`">
					<span class="icon">
						<LnxIcon icon="lucide:building-2" :size="20" />
					</span>
					<span class="body">
						<strong>{{ community.name || 'Sin nombre' }}</strong>
						<small>{{ community.address }}</small>
					</span>
					<span class="meta">
						<span :title="neighbours[community.id] == null ? 'Vecinos' : plural(neighbours[community.id]!, 'vecino', 'vecinos')">
							<LnxIcon icon="lucide:users" :size="14" />
							<span v-if="neighbours[community.id] === null" class="skeleton-item skeleton-item--count" aria-hidden="true" />
							<template v-else>{{ neighbours[community.id] ?? '–' }}</template>
							<span class="sr-only">vecinos</span>
						</span>
						<span :title="plural(community.contacts?.length ?? 0, 'contacto', 'contactos')">
							<LnxIcon icon="lucide:phone" :size="14" />
							{{ community.contacts?.length ?? 0 }}
							<span class="sr-only">contactos</span>
						</span>
						<span :title="plural(community.documents?.length ?? 0, 'documento', 'documentos')">
							<LnxIcon icon="lucide:file-text" :size="14" />
							{{ community.documents?.length ?? 0 }}
							<span class="sr-only">documentos</span>
						</span>
					</span>
					<LnxIcon class="chevron" icon="lucide:chevron-right" :size="18" />
				</RouterLink>
			</li>
		</ul>

		<section v-else class="empty" role="status">
			<LnxIcon icon="lucide:search-x" :size="40" />
			<p>Ninguna comunidad coincide con «{{ search.trim() }}». Prueba con otra parte del nombre o de la dirección.</p>
		</section>
	</template>

	<section v-else class="empty">
		<LnxIcon icon="lucide:building-2" :size="40" />
		<p v-if="user?.role === 'superadmin'">
			Aún no hay comunidades. Crea la primera para que sus vecinos puedan usar gobernança.
		</p>
		<p v-else>
			Aún no tienes comunidades asignadas. Pide al equipo de gobernança que te asigne las tuyas.
		</p>
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

.search {
	margin-bottom: var(--lnx-spacing-4);
	width: 100%;
}

.skeleton-item--count {
	width: 1.5em;
	height: 1em;
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
