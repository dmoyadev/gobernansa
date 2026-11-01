<script setup lang="ts">
import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { ComponentPublicInstance } from 'vue';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { getCommonAreas } from '@gobernansa/shared/domain/community.ts';
import { isValidIban, isValidNif } from '@gobernansa/shared/domain/fiscal.ts';
import { DEFAULT_MONTHLY_VOTES } from '@gobernansa/shared/domain/issue.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import CommunityBusinessCard from '@gobernansa/shared/ui/CommunityBusinessCard.vue';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed, nextTick, onActivated, onDeactivated, onMounted, ref, useId, watch } from 'vue';
import { useRouter } from 'vue-router';
import BackButton from '@/app/ux/BackButton.vue';
import { onRevalidate, useRevalidated } from '@/app/ux/navigation.ts';
import { useEventListener, useShortcut } from '@/app/ux/shortcuts.ts';
import { toast } from '@/app/ux/toast.ts';
import { workspaces } from '@/app/workspace/workspaces.ts';
import { loadTileFigures } from '@/modules/finances/application/useFinanceSummary.ts';
import { loadCommunity } from '../application/useCommunities.ts';
import { loadNeighbourFigures } from '../application/useCommunityDashboard.ts';
import CommunityDashboard from './CommunityDashboard.vue';
import CommunitySearch from './CommunitySearch.vue';

const props = defineProps<{ id: string }>();

const SPACES_REGEX = /\s/g;
// v2 since the tiles were merged into workspaces, so everyone gets the new default
const LAYOUT_KEY = 'gobernansa.admin.communityLayout.v2';

// 1 is one cell of the bento, 2 two side by side and 4 a square of two by two. Bigger tiles show more
type TileSize = 1 | 2 | 4;

interface Tile {
	// The page it opens, /communities/:id/<key>: a page of its own or the first of a workspace
	key: string;
	title: string;
	icon: string;
	description: string;
	// What can be done there, for the pages shown at size 2
	details?: string;
	sizes: TileSize[];
	size: TileSize;
}

// In their default order and size, the community's data first and big, then its workspaces and the pages filling the rows
const allTiles: Tile[] = [
	{ key: 'info', title: 'Comunidad', icon: 'lucide:building-2', description: 'Datos generales, contactos, documentación y configuración', sizes: [1, 2, 4], size: 4 },
	{ key: 'people', title: 'Vecinos', icon: 'lucide:users', description: 'Propiedades, cuentas e invitaciones', sizes: [1, 2], size: 2 },
	{ key: 'finances', title: 'Finanzas', icon: 'lucide:wallet', description: 'Pendiente de cobro, facturas vencidas y banco', sizes: [1, 2], size: 2 },
	{ key: 'issues', title: 'Incidencias', icon: 'lucide:message-square-warning', description: 'Estado y respuestas a los vecinos', details: 'Revisa lo que avisan los vecinos, cambia su estado y respóndeles.', sizes: [1, 2], size: 2 },
	{ key: 'meetings', title: 'Juntas', icon: 'lucide:gavel', description: 'Convocatorias, asistencia y votaciones', details: 'Convoca juntas, lleva la asistencia, recoge las votaciones y redacta el acta.', sizes: [1, 2], size: 2 },
	{ key: 'locations', title: 'Zonas comunes y reservas', icon: 'lucide:map-pin', description: 'Lugares de los avisos y zonas que se reservan', sizes: [1, 2, 4], size: 2 },
	{ key: 'notifications', title: 'Avisos', icon: 'lucide:bell', description: 'Avisos y eventos de la comunidad', details: 'Publica avisos y eventos que llegan a todos los vecinos de la comunidad.', sizes: [1, 2], size: 1 },
	{ key: 'obligations', title: 'Obligaciones', icon: 'lucide:calendar-check', description: 'IEE, ascensor, extintores, seguro…', details: 'Vencimientos de inspecciones, revisiones y seguros, con su proveedor y aviso previo.', sizes: [1, 2], size: 1 },
];
const tilesByKey = new Map(allTiles.map(tile => [tile.key, tile]));
// The tiles showing the community's data, skeletons until it's loaded
const dataKeys = ['info', 'locations'];
const sizeLabels: Record<TileSize, string> = { 1: 'pequeña', 2: 'ancha', 4: 'grande' };
// Placeholder lines while the community loads, as many as the tile shows and as wide as real ones tend to be
const SKELETON_WIDTHS = [72, 54, 80, 46, 64, 58];
const skeletonLines = (size: TileSize) => SKELETON_WIDTHS.slice(0, size === 1 ? 1 : size === 2 ? 3 : 6);

