<script setup lang="ts">
import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { ComponentPublicInstance } from 'vue';
import type { LayoutItem } from '../domain/tiles.ts';
import { getIssueCategories } from '@gobernansa/shared/domain/issue.ts';
import { LnxButton, LnxIcon, toast, useEventListener, useShortcut } from 'lnxjs-components';
import { computed, nextTick, onActivated, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import BackButton from '@/app/ux/BackButton.vue';
import { onRevalidate, useRevalidated } from '@/app/ux/navigation.ts';
import { loadTileFigures } from '@/modules/finances/application/useFinanceSummary.ts';
import { loadCommunity } from '../application/useCommunities.ts';
import { loadNeighbourFigures } from '../application/useCommunityDashboard.ts';
import { defaultLayout, nextSize, sizeLabels, tilesByKey, toLayout } from '../domain/tiles.ts';
import CommunityDashboard from './CommunityDashboard.vue';
import CommunityMenu from './CommunityMenu.vue';
import CommunitySearch from './CommunitySearch.vue';
import CommunitySetup from './CommunitySetup.vue';
import CommunityTile from './CommunityTile.vue';

const props = defineProps<{ id: string }>();

// v2 since the tiles were merged into workspaces, so everyone gets the new default
const LAYOUT_KEY = 'gobernansa.admin.communityLayout.v2';

const dashboard = ref<InstanceType<typeof CommunityDashboard>>();
const communityMenu = ref<InstanceType<typeof CommunityMenu>>();

const community = ref<Community>();
const loading = ref(true);
const loadError = ref<string>();

// Read again each time the page comes back, showing the last one meanwhile. A failed reread keeps it
async function load() {
	try {
		community.value = await loadCommunity(props.id);
		loadError.value = undefined;
	} catch (e) {
		if (!community.value) {
			loadError.value = (e as Error).message;
		}
	} finally {
		loading.value = false;
	}
}
onMounted(load);
onRevalidate(load);

const router = useRouter();
useShortcut('e', () => void router.push(`/communities/${props.id}/info`), { description: 'Editar los datos de la comunidad' });

// The same figures as the Finanzas summary, the cheaper ones
const { data: finances, loading: financesLoading } = useRevalidated(async () => loadTileFigures(props.id));
// Counts of the neighbours' pages, 4 reads
const { data: neighbours, loading: neighboursLoading } = useRevalidated(async () => loadNeighbourFigures(props.id));

// For screen readers, what copying, moving or resizing a tile did
const announcement = ref('');

/* Layout */
// Saved in the order and size the admin left them
// ponytail: per browser and the same for every community, move it to the user profile to follow the admin between devices
function loadLayout(): LayoutItem[] {
	let saved: unknown;
	try {
		saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '[]');
	} catch {
		// Blocked storage or a broken value, the default layout then
	}

	return toLayout(saved);
}

const layout = ref(loadLayout());
// Only what the admin changed, so a new default reaches those who didn't
watch(layout, (value) => {
	try {
		if (JSON.stringify(value) === JSON.stringify(defaultLayout)) {
			localStorage.removeItem(LAYOUT_KEY);
		} else {
			localStorage.setItem(LAYOUT_KEY, JSON.stringify(value));
		}
	} catch {
		// The layout just won't be remembered
	}
}, { deep: true });

const tiles = computed(() => layout.value.map(({ key, size }) => ({ ...tilesByKey.get(key)!, size })));

const editing = ref(false);
// Shared by every community, so another kept page may have changed it meanwhile
onActivated(() => {
	if (!editing.value) {
		layout.value = loadLayout();
	}
});
const doneButton = ref<ComponentPublicInstance>();

async function startEditing() {
	editing.value = true;
	await nextTick();
	(doneButton.value?.$el as HTMLElement | undefined)?.focus();
}

async function stopEditing() {
	editing.value = false;
	await nextTick();
	communityMenu.value?.focus();
}

function resetLayout() {
	const previous = layout.value;
	layout.value = structuredClone(defaultLayout);
	announcement.value = 'Vista restablecida';
	toast('Vista restablecida', { undo: async () => layout.value = previous });
}

// Escape leaves the edit mode, unless it was for the search or the menu
function onKeydown(event: KeyboardEvent) {
	if (event.key === 'Escape' && editing.value && !event.defaultPrevented && !(event.target as HTMLElement).closest('input, textarea, [popover]')) {
		stopEditing();
	}
}
useEventListener(window, 'keydown', onKeydown);

function move(from: number, to: number) {
	const [item] = layout.value.splice(from, 1);
	layout.value.splice(to, 0, item);
	announcement.value = `${tilesByKey.get(item.key)!.title} movido a la posición ${to + 1}`;
}

