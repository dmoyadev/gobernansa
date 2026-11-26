// The sales demo on this laptop alone, with no internet: the emulators with the seed's data, and both apps built against
// them and served on the local network, so a phone on the same wifi opens the webapp. npm run demo:reset loads the data again.
// npm run dev:isolated (--dev) is the same stack for development: Vite's dev servers, on https with hot reload and on this
// laptop only, so a second branch or a check runs without touching npm run dev's data
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { styleText } from 'node:util';
import { renderUnicodeCompact } from 'uqr';
import { build, createServer, preview } from 'vite';
import { uids, users } from './seed/data/cast.js';

const DEV = process.argv.includes('--dev');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
// The built apps, the emulators' config and their log, out of the repo's way
const DIR = join(ROOT, DEV ? 'node_modules/.isolated' : 'node_modules/.demo');
const LOG = join(DIR, 'emulators.log');
const PROJECT = 'demo-gobernansa';
const BUCKET = `${PROJECT}.appspot.com`;
// Next to npm run dev's, so all three can run at once: the apps after its 5400 and 5401 (and the landing's 5404), the emulators
// ten (the demo) or twenty (dev:isolated) above its 550x. The apps find them with VITE_EMULATORS_OFFSET (firebase.ts emulatorAt)
const OFFSET = DEV ? 20 : 10;
const PORTS = { webapp: DEV ? 5405 : 5402, admin: DEV ? 5406 : 5403, ...Object.fromEntries(Object.entries({ auth: 5501, firestore: 5502, websocket: 5503, storage: 5504, hub: 5506, logging: 5507 }).map(([name, port]) => [name, port + OFFSET])) };
const NAME = DEV ? 'npm run dev:isolated' : 'La demo';
const RESET = DEV ? 'npm run dev:isolated -- --reset' : 'npm run demo:reset';
const APPS = ['webapp', 'admin'];
// Who's who in docs/demo.md
const CAST = [[uids.office, 'admin, en el portátil'], [uids.maria, 'webapp, navegador 1 del móvil'], [uids.carmen, 'webapp, navegador 2 del móvil']];

const bold = text => styleText('bold', String(text));
const dim = text => styleText('dim', String(text));
const local = port => `127.0.0.1:${port}`;
const answers = async port => fetch(`http://${local(port)}/`).then(() => true, () => false);

let emulators;
const servers = [];

// The seed, with every account kept so the phones stay signed in, and the photos in the Storage emulator
async function seed() {
	const env = {
		...process.env,
		FIRESTORE_EMULATOR_HOST: local(PORTS.firestore),
		FIREBASE_AUTH_EMULATOR_HOST: local(PORTS.auth),
		FIREBASE_STORAGE_EMULATOR_HOST: local(PORTS.storage),
		GCLOUD_PROJECT: PROJECT,
		VITE_FIREBASE_STORAGE_BUCKET: BUCKET,
		// Not on Google Cloud: without it the Storage client asks the metadata server first
		METADATA_SERVER_DETECTION: 'none',
	};
	const child = spawn(process.execPath, ['scripts/seed/seed.js', '--reset'], { cwd: ROOT, env, stdio: 'inherit' });
	const code = await new Promise(resolve => child.on('exit', resolve));
	// null when a signal stopped it halfway
	if (code !== 0) {
		throw new Error('No se han podido cargar los datos del seed');
	}
}

function logTail() {
	return readFileSync(LOG, 'utf8').trim().split('\n').slice(-15).join('\n');
}

