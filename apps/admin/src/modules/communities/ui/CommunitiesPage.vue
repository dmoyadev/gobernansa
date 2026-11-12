<script lang="ts">
import { computed, reactive, ref, useTemplateRef, watch } from 'vue';
</script>

<script setup lang="ts">
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { normalize } from '@gobernansa/shared/utils/helpers.ts';
import { LnxButton, LnxIcon, LnxInput, useShortcut } from 'lnxjs-components';
import NewButton from '@/app/ux/NewButton.vue';
import { loadNeighbourCount, useCommunities } from '../application/useCommunities.ts';
import { useNeighbourSearch } from '../application/useCommunitySearch.ts';

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

// Neighbours in any of them, by name, home, NIF, email or phone. Their census is read once something is typed
const census = useNeighbourSearch(communities);
const people = computed(() => census.search(search.value));
watch(() => !!search.value.trim(), (typed) => {
	if (typed) {
		void census.loadIndex();
	}
});
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// Placeholder rows as wide as real names and addresses tend to be
const SKELETON_ROWS = [[48, 72], [36, 58], [54, 80], [42, 64]];

const searchField = useTemplateRef<{ $el: HTMLElement }>('searchField');
useShortcut('/', () => searchField.value?.$el.querySelector('input')?.focus(), { description: 'Buscar comunidades' });

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

		<div class="actions">
			<!-- The census of several at once. Administrators only fill in the ones they have -->
			<LnxButton v-if="user?.role === 'superadmin' || user?.role === 'admin'" mode="outline" to="/communities/import">
				<LnxIcon icon="lucide:file-spreadsheet" />
				Importar comunidades
			</LnxButton>
			<!-- Only gobernança's team creates them, and then assigns them to their administrators -->
			<NewButton v-if="user?.role === 'superadmin'" label="Nueva comunidad" to="/communities/new" />
		</div>
	</header>

	<p v-if="error" class="error" role="alert">
		No se han podido cargar las comunidades: {{ error.message }}
	</p>

	<ul v-else-if="loading" class="list" aria-busy="true">
		<li v-for="([title, address], index) in SKELETON_ROWS" :key="index" class="row">
			<span class="icon">
				<span class="lnx-skeleton lnx-skeleton--circle" />
			</span>
			<span class="body">
				<span class="lnx-skeleton" :style="{ width: `${title}%` }" />
				<span class="lnx-skeleton lnx-skeleton--small" :style="{ width: `${address}%` }" />
			</span>
			<span class="lnx-skeleton lnx-skeleton--small meta-skeleton" />
		</li>
	</ul>

	<template v-else-if="communities.length">
		<LnxInput ref="searchField" v-model="search" class="search" type="search" placeholder="Busca una comunidad o un vecino: nombre, piso, NIF, teléfono…">
			<span class="sr-only">Buscar comunidades y vecinos</span>
			<template #icon>
				<LnxIcon icon="lucide:search" />
			</template>
		</LnxInput>

		<TransitionGroup v-if="filtered.length" tag="ul" name="row" class="list lnx-appear">
			<li v-for="community in filtered" :key="community.id">
				<RouterLink class="row ux-row" :to="`/communities/${community.id}`">
					<span class="icon">
						<LnxIcon icon="lucide:building-2" :size="20" />
					</span>
					<span class="body">
						<strong :style="{ viewTransitionName: `community-${community.id}` }">{{ community.name || 'Sin nombre' }}</strong>
						<small>{{ community.address }}</small>
					</span>
					<span class="meta tabular">
						<span :title="neighbours[community.id] == null ? 'Vecinos' : plural(neighbours[community.id]!, 'vecino', 'vecinos')">
							<LnxIcon icon="lucide:users" :size="14" />
							<span v-if="neighbours[community.id] === null" class="lnx-skeleton count-skeleton" aria-hidden="true" />
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
		</TransitionGroup>

		<section v-if="search.trim() && (people.length || census.loading.value)" class="people" aria-live="polite">
			<h2>Vecinos</h2>
			<ul v-if="people.length" class="list">
				<li v-for="(person, index) in people" :key="`${person.to}-${index}`">
					<RouterLink class="row ux-row" :to="person.to">
						<span class="icon">
							<LnxIcon :icon="person.icon" :size="20" />
						</span>
						<span class="body">
							<strong>
								<template v-for="(segment, part) in person.titleSegments" :key="part">
									<mark v-if="segment.mark">{{ segment.text }}</mark>
									<template v-else>{{ segment.text }}</template>
								</template>
							</strong>
							<small>
								{{ person.section }} ·
								<template v-for="(segment, part) in person.textSegments" :key="part">
									<mark v-if="segment.mark">{{ segment.text }}</mark>
									<template v-else>{{ segment.text }}</template>
								</template>
							</small>
						</span>
						<LnxIcon class="chevron" icon="lucide:chevron-right" :size="18" />
					</RouterLink>
				</li>
			</ul>
			<p v-else class="hint">
				Buscando entre los vecinos…
			</p>
		</section>

		<section v-else-if="!filtered.length" class="empty" role="status">
			<LnxIcon icon="lucide:search-x" :size="40" />
			<p>Nada coincide con «{{ search.trim() }}». Prueba con otra parte del nombre, la dirección, el piso o el NIF.</p>
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

.actions {
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-2);
}

.search {
	margin-bottom: var(--lnx-spacing-4);
	width: 100%;
}

.count-skeleton {
	width: 1.5em;
	height: 1em;
}

.error {
	color: var(--color-secondary-accent);
}

.list {
	position: relative;
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
			text-wrap: balance;
		}

		.lnx-skeleton + .lnx-skeleton {
			margin-top: 6px;
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
		transition: translate var(--duration) var(--ease-spring), color var(--duration) var(--ease-out);
	}

	&:hover .chevron {
		translate: 2px 0;
		color: var(--color-gray-7);
	}

	.meta-skeleton {
		width: 72px;
	}
}

// Filtering: the ones left slide into place, the rest fade out of it
.row-move,
.row-enter-active,
.row-leave-active {
	transition: opacity var(--duration) var(--ease-out), translate var(--duration) var(--ease-out);
}

.row-enter-from,
.row-leave-to {
	opacity: 0;
	translate: 0 -4px;
}

.row-leave-active {
	position: absolute;
	width: 100%;
}

.people {
	margin-top: var(--lnx-spacing-5);

	h2 {
		margin-bottom: var(--lnx-spacing-3);
		font-size: var(--lnx-font-size-subtitle);
	}

	mark {
		border-radius: 2px;
		background: #fde68a;
		color: inherit;
	}
}

.hint {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
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
