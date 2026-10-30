import type { Ref } from 'vue';
import { nextTick, onBeforeUnmount, watch } from 'vue';
import { useRoute } from 'vue-router';

const DIACRITICS_REGEX = /\p{M}/gu;
const WHITESPACE_REGEX = /\s+/;
// Pages load their data after arriving, so matches are looked for again while they render
const RESCAN_MS = 5000;

// Like normalize(), accents and case ignored, but keeping every character in place so a match in the folded text is at
// the same position in the original one
export function fold(text: string) {
	let folded = '';
	for (const char of text) {
		const plain = char.normalize('NFD').replace(DIACRITICS_REGEX, '').toLowerCase();
		folded += plain.length === char.length ? plain : char;
	}
	return folded;
}

export function searchWords(query: string) {
	return fold(query).split(WHITESPACE_REGEX).filter(Boolean);
}

// Where each needle appears in the text, sorted and with overlapping ones merged
export function findRanges(text: string, needles: string[]) {
	const folded = fold(text);
	const ranges: [number, number][] = [];
	for (const needle of needles.filter(Boolean)) {
		for (let index = folded.indexOf(needle); index !== -1; index = folded.indexOf(needle, index + needle.length)) {
			ranges.push([index, index + needle.length]);
		}
	}
	ranges.sort((a, b) => a[0] - b[0]);
	return ranges.reduce<[number, number][]>((merged, range) => {
		const last = merged.at(-1);
		if (last && range[0] <= last[1]) {
			last[1] = Math.max(last[1], range[1]);
		} else {
			merged.push(range);
		}
		return merged;
	}, []);
}

// Highlights the `highlight` query param inside the root once a search result is opened, and scrolls to the first match
export function useSearchHighlight(root: Readonly<Ref<HTMLElement | null>>) {
	const route = useRoute();
	if (typeof CSS === 'undefined' || !('highlights' in CSS)) {
		return;
	}

	let observer: MutationObserver | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let frame = 0;

	function clear() {
		observer?.disconnect();
		clearTimeout(timer);
		cancelAnimationFrame(frame);
		CSS.highlights.delete('search');
	}

	function textRanges(element: HTMLElement, needles: string[]) {
		const ranges: Range[] = [];
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
			if (node.parentElement?.closest('script, style')) {
				continue;
			}
			for (const [start, end] of findRanges(node.data, needles)) {
				const range = new Range();
				range.setStart(node, start);
				range.setEnd(node, end);
				ranges.push(range);
			}
		}
		return ranges;
	}

	watch(() => route.fullPath, async () => {
		clear();
		const query = route.query.highlight;
		if (typeof query !== 'string' || !query.trim()) {
			return;
		}

		await nextTick();
		const element = root.value;
		if (!element) {
			return;
		}

		// The whole phrase when it's there, otherwise each of its words, as the search matched them
		const phrase = fold(query.trim());
		const words = searchWords(query).filter(word => word.length > 1);
		const behavior: ScrollBehavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
		let scrolled = false;
		let inputDone = false;

		function apply() {
			let ranges = textRanges(element!, [phrase]);
			if (!ranges.length && words.length > 1) {
				ranges = textRanges(element!, words);
			}
			CSS.highlights.set('search', new Highlight(...ranges));
			if (!scrolled && ranges.length) {
				ranges[0].startContainer.parentElement?.scrollIntoView({ block: 'center', behavior });
				scrolled = true;
			}

			// Ranges don't reach inside form fields: the first one with the text gets it selected instead
			if (!inputDone) {
				const fields = [...element!.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')];
				// Also by its words, like the text, e.g. "limpieza garaje" in "Limpieza de garaje"
				const needle = [phrase, ...words].find(text => fields.some(input => fold(input.value).includes(text)));
				const field = needle && fields.find(input => fold(input.value).includes(needle));
				if (field && needle) {
					inputDone = true;
					field.focus({ preventScroll: scrolled });
					const start = fold(field.value).indexOf(needle);
					try {
						field.setSelectionRange(start, start + needle.length);
					} catch {
						// Some types (email, number) can't be partly selected, focusing them is enough
					}
					scrolled = true;
				}
			}
		}

		apply();
		observer = new MutationObserver(() => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(apply);
		});
		observer.observe(element, { childList: true, subtree: true, characterData: true });
		timer = setTimeout(() => observer?.disconnect(), RESCAN_MS);
	}, { immediate: true });

	onBeforeUnmount(clear);
}
