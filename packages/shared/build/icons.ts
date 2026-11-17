import type { IconifyJSON } from 'iconify-icon';
import type { Plugin } from 'vite';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * The icons, bundled with each app: only the ones the code names, read when building. Without them iconify-icon fetches
 * each one from api.iconify.design, and the local demo (npm run demo) has no internet. Imported once from main.ts
 */
const ID = 'virtual:icons';
const root = fileURLToPath(new URL('../../../', import.meta.url));
// Where icons are named: both apps, this package, the seed's data (common areas, categories) and the components library
const SOURCES = ['apps/webapp/src', 'apps/admin/src', 'packages/shared', 'scripts/seed/data'];
const LIBRARY = 'node_modules/lnxjs-components/dist/lnxjs-components.js';
const LUCIDE = 'node_modules/@iconify-json/lucide/icons.json';
const FILE_REGEX = /\.(?:ts|vue|js)$/;
const SKIP_REGEX = /(?:^|\/)(?:node_modules|dist)\//;
const NAME_REGEX = /\b(lucide|mdi|line-md):([a-z\d]+(?:-[a-z\d]+)*)/g;
// The library's own icons from other sets, drawn with Lucide's like the rest of the apps
const STANDINS: Record<string, string> = {
	'calendar': 'calendar',
	'check': 'check',
	'chevron-double-left': 'chevrons-left',
	'chevron-double-right': 'chevrons-right',
	'chevron-down': 'chevron-down',
	'chevron-left': 'chevron-left',
	'chevron-right': 'chevron-right',
	'clear': 'x',
	'email': 'mail',
	'external-link': 'external-link',
	'eye': 'eye',
	'eye-off': 'eye-off',
	'file': 'file',
	'folder': 'folder',
	'folder-multiple': 'folders',
	'folder-open': 'folder-open',
	'phone': 'phone',
	'search': 'search',
	'times': 'x',
};
// line-md's, while a button or an input is loading: Lucide's loader turning
const SPINNER = '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M21 12a9 9 0 1 1-6.219-8.56"><animateTransform attributeName="transform" dur="0.8s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12"/></path>';

function usedNames() {
	const texts = SOURCES.flatMap(dir => readdirSync(`${root}${dir}`, { recursive: true, encoding: 'utf8' })
		.filter(file => FILE_REGEX.test(file) && !SKIP_REGEX.test(file))
		.map(file => readFileSync(`${root}${dir}/${file}`, 'utf8')));
	texts.push(readFileSync(`${root}${LIBRARY}`, 'utf8'));
	return new Set(texts.flatMap(text => Array.from(text.matchAll(NAME_REGEX), match => match[0])));
}

// Each set with only the icons used, and the names that don't exist so the build stops
function collections() {
	const lucide = JSON.parse(readFileSync(`${root}${LUCIDE}`, 'utf8')) as IconifyJSON;
	const sets: Record<string, IconifyJSON> = {
		'lucide': { prefix: 'lucide', width: 24, height: 24, icons: {}, aliases: {} },
		'mdi': { prefix: 'mdi', width: 24, height: 24, icons: {} },
		'line-md': { prefix: 'line-md', width: 24, height: 24, icons: {} },
	};
	// An alias needs its parent too
	function addLucide(name: string): boolean {
		const alias = lucide.aliases?.[name];
		if (alias) {
			sets.lucide.aliases![name] = alias;
			return addLucide(alias.parent);
		}
		if (!lucide.icons[name]) {
			return false;
		}
		sets.lucide.icons[name] = lucide.icons[name];
		return true;
	}

	const missing: string[] = [];
	for (const used of usedNames()) {
		const [prefix, name] = used.split(':');
		const standin = lucide.icons[STANDINS[name]];
		if (prefix === 'lucide' && addLucide(name)) {
			continue;
		}
		if (prefix === 'mdi' && standin) {
			sets.mdi.icons[name] = standin;
		} else if (prefix === 'line-md' && name.startsWith('loading')) {
			sets[prefix].icons[name] = { body: SPINNER };
		} else {
			missing.push(used);
		}
	}
	return { sets: Object.values(sets), missing };
}

export default function icons(): Plugin {
	return {
		name: 'icons',
		resolveId: id => id === ID ? `\0${ID}` : undefined,
		load(id) {
			if (id !== `\0${ID}`) {
				return;
			}
			const { sets, missing } = collections();
			if (missing.length) {
				this.error(`Iconos sin dibujo: ${missing.join(', ')}. Un nombre de Lucide mal escrito, o uno de lnxjs-components que falta en STANDINS (packages/shared/build/icons.ts)`);
			}
			// addCollection reaches the iconify-icon element that was defined, also when it's the copy inside lnxjs-components
			return `import { addCollection } from 'iconify-icon';\nfor (const set of ${JSON.stringify(sets)}) addCollection(set);\n`;
		},
	};
}
