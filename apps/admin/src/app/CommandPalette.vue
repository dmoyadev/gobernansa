<script setup lang="ts">
import type { SearchEntry, Segment } from '@/modules/communities/application/useCommunitySearch.ts';
import { LnxIcon, LnxKbd } from 'lnxjs-components';
import { computed, nextTick, onMounted, ref, useId, useTemplateRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useCommunities } from '@/modules/communities/application/useCommunities.ts';
import { rank, useCommunitySearch, useNeighbourSearch } from '@/modules/communities/application/useCommunitySearch.ts';
import { paletteMode } from './palette.ts';

// ⌘K from any page: a community, a section of the app or, inside a community, one of its pages. Mounted the first time
// it's opened, so only who uses it reads the communities
const props = defineProps<{ sections: { to: string; label: string; icon: string }[] }>();

const route = useRoute();
const router = useRouter();
const listId = useId();
const dialog = useTemplateRef('dialog');
const input = useTemplateRef('input');
const text = ref('');
const active = ref(0);

const { communities, loading } = useCommunities();
const currentId = computed(() => route.params.id as string | undefined);
const current = computed(() => communities.value.find(community => community.id === currentId.value));
// Its sections and what its doc has, without reading the rest: the search on its page does that
const inCommunity = useCommunitySearch(() => currentId.value ?? '', current);
// Every census, read only when asked for (about one read per home)
const neighbours = useNeighbourSearch(communities);
const neighboursRead = ref(false);

const switching = computed(() => paletteMode.value === 'switch');
const typed = computed(() => text.value.trim());

// The same page in another community: the route's path up to the first param of this community's own (an issue, a
// home…), then back to the nearest page there is. Only the id changes, and a section like info or contacts is kept
const ID = ':id';
const PARAM_REGEX = /^:(\w+)(\(.*\))?$/;
const samePage = computed(() => {
	const parts: string[] = [];
	for (const part of route.matched.at(-1)?.path.split('/') ?? []) {
		const [, name, choices] = PARAM_REGEX.exec(part) ?? [];
		if (name && name !== 'id' && !choices) {
			break;
		}
		parts.push(name && name !== 'id' ? String(route.params[name]) : part);
	}
	while (parts.length > 3 && !router.resolve(parts.join('/').replace(ID, currentId.value ?? '')).name) {
		parts.pop();
	}
	return parts.join('/');
});

const communityEntries = computed<SearchEntry[]>(() => communities.value.map(community => ({
	section: community.id === currentId.value ? 'Comunidad actual' : 'Comunidades',
	icon: 'lucide:building-2',
	title: community.name || 'Sin nombre',
	text: community.address ?? '',
	to: switching.value && currentId.value ? samePage.value.replace(ID, community.id) : `/communities/${community.id}`,
})));
const appEntries = computed(() => props.sections.map(section => ({ section: 'Ir a', icon: section.icon, title: section.label, text: '', to: section.to })));
// Places, opened as they are. The rest (contacts, documents, neighbours) open with what was typed highlighted
const PLACES = new Set(['Comunidades', 'Comunidad actual', 'Ir a', 'Secciones']);

const plain = (value: string): Segment[] => value ? [{ text: value, mark: false }] : [];
const found = computed(() => {
	if (!typed.value) {
		return communityEntries.value.map(entry => ({ ...entry, titleSegments: plain(entry.title), textSegments: plain(entry.text) }));
	}
	if (switching.value) {
		return rank(communityEntries.value, typed.value);
	}
	return rank([...communityEntries.value, ...(currentId.value ? inCommunity.entries.value : []), ...appEntries.value], typed.value);
});