const { user } = useAuth();
const menuId = useId();
const dashboard = ref<InstanceType<typeof CommunityDashboard>>();

// The webapp as its neighbours see it, to give them support. The admin signs in there with the same account
const webappUrl = `${(import.meta.env.VITE_WEBAPP_URL as string | undefined) || 'https://gobernansa.dmoya.dev'}/?viewAs=${props.id}`;

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
useShortcut('e', () => void router.push(`/communities/${props.id}/info`), 'Editar los datos de la comunidad');

// What the tiles show, from the community already loaded: no reads of their own
const contacts = computed(() => community.value?.contacts ?? []);
const documents = computed(() => community.value?.documents ?? []);
const commonAreas = computed(() => getCommonAreas(community.value));
const bookableAreas = computed(() => commonAreas.value.filter(area => area.booking));
// The same figures as the Finanzas summary, the cheaper ones
const { data: finances, loading: financesLoading } = useRevalidated(async () => loadTileFigures(props.id));
// Counts of the neighbours' pages, 4 reads
const { data: neighbours, loading: neighboursLoading } = useRevalidated(async () => loadNeighbourFigures(props.id));
const adoption = computed(() => neighbours.value?.homes ? Math.min(100, Math.round(neighbours.value.registered / neighbours.value.homes * 100)) : undefined);

const summary = computed(() => `${count(contacts.value.length, 'contacto', 'contactos')} · ${count(documents.value.length, 'documento', 'documentos')} · ${count(community.value?.monthlyVotes ?? DEFAULT_MONTHLY_VOTES, 'voto', 'votos')} al mes`);
// What the community lacks, each opening the section where it's filled in
const flags = computed(() => {
	const { cif, iban } = community.value ?? {};
	return [
		!cif || !isValidNif(cif) ? { label: cif ? 'CIF no válido' : 'Sin CIF', short: 'CIF', section: 'info' } : undefined,
		!iban || !isValidIban(iban) ? { label: iban ? 'IBAN no válido' : 'Sin IBAN', short: 'IBAN', section: 'info' } : undefined,
		!documents.value.some(document => document.type === 'insurance') ? { label: 'Sin póliza del seguro', short: 'póliza del seguro', section: 'documents' } : undefined,
		!contacts.value.length ? { label: 'Sin contactos', short: 'contactos', section: 'contacts' } : undefined,
	].filter(flag => !!flag);
});
const missing = computed(() => `Por completar: ${flags.value.map(flag => flag.short).join(', ')}`);

function count(total: number, one: string, many: string) {
	return `${total} ${total === 1 ? one : many}`;
}

/* Fiscal data */
// For screen readers, what copying, moving or resizing a tile did
const announcement = ref('');
const copyable = computed(() => [
	{ label: 'CIF', value: community.value?.cif },
	{ label: 'IBAN', value: community.value?.iban },
].filter((item): item is { label: string; value: string } => !!item.value));
const copied = ref<string>();
async function copy(label: string, value: string) {
	try {
		await navigator.clipboard.writeText(value.replace(SPACES_REGEX, ''));
		copied.value = label;
		announcement.value = `${label} copiado`;
	} catch {
		// e.g. the browser denies the permission
		announcement.value = `No se ha podido copiar el ${label}`;
		return;
	}

	setTimeout(() => {
		if (copied.value === label) {
			copied.value = undefined;
		}
	}, 2000);
}

/* Menu */
const menu = ref<HTMLElement>();
const menuButton = ref<ComponentPublicInstance>();
const menuOpen = ref(false);
const menuPosition = ref<{ top: string; right: string }>();

function closeMenu() {
	if (menuOpen.value) {
		menu.value?.hidePopover();
	}
}

// A native popover: it closes when clicking outside or with Escape, and gives the focus back to its button.
// Placed once when it opens, so it closes on scroll or resize instead of drifting away from its button
useEventListener(document, 'scroll', closeMenu, { capture: true, passive: true });
useEventListener(window, 'resize', closeMenu);
// Leaving the page takes the popover out of the document without a toggle event
onDeactivated(() => {
	menuOpen.value = false;
	closeGo();
});

