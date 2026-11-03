import { readFileSync } from 'node:fs';
import process from 'node:process';
import { styleText } from 'node:util';
import { checkbox, confirm, input, select } from '@inquirer/prompts';
import admin from 'firebase-admin';
import { roles } from '../../packages/shared/domain/user.ts';
import accounting from './data/accounting.js';
import billing from './data/billing.js';
import bookings from './data/bookings.js';
import { users } from './data/cast.js';
import charges from './data/charges.js';
import core from './data/core.js';
import errors from './data/errors.js';
import maintenance from './data/maintenance.js';
import meetings from './data/meetings.js';

// In the order they're offered and loaded
const GROUPS = [core, maintenance, meetings, charges, accounting, bookings, billing, errors];
const EMULATORS = { firestore: '127.0.0.1:8080', auth: '127.0.0.1:9099' };
// The free plan's writes (and deletes) per day
const DAILY_WRITES = 20_000;

// Any flag (--yes, --reset, --only=core,meetings, --project=<id>) skips the questions, as in scripts and CI
const FLAG_PREFIX_REGEX = /^--/;
const flags = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(FLAG_PREFIX_REGEX, '').split('=')).map(([name, value = true]) => [name, value]));
const interactive = process.stdin.isTTY && !Object.keys(flags).length;

const bold = text => styleText('bold', String(text));
const dim = text => styleText('dim', String(text));
const number = value => value.toLocaleString('es');

function readKey() {
	try {
		return JSON.parse(readFileSync(new URL('./serviceAccountKey.local.json', import.meta.url), 'utf-8'));
	} catch {
		return null;
	}
}

// Each group's docs by path, recorded without writing them, so it's known what will be written and what the seed made
function plan(group) {
	const docs = new Map();
	group.seed((path, data) => {
		if (path.split('/').length % 2) {
			throw new Error(`${group.id}: ${path} no es la ruta de un documento`);
		}
		docs.set(path, data);
	});
	return docs;
}

async function chooseTarget(key) {
	if (process.env.FIRESTORE_EMULATOR_HOST) {
		return 'emulator';
	}
	if (!interactive) {
		// Never the live project by accident: a script has to name it
		if (!key || flags.project !== key.project_id) {
			throw new Error(`Sin FIRESTORE_EMULATOR_HOST se escribe en el proyecto real: añade --project=${key?.project_id ?? '<id>'} para confirmarlo`);
		}
		return 'live';
	}

	const target = await select({
		message: '¿Dónde cargar los datos?',
		choices: [
			{ name: `Emuladores locales (Firestore ${EMULATORS.firestore}, Auth ${EMULATORS.auth})`, value: 'emulator' },
			{ name: `Proyecto real ${key?.project_id ?? ''}`, value: 'live', description: 'Lo que usa la gente: cada lectura, escritura y borrado gasta la cuota diaria del plan gratuito', disabled: !key && '(falta serviceAccountKey.local.json)' },
		],
	});
	if (target === 'live') {
		await input({ message: `Escribe ${bold(key.project_id)} para confirmar que es el proyecto real:`, validate: value => value.trim() === key.project_id || 'No coincide' });
	} else {
		process.env.FIRESTORE_EMULATOR_HOST = EMULATORS.firestore;
		process.env.FIREBASE_AUTH_EMULATOR_HOST = EMULATORS.auth;
	}
	return target;
}

// Documents there are now of each group's collections, aggregated: about one read per 1.000 documents
async function count(db, group) {
	const queries = [...group.collections.map(name => db.collection(name)), ...group.communityCollections.map(name => db.collectionGroup(name))];
	const counts = await Promise.all(queries.map(async query => (await query.count().get()).data().count));
	return counts.reduce((total, value) => total + value, 0);
}