// Last, the neighbours of every community: an option to choose, as it reads every census, then their matches
const NEIGHBOURS = 'neighbours';
const options = computed(() => {
	if (switching.value || !typed.value || !communities.value.length) {
		return found.value;
	}
	if (neighboursRead.value) {
		return [...found.value, ...neighbours.search(typed.value)];
	}
	const title = neighbours.loading.value ? 'Buscando entre los vecinos…' : `Buscar «${typed.value}» entre los vecinos`;
	const option = { section: 'Vecinos', icon: 'lucide:users', title, text: 'En el censo de todas tus comunidades', to: NEIGHBOURS };
	return [...found.value, { ...option, titleSegments: plain(option.title), textSegments: plain(option.text) }];
});
watch(text, () => active.value = 0);

async function go(index: number) {
	const option = options.value[index];
	if (!option || neighbours.loading.value) {
		return;
	}
	if (option.to === NEIGHBOURS) {
		await neighbours.loadIndex();
		neighboursRead.value = true;
		// On the first of them, where the option was
		active.value = Math.max(0, Math.min(index, options.value.length - 1));
		return;
	}
	close();
	if (PLACES.has(option.section)) {
		void router.push(option.to);
		return;
	}
	// Some already carry a query, e.g. the home to mark instead of what was typed
	const { path, query } = router.resolve(option.to);
	void router.push({ path, query: { highlight: typed.value, ...query } });
}

function move(step: number) {
	const count = options.value.length;
	if (count) {
		active.value = (active.value + step + count) % count;
		document.getElementById(`${listId}-${active.value}`)?.scrollIntoView({ block: 'nearest' });
	}
}

