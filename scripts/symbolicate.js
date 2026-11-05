import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { SourceMapConsumer } from 'source-map-js';

/*
 * Traducir una pila (MON-10, docs/fiabilidad.md): the stack of a sample, copied from the Errores page, back to the lines
 * of the source code. The maps of that release come from its CI run (gh run download), or from this computer's last build
 * for the release 'local'. From the clipboard or a file:
 *   pbpaste | npm run symbolicate -- 2026.11.04-1200-ab12cd3
 *   npm run symbolicate -- 2026.11.04-1200-ab12cd3 stack.txt
 */

// Chrome's "at f (https://…/assets/X-hash.js:1:234)" and Safari's and Firefox's "f@https://…/assets/X-hash.js:1:234"
const FRAME = /https?:\/\/[^\s()]+\/(assets\/[^\s():]+\.js):(\d+):(\d+)/g;
// Vite's sources are relative to the map: ../../src/… is the app's src
const UP = /^(?:\.\.\/)+/;

function findMaps(dir, maps = new Map()) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			findMaps(path, maps);
		} else if (entry.name.endsWith('.js.map')) {
			maps.set(entry.name, path);
		}
	}
	return maps;
}

function mapsOf(release) {
	if (release === 'local') {
		const maps = new Map();
		['admin', 'webapp'].forEach(app => findMaps(fileURLToPath(new URL(`../apps/${app}/dist`, import.meta.url)), maps));
		return maps;
	}
	const dir = join(tmpdir(), 'gobernansa-sourcemaps', release);
	if (!existsSync(dir)) {
		try {
			execFileSync('gh', ['run', 'download', '--name', `sourcemaps-${release}`, '--dir', dir], { stdio: ['ignore', 'ignore', 'inherit'] });
		} catch (error) {
			rmSync(dir, { recursive: true, force: true });
			throw new Error(error.code === 'ENOENT'
				? 'Falta gh, la CLI de GitHub: brew install gh y gh auth login'
				: `No se han podido descargar los mapas de ${release}: ¿es la versión de una muestra de los últimos 90 días?`);
		}
	}
	return findMaps(dir);
}

const [release, file] = process.argv.slice(2);
if (!release) {
	console.error('Uso: pbpaste | npm run symbolicate -- <versión> (la de la muestra, o local para el último build de este equipo)');
	process.exit(1);
}
try {
	const stack = readFileSync(file ?? 0, 'utf8');
	const maps = mapsOf(release);
	const consumers = new Map();
	const consumer = (name) => {
		if (!consumers.has(name)) {
			const path = maps.get(`${name}.map`);
			consumers.set(name, path && new SourceMapConsumer(JSON.parse(readFileSync(path, 'utf8'))));
		}
		return consumers.get(name);
	};
	console.log(stack.replace(FRAME, (frame, asset, line, column) => {
		const original = consumer(asset.split('/').pop())?.originalPositionFor({ line: Number(line), column: Number(column) - 1 });
		if (!original?.source) {
			return frame;
		}
		const source = original.source.replace(UP, '');
		return `${source}:${original.line}:${original.column + 1}${original.name ? ` (${original.name})` : ''}`;
	}));
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
