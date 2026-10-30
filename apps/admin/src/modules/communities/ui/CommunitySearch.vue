<script setup lang="ts">
import type { Community } from '@gobernansa/shared/domain/community.ts';
import { LnxIcon } from 'lnxjs-components';
import { computed, ref, useId, useTemplateRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import Kbd from '@/app/ux/Kbd.vue';
import { useEventListener, useShortcut } from '@/app/ux/shortcuts.ts';
import { useCommunitySearch } from '../application/useCommunitySearch.ts';

const props = defineProps<{ communityId: string; community?: Community }>();

const router = useRouter();
const { search, loadIndex, loading } = useCommunitySearch(() => props.communityId, () => props.community);

const listId = useId();
const root = useTemplateRef('root');
const input = useTemplateRef('input');
const text = ref('');
const open = ref(false);
const active = ref(0);

const results = computed(() => search(text.value));
const expanded = computed(() => open.value && !!text.value.trim());
watch(results, () => active.value = 0);

// The rest of the community is only read once something is typed
function show() {
	open.value = true;
	if (text.value.trim()) {
		void loadIndex();
	}
}

function go(index: number) {
	const result = results.value[index];
	if (!result) {
		return;
	}
	open.value = false;
	// Some results already carry a query, e.g. the aviso to open
	const { path, query } = router.resolve(result.to);
	void router.push({ path, query: { ...query, highlight: text.value.trim() } });
}

function onKeydown(event: KeyboardEvent) {
	const count = results.value.length;
	if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
		event.preventDefault();
		show();
		if (count) {
			active.value = (active.value + (event.key === 'ArrowDown' ? 1 : count - 1)) % count;
			document.getElementById(`${listId}-${active.value}`)?.scrollIntoView({ block: 'nearest' });
		}
	} else if (event.key === 'Enter' && expanded.value) {
		event.preventDefault();
		go(active.value);
	} else if (event.key === 'Escape') {
		// Handled here, so the page doesn't leave its edit mode too
		event.preventDefault();
		if (expanded.value) {
			open.value = false;
		} else {
			text.value = '';
			input.value?.blur();
		}
	}
}

function focus() {
	input.value?.focus();
	input.value?.select();
}
useShortcut('mod+k', focus, 'Buscar en la comunidad');
useShortcut('/', focus, 'Buscar en la comunidad');

// Closes when the focus leaves it, e.g. with Tab
function onFocusout(event: FocusEvent) {
	if (!root.value?.contains(event.relatedTarget as Node)) {
		open.value = false;
	}
}

// For screen readers, how many there are as they change
const status = computed(() => {
	if (!expanded.value) {
		return '';
	}
	if (loading.value) {
		return 'Buscando…';
	}
	return results.value.length
		? `${results.value.length} ${results.value.length === 1 ? 'resultado' : 'resultados'}`
		: `Sin resultados para «${text.value.trim()}»`;
});

function onPointerdown(event: PointerEvent) {
	if (!root.value?.contains(event.target as Node)) {
		open.value = false;
	}
}
useEventListener(document, 'pointerdown', onPointerdown);
</script>

<template>
	<div ref="root" class="search" @focusout="onFocusout">
		<label class="field">
			<LnxIcon icon="lucide:search" :size="18" />
			<span class="sr-only">Buscar en la comunidad</span>
			<input
				ref="input"
				v-model="text"
				type="search"
				role="combobox"
				autocomplete="off"
				placeholder="Busca vecinos, incidencias, juntas, contactos…"
				aria-autocomplete="list"
				:aria-expanded="expanded"
				:aria-controls="listId"
				:aria-activedescendant="expanded && results.length ? `${listId}-${active}` : undefined"
				@focus="show()"
				@input="show()"
				@keydown="onKeydown"
			>
			<Kbd combo="mod+k" />
		</label>

		<!-- The focus stays in the input, or leaving it would close the list before the click -->
		<Transition name="popover">
			<div v-show="expanded" class="popover" @mousedown.prevent>
				<ul :id="listId" role="listbox" aria-label="Resultados">
					<li
						v-for="(result, index) in results"
						:id="`${listId}-${index}`"
						:key="`${result.to}-${result.title}-${index}`"
						role="option"
						:aria-selected="index === active"
						:class="{ active: index === active }"
						@pointermove="active = index"
						@click="go(index)"
					>
						<span class="icon">
							<LnxIcon :icon="result.icon" :size="16" />
						</span>
						<span class="body">
							<span class="section">{{ result.section }}</span>
							<span class="title">
								<template v-for="(segment, part) in result.titleSegments" :key="part">
									<mark v-if="segment.mark">{{ segment.text }}</mark>
									<template v-else>{{ segment.text }}</template>
								</template>
							</span>
							<span v-if="result.textSegments.length" class="text">
								<template v-for="(segment, part) in result.textSegments" :key="part">
									<mark v-if="segment.mark">{{ segment.text }}</mark>
									<template v-else>{{ segment.text }}</template>
								</template>
							</span>
						</span>
					</li>
				</ul>
				<p class="status" aria-hidden="true">
					<template v-if="!results.length && !loading">
						Sin resultados para «{{ text.trim() }}»
					</template>
					<template v-else-if="loading">
						Buscando en el resto de la comunidad…
					</template>
				</p>
			</div>
		</Transition>
		<p class="sr-only" role="status">
			{{ status }}
		</p>
	</div>
</template>

<style lang="scss" scoped>
.search {
	position: relative;
	margin-bottom: var(--lnx-spacing-5);
}

.field {
	padding: 0 var(--lnx-spacing-3);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
	color: var(--color-gray-6);
	transition: border-color var(--duration) var(--ease-out), box-shadow var(--duration) var(--ease-out);

	&:focus-within {
		border-color: var(--color-primary);
		outline: 2px solid var(--color-primary);
		outline-offset: 1px;
	}

	input {
		flex: 1;
		min-width: 0;
		height: 44px;
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

// Above the tiles, as tall as fits
.popover {
	position: absolute;
	top: calc(100% + var(--lnx-spacing-2));
	right: 0;
	left: 0;
	z-index: 5;
	max-height: min(480px, 60vh);
	overflow-y: auto;
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 2px 4px #0000000F, 0 8px 24px #0000001A;

	ul {
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

	mark {
		border-radius: 2px;
		background: #fde68a;
		color: inherit;
	}

	.status:not(:empty) {
		padding: var(--lnx-spacing-3) var(--lnx-spacing-4);
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
	}
}

// Drops in from the field, and back if it closes halfway
.popover-enter-active,
.popover-leave-active {
	transition: opacity var(--duration) var(--ease-out), translate var(--duration) var(--ease-out);
}

.popover-enter-from,
.popover-leave-to {
	opacity: 0;
	translate: 0 -4px;
}

@media (prefers-reduced-motion: reduce) {
	.field {
		transition: none;
	}
}
</style>
