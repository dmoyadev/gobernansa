import type { DirectiveNode, TemplateChildNode } from '@vue/compiler-core';
import type { Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'vue/compiler-sfc';

// What each page of a community has written in it, so the community search finds what's in its tabs, sections,
// buttons and options. Read when building, and only downloaded once the search is used
const ID = 'virtual:page-texts';
const src = fileURLToPath(new URL('./src/', import.meta.url));

// The routes of a page of the community, without other params, with its file and title
const ROUTE_REGEX = /path: 'communities\/:id\/([^':]*(?::section\([^)]+\))?)',[^{}]*?import\('@\/([^']+)'\),\s*meta: \{ title: '([^']+)'/g;
// The tabs a page opens from its address, and the parts of the section param, e.g. v-if="view === 'ledger'"
const TAB_REGEX = /^\s*(view|model|section) === '([\w-]+)'/;
// The labels of those tabs, e.g. const views = { ledger: 'Libro mayor' }
const TAB_LABELS_REGEX = /const (view|model)s(?::[^=]+)? = \{([^}]*)\}/g;
const ENTRY_REGEX = /'?([\w-]+)'?: '([^']+)'/g;
// Options of selects, columns and menus written in the script
const LABEL_REGEX = /\b(?:label|title): '([^'{}]{3,})'/g;
const WORD_REGEX = /\p{L}{3}/u;
const SPACES_REGEX = /\s+/g;
// What's left at the ends of a sentence cut by a value or a tag
const EDGES_REGEX = /^[\s…·:,.]+|[\s…·:,]+$/g;
const ATTRIBUTES = new Set(['label', 'title', 'aria-label']);
const HEADINGS = new Set(['h2', 'h3', 'legend']);
// In this many pages or more it's the app's own wording (Guardar, Fecha, Volver…), not something to look for
const COMMON_PAGES = 4;

// [text, tab as 'param=value' or the section, heading it's under]
type Text = [string, string?, string?];

function texts(file: string) {
	const { descriptor } = parse(readFileSync(`${src}${file}`, 'utf8'));
	const found: Text[] = [];
	let heading: string | undefined;

	function add(text: string, tab?: string) {
		const clean = text.replace(SPACES_REGEX, ' ').trim();
		if (WORD_REGEX.test(clean)) {
			found.push([clean, tab, heading === clean ? undefined : heading]);
		}
	}

	function walk(nodes: TemplateChildNode[], tab?: string) {
		// Text and {{ values }} side by side are one sentence, with … where the values go
		let sentence = '';
		for (const node of [...nodes, undefined]) {
			if (node?.type === 2 || node?.type === 5) {
				sentence += node.type === 2 ? (node).content : ' … ';
				continue;
			}
			if (sentence.trim()) {
				add(sentence.replace(EDGES_REGEX, ''), tab);
			}
			sentence = '';
			if (node?.type !== 1) {
				continue;
			}

			const element = node;
			const condition = element.props.find((prop): prop is DirectiveNode => prop.type === 7 && ['if', 'else-if', 'show'].includes(prop.name));
			const match = condition?.exp && 'content' in condition.exp ? TAB_REGEX.exec(condition.exp.content) : null;
			const inner = match ? (match[1] === 'section' ? match[2] : `${match[1]}=${match[2]}`) : tab;
			for (const prop of element.props) {
				if (prop.type === 6 && ATTRIBUTES.has(prop.name) && (prop).value) {
					add((prop).value.content, inner);
				}
			}
			if (HEADINGS.has(element.tag) && element.children.every(child => child.type === 2)) {
				heading = element.children.map(child => (child).content).join('').replace(SPACES_REGEX, ' ').trim() || heading;
			}
			walk(element.children, inner);
		}
	}
	walk(descriptor.template?.ast?.children ?? []);

	const script = descriptor.scriptSetup?.content ?? descriptor.script?.content ?? '';
	heading = undefined;
	for (const [, name, body] of script.matchAll(TAB_LABELS_REGEX)) {
		for (const [, key, label] of body.matchAll(ENTRY_REGEX)) {
			add(label, `${name}=${key}`);
		}
	}
	for (const [, label] of script.matchAll(LABEL_REGEX)) {
		add(label);
	}

	const seen = new Set<string>();
	return found.filter(([text, tab]) => !seen.has(`${text}|${tab}`) && seen.add(`${text}|${tab}`));
}

export default function pageTexts(): Plugin {
	return {
		name: 'page-texts',
		resolveId: id => id === ID ? `\0${ID}` : undefined,
		load(id) {
			if (id !== `\0${ID}`) {
				return;
			}
			const router = readFileSync(`${src}app/router.ts`, 'utf8');
			const pages = Array.from(router.matchAll(ROUTE_REGEX), ([, path, file, title]) => {
				this.addWatchFile(`${src}${file}`);
				// The section, e.g. contacts, comes as the tab of its texts
				return { path: path.includes(':section') ? '' : path, title, texts: texts(file) };
			});

			const pagesWith = new Map<string, number>();
			for (const page of pages) {
				for (const text of new Set(page.texts.map(([text]) => text))) {
					pagesWith.set(text, (pagesWith.get(text) ?? 0) + 1);
				}
			}
			for (const page of pages) {
				page.texts = page.texts.filter(([text]) => pagesWith.get(text)! < COMMON_PAGES);
			}
			return `export default ${JSON.stringify(pages)}`;
		},
	};
}