async function startEmulators() {
	if (spawnSync('java', ['-version']).status !== 0) {
		throw new Error('Los emuladores necesitan Java: instala un JDK (brew install openjdk@21) y ponlo en el PATH');
	}
	if (await answers(PORTS.firestore)) {
		throw new Error(`${NAME} ya está en marcha en otra terminal. Para dejar sus datos como nuevos: ${RESET}`);
	}
	// Downloaded by firebase the first time they start, the only time it needs internet
	const cache = process.env.FIREBASE_EMULATORS_PATH || join(homedir(), '.cache/firebase/emulators');
	const jars = existsSync(cache) ? readdirSync(cache) : [];
	if (!['cloud-firestore-emulator', 'cloud-storage-rules-runtime'].every(name => jars.some(file => file.startsWith(name)))) {
		console.warn(styleText('yellow', '⚠ Falta descargar los emuladores: esta vez necesita internet, las siguientes ya no'));
	}

	writeFileSync(join(DIR, 'firebase.json'), JSON.stringify({
		firestore: { rules: join(ROOT, 'firebase', 'firestore.rules') },
		storage: { rules: join(ROOT, 'firebase', 'storage.rules') },
		emulators: {
			auth: { port: PORTS.auth },
			firestore: { port: PORTS.firestore, websocketPort: PORTS.websocket },
			storage: { port: PORTS.storage },
			hub: { port: PORTS.hub },
			logging: { port: PORTS.logging },
			ui: { enabled: false },
		},
	}, null, '\t'));
	const log = openSync(LOG, 'w');
	// In its own process group, so Ctrl+C reaches it only through stop() and Java goes with it
	emulators = spawn(join(ROOT, 'node_modules/.bin/firebase'), ['emulators:start', '--only', 'auth,firestore,storage', '--project', PROJECT, '--config', join(DIR, 'firebase.json')], {
		cwd: DIR,
		env: {
			...process.env,
			// Without English the Firestore emulator fails on null values
			JAVA_TOOL_OPTIONS: `${process.env.JAVA_TOOL_OPTIONS ?? ''} -Duser.language=en -Duser.country=US`.trim(),
			// firebase-tools sends through a proxy set in the shell even the emulators' calls to each other (NO_PROXY aside):
			// Storage's rules couldn't read Firestore, and every upload would be refused
			HTTP_PROXY: '',
			HTTPS_PROXY: '',
			http_proxy: '',
			https_proxy: '',
		},
		detached: true,
		stdio: ['ignore', log, log],
	});
	for (let tries = 0; tries < 120; tries++) {
		if (emulators.exitCode !== null) {
			throw new Error(`Los emuladores no han arrancado:\n${logTail()}`);
		}
		if ((await Promise.all([PORTS.auth, PORTS.firestore, PORTS.storage].map(answers))).every(Boolean)) {
			emulators.on('exit', () => {
				console.error(styleText('red', `Los emuladores se han parado:\n${logTail()}`));
				void stop(1);
			});
			return;
		}
		await new Promise(resolve => setTimeout(resolve, 500));
	}
	throw new Error(`Los emuladores no responden tras un minuto:\n${logTail()}`);
}

// Against these emulators, whatever .env.local says: the variables already set win over its files
function pointAtEmulators(webappUrl) {
	Object.assign(process.env, {
		VITE_FIREBASE_EMULATORS: 'true',
		VITE_EMULATORS_OFFSET: String(OFFSET),
		VITE_FIREBASE_API_KEY: 'demo-api-key',
		VITE_FIREBASE_PROJECT_ID: PROJECT,
		VITE_FIREBASE_STORAGE_BUCKET: BUCKET,
		VITE_FIREBASE_MEASUREMENT_ID: '',
		VITE_FIREBASE_VAPID_KEY: '',
		VITE_APP_CHECK_KEY: '',
		VITE_WEBAPP_URL: webappUrl,
		VITE_MAIL_MODE: 'demo',
	});
}

async function buildApps(webappUrl) {
	pointAtEmulators(webappUrl);
	process.env.VITE_RELEASE = 'demo';
	await Promise.all(APPS.map(async app => build({
		root: join(ROOT, 'apps', app),
		configFile: join(ROOT, 'apps', app, 'vite.config.ts'),
		mode: 'production',
		logLevel: 'error',
		build: { outDir: join(DIR, app), emptyOutDir: true, sourcemap: false },
	})));
}

// Plain http: a phone would have to trust mkcert's certificate. The emulators are reached through each page's own address
// (firebase.ts emulatorAt), wherever it's opened from. With the page's host, so the address the Storage emulator makes from
// it for a photo upload comes back here too: the shorthand 'http://…' would change it to its own
async function serveApps() {
	const to = port => ({ target: `http://${local(port)}` });
	const proxy = {
		'/google.firestore.v1.Firestore': to(PORTS.firestore),
		'/v1/projects': to(PORTS.firestore),
		'/identitytoolkit.googleapis.com': to(PORTS.auth),
		'/securetoken.googleapis.com': to(PORTS.auth),
		'/emulator': to(PORTS.auth),
		'/v0/b': to(PORTS.storage),
	};
	for (const app of APPS) {
		servers.push(await preview({
			root: join(ROOT, 'apps', app),
			configFile: join(ROOT, 'apps', app, 'vite.config.ts'),
			logLevel: 'warn',
			server: { https: false }, // vite-plugin-mkcert stays out
			build: { outDir: join(DIR, app) },
			preview: { host: '0.0.0.0', port: PORTS[app], strictPort: true, proxy },
		}));
	}
}