function onMenuToggle(event: Event) {
	menuOpen.value = (event as ToggleEvent).newState === 'open';
	if (!menuOpen.value) {
		closeGo();
		return;
	}

	const rect = (menuButton.value!.$el as HTMLElement).getBoundingClientRect();
	menuPosition.value = { top: `${rect.bottom + 4}px`, right: `${window.innerWidth - rect.right}px` };
	menu.value?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
}

function onMenuKeydown(event: KeyboardEvent) {
	if (event.key === 'Tab') {
		closeMenu();
		return;
	}

	// Its own items, not the submenu's
	focusSibling(event, [...menu.value!.querySelectorAll<HTMLElement>(':scope > [role="menuitem"], :scope > .go > [role="menuitem"]')], () => closeGo());
}

// Arrows, Home and End move the focus between the items of a menu
function focusSibling(event: KeyboardEvent, items: HTMLElement[], onMove?: () => void) {
	const index = items.indexOf(document.activeElement as HTMLElement);
	// With none focused, ArrowUp goes to the last one
	const next = { ArrowDown: index + 1, ArrowUp: (index < 0 ? 0 : index) - 1, Home: 0, End: items.length - 1 }[event.key];
	if (next === undefined) {
		return;
	}

	event.preventDefault();
	onMove?.();
	items[(next + items.length) % items.length]?.focus();
}

/* "Ir a…" submenu */
// A section of a workspace by the key of its first page, as the nav names it
function workspaceSection(workspace: string, key: string) {
	const { title, icon } = workspaces[workspace].sectionOf.get(key)!;
	return { key, label: title, icon };
}
const goSections = computed(() => [
	{ key: 'issues', label: 'Incidencias', icon: 'lucide:message-square-warning' },
	workspaceSection('neighbours', 'people'),
	workspaceSection('neighbours', 'properties'),
	{ key: 'meetings', label: 'Juntas', icon: 'lucide:gavel' },
	{ key: 'finances', label: workspaces.finances.title, icon: workspaces.finances.summary!.icon },
	workspaceSection('finances', 'charges'),
	workspaceSection('finances', 'budget'),
	{ key: 'obligations', label: 'Obligaciones', icon: 'lucide:calendar-check' },
	{ key: 'locations', label: 'Zonas comunes', icon: 'lucide:map-pin' },
	{ key: 'notifications', label: 'Avisos', icon: 'lucide:bell' },
	{ key: 'activity', label: 'Registro de actividad', icon: 'lucide:history' },
	workspaceSection('community', 'info'),
].map(section => ({ ...section, to: `/communities/${props.id}/${section.key}` })));

const GO_CLOSE_MS = 300;
const VIEWPORT_MARGIN = 8;
const goTrigger = ref<HTMLElement>();
const submenu = ref<HTMLElement>();
const goOpen = ref(false);
// To the left when there's no room on the right, and moved up when it would go past the bottom
const goPlacement = ref({ left: false, top: 0 });
// The safe triangle, from the pointer to the submenu's near corners
const safeArea = ref<Record<string, string>>();
let closeTimer: ReturnType<typeof setTimeout> | undefined;
let restTimer: ReturnType<typeof setTimeout> | undefined;

function openGo(focusFirst = false) {
	clearTimeout(closeTimer);
	if (!goOpen.value) {
		const trigger = goTrigger.value!.getBoundingClientRect();
		const { offsetWidth: width, offsetHeight: height } = submenu.value!;
		goPlacement.value = {
			left: trigger.right + width + VIEWPORT_MARGIN > window.innerWidth && trigger.left - width > VIEWPORT_MARGIN,
			top: Math.min(0, window.innerHeight - VIEWPORT_MARGIN - trigger.top - height),
		};
		goOpen.value = true;
	}
	if (focusFirst) {
		submenu.value?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
	}
}

function closeGo() {
	clearTimeout(closeTimer);
	clearTimeout(restTimer);
	goOpen.value = false;
	safeArea.value = undefined;
}

// Unless the pointer comes back to the trigger or reaches the submenu meanwhile
function scheduleCloseGo() {
	clearTimeout(closeTimer);
	closeTimer = setTimeout(closeGo, GO_CLOSE_MS);
}

