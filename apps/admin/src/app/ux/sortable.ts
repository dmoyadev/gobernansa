import type { Ref } from 'vue';
import { useEventListener } from 'lnxjs-components';
import { nextTick, ref } from 'vue';

interface Sorting {
	id: string;
	from: number;
	to: number;
	offset: number;
	startY: number;
	// Each row's top and height when it started, the layout doesn't change until it's dropped
	tops: number[];
	heights: number[];
	dropping: boolean;
}

const DROP_MS = 220;

/**
 * Reordering a list's rows: dragged by the handle, or with the arrow keys on it. The row lifts and follows the pointer,
 * the others slide out of its way, and on release it glides into its slot. Pointer events rather than native drag and
 * drop, whose ghost image can't be styled. Rows are `li[data-id]` with a `.handle` button, styled by sortable.scss
 */
export function useSortable<T extends { id: string }>(items: Ref<T[]>, options: { disabled: () => boolean; reorder: (next: T[]) => void }) {
	const sorting = ref<Sorting>();
	const landed = ref<string>();
	let landedTimer: ReturnType<typeof setTimeout> | undefined;

	// Where it landed glows for a moment
	function land(id: string) {
		clearTimeout(landedTimer);
		landed.value = id;
		landedTimer = setTimeout(() => landed.value = undefined, 700);
	}

	function move(item: T, by: -1 | 1) {
		const index = items.value.findIndex(other => other.id === item.id);
		if (options.disabled() || index + by < 0 || index + by >= items.value.length) {
			return;
		}
		const next = [...items.value];
		next.splice(index, 1);
		next.splice(index + by, 0, item);
		options.reorder(next);
		land(item.id);
		// Moving the row in the page takes the focus away, it's given back so the arrows keep moving it
		void nextTick(() => document.querySelector<HTMLElement>(`li[data-id="${item.id}"] .handle`)?.focus());
	}

	function start(item: T, event: PointerEvent) {
		if (event.button !== 0 || options.disabled() || sorting.value) {
			return;
		}
		const handle = event.currentTarget as HTMLElement;
		const rows = Array.from(handle.closest('ul')!.querySelectorAll<HTMLElement>(':scope > li[data-id]'), row => row.getBoundingClientRect());
		handle.setPointerCapture(event.pointerId);
		const from = items.value.findIndex(other => other.id === item.id);
		sorting.value = {
			id: item.id,
			from,
			to: from,
			offset: 0,
			startY: event.clientY,
			tops: rows.map(row => row.top),
			heights: rows.map(row => row.height),
			dropping: false,
		};
	}

	function onMove(event: PointerEvent) {
		const state = sorting.value;
		if (!state || state.dropping) {
			return;
		}
		const { from, tops, heights } = state;
		const last = tops.length - 1;
		// Kept within the list, and at either end it takes the first or last slot
		const min = tops[0] - tops[from];
		const max = tops[last] + heights[last] - tops[from] - heights[from];
		state.offset = Math.min(Math.max(event.clientY - state.startY, min), max);
		const center = tops[from] + state.offset + heights[from] / 2;
		state.to = state.offset <= min
			? 0
			: state.offset >= max ? last : tops.filter((top, index) => index !== from && top + heights[index] / 2 < center).length;
	}

	// Where the row ends, relative to where it started
	function slotOffset({ from, to, tops, heights }: Sorting) {
		return to > from ? tops[to] + heights[to] - tops[from] - heights[from] : tops[to] - tops[from];
	}

	function end(cancel = false) {
		const state = sorting.value;
		if (!state || state.dropping) {
			return;
		}
		if (cancel) {
			state.to = state.from;
		}
		state.dropping = true;
		state.offset = slotOffset(state);
		setTimeout(() => {
			sorting.value = undefined;
			if (state.to !== state.from) {
				const next = [...items.value];
				const [item] = next.splice(state.from, 1);
				next.splice(state.to, 0, item);
				options.reorder(next);
			}
			land(state.id);
		}, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : DROP_MS);
	}

	// The others make room for it in the slot it's over
	function rowStyle(item: T) {
		const state = sorting.value;
		if (!state) {
			return;
		}
		if (item.id === state.id) {
			return { translate: `0 ${state.offset}px` };
		}
		const index = items.value.findIndex(other => other.id === item.id);
		const height = state.heights[state.from];
		if (state.from < index && index <= state.to) {
			return { translate: `0 ${-height}px` };
		}
		if (state.to <= index && index < state.from) {
			return { translate: `0 ${height}px` };
		}
	}

	// The row's classes, for sortable.scss
	function rowClass(item: T) {
		return { lifted: sorting.value?.id === item.id, dropping: sorting.value?.id === item.id && sorting.value.dropping, landed: landed.value === item.id };
	}

	// The handle's listeners, on its button
	function handleEvents(item: T) {
		return {
			pointerdown: (event: PointerEvent) => start(item, event),
			pointermove: onMove,
			pointerup: () => end(),
			pointercancel: () => end(true),
			lostpointercapture: () => end(),
			keydown: (event: KeyboardEvent) => {
				if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
					event.preventDefault();
					move(item, event.key === 'ArrowUp' ? -1 : 1);
				}
			},
		};
	}

	useEventListener(window, 'keydown', (event) => {
		if (event.key === 'Escape' && sorting.value) {
			event.preventDefault();
			end(true);
		}
	});

	return { sorting, rowStyle, rowClass, handleEvents };
}