// Modal: the page's shortcuts behind it don't run (only ⌘K, which closes it). Escape is handled here, so a form
// open behind doesn't take it as its own
function onKeydown(event: KeyboardEvent) {
	if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
		event.preventDefault();
		move(event.key === 'ArrowDown' ? 1 : -1);
	} else if (event.key === 'Enter') {
		event.preventDefault();
		void go(active.value);
	} else if (event.key === 'Escape') {
		event.preventDefault();
		close();
	}
	if (!((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')) {
		event.stopPropagation();
	}
}

function close() {
	paletteMode.value = undefined;
}

// The focus goes back where it was when it closes
async function toggle(mode = paletteMode.value) {
	if (mode && !dialog.value?.open) {
		text.value = '';
		active.value = 0;
		dialog.value?.showModal();
		await nextTick();
		input.value?.focus();
	} else if (!mode) {
		dialog.value?.close();
	}
}
watch(paletteMode, toggle);
onMounted(toggle);

const status = computed(() => {
	if (loading.value && !communities.value.length) {
		return 'Cargando comunidades…';
	}
	const count = options.value.length;
	return count ? `${count} ${count === 1 ? 'resultado' : 'resultados'}` : `Sin resultados para «${typed.value}»`;
});
</script>

<template>
	<!-- A click on the backdrop lands on the dialog itself -->
	<dialog
		ref="dialog"
		class="palette"
		:aria-label="switching ? 'Cambiar de comunidad' : 'Buscar e ir a'"
		@close="close()"
		@click.self="close()"
		@keydown="onKeydown"
	>
		<label class="field">
			<LnxIcon :icon="switching ? 'lucide:building-2' : 'lucide:search'" :size="18" />
			<span class="sr-only">{{ switching ? 'Cambiar de comunidad' : 'Buscar e ir a' }}</span>
			<input
				ref="input"
				v-model="text"
				type="text"
				role="combobox"
				autocomplete="off"
				:placeholder="switching ? 'Busca la comunidad…' : currentId ? 'Busca una comunidad, una página de esta o una sección…' : 'Busca una comunidad o una sección…'"
				aria-autocomplete="list"
				:aria-expanded="options.length > 0"
				:aria-controls="listId"
				:aria-activedescendant="options.length ? `${listId}-${active}` : undefined"
			>
			<LnxKbd combo="escape" />
		</label>

		<!-- The focus stays in the input -->
		<ul v-if="options.length" :id="listId" role="listbox" aria-label="Resultados" @mousedown.prevent>
			<li
				v-for="(option, index) in options"
				:id="`${listId}-${index}`"
				:key="`${option.to}-${option.title}-${index}`"
				role="option"
				:aria-selected="index === active"
				:class="{ active: index === active }"
				@pointermove="active = index"
				@click="go(index)"
			>
				<span class="icon">
					<LnxIcon :icon="option.icon" :size="16" />
				</span>
				<span class="body">
					<span class="section">{{ option.section }}</span>
					<span class="title">
						<template v-for="(segment, part) in option.titleSegments" :key="part">
							<mark v-if="segment.mark">{{ segment.text }}</mark>
							<template v-else>{{ segment.text }}</template>
						</template>
					</span>
					<span v-if="option.textSegments.length" class="text">
						<template v-for="(segment, part) in option.textSegments" :key="part">
							<mark v-if="segment.mark">{{ segment.text }}</mark>
							<template v-else>{{ segment.text }}</template>
						</template>
					</span>
				</span>
			</li>
		</ul>
		<p v-else class="empty" aria-hidden="true">
			{{ status }}
		</p>
		<p class="sr-only" role="status">
			{{ status }}
		</p>
	</dialog>
</template>

<style lang="scss" scoped>
// Near the top, as tall as its results, over a dimmed page
.palette {
	margin: 12vh auto auto;
	width: min(640px, calc(100vw - 32px));
	max-height: min(560px, 76vh);
	padding: 0;
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: var(--lnx-elevation-4);
	color: var(--color-gray-8);
	opacity: 0;
	scale: .98;
	// Transitions, so closing while it opens turns back from where it is
	transition:
		opacity var(--duration-fast) var(--ease-out),
		scale var(--duration-fast) var(--ease-out),
		overlay var(--duration-fast) allow-discrete,
		display var(--duration-fast) allow-discrete;

	// The layout stays while it fades out, only display goes
	flex-direction: column;

	&[open] {
		display: flex;
		opacity: 1;
		scale: 1;

		@starting-style {
			opacity: 0;
			scale: .98;
		}
	}

	&::backdrop {
		background: color-mix(in srgb, var(--color-gray-10) 30%, transparent);
		opacity: 0;
		transition: opacity var(--duration-fast) var(--ease-out), overlay var(--duration-fast) allow-discrete, display var(--duration-fast) allow-discrete;
	}

	&[open]::backdrop {
		opacity: 1;

		@starting-style {
			opacity: 0;
		}
	}
}

.field {
	flex-shrink: 0;
	padding: 0 var(--lnx-spacing-4);
	border-bottom: 1px solid var(--color-gray-3);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
	color: var(--color-gray-6);

	input {
		flex: 1;
		min-width: 0;
		height: 52px;
		border: 0;
		background: none;
		color: var(--color-gray-9);
		font: inherit;
		outline: none;

		&::placeholder {
			color: var(--color-gray-5);
		}
	}
}

ul {
	overflow-y: auto;
	padding: var(--lnx-spacing-1);
}

li {
	padding: var(--lnx-spacing-2) var(--lnx-spacing-3);
	border-radius: var(--lnx-radius-2);
	display: flex;
	align-items: flex-start;
	gap: var(--lnx-spacing-3);
	cursor: pointer;

	&.active {
		background: var(--color-gray-1);
	}

	&:active {
		scale: .99;
	}
}

.icon {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 32px;
	height: 32px;
	border-radius: var(--lnx-radius-circle);
	background: var(--color-gray-2);
	color: var(--color-primary);
}

.body {
	min-width: 0;
	display: flex;
	flex-direction: column;
}

.section {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.title {
	color: var(--color-gray-9);
	font-weight: var(--lnx-font-weight-bold);
}

.title,
.text {
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.text {
	color: var(--color-gray-7);
	font-size: var(--lnx-font-size-small);
}

// The browser's own highlight colour
mark {
	border-radius: 2px;
	color: inherit;
}

.empty {
	padding: var(--lnx-spacing-4);
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}
</style>