// npm run dev:isolated: on https like npm run dev, so the emulators are reached straight at their ports
async function serveDev() {
	pointAtEmulators(`https://localhost:${PORTS.webapp}`);
	for (const app of APPS) {
		const server = await createServer({
			root: join(ROOT, 'apps', app),
			configFile: join(ROOT, 'apps', app, 'vite.config.ts'),
			mode: 'localhost',
			logLevel: 'warn',
			server: { port: PORTS[app], strictPort: true },
		});
		servers.push(await server.listen());
	}
}

let stopping = false;
async function stop(code = 0) {
	// Once, however many times Ctrl+C is pressed
	if (stopping) {
		return;
	}
	stopping = true;
	await Promise.all(servers.map(async server => server.close()));
	if (emulators?.exitCode === null && emulators.signalCode === null) {
		emulators.removeAllListeners('exit');
		const exited = new Promise(resolve => emulators.once('exit', resolve));
		emulators.kill('SIGINT');
		await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 10_000))]);
		// Java, if it's left behind
		try {
			process.kill(-emulators.pid, 'SIGKILL');
		} catch {}
	}
	process.exit(code);
}

function printAccounts() {
	console.log(`\n${bold('Cuentas')} ${dim('· con la contraseña DEMO_PASSWORD de .env.local')}`);
	for (const [uid, where] of CAST) {
		const user = users.find(person => person.uid === uid);
		console.log(`  ${user.name.padEnd(14)} ${user.email.padEnd(30)} ${DEV ? '' : dim(where)}`.trimEnd());
	}
}

async function main() {
	if (process.argv.includes('--reset')) {
		if (!await answers(PORTS.firestore)) {
			throw new Error(`${NAME} no está en marcha: arráncalo con ${DEV ? 'npm run dev:isolated' : 'npm run demo'}`);
		}
		await seed();
		console.log(styleText('green', '\n✔ Datos como nuevos. Las sesiones abiertas siguen'));
		return;
	}
	if (!process.env.DEMO_PASSWORD) {
		throw new Error('Falta DEMO_PASSWORD en .env.local: es la contraseña de todas las cuentas del seed');
	}
	mkdirSync(DIR, { recursive: true });
	// Also when the terminal is closed: the emulators run apart and would be left holding the ports
	for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
		process.on(signal, () => void stop());
	}

	console.log(dim('Arrancando los emuladores…'));
	await startEmulators();
	console.log(`${styleText('green', '✔')} Emuladores ${dim(`· Auth ${PORTS.auth}, Firestore ${PORTS.firestore}, Storage ${PORTS.storage}`)}`);
	await seed();

	if (DEV) {
		await serveDev();
		console.log(`\n${styleText('green', '✔')} ${bold('Listo, aparte de npm run dev')}`);
		console.log(`  Webapp   ${bold(`https://localhost:${PORTS.webapp}`)}`);
		console.log(`  Admin    ${bold(`https://localhost:${PORTS.admin}`)}`);
		printAccounts();
		console.log(dim(`\nSus datos: npm run db -- --isolated <orden>. ${RESET} los deja como nuevos. Ctrl+C para todo. Registro de los emuladores: ${LOG}`));
		return;
	}

	// Where the phone finds this laptop, the first address on a network that isn't a self-assigned one
	const ip = Object.values(networkInterfaces()).flat().find(address => address.family === 'IPv4' && !address.internal && !address.address.startsWith('169.254.'))?.address;
	if (!ip) {
		console.warn(styleText('yellow', '⚠ El portátil no está en ninguna red: el móvil no podrá abrir la webapp. Conéctalo a la wifi (o al punto de acceso del móvil) y vuelve a arrancar'));
	}
	const webappUrl = `http://${ip ?? '127.0.0.1'}:${PORTS.webapp}`;
	console.log(dim('\nConstruyendo la webapp y el admin…'));
	await buildApps(webappUrl);
	await serveApps();

	console.log(`\n${styleText('green', '✔')} ${bold('La demo está lista, sin internet')}`);
	// The admin by name, where the browser allows what http on an address doesn't (copying the work order's link, crypto)
	console.log(`  Admin, en el portátil   ${bold(`http://localhost:${PORTS.admin}`)}`);
	console.log(`  Webapp, en el móvil     ${bold(webappUrl)} ${dim('(en la misma wifi que el portátil)')}\n`);
	console.log(renderUnicodeCompact(webappUrl, { border: 2 }));
	printAccounts();
	console.log(dim(`\nnpm run demo:reset deja los datos como nuevos sin cerrar las sesiones. Ctrl+C para todo. Registro de los emuladores: ${LOG}`));
}

try {
	await main();
} catch (error) {
	console.error(styleText('red', error.message));
	await stop(1);
}
