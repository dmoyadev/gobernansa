import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { styleText } from 'node:util';
import admin from 'firebase-admin';
import { BACKUP_DIR, encode, encrypt, KEY_FILE, readKey, SERVICE_ACCOUNT } from './archive.js';

/*
 * Copia de seguridad (ROB-2, puente gratuito, docs/fiabilidad.md): every document of Firestore, encrypted, to this
 * computer, and ops/backup with when and how many, for the admin's warning. It reads every document once, so it spends
 * that many reads of the day's 50.000. --schedule sets it to run every day with launchd
 */

const KEEP = 14;
const DAILY_READS = 50_000;
const LABEL = 'com.gobernansa.backup';
// Collection groups get each collection at any depth with one read per document. Every collection a client writes has its
// match in the rules (they deny the rest), plus users/{uid}/{collection}, whose names the rules list in a condition
const RULES = new URL('../../firestore.rules', import.meta.url);
const USER_COLLECTIONS = ['documents', 'documentFiles', 'devices', 'keys'];
const MATCH = /match \/(\w+)\//g;

function schedule() {
	const plist = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
	const root = fileURLToPath(new URL('../..', import.meta.url));
	mkdirSync(BACKUP_DIR, { recursive: true });
	// Every day at 14:00. Asleep then, launchd runs it on waking; switched off, the admin warns after 26 hours
	writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>${LABEL}</string>
	<key>ProgramArguments</key>
	<array><string>${process.execPath}</string><string>${fileURLToPath(import.meta.url)}</string></array>
	<key>WorkingDirectory</key><string>${root}</string>
	<key>EnvironmentVariables</key>
	<dict><key>BACKUP_DIR</key><string>${BACKUP_DIR}</string><key>BACKUP_KEY</key><string>${KEY_FILE}</string></dict>
	<key>StartCalendarInterval</key><dict><key>Hour</key><integer>14</integer><key>Minute</key><integer>0</integer></dict>
	<key>StandardOutPath</key><string>${join(BACKUP_DIR, 'backup.log')}</string>
	<key>StandardErrorPath</key><string>${join(BACKUP_DIR, 'backup.log')}</string>
</dict>
</plist>
`);
	console.log(`Escrito ${plist}. Para activarlo (y después de cambiarlo, antes con bootout):\n  launchctl bootstrap gui/${process.getuid()} "${plist}"\nPara lanzarlo ya: launchctl kickstart gui/${process.getuid()}/${LABEL}`);
}

async function main() {
	if (process.argv.includes('--schedule')) {
		readKey({ create: true });
		return schedule();
	}

	const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
	const account = emulator ? null : JSON.parse(readFileSync(SERVICE_ACCOUNT, 'utf8'));
	const projectId = account?.project_id ?? process.env.GCLOUD_PROJECT ?? 'demo-gobernansa';
	admin.initializeApp(account ? { credential: admin.credential.cert(account) } : { projectId });
	const db = admin.firestore();
	const key = readKey({ create: true });

	const root = (await db.listCollections()).map(collection => collection.id);
	const groups = [...new Set([...root, ...Array.from(readFileSync(RULES, 'utf8').matchAll(MATCH), ([, name]) => name), ...USER_COLLECTIONS])];
	const documents = new Map();
	// ponytail: the whole database in memory, fine up to the free plan's 1 GiB; stream it to the file if it gets near
	for (const group of groups) {
		const snapshot = await db.collectionGroup(group).get();
		snapshot.forEach(doc => documents.set(doc.ref.path, encode(doc.data())));
	}

	const at = new Date();
	const name = `gobernansa-${projectId}-${at.toISOString().slice(0, 16).replace(':', '')}.bak`;
	const file = encrypt({ project: projectId, at: at.toISOString(), documents: [...documents] }, key);
	mkdirSync(BACKUP_DIR, { recursive: true });
	writeFileSync(join(BACKUP_DIR, name), file, { mode: 0o600 });
	const old = readdirSync(BACKUP_DIR).filter(file => file.startsWith(`gobernansa-${projectId}-`) && file.endsWith('.bak')).sort().slice(0, -KEEP);
	old.forEach(file => rmSync(join(BACKUP_DIR, file)));

	const collections = new Set(Array.from(documents.keys(), path => path.split('/').at(-2)));
	await db.doc('ops/backup').set({ at: admin.firestore.FieldValue.serverTimestamp(), documents: documents.size, collections: collections.size, bytes: file.length });

	console.log(`${at.toLocaleString('es')} ${styleText('green', '✔')} ${documents.size.toLocaleString('es')} documentos de ${collections.size} colecciones ${emulator ? `del emulador ${process.env.FIRESTORE_EMULATOR_HOST}` : `de ${projectId}`} en ${join(BACKUP_DIR, name)} (${(file.length / 1024).toFixed(0)} KB)${old.length ? `, borradas ${old.length} antiguas` : ''}`);
	if (documents.size > DAILY_READS / 2) {
		console.warn(styleText('yellow', `⚠ Ha gastado ${documents.size.toLocaleString('es')} lecturas de las ${DAILY_READS.toLocaleString('es')} diarias: es hora de las copias programadas de Blaze (INF-1)`));
	}
}

try {
	await main();
} catch (error) {
	console.error(`${new Date().toLocaleString('es')} ${styleText('red', `✗ ${error.message}`)}`);
	process.exitCode = 1;
}