// While the pointer heads from "Ir a…" to the submenu it crosses the items below or above it. A triangle from the
// pointer to the submenu's near edge covers them, so they're neither hovered nor close it: the Amazon safe triangle.
// If the pointer rests a moment, the triangle goes and those items can be pointed at again
function onTriggerPointermove(event: PointerEvent) {
	if (event.pointerType === 'touch' || !goOpen.value) {
		return;
	}
	clearTimeout(closeTimer);
	const trigger = goTrigger.value!.getBoundingClientRect();
	const target = submenu.value!.getBoundingClientRect();
	const x = event.clientX - trigger.left;
	const y = event.clientY - trigger.top;
	const edge = (goPlacement.value.left ? target.right : target.left) - trigger.left;
	const top = Math.min(y, target.top - trigger.top);
	const bottom = Math.max(y, target.bottom - trigger.top);
	const left = Math.min(x, edge);
	const width = Math.max(1, Math.abs(edge - x));
	const point = (px: number, py: number) => `${px - left}px ${py - top}px`;
	safeArea.value = {
		left: `${left}px`,
		top: `${top}px`,
		width: `${width}px`,
		height: `${bottom - top}px`,
		clipPath: `polygon(${point(x, y)}, ${point(edge, target.top - trigger.top)}, ${point(edge, target.bottom - trigger.top)})`,
	};
	clearTimeout(restTimer);
	restTimer = setTimeout(() => safeArea.value = undefined, GO_CLOSE_MS);
}

function onTriggerKeydown(event: KeyboardEvent) {
	if (['ArrowRight', 'Enter', ' '].includes(event.key)) {
		event.preventDefault();
		event.stopPropagation();
		openGo(true);
	}
}

function onSubmenuKeydown(event: KeyboardEvent) {
	if (event.key === 'ArrowLeft' || event.key === 'Escape') {
		// Back to its item, without closing the whole menu
		event.preventDefault();
		event.stopPropagation();
		closeGo();
		goTrigger.value?.focus();
		return;
	}
	if (event.key !== 'Tab') {
		event.stopPropagation();
		focusSibling(event, [...submenu.value!.querySelectorAll<HTMLElement>('[role="menuitem"]')]);
	}
}

/* Layout */
interface LayoutItem { key: string; size: TileSize }

const defaultLayout = allTiles.map(({ key, size }) => ({ key, size }));

// Saved in the order and size the admin left them. Unknown tiles are dropped and new ones are added at the end
// ponytail: per browser and the same for every community, move it to the user profile to follow the admin between devices
function loadLayout(): LayoutItem[] {
	let saved: unknown;
	try {
		saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '[]');
	} catch {
		// Blocked storage or a broken value, the default layout then
	}

	const items = (Array.isArray(saved) ? saved as LayoutItem[] : [])
		.filter((item, index, all) => tilesByKey.get(item?.key)?.sizes.includes(item.size) && all.findIndex(other => other.key === item.key) === index);
	// Copies, resizing a tile mustn't change the defaults it's reset to
	return structuredClone([...items, ...defaultLayout.filter(item => !items.some(({ key }) => key === item.key))]);
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
	closeMenu();
	editing.value = true;
	await nextTick();
	(doneButton.value?.$el as HTMLElement | undefined)?.focus();
}