function resize(index: number) {
	const item = layout.value[index];
	const { sizes, title } = tilesByKey.get(item.key)!;
	item.size = sizes[(sizes.indexOf(item.size) + 1) % sizes.length];
	announcement.value = `${title}: tamaño ${sizeLabels[item.size]}`;
}

// Arrows move the tile one place, the focus stays on its handle
async function onHandleKeydown(event: KeyboardEvent, index: number) {
	const step = ({ ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 } as Record<string, number>)[event.key];
	const to = index + (step ?? 0);
	if (!step || to < 0 || to >= layout.value.length) {
		return;
	}

	event.preventDefault();
	const { key } = layout.value[index];
	move(index, to);
	await nextTick();
	document.querySelector<HTMLElement>(`[data-handle="${key}"]`)?.focus();
}

// Native drag and drop, only from the handle: the tile is draggable while the pointer is down on it
const armedKey = ref<string>();
const draggedKey = ref<string>();
const dropTarget = ref<{ key: string; after: boolean }>();

function onDragStart(event: DragEvent, key: string) {
	draggedKey.value = key;
	event.dataTransfer!.effectAllowed = 'move';
	event.dataTransfer!.setData('text/plain', key);
}

function onDragOver(event: DragEvent, key: string) {
	if (!draggedKey.value) {
		return;
	}

	event.preventDefault();
	const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
	dropTarget.value = key === draggedKey.value ? undefined : { key, after: event.clientX > rect.left + rect.width / 2 };
}

function onDrop(event: DragEvent) {
	event.preventDefault();
	if (draggedKey.value && dropTarget.value) {
		const from = layout.value.findIndex(({ key }) => key === draggedKey.value);
		const target = layout.value.findIndex(({ key }) => key === dropTarget.value!.key);
		// Once taken out, the ones after it move one place back
		const to = target + (dropTarget.value.after ? 1 : 0) - (from < target ? 1 : 0);
		move(from, to);
	}
	onDragEnd();
}

function onDragEnd() {
	armedKey.value = undefined;
	draggedKey.value = undefined;
	dropTarget.value = undefined;
}

// Releasing the pointer anywhere without dragging disarms the handle, or the whole tile would stay draggable
function disarm() {
	armedKey.value = undefined;
}
useEventListener(window, 'pointerup', disarm);
</script>

<template>
	<header class="page-header">
		<BackButton to="/" label="Volver a comunidades" />
		<h1 :style="{ viewTransitionName: `community-${id}` }">
			<span v-if="loading" class="lnx-skeleton lnx-skeleton--title" style="width: 40%" />
			<template v-else>
				{{ community?.name || 'Comunidad' }}
			</template>
		</h1>
		<CommunityMenu ref="communityMenu" :community-id="id" :can-edit="!!community" @edit="startEditing()" @customize="dashboard?.customize()" />
	</header>

	<CommunitySetup :community-id="id" :community :neighbours />

	<CommunityDashboard ref="dashboard" :community-id="id" :categories="community && getIssueCategories(community)" />

	<CommunitySearch :community-id="id" :community="community" />

	<section v-if="loadError || (!loading && !community)" class="status">
		<p v-if="loadError" class="error" role="alert">
			No se ha podido cargar la comunidad: {{ loadError }}
		</p>
		<p v-else>
			Esta comunidad no existe o se ha borrado.
		</p>
		<LnxButton to="/" mode="outline">
			Volver a comunidades
		</LnxButton>
	</section>

	<template v-else>
		<div v-if="editing" class="edit-bar">
			<p id="edit-help">
				Arrastra cada tarjeta por su asa, o muévela con las flechas, y cambia su tamaño con su botón.
			</p>
			<LnxButton mode="clear" class="lnx-size-small" @click="resetLayout()">
				<LnxIcon icon="lucide:rotate-ccw" />
				Restablecer
			</LnxButton>
			<LnxButton ref="doneButton" class="lnx-size-small" @click="stopEditing()">
				<LnxIcon icon="lucide:check" />
				Listo
			</LnxButton>
		</div>
		<p class="sr-only" aria-live="polite">
			{{ announcement }}
		</p>

		<TransitionGroup tag="ul" name="tile" class="bento" :class="{ editing }" :aria-busy="loading">
			<li
				v-for="(tile, index) in tiles"
				:key="tile.key"
				:class="[tile.key, `size-${tile.size}`, {
					'dragging': draggedKey === tile.key,
					'drop-before': dropTarget?.key === tile.key && !dropTarget.after,
					'drop-after': dropTarget?.key === tile.key && dropTarget.after,
				}]"
				:style="{ '--index': index }"
				:draggable="editing && armedKey === tile.key"
				@dragstart="onDragStart($event, tile.key)"
				@dragover="onDragOver($event, tile.key)"
				@drop="onDrop($event)"
				@dragend="onDragEnd()"
			>
				<CommunityTile
					:tile
					:community-id="id"
					:community
					:editing
					:loading
					:finances
					:finances-loading
					:neighbours
					:neighbours-loading
					@announce="announcement = $event"
				/>

				<div v-if="editing" class="edit-controls">
					<LnxButton
						mode="clear"
						shape="circle"
						class="handle lnx-size-small"
						:data-handle="tile.key"
						:aria-label="`Mover ${tile.title}`"
						:title="`Mover ${tile.title}`"
						aria-describedby="edit-help"
						@pointerdown="armedKey = tile.key"
						@keydown="onHandleKeydown($event, index)"
					>
						<LnxIcon icon="lucide:grip-vertical" />
					</LnxButton>
					<LnxButton
						mode="clear"
						shape="circle"
						class="lnx-size-small"
						:aria-label="`Cambiar tamaño de ${tile.title} (ahora ${sizeLabels[tile.size]}, pasará a ${sizeLabels[nextSize(tile)]})`"
						:title="`Cambiar tamaño de ${tile.title} (ahora ${sizeLabels[tile.size]}, pasará a ${sizeLabels[nextSize(tile)]})`"
						@click="resize(index)"
					>
						<LnxIcon :icon="nextSize(tile) > tile.size ? 'lucide:maximize-2' : 'lucide:minimize-2'" />
					</LnxButton>
				</div>
			</li>
		</TransitionGroup>
	</template>
