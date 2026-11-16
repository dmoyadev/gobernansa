import type { Ref } from 'vue';
import { nextTick, onBeforeUnmount, watch } from 'vue';
import { useRoute } from 'vue-router';

const DIACRITICS_REGEX = /\p{M}/gu;
const WHITESPACE_REGEX = /\s+/;
const DIGIT_REGEX = /\d/;
const ALPHANUMERIC_REGEX = /[a-z0-9]/;
// What phones and NIFs are written with, or without: 600 200 004, (91) 555-12-34, 11.111.111-H
const SEPARATOR_REGEX = /[\s./()-]/;
const SEPARATORS_REGEX = new RegExp(SEPARATOR_REGEX, 'g');
// A Spanish phone's country code: left out of what's typed, and what follows it in the text starts a word
const COUNTRY_CODES = ['+34', '0034'];
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

export interface Needle {
	word: string;
	compact: string | undefined;
}

// How long the country code at that place is, 0 when there's none
function countryCodeAt(text: string, index = 0) {
	return COUNTRY_CODES.find(code => text.startsWith(code, index))?.length ?? 0;
}

// How a word is looked for: as typed and, one with digits like a phone or a NIF, also without separators or a country code
// from the start of a word in the text. So 600200004 and +34 600-200-004 find "600 200 004" and "+34600200004",
// 11111111-h finds "11111111H", but 600 100 001 doesn't find "600 100 002" by its 001
export function needle(word: string): Needle {
	if (!DIGIT_REGEX.test(word)) {
		return { word, compact: undefined };
	}
	const compact = word.replace(SEPARATORS_REGEX, '');
	return { word, compact: compact.slice(countryCodeAt(compact)) };
}

// A country code before a number, as in "+34 600 200 004", is left out. Not one on its own, like the invoice in "fra 0034"
export function searchWords(query: string) {
	const words = fold(query).split(WHITESPACE_REGEX).filter(Boolean);
	return words.filter((word, index) => needle(word).compact !== '' || !DIGIT_REGEX.test(words[index + 1] ?? ''));
}

// The text as needles are looked for in it: folded and, for those with digits, without separators, with where each of its
// characters was and which ones start a word. Prepared once for the texts searched at every key
export function searchable(text: string) {
	const folded = fold(text);
	let compact = '';
	const positions: number[] = [];
	const starts = new Set<number>();
	for (let index = 0; index < folded.length; index++) {
		if (SEPARATOR_REGEX.test(folded[index])) {
			continue;
		}
		if (!index || !ALPHANUMERIC_REGEX.test(folded[index - 1])) {
			starts.add(compact.length);
		}
		positions.push(index);
		compact += folded[index];
	}
	// The number after a country code starts one too, as in "+34600200004"
	for (const start of starts) {
		const length = countryCodeAt(compact, start);
		if (length) {
			starts.add(start + length);
		}
	}
	return { folded, compact, positions, starts };
}

export type Searchable = ReturnType<typeof searchable>;

// Where the needle is in the text without separators from the start of a word, -1 when it isn't
function findCompact({ compact, starts }: Searchable, needle: string, from = 0) {
	let index = compact.indexOf(needle, from);
	while (index !== -1 && !starts.has(index)) {
		index = compact.indexOf(needle, index + 1);
	}
	return index;
}

// Whether the needle is in the text, as findRanges() marks it
export function contains(text: Searchable, { word, compact }: Needle) {
	return text.folded.includes(word) || (!!compact && findCompact(text, compact) !== -1);
}

// Where each needle appears in the text, sorted and with overlapping ones merged. One found without separators is marked
// from its first character to its last, with the separators in between
export function findRanges(text: string, needles: string[]) {
	const list = needles.filter(Boolean).map(needle);
	const searched = list.some(({ compact }) => compact) ? searchable(text) : undefined;
	const folded = searched?.folded ?? fold(text);
	const ranges: [number, number][] = [];
	for (const { word, compact } of list) {
		for (let index = folded.indexOf(word); index !== -1; index = folded.indexOf(word, index + word.length)) {
			ranges.push([index, index + word.length]);
		}
		if (compact && searched) {
			for (let index = findCompact(searched, compact); index !== -1; index = findCompact(searched, compact, index + compact.length)) {
				ranges.push([searched.positions[index], searched.positions[index + compact.length - 1] + 1]);
			}
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
				const [field, range] = [phrase, ...words]
					.flatMap(text => fields.map(input => [input, findRanges(input.value, [text])[0]] as const))
					.find(([, range]) => range) ?? [];
				if (field && range) {
					inputDone = true;
					field.focus({ preventScroll: scrolled });
					try {
						field.setSelectionRange(...range);
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