async function stopEditing() {
	editing.value = false;
	await nextTick();
	(menuButton.value?.$el as HTMLElement | undefined)?.focus();
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

function nextSize(tile: Tile) {
	return tile.sizes[(tile.sizes.indexOf(tile.size) + 1) % tile.sizes.length];
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
			<span v-if="loading" class="skeleton-item skeleton-item--title" style="width: 40%" />
			<template v-else>
				{{ community?.name || 'Comunidad' }}
			</template>
		</h1>
		<LnxButton
			ref="menuButton"
			mode="clear"
			shape="circle"
			aria-label="Más opciones"
			title="Más opciones"
			aria-haspopup="menu"
			:aria-expanded="menuOpen"
			:aria-controls="menuId"
			:popovertarget="menuId"
		>
			<LnxIcon icon="lucide:ellipsis-vertical" />
		</LnxButton>
		<div
			:id="menuId"
			ref="menu"
			popover
			class="menu"
			role="menu"
			aria-label="Más opciones"
			:style="menuPosition"
			@toggle="onMenuToggle"
			@keydown="onMenuKeydown"
		>
			<a role="menuitem" tabindex="-1" :href="webappUrl" target="_blank" rel="noopener" @click="menu?.hidePopover()">
				<LnxIcon icon="lucide:eye" />
				Ver como un vecino
			</a>
			<RouterLink
				v-if="user?.role === 'superadmin'"
				role="menuitem"
				tabindex="-1"
				:to="`/communities/new?from=${id}`"
				@click="menu?.hidePopover()"
			>
				<LnxIcon icon="lucide:copy" />
				Duplicar esta comunidad
			</RouterLink>
			<div class="go" @pointerenter="openGo()" @pointerleave="scheduleCloseGo()">
				<button
					ref="goTrigger"
					type="button"
					role="menuitem"
					tabindex="-1"
					aria-haspopup="menu"
					:aria-expanded="goOpen"
					:aria-controls="`${menuId}-go`"
					:class="{ open: goOpen }"
					@click="openGo()"
					@pointermove="onTriggerPointermove"
					@keydown="onTriggerKeydown"
				>
					<LnxIcon icon="lucide:compass" />
					Ir a…
					<LnxIcon class="chevron" icon="lucide:chevron-right" />
					<span v-if="safeArea" class="safe-area" :style="safeArea" aria-hidden="true" />
				</button>
				<div
					:id="`${menuId}-go`"
					ref="submenu"
					class="submenu"
					:class="{ open: goOpen, left: goPlacement.left }"
					:style="{ '--offset': `${goPlacement.top}px` }"
					role="menu"
					aria-label="Ir a"
					@keydown="onSubmenuKeydown"
				>
					<RouterLink v-for="section in goSections" :key="section.key" role="menuitem" tabindex="-1" :to="section.to" @click="closeMenu()">
						<LnxIcon :icon="section.icon" />
						{{ section.label }}
					</RouterLink>
				</div>
			</div>
			<button v-if="community" type="button" role="menuitem" tabindex="-1" @click="startEditing()">
				<LnxIcon icon="lucide:layout-dashboard" />
				Editar vista
			</button>
			<button type="button" role="menuitem" tabindex="-1" @click="closeMenu(); dashboard?.customize()">
				<LnxIcon icon="lucide:chart-no-axes-combined" />
				Personalizar dashboard
			</button>
		</div>
	</header>

	<CommunityDashboard ref="dashboard" :community-id="id" />

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
			<LnxButton mode="clear" size="small" @click="resetLayout()">
				<LnxIcon icon="lucide:rotate-ccw" />
				Restablecer
			</LnxButton>
			<LnxButton ref="doneButton" size="small" @click="stopEditing()">
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
				<!-- The general and fiscal data as the card the neighbours see, the tile itself -->
				<div v-if="tile.key === 'info' && tile.size > 1 && community" class="tile card-tile">
					<h2 class="sr-only">
						{{ tile.title }}
					</h2>
					<CommunityBusinessCard
						compact
						:name="community.name"
						:address="community.address"
						:cif="community.cif"
						:iban="community.iban"
						:bank="community.bank"
						empty-text="Aún no hay datos fiscales."
					>
						<RouterLink v-if="!editing" class="stretched" :to="`/communities/${id}/info`" aria-label="Editar los datos generales" />
						<!-- No room for them under the card: how many, in its corner, opening the first -->
						<RouterLink
							v-if="tile.size === 2 && flags.length && !editing"
							class="flag flag-count"
							:to="`/communities/${id}/${flags[0].section}`"
							:title="missing"
							:aria-label="missing"
						>
							<LnxIcon icon="lucide:circle-alert" :size="14" aria-hidden="true" />
							{{ flags.length }} por completar
						</RouterLink>
					</CommunityBusinessCard>
					<div v-if="tile.size === 4" class="card-actions">
						<LnxButton v-for="{ label, value } in copyable" :key="label" mode="outline" size="small" @click="copy(label, value)">
							<LnxIcon :icon="copied === label ? 'lucide:check' : 'lucide:copy'" />
							{{ copied === label ? 'Copiado' : `Copiar ${label}` }}
						</LnxButton>
						<p class="summary-line tabular">
							{{ summary }}
						</p>
						<ul v-if="flags.length && !editing" class="flags" aria-label="Por completar">
							<li v-for="flag in flags" :key="flag.label">
								<RouterLink class="flag" :to="`/communities/${id}/${flag.section}`">
									<LnxIcon icon="lucide:circle-alert" :size="14" aria-hidden="true" />
									{{ flag.label }}
								</RouterLink>
							</li>
						</ul>
					</div>
				</div>

				<div v-else class="tile">
					<header>
						<span class="icon">
							<LnxIcon :icon="tile.icon" :size="20" />
						</span>
						<h2>
							<RouterLink v-if="!editing" class="stretched" :to="`/communities/${id}/${tile.key}`">
								{{ tile.title }}
							</RouterLink>
							<template v-else>
								{{ tile.title }}
							</template>
						</h2>
						<LnxIcon v-if="!editing" class="arrow" icon="lucide:arrow-up-right" :size="18" aria-hidden="true" />
					</header>

					<div v-if="(loading && dataKeys.includes(tile.key)) || (tile.key === 'finances' && financesLoading) || (tile.key === 'people' && neighboursLoading)" class="body" aria-hidden="true">
						<span v-for="width in skeletonLines(tile.size)" :key="width" class="skeleton-item skeleton-item--small" :style="{ width: `${width}%` }" />
					</div>

					<div v-else-if="tile.key === 'info'" class="body">
						<p v-if="flags.length" class="flagged">
							<LnxIcon icon="lucide:circle-alert" :size="14" aria-hidden="true" />
							{{ missing }}
						</p>
						<p v-else class="tabular">
							{{ summary }}
						</p>
					</div>

					<div v-else-if="tile.key === 'people'" class="body">
						<p v-if="!neighbours" class="empty">
							No se han podido cargar las cifras
						</p>
						<template v-else-if="tile.size === 1">
							<p class="tabular">
								{{ count(neighbours.properties, 'propiedad', 'propiedades') }}
							</p>
							<p v-if="adoption !== undefined" class="secondary tabular">
								{{ adoption }}% de las viviendas en la app
							</p>
						</template>
						<ul v-else class="lines">
							<li class="row">
								<span class="text">Propiedades</span>
								<span class="secondary tabular">{{ neighbours.properties }}</span>
							</li>
							<li class="row">
								<span class="text">Vecinos con cuenta</span>
								<span class="secondary tabular">{{ neighbours.registered }}{{ adoption !== undefined ? ` · ${adoption}% de las viviendas` : '' }}</span>
							</li>
							<li class="row">
								<span class="text">Invitaciones pendientes</span>
								<span class="secondary tabular">{{ neighbours.invitations || 'Ninguna' }}</span>
							</li>
						</ul>
					</div>

					<div v-else-if="tile.key === 'locations'" class="body">
						<p v-if="!commonAreas.length" class="empty">
							Aún no hay zonas comunes
						</p>
						<p v-else-if="tile.size === 1">
							<span class="tabular">{{ count(commonAreas.length, 'zona común', 'zonas comunes') }}</span>
						</p>
						<template v-else>
							<ul class="chips">
								<li v-for="area in commonAreas" :key="area.id">
									<LnxIcon v-if="tile.size === 4" :icon="area.icon" :size="14" aria-hidden="true" />
									{{ area.name }}
									<LnxIcon v-if="area.booking" icon="lucide:calendar-clock" :size="12" aria-label="reservable" />
								</li>
							</ul>
							<template v-if="tile.size === 4">
								<p class="summary-title">
									Zonas reservables
								</p>
								<ul v-if="bookableAreas.length" class="lines">
									<li v-for="area in bookableAreas" :key="area.id" class="row">
										<span class="text">{{ area.name }}</span>
										<span class="secondary tabular">{{ area.booking!.opens }}–{{ area.booking!.closes }}</span>
									</li>
								</ul>
								<p v-else class="empty">
									Ninguna, márcalas como reservables al editarlas
								</p>
							</template>
						</template>
					</div>

					<div v-else-if="tile.key === 'finances'" class="body">
						<p v-if="!finances" class="empty">
							No se han podido cargar las cifras
						</p>
						<p v-else-if="tile.size === 1">
							<span class="tabular">{{ formatCents(finances.pending) }} pendiente</span>
						</p>
						<ul v-else class="lines">
							<li class="row">
								<span class="text">Pendiente de cobro</span>
								<span class="secondary tabular">{{ formatCents(finances.pending) }}</span>
							</li>
							<li class="row">
								<span class="text">Facturas vencidas</span>
								<span class="secondary tabular">{{ finances.overdueInvoices ? `${finances.overdueInvoices} · ${formatCents(finances.overdueInvoicesAmount)}` : 'Ninguna' }}</span>
							</li>
							<li class="row">
								<span class="text">Movimientos por conciliar</span>
								<span class="secondary tabular">{{ finances.unreconciled || 'Ninguno' }}</span>
							</li>
						</ul>
					</div>

					<div v-else class="body">
						<p :class="{ lead: tile.size > 1 && tile.details }">
							{{ tile.description }}
						</p>
						<p v-if="tile.size > 1 && tile.details" class="secondary">
							{{ tile.details }}
						</p>
					</div>
				</div>

				<div v-if="editing" class="edit-controls">
					<LnxButton
						mode="clear"
						shape="circle"
						size="small"
						class="handle"
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
						size="small"
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
	margin-bottom: var(--lnx-spacing-5);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);

	h1 {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		font-size: var(--lnx-font-size-title);
		white-space: nowrap;
		text-overflow: ellipsis;
	}
}

