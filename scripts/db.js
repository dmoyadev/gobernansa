// npm run db -- <get|set|update|delete> <path> [json]: reads or writes the data of the emulators, never of a real project: it
// only ever talks to FIRESTORE_EMULATOR_HOST. npm run dev's by default; --isolated or --demo for those (scripts/demo.js)
//   npm run db -- get communities/c1                      a document
//   npm run db -- get communities/c1/meetings             a collection: each document with its id
//   npm run db -- update communities/c1 '{"name":"Otra"}'  only those fields ("a.b" for a nested one)
//   npm run db -- set users/x '{"role":"user"}'           the whole document, created or replaced
//   npm run db -- delete communities/c1/meetings/m1
import process from 'node:process';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const [command, path, json] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const offset = process.argv.includes('--isolated') ? 20 : process.argv.includes('--demo') ? 10 : 0;
// npm run dev's data is under the apps' project (.env.local); the demo's and dev:isolated's, under demo-gobernansa
const projectId = offset ? 'demo-gobernansa' : process.env.VITE_FIREBASE_PROJECT_ID ?? 'demo-gobernansa';
const host = `127.0.0.1:${5502 + offset}`;

if (!['get', 'set', 'update', 'delete'].includes(command) || !path || (['set', 'update'].includes(command) && !json)) {
	console.error('Uso: npm run db -- <get|set|update|delete> <ruta> [json] [--isolated|--demo]. Ejemplos al principio de scripts/db.js');
	process.exit(1);
}
if (!await fetch(`http://${host}/`).then(() => true, () => false)) {
	console.error(`No hay emulador de Firestore en ${host}: arráncalo con ${{ 0: 'npm run dev', 10: 'npm run demo', 20: 'npm run dev:isolated' }[offset]}`);
	process.exit(1);
}

process.env.FIRESTORE_EMULATOR_HOST = host;
initializeApp({ projectId });
const db = getFirestore();
// Dates as ISO text, not as { _seconds, _nanoseconds }
function print(value) {
	return console.log(JSON.stringify(value, function (key, item) {
		return this[key] instanceof Timestamp ? this[key].toDate().toISOString() : item;
	}, '\t'));
}

const isCollection = path.split('/').filter(Boolean).length % 2 === 1;
if (command === 'get' && isCollection) {
	print((await db.collection(path).get()).docs.map(snap => ({ id: snap.id, ...snap.data() })));
} else if (isCollection) {
	console.error(`${path} es una colección: ${command} va sobre un documento`);
	process.exit(1);
} else if (command === 'get') {
	const snap = await db.doc(path).get();
	if (!snap.exists) {
		console.error(`${path} no existe`);
		process.exit(1);
	}
	print(snap.data());
} else {
	await db.doc(path)[command](...(json ? [JSON.parse(json)] : []));
	console.log(`${path}: ${command} hecho`);
}
process.exit(0);