// Exactly the documents the seed makes, with no reads. What was added by hand stays, also under them (e.g. a comment on a demo
// issue): a recursive delete of a community would take every group's data with it
async function removeSeeded(db, paths) {
	const writer = db.bulkWriter();
	const deletes = paths.map(async path => writer.delete(db.doc(path)));
	await writer.close();
	await Promise.all(deletes);
}

// Whether emptying these groups' collections takes the document with it. Other groups write into some of them (e.g.
// bookings' payments, billing's expenses) and the communities hold every group's subcollections
function wipes(groups, path) {
	const [root, , sub] = path.split('/');
	return groups.some(group => group.collections.includes(root) || (root === 'communities' && group.communityCollections.includes(sub)));
}

// The group's collections whole, those made by hand too
async function empty(db, group) {
	const communities = group.communityCollections.length ? await db.collection('communities').listDocuments() : [];
	await Promise.all([
		...group.collections.map(async name => db.recursiveDelete(db.collection(name))),
		...communities.flatMap(community => group.communityCollections.map(async name => db.recursiveDelete(community.collection(name)))),
	]);
}

async function load(db, target, docs, mode) {
	const writer = db.bulkWriter({ throttling: target === 'live' });
	let skipped = 0;
	const failed = [];
	writer.onWriteError((error) => {
		// ALREADY_EXISTS, when only the missing ones are created
		if (error.code === 6) {
			skipped++;
			return false;
		}
		return error.failedAttempts < 5;
	});
	const writes = Array.from(docs, async ([path, data]) => writer[mode](db.doc(path), data).catch((error) => {
		if (error.code !== 6) {
			failed.push(`${path}: ${error.message}`);
		}
	}));
	await writer.close();
	await Promise.all(writes);
	return { written: docs.size - skipped - failed.length, skipped, failed };
}

// The demo's accounts, so each can sign in with a magic link. Others signed in before go, or their emails would map to other uids
async function resetAuth() {
	// Never the live project's accounts
	if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
		throw new Error('Las cuentas solo se recrean en el emulador de Auth');
	}
	const auth = admin.auth();
	const { users: existing } = await auth.listUsers(1000);
	await auth.deleteUsers(existing.map(user => user.uid));
	await Promise.all(users.map(async ({ uid, email, name }) => auth.createUser({ uid, email, displayName: name, emailVerified: true })));
}

