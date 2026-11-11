// Builds both apps against the demo project and deploys them with its rules and indexes. It never reaches production: the build
// reads .env.demo.local over .env.local, so it stops unless that file names the project .firebaserc calls demo, leaves the
// emulators off and sends «Ver como vecino» and the invitations to the demo's webapp
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { styleText } from 'node:util';
import { loadEnv } from 'vite';

const { projects } = JSON.parse(readFileSync('.firebaserc', 'utf-8'));
const env = loadEnv('demo', '.');

const problems = [
	(!projects.demo || projects.demo === projects.default) && '.firebaserc no tiene un proyecto demo distinto del real',
	env.VITE_FIREBASE_PROJECT_ID !== projects.demo && `VITE_FIREBASE_PROJECT_ID es ${env.VITE_FIREBASE_PROJECT_ID}, no ${projects.demo}`,
	env.VITE_FIREBASE_EMULATORS === 'true' && 'VITE_FIREBASE_EMULATORS tiene que ser false',
	!env.VITE_WEBAPP_URL && 'falta VITE_WEBAPP_URL, la webapp de la demo',
].filter(Boolean);
if (problems.length) {
	console.error(styleText('red', `No se despliega la demo. En .env.demo.local:\n${problems.map(problem => `  · ${problem}`).join('\n')}`));
	process.exit(1);
}

// Same as CI's: UTC date and time and the commit, e.g. 2026.11.10-1530-3732788
const at = new Date().toISOString();
const release = `${at.slice(0, 10).replaceAll('-', '.')}-${at.slice(11, 16).replace(':', '')}-${execSync('git rev-parse --short=7 HEAD').toString().trim()}`;
const run = command => execSync(command, { stdio: 'inherit', env: { ...process.env, VITE_RELEASE: release } });
run('npm run build -w apps/webapp -w apps/admin -- --mode demo');
// Rules and indexes first, as in CI. The maps stay out: firebase.json ignores them
run('npx firebase deploy --project demo --only firestore,hosting --non-interactive');
console.log(styleText('green', `✔ Demo ${release} en ${env.VITE_WEBAPP_URL}`));