// In the top layer, under its button and aligned to its right edge
.menu {
	position: fixed;
	inset: auto;
	margin: 0;
	min-width: 220px;
	padding: var(--lnx-spacing-1);
	// The submenu sticks out of it
	overflow: visible;
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 2px 4px #0000000F, 0 8px 24px #0000001A;
	opacity: 0;
	scale: .96;
	transform-origin: top right;
	// Transitions, so closing while it opens turns back from where it is
	transition:
		opacity var(--duration) var(--ease-out),
		scale var(--duration) var(--ease-out),
		overlay var(--duration) allow-discrete,
		display var(--duration) allow-discrete;

	// The layout stays while it fades out, only display goes
	flex-direction: column;

	&:popover-open {
		display: flex;
		opacity: 1;
		scale: 1;

		@starting-style {
			opacity: 0;
			scale: .96;
		}
	}

	[role='menuitem'] {
		padding: var(--lnx-spacing-2) var(--lnx-spacing-3);
		border-radius: var(--lnx-radius-2);
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-2);
		color: var(--color-gray-9);
		font-size: var(--lnx-font-size-small);
		text-decoration: none;
		cursor: pointer;

		&:hover,
		&:focus-visible,
		&.open {
			outline: none;
			background: var(--color-gray-2);
		}

		&:active {
			scale: var(--press-scale);
		}
	}

	.chevron {
		margin-left: auto;
		color: var(--color-gray-6);
		transition: translate var(--duration) var(--ease-spring);
	}

	.open .chevron {
		translate: 2px 0;
	}
}

