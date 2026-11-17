import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { connect } from 'node:net';
import process from 'node:process';
import { parseEnv } from 'node:util';

/*
 * npm run doctor: what npm run dev needs on this computer, checked before starting instead of found halfway.
 * Reads nothing secret: of .env.local it only looks at which variables are set.
 */

const root = new URL('../', import.meta.url);
const file = name => new URL(name, root);
let failed = false;

function report(state, text, fix) {
	failed ||= state === 'fail';
	console.log(`${{ ok: '✓', warn: '!', fail: '✗' }[state]} ${text}${fix ? `\n    → ${fix}` : ''}`);
}

// Both outputs, since java -version writes to stderr; empty when the command doesn't exist
function run(command, args) {
	const { stdout, stderr } = spawnSync(command, args, { encoding: 'utf8' });
	return `${stdout ?? ''}${stderr ?? ''}`.trim();
}

// Node
const wanted = Number(readFileSync(file('.nvmrc'), 'utf8').trim());
const node = Number(process.versions.node.split('.')[0]);
if (node === wanted) {
	report('ok', `Node ${process.versions.node}`);
} else {
	report(node < wanted ? 'fail' : 'warn', `Node ${process.versions.node}, el proyecto usa el ${wanted}`, 'nvm use');
}

// Dependencies: npm rewrites node_modules/.package-lock.json on every install
const installed = file('node_modules/.package-lock.json');
if (!existsSync(installed)) {
	report('fail', 'Faltan las dependencias', 'npm install');
} else if (statSync(installed).mtimeMs < statSync(file('package-lock.json')).mtimeMs) {
	report('warn', 'package-lock.json ha cambiado desde la última instalación', 'npm install');
} else {
	report('ok', 'Dependencias instaladas');
}

// Java, for the Firestore and Storage emulators
const java = Number(run('java', ['-version']).match(/version "(\d+)/)?.[1] ?? 0);
if (java >= 21) {
	report('ok', `Java ${java}`);
} else {
	report('fail', java ? `Java ${java}, los emuladores necesitan el 21` : 'Sin Java en el PATH: los emuladores necesitan el 21', 'docs/desarrollo.md, Requisitos');
}

// .env.local
if (!existsSync(file('.env.local'))) {
	report('fail', 'No hay .env.local', 'cp .env.example .env.local y rellénalo (docs/desarrollo.md, Primer arranque)');
} else {
	const env = parseEnv(readFileSync(file('.env.local'), 'utf8'));
	const project = JSON.parse(readFileSync(file('.firebaserc'), 'utf8')).projects.default;
	const problems = [
		env.VITE_FIREBASE_EMULATORS !== 'true' && 'VITE_FIREBASE_EMULATORS no es \'true\': las apps irán al proyecto real',
		env.VITE_FIREBASE_PROJECT_ID !== project && `VITE_FIREBASE_PROJECT_ID no es ${project}: los emuladores no verán los datos del seed`,
		(env.DEMO_PASSWORD ?? '').length < 6 && 'DEMO_PASSWORD falta o tiene menos de 6 caracteres: el seed no puede crear las cuentas',
	].filter(Boolean);
	problems.forEach(problem => report('warn', `.env.local: ${problem}`));
	if (!problems.length) {
		report('ok', '.env.local');
	}
}

// Ports that npm run dev opens
const ports = { 5400: 'webapp', 5401: 'admin', 5500: 'interfaz de los emuladores', 5501: 'Auth', 5502: 'Firestore', 5504: 'Storage', 5505: 'Functions' };
const busy = await Promise.all(Object.keys(ports).map(port => new Promise((resolve) => {
	const socket = connect(Number(port), '127.0.0.1').setTimeout(500);
	const done = (open) => {
		socket.destroy();
		resolve(open && port);
	};
	socket.on('connect', () => done(true)).on('error', () => done(false)).on('timeout', () => done(false));
})));
const taken = busy.filter(Boolean);
if (taken.length) {
	report('warn', `En uso: ${taken.map(port => `${port} (${ports[port]})`).join(', ')}`, '¿hay otro npm run dev abierto? lsof -i :<puerto>');
} else {
	report('ok', 'Puertos libres');
}

// Git hooks
if (run('git', ['config', 'core.hooksPath']) === '.githooks') {
	report('ok', 'Hooks de git activos');
} else {
	report('warn', 'Los hooks de git no están activos: el commit no pasa ESLint ni comprueba el mensaje', 'npm install, o git config core.hooksPath .githooks');
}

process.exit(failed ? 1 : 0);