async function ask(db, planned) {
	console.log(dim('Contando lo que hay…'));
	const counts = Object.fromEntries(await Promise.all(GROUPS.map(async group => [group.id, await count(db, group)])));
	const describe = group => `${group.label} ${dim(`· ${number(counts[group.id])} ahora, ${number(planned[group.id].size)} en la demo`)}`;

	const what = await select({
		message: '¿Qué quieres hacer?',
		choices: [
			{ name: 'Dejar la demo completa como nueva', value: 'fresh', description: 'Vacía todas las colecciones de la demo, también lo creado a mano, y lo carga todo' },
			{ name: 'Elegir qué borrar y qué cargar', value: 'custom' },
		],
	});
	if (what === 'fresh') {
		const ids = GROUPS.map(group => group.id);
		return { remove: ids, removeMode: 'empty', add: ids, addMode: 'set', auth: !!process.env.FIREBASE_AUTH_EMULATOR_HOST };
	}

	// Asked only when there's something to delete, a checkbox with every choice disabled can't be answered
	const remove = Object.values(counts).some(Boolean)
		? await checkbox({
				message: '¿Qué datos borrar antes de cargar?',
				choices: GROUPS.map(group => ({ name: describe(group), value: group.id, description: group.hint, disabled: !counts[group.id] && '(vacío)' })),
				pageSize: GROUPS.length,
			})
		: [];
	const removeMode = remove.length && await select({
		message: '¿Cómo borrarlos?',
		choices: [
			{ name: 'Solo lo que crea el seed', value: 'seeded', description: 'Borra exactamente los documentos de la demo. Lo creado a mano se queda, también lo que cuelga de ellos' },
			{ name: 'Vaciar sus colecciones enteras', value: 'empty', description: `También lo creado a mano.${remove.includes('core') ? ' Vaciar las comunidades borra todo lo que cuelga de ellas' : ''}` },
		],
	});

	const add = await checkbox({
		message: '¿Qué datos cargar?',
		choices: GROUPS.map(group => ({ name: describe(group), value: group.id, description: group.hint, checked: true })),
		pageSize: GROUPS.length,
	});
	// What the chosen groups point to, when it isn't there nor coming
	const missing = GROUPS.filter(group => !add.includes(group.id)
		&& (!counts[group.id] || (remove.includes(group.id) && removeMode === 'empty'))
		&& add.some(id => GROUPS.find(other => other.id === id).requires.includes(group.id)));
	if (missing.length && await confirm({ message: `Lo elegido usa ${missing.map(group => bold(group.label)).join(', ')}, que no estará. ¿Lo cargo también?`, default: true })) {
		add.push(...missing.map(group => group.id));
	}
	const emptied = removeMode === 'empty' ? GROUPS.filter(group => remove.includes(group.id)) : [];
	const caught = GROUPS.filter(group => !add.includes(group.id) && counts[group.id] && [...planned[group.id].keys()].some(path => wipes(emptied, path)));
	if (caught.length && await confirm({ message: `Vaciar lo elegido borra también datos de ${caught.map(group => bold(group.label)).join(', ')}. ¿Los cargo de nuevo?`, default: true })) {
		add.push(...caught.map(group => group.id));
	}
	const addMode = add.length && await select({
		message: '¿Cómo cargarlos?',
		choices: [
			{ name: 'Sobrescribir los documentos de la demo', value: 'set', description: 'Quedan como recién cargados. Lo creado a mano no se toca' },
			{ name: 'Crear solo los que falten', value: 'create', description: 'Los que ya existen se quedan como están' },
		],
	});

	const auth = !!process.env.FIREBASE_AUTH_EMULATOR_HOST && await confirm({
		message: `¿Recrear en el emulador de Auth las ${users.length} cuentas de la demo? Borra las demás del emulador`,
		default: add.includes('core'),
	});
	return { remove, removeMode, add, addMode, auth };
}