</template>

<style lang="scss" scoped>
.page-header {
	h1 {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		font-size: var(--lnx-font-size-title);
		white-space: nowrap;
		text-overflow: ellipsis;
	}
}

.status {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: var(--lnx-spacing-3);
}

.error {
	font-size: inherit;
}

.edit-bar {
	position: sticky;
	top: 0;
	z-index: 3;
	margin-bottom: var(--lnx-spacing-4);
	padding: var(--lnx-spacing-2) var(--lnx-spacing-3);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--lnx-spacing-2);
	background: color-mix(in srgb, var(--color-gray-0) 90%, transparent);
	backdrop-filter: blur(8px);

	p {
		flex: 1 1 240px;
		color: var(--color-gray-7);
		font-size: var(--lnx-font-size-small);
	}
}

// Fixed rows, so a tile of size 4 is really twice as tall, and dense to fill the gaps a big tile leaves
.bento {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	grid-auto-rows: 148px;
	grid-auto-flow: dense;
	gap: var(--lnx-spacing-4);

	> li {
		position: relative;
		min-width: 0;
		display: flex;
	}

	> .size-2 {
		grid-column: span 2;
	}

	> .size-4 {
		grid-column: span 2;
		grid-row: span 2;
	}

	> .dragging {
		opacity: .4;
	}

	// In order while arranging, so a tile lands where its drop bar or its position says
	&.editing {
		grid-auto-flow: row;
	}

	// Where the dragged tile will drop, a bar in the gap before or after the tile under the pointer
	> :is(.drop-before, .drop-after)::before {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		left: calc(var(--lnx-spacing-4) / -2 - 2px);
		width: 4px;
		border-radius: var(--lnx-radius-2);
		background: var(--color-primary);
	}

	> .drop-after::before {
		left: auto;
		right: calc(var(--lnx-spacing-4) / -2 - 2px);
	}
}

// Like the apps of a phone being arranged, each tile a bit out of step with the next
.editing > li {
	--wiggle: 1deg;
	// rotate and not transform, which the reordering slides with
	animation: wiggle .28s ease-in-out infinite alternate;
	animation-delay: calc(var(--index) * -.09s);

	&.size-2 {
		--wiggle: .5deg;
	}

	&.size-4 {
		--wiggle: .35deg;
	}

	&.dragging {
		animation: none;
	}
}

@keyframes wiggle {
	from {
		rotate: calc(var(--wiggle) * -1);
	}

	to {
		rotate: var(--wiggle);
	}
}

// Moving, resizing or resetting the tiles slides them into their new place
.tile-move {
	transition: transform .3s var(--ease-out);
}

@media (prefers-reduced-motion: reduce) {
	.editing > li {
		border-radius: var(--lnx-radius-3);
		outline: 2px dashed var(--color-gray-5);
		outline-offset: 2px;
		animation: none;
	}

	// Only fading, without sliding or scaling
	.tile-move {
		translate: none !important;
		scale: none !important;
		transition-property: opacity, visibility, overlay, display;
	}
}

.edit-controls {
	position: absolute;
	top: var(--lnx-spacing-2);
	right: var(--lnx-spacing-2);
	z-index: 2;
	padding: 2px;
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-4);
	display: flex;
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000F;

	.handle {
		cursor: grab;
		touch-action: none;
	}
}

@media (max-width: 640px) {
	.bento {
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--lnx-spacing-3);
	}
}
</style>