.go {
	position: relative;

	> [role='menuitem'] {
		position: relative;
		width: 100%;
	}
}

// Over the items it crosses, invisible, so they aren't hovered on the way to the submenu
.safe-area {
	position: absolute;
	z-index: 3;
}

// Beside its item, on the right or on the left when there's no room
.submenu {
	position: absolute;
	top: calc(var(--offset, 0px) - var(--lnx-spacing-1) - 1px);
	left: calc(100% + var(--lnx-spacing-1) + 1px);
	z-index: 4;
	min-width: 220px;
	padding: var(--lnx-spacing-1);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	display: flex;
	flex-direction: column;
	background: var(--color-gray-0);
	box-shadow: 0 2px 4px #0000000F, 0 8px 24px #0000001A;
	visibility: hidden;
	opacity: 0;
	translate: -4px 0;
	pointer-events: none;
	transition:
		opacity var(--duration) var(--ease-out),
		translate var(--duration) var(--ease-out),
		visibility var(--duration);

	&.left {
		left: auto;
		right: calc(100% + var(--lnx-spacing-1) + 1px);
		translate: 4px 0;
	}

	&.open {
		visibility: visible;
		opacity: 1;
		translate: 0;
		pointer-events: auto;
	}
}

.status {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: var(--lnx-spacing-3);
}

