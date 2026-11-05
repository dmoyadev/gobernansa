import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { styleText } from 'node:util';
import admin from 'firebase-admin';
import { BACKUP_DIR, decode, decrypt, readKey } from './archive.js';

/*
 * Restaurar una copia (ROB-2, docs/fiabilidad.md) into the local emulators, never the live project: it empties the
 * emulator and writes every document of the copy. With the Auth emulator too, each profile in users gets its account back
 * with the same id and email, to sign in by magic link as that person. The last copy, or the one given:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run restore -- [file]
 */

async function main() {
	const firestore = process.env.FIRESTORE_EMULATOR_HOST;
	if (!firestore) {
		throw new Error('Solo se restaura en los emuladores: falta FIRESTORE_EMULATOR_HOST');
	}
	const projectId = process.env.GCLOUD_PROJECT ?? 'demo-gobernansa';
	const path = process.argv[2] ?? join(BACKUP_DIR, readdirSync(BACKUP_DIR).filter(file => file.endsWith('.bak')).sort().at(-1) ?? '');
	const backup = decrypt(readFileSync(path), readKey());
	console.log(`Copia de ${backup.project} del ${new Date(backup.at).toLocaleString('es')}: ${backup.documents.length.toLocaleString('es')} documentos`);

	const emptied = await fetch(`http://${firestore}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
	if (!emptied.ok) {
		throw new Error(`No se ha podido vaciar el emulador de ${firestore}: ${emptied.status}`);
	}
	admin.initializeApp({ projectId });
	const db = admin.firestore();
	const writer = db.bulkWriter();
	let failed = 0;
	writer.onWriteError((error) => {
		failed++;
		console.error(styleText('red', `✗ ${error.documentRef.path}: ${error.message}`));
		return false;
	});
	for (const [docPath, data] of backup.documents) {
		void writer.set(db.doc(docPath), decode(data, db));
	}
	await writer.close();
	console.log(`${styleText(failed ? 'yellow' : 'green', '✔')} ${(backup.documents.length - failed).toLocaleString('es')} documentos restaurados en ${firestore} (${projectId})${failed ? `, ${failed} fallidos` : ''}`);

	const auth = process.env.FIREBASE_AUTH_EMULATOR_HOST;
	if (auth) {
		await fetch(`http://${auth}/emulator/v1/projects/${projectId}/accounts`, { method: 'DELETE' });
		const users = backup.documents.filter(([docPath, data]) => docPath.split('/').length === 2 && docPath.startsWith('users/') && data.email);
		const { errors } = await admin.auth().importUsers(users.map(([docPath, data]) => ({ uid: docPath.split('/')[1], email: data.email, emailVerified: true })));
		console.log(`${styleText(errors.length ? 'yellow' : 'green', '✔')} ${users.length - errors.length} cuentas en el emulador de Auth ${auth}`);
	}
	if (failed) {
		process.exitCode = 1;
	}
}

try {
	await main();
} catch (error) {
	console.error(styleText('red', error.message));
	process.exitCode = 1;
}
