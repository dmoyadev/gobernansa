import process from 'node:process';
import { styleText } from 'node:util';
import { MAX, purge } from '../../functions/retention.js';
import { connect } from './archive.js';

/*
 * Plazos de conservación (functions/retention.js) by hand, on the free plan, where purgeExpired doesn't run and until the
 * copia de seguridad does it every day: counts what's expired and, with --delete, deletes it
 */

try {
	const remove = process.argv.includes('--delete');
	const { db, projectId, emulator } = connect();
	const counts = await purge(db, { dryRun: !remove });
	const where = emulator ? `el emulador ${process.env.FIRESTORE_EMULATOR_HOST}` : projectId;
	console.log(`${remove ? 'Borrado' : 'Caducado'} en ${where}:`);
	Object.entries(counts).forEach(([what, count]) => console.log(`  ${what}: ${count.toLocaleString('es')}`));
	if (!remove) {
		console.log('Para borrarlo: npm run purge -- --delete');
	} else if (Object.values(counts).reduce((sum, count) => sum + count, 0) >= MAX) {
		console.warn(styleText('yellow', `⚠ Ha llegado al máximo de ${MAX.toLocaleString('es')} por vez y puede quedar más: vuelve a ejecutarlo`));
	}
} catch (error) {
	console.error(styleText('red', `✗ ${error.message}`));
	process.exitCode = 1;
}