.error {
	color: var(--color-secondary-accent);
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

	// Room for the handle and resize button, so they don't cover the title
	.tile header {
		padding-right: 72px;
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
	.menu,
	.submenu,
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

.tile {
	position: relative;
	flex: 1;
	min-width: 0;
	overflow: hidden;
	padding: var(--lnx-spacing-4);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);
	color: var(--color-gray-7);
	transition: border-color var(--duration) var(--ease-out), box-shadow var(--duration) var(--ease-out), translate var(--duration) var(--ease-spring), scale var(--duration-fast) var(--ease-out);

	&:not(:has(.card-actions)):has(.stretched:hover) {
		border-color: var(--color-primary-light);
		box-shadow: 0 2px 4px #0000000F, 0 8px 24px #0000000F;
		translate: 0 -2px;

		.arrow {
			color: inherit;
			translate: 2px -2px;
		}
	}

	&:not(:has(.card-actions)):has(.stretched:active) {
		translate: 0;
		scale: .99;
	}

	header {
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-3);
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

	.arrow {
		flex-shrink: 0;
		align-self: flex-start;
		color: var(--color-gray-5);
		transition: color var(--duration) var(--ease-out), translate var(--duration) var(--ease-spring);
	}

	h2 {
		flex: 1;
		min-width: 0;
		text-wrap: balance;
		display: -webkit-box;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		color: var(--color-gray-9);
		font-size: var(--lnx-font-size-body);
		font-weight: var(--lnx-font-weight-bold);
		line-height: 1.25;
	}

	.body {
		min-height: 0;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: var(--lnx-font-size-small);

		> p:not(.lead) {
			display: -webkit-box;
			overflow: hidden;
			-webkit-box-orient: vertical;
			-webkit-line-clamp: 3;
		}
	}

	.lead {
		color: var(--color-gray-9);
		font-size: var(--lnx-font-size-body);
	}

	.secondary,
	.empty {
		color: var(--color-gray-6);
	}

	.lines li {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;

		&.row {
			padding: 3px 0;
			display: flex;
			align-items: center;
			gap: var(--lnx-spacing-2);

			+ .row {
				border-top: 1px solid var(--color-gray-2);
			}

			.text {
				flex: 1;
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
			}
		}
	}

	.summary-title {
		margin-top: var(--lnx-spacing-2);
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-1);
		font-weight: var(--lnx-font-weight-bold);
	}

	.summary li {
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-1);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--lnx-spacing-1);

		li {
			padding: 2px var(--lnx-spacing-2);
			border-radius: var(--lnx-radius-4);
			display: inline-flex;
			align-items: center;
			gap: 4px;
			background: var(--color-gray-2);
			color: var(--color-gray-8);
		}
	}
}

// The title's link covers the whole tile, so the tile opens from anywhere and controls can sit above it
.stretched {
	color: inherit;
	text-decoration: none;

	&::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 1;
		border-radius: var(--lnx-radius-3);
	}

	&:focus-visible {
		outline: none;

		&::after {
			outline: 2px solid var(--color-primary);
			outline-offset: -2px;
		}
	}
}

.card-tile {
	padding: 0;
	border: none;
	background: none;
	box-shadow: none;
	overflow: visible;

	> :not(.card-actions, h2) {
		flex: 1;
		min-height: 0;
	}

	.stretched::after {
		border-radius: inherit;
	}
}

.card-actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--lnx-spacing-2);

	.summary-line {
		flex-basis: 100%;
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
	}
}

// What's missing, as tinted badges that open where it's filled in
.flags {
	flex-basis: 100%;
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-1);
}

.flag {
	padding: 2px var(--lnx-spacing-2);
	border-radius: var(--lnx-radius-4);
	display: inline-flex;
	align-items: center;
	gap: 4px;
	background: color-mix(in srgb, var(--color-secondary-accent) 12%, var(--color-gray-0));
	color: color-mix(in srgb, var(--color-secondary-accent), var(--color-gray-9) 35%);
	font-size: var(--lnx-font-size-small);
	text-decoration: none;

	&:hover {
		background: color-mix(in srgb, var(--color-secondary-accent) 20%, var(--color-gray-0));
	}

	&:active {
		scale: var(--press-scale);
	}
}

// In the card's corner, above its link and tilting with it. The name makes room for it
.flag-count {
	position: absolute;
	top: var(--lnx-spacing-3);
	right: var(--lnx-spacing-3);
	z-index: 2;
	box-shadow: 0 1px 2px #0000000F;
}

.card-tile:has(.flag-count) :deep(.brand h2) {
	padding-right: 8.5rem;
}

// The main tile when small, in the brand colour
.info .tile:not(.card-tile) {
	border-color: var(--color-primary);
	background: var(--color-primary);
	color: var(--color-primary-accent-alpha);

	&:has(.stretched:hover) {
		border-color: var(--color-primary-dark);
		background: var(--color-primary-dark);
	}

	.icon {
		background: var(--color-gray-0-alpha);
		color: var(--color-primary-accent);
	}

	.arrow {
		color: var(--color-primary-accent-alpha);
	}

	h2,
	.lead {
		color: var(--color-primary-accent);
	}

	.body {
		margin-top: auto;
	}

	.flagged {
		color: var(--color-primary-accent);
	}
}

@media (max-width: 640px) {
	.bento {
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--lnx-spacing-3);
	}
}
</style>