async function main() {
	const key = readKey();
	const target = await chooseTarget(key);
	const projectId = target === 'live' ? key.project_id : process.env.GCLOUD_PROJECT ?? key?.project_id ?? 'demo-gobernansa';
	if (target === 'emulator' && !await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/`).catch(() => null)) {
		throw new Error(`No hay emulador de Firestore en ${process.env.FIRESTORE_EMULATOR_HOST}: arráncalo con npm run start:firebase:emulators`);
	}
	admin.initializeApp(target === 'live' ? { credential: admin.credential.cert(key) } : { projectId });
	const db = admin.firestore();
	db.settings({ ignoreUndefinedProperties: true });

	const planned = Object.fromEntries(GROUPS.map(group => [group.id, plan(group)]));
	const owners = new Map();
	for (const group of GROUPS) {
		for (const path of planned[group.id].keys()) {
			if (owners.has(path)) {
				console.warn(styleText('yellow', `⚠ ${path} lo escriben ${owners.get(path)} y ${group.id}, se queda el último`));
			}
			owners.set(path, group.id);
		}
	}

	let choice;
	if (interactive) {
		choice = await ask(db, planned);
	} else {
		const ids = flags.only ? String(flags.only).split(',') : GROUPS.map(group => group.id);
		const unknown = ids.filter(id => !GROUPS.some(group => group.id === id));
		if (unknown.length) {
			throw new Error(`No existen los grupos ${unknown.join(', ')}. Son: ${GROUPS.map(group => group.id).join(', ')}`);
		}
		choice = { remove: flags.reset ? ids : [], removeMode: 'empty', add: ids, addMode: 'set', auth: !!process.env.FIREBASE_AUTH_EMULATOR_HOST };
		const emptied = GROUPS.filter(group => choice.remove.includes(group.id));
		const caught = GROUPS.filter(group => !ids.includes(group.id) && [...planned[group.id].keys()].some(path => wipes(emptied, path)));
		if (caught.length) {
			console.warn(styleText('yellow', `⚠ Vaciar ${emptied.map(group => group.id).join(', ')} borra también datos de ${caught.map(group => group.id).join(', ')}: añádelos a --only para cargarlos de nuevo`));
		}
	}

	const chosen = ids => GROUPS.filter(group => ids.includes(group.id));
	const writes = chosen(choice.add).reduce((total, group) => total + planned[group.id].size, 0);
	console.log(`\n${bold('Destino')}     ${target === 'live' ? styleText('red', `proyecto real ${projectId}`) : `emulador ${process.env.FIRESTORE_EMULATOR_HOST} (${projectId})`}`);
	console.log(`${bold('Borrar')}      ${choice.remove.length ? `${chosen(choice.remove).map(group => group.label).join(', ')} ${dim(choice.removeMode === 'empty' ? '(colecciones enteras)' : '(solo lo del seed)')}` : dim('nada')}`);
	console.log(`${bold('Cargar')}      ${choice.add.length ? `${number(writes)} documentos de ${chosen(choice.add).map(group => group.label).join(', ')} ${dim(choice.addMode === 'set' ? '(sobrescribe)' : '(solo los que falten)')}` : dim('nada')}`);
	if (choice.auth) {
		console.log(`${bold('Auth')}        recrear ${users.length} cuentas en el emulador ${process.env.FIREBASE_AUTH_EMULATOR_HOST}`);
	}
	if (target === 'live') {
		console.log(styleText('yellow', `Gasta unas ${number(writes)} escrituras, más un borrado por documento borrado (y al vaciar, una lectura), de las ${number(DAILY_WRITES)} diarias del plan gratuito`));
	}
	if (!choice.remove.length && !choice.add.length && !choice.auth) {
		console.log('Nada que hacer');
		return;
	}
	if (interactive && !await confirm({ message: '¿Seguimos?', default: target === 'emulator' })) {
		console.log('Cancelado, no se ha tocado nada');
		return;
	}

	// The others first, so emptying the communities last doesn't leave the rest listing what's already gone
	for (const group of chosen(choice.remove).reverse()) {
		await (choice.removeMode === 'empty' ? empty(db, group) : removeSeeded(db, [...planned[group.id].keys()]));
		console.log(`${styleText('red', '✗')} ${group.label} ${dim('borrado')}`);
	}
	let failures = 0;
	for (const group of chosen(choice.add)) {
		const { written, skipped, failed } = await load(db, target, planned[group.id], choice.addMode);
		failures += failed.length;
		console.log(`${styleText(failed.length ? 'yellow' : 'green', '✔')} ${group.label} ${dim(`· ${number(written)} documentos${skipped ? `, ${number(skipped)} ya estaban` : ''}${failed.length ? `, ${failed.length} fallidos` : ''}`)}`);
		failed.slice(0, 5).forEach(line => console.log(styleText('red', `  ${line}`)));
	}
	if (choice.auth) {
		await resetAuth();
		console.log(`${styleText('green', '✔')} Cuentas del emulador de Auth`);
	}

	console.log(`\n${bold('Cuentas de la demo')} ${dim('(se entra con enlace mágico al correo)')}`);
	for (const user of users) {
		console.log(`  ${user.name.padEnd(20)} ${roles[user.role].label.padEnd(18)} ${user.email}${user.blocked ? dim(' · bloqueado') : ''}`);
	}
	if (failures) {
		process.exitCode = 1;
	}
}

try {
	await main();
} catch (error) {
	// Ctrl+C on a question
	if (error.name === 'ExitPromptError') {
		console.log('Cancelado');
	} else {
		console.error(styleText('red', error.message));
		process.exitCode = 1;
	}
}
