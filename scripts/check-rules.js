// npm run check:rules: firebase/firestore.rules against what each role must and mustn't be able to do, on a Firestore emulator
// of its own, thirty above npm run dev's ports (docs/desarrollo.md#puertos), that starts and stops with it. CI runs it before
// deploying the rules. With FIRESTORE_EMULATOR_HOST already set it uses that one, in a project of its own (demo-rules)
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { styleText } from 'node:util';
import { initializeApp as initializeAdmin } from 'firebase-admin/app';
import { Timestamp as AdminTimestamp, getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { initializeApp } from 'firebase/app';
import { arrayUnion, collection, collectionGroup, connectFirestoreEmulator, deleteDoc, deleteField, doc, getDoc, getDocs, getFirestore, increment, query, serverTimestamp, setDoc, setLogLevel, Timestamp, updateDoc, where, writeBatch } from 'firebase/firestore';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROJECT = 'demo-rules';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
	// firebase emulators:exec starts the emulator, runs this file again with FIRESTORE_EMULATOR_HOST set, and stops it
	if (spawnSync('java', ['-version']).status !== 0) {
		console.error(styleText('red', 'El emulador de Firestore necesita Java: instala un JDK (brew install openjdk@21) y ponlo en el PATH'));
		process.exit(1);
	}
	const dir = join(ROOT, 'node_modules/.rules');
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'firebase.json'), JSON.stringify({
		firestore: { rules: join(ROOT, 'firebase/firestore.rules') },
		emulators: { firestore: { port: 5532, websocketPort: 5533 }, hub: { port: 5536 }, logging: { port: 5537 }, ui: { enabled: false } },
	}));
	const { status } = spawnSync(join(ROOT, 'node_modules/.bin/firebase'), ['emulators:exec', '--only', 'firestore', '--project', PROJECT, '--config', join(dir, 'firebase.json'), `node "${fileURLToPath(import.meta.url)}"`], {
		// Its firestore-debug.log stays there too
		cwd: dir,
		// Without English the emulator fails on null values; with a shell proxy, the checks' calls to it would go through it
		env: { ...process.env, JAVA_TOOL_OPTIONS: `${process.env.JAVA_TOOL_OPTIONS ?? ''} -Duser.language=en -Duser.country=US`.trim(), HTTP_PROXY: '', HTTPS_PROXY: '', http_proxy: '', https_proxy: '' },
		stdio: 'inherit',
	});
	process.exit(status ?? 1);
}

const host = process.env.FIRESTORE_EMULATOR_HOST;
const emulator = `http://${host}/emulator/v1/projects/${PROJECT}`;
const loaded = await fetch(`${emulator}:securityRules`, {
	method: 'PUT',
	body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: readFileSync(join(ROOT, 'firebase/firestore.rules'), 'utf8') }] } }),
});
if (!loaded.ok) {
	console.error(styleText('red', `firebase/firestore.rules no compila:\n${await loaded.text()}`));
	process.exit(1);
}

initializeAdmin({ projectId: PROJECT });
// Every denial would print a warning, expected or not
setLogLevel('silent');
const admin = getAdminFirestore();
const set = (path, data) => admin.doc(path).set(data);

let clients = new Map();
let apps = 0;
// The same user within a section shares one client; a new section starts them anew
function as(uid, claims = {}) {
	if (!clients.has(uid)) {
		const db = getFirestore(initializeApp({ projectId: PROJECT, apiKey: 'fake' }, `client${apps++}`));
		connectFirestoreEmulator(db, host.split(':')[0], Number(host.split(':')[1]), { mockUserToken: { user_id: uid, sub: uid, ...claims } });
		clients.set(uid, db);
	}
	return clients.get(uid);
}

let checks = 0;
let failures = 0;
async function section(title) {
	console.log(styleText('bold', title));
	clients = new Map();
	await fetch(`${emulator}/databases/(default)/documents`, { method: 'DELETE' });
}
// Denied is the rules saying no; any other error fails the check, whatever was expected
async function expect(label, allowed, run) {
	checks++;
	let error;
	try {
		await run();
	} catch (caught) {
		error = caught;
	}
	const denied = error?.code === 'permission-denied';
	if ((error && !denied) || allowed === denied) {
		failures++;
		console.log(styleText('red', `  ✗ ${label}: ${allowed ? 'debería poder' : 'no debería poder'}${error && !denied ? ` (${error.code ?? error.message})` : ''}`));
	}
}

// Issues: the author's key and private author, votes by home, removal and categories
await section('Incidencias');
{
	const users = {
		lucia: { role: 'user', communityId: 'c1', name: 'Lucía', email: 'l@x.es' },
		javier: { role: 'user', communityId: 'c1', name: 'Javier', email: 'j@x.es' },
		irene: { role: 'user', communityId: 'c1', name: 'Irene', email: 'i@x.es' },
		carmen: { role: 'manager', communityId: 'c1', name: 'Carmen', email: 'c@x.es' },
	};
	await set('communities/c1', { name: 'C1' });
	for (const [uid, data] of Object.entries(users)) {
		await set(`users/${uid}`, data);
	}
	await set('properties/p1', { communityId: 'c1', ownerUid: 'lucia', name: '1A' });
	await set('properties/p5', { communityId: 'c1', ownerUid: 'lucia', name: 'Garaje' });
	await set('properties/p2', { communityId: 'c1', ownerUid: 'javier', name: '1B' });
	const user = uid => as(uid, { email: users[uid].email, email_verified: true });
	const key = 'k'.repeat(32);

	await expect('lucia creates her key', true, () => setDoc(doc(user('lucia'), 'users/lucia/keys/issues'), { key }));
	await expect('lucia changes her key', false, () => setDoc(doc(user('lucia'), 'users/lucia/keys/issues'), { key: 'z'.repeat(32) }));
	await expect('lucia reads her key', true, () => getDoc(doc(user('lucia'), 'users/lucia/keys/issues')));
	await expect('javier reads lucia\'s key', false, () => getDoc(doc(user('javier'), 'users/lucia/keys/issues')));
	await expect('carmen (manager) reads lucia\'s key', false, () => getDoc(doc(user('carmen'), 'users/lucia/keys/issues')));
	await expect('javier creates a key for lucia', false, () => setDoc(doc(user('javier'), 'users/lucia/keys/other'), { key }));

	const base = { title: 't', description: '', category: 'maintenance', communityId: 'c1', status: 'open', votesScore: 0, votesCount: 0, commentsCount: 0, deletedAt: null };
	function report(uid, id, fields = {}, authorUid = uid) {
		const db = user(uid);
		const ref = doc(db, 'communities/c1/issues', id);
		const batch = writeBatch(db);
		batch.set(ref, { ...base, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...fields });
		batch.set(doc(ref, 'private', 'author'), { uid: authorUid });
		return batch.commit();
	}
	await expect('lucia reports with her key and private author', true, () => report('lucia', 'i1', { authorKey: key }));
	await expect('lucia reports with createdBy', false, () => report('lucia', 'i2', { createdBy: 'lucia' }));
	await expect('lucia reports with updatedBy', false, () => report('lucia', 'i3', { updatedBy: 'lucia' }));
	await expect('lucia reports naming javier as author', false, () => report('lucia', 'i4', {}, 'javier'));
	await expect('lucia reports without private author', false, () => setDoc(doc(user('lucia'), 'communities/c1/issues/i5'), { ...base, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
	await expect('carmen reports on behalf, without key', true, () => report('carmen', 'i6'));
	await expect('javier reads the issue', true, () => getDoc(doc(user('javier'), 'communities/c1/issues/i1')));
	await expect('javier reads its author', false, () => getDoc(doc(user('javier'), 'communities/c1/issues/i1/private/author')));
	await expect('carmen reads its author', true, async () => {
		const snap = await getDoc(doc(user('carmen'), 'communities/c1/issues/i1/private/author'));
		if (snap.data()?.uid !== 'lucia') {
			throw new Error('wrong author');
		}
	});
	await expect('carmen rewrites its author', false, () => setDoc(doc(user('carmen'), 'communities/c1/issues/i1/private/author'), { uid: 'carmen' }));
	await expect('lucia claims an existing issue', false, () => setDoc(doc(user('lucia'), 'communities/c1/issues/i6/private/author'), { uid: 'lucia' }));
	await expect('carmen writes private/admin', true, () => setDoc(doc(user('carmen'), 'communities/c1/issues/i1/private/admin'), { note: 'x' }, { merge: true }));

	const vote = (uid, issue, propertyId, id = `${issue}_${propertyId}`) => setDoc(doc(user(uid), `communities/c1/issues/${issue}/votes/${id}`), { propertyId, voterId: uid, score: 1, votedAt: serverTimestamp() });
	await expect('lucia votes with her home', true, () => vote('lucia', 'i1', 'p1'));
	await expect('lucia votes with her garage too', true, () => vote('lucia', 'i1', 'p5'));
	await expect('lucia votes with javier\'s home', false, () => vote('lucia', 'i1', 'p2'));
	await expect('lucia votes under her uid', false, () => vote('lucia', 'i1', 'p1', 'i1_lucia'));
	await expect('irene (no home) votes', false, () => vote('irene', 'i1', 'p1'));
	await expect('lucia votes with an extra field', false, () => setDoc(doc(user('lucia'), 'communities/c1/issues/i6/votes/i6_p1'), { propertyId: 'p1', voterId: 'lucia', score: 1, votedAt: serverTimestamp(), x: 1 }));
	await expect('lucia reads her month\'s votes', true, async () => {
		const snap = await getDocs(query(collectionGroup(user('lucia'), 'votes'), where('voterId', '==', 'lucia'), where('votedAt', '>=', new Date(Date.now() - 86_400_000))));
		if (snap.size !== 2) {
			throw new Error(`expected 2 votes, got ${snap.size}`);
		}
	});
	await expect('javier takes back lucia\'s vote', false, () => deleteDoc(doc(user('javier'), 'communities/c1/issues/i1/votes/i1_p1')));
	await expect('lucia takes back her vote', true, () => deleteDoc(doc(user('lucia'), 'communities/c1/issues/i1/votes/i1_p5')));
	await expect('the counters change with the vote', true, () => updateDoc(doc(user('lucia'), 'communities/c1/issues/i1'), { votesScore: 1, votesCount: 1 }));

	await expect('lucia lists hers by key', true, async () => {
		const snap = await getDocs(query(collection(user('lucia'), 'communities/c1/issues'), where('authorKey', '==', key), where('deletedAt', '==', null)));
		if (snap.size !== 1) {
			throw new Error(`expected 1, got ${snap.size}`);
		}
	});
	await expect('javier removes lucia\'s issue', false, () => updateDoc(doc(user('javier'), 'communities/c1/issues/i1'), { deletedAt: serverTimestamp() }));
	await expect('lucia removes hers, signing it', true, async () => {
		await updateDoc(doc(user('lucia'), 'communities/c1/issues/i1'), { deletedAt: serverTimestamp(), deletedBy: 'lucia' });
		await admin.doc('communities/c1/issues/i1').update({ deletedAt: null, deletedBy: 'carmen' });
	});
	await expect('lucia removes it again without signing, after carmen restored it', true, () => updateDoc(doc(user('lucia'), 'communities/c1/issues/i1'), { deletedAt: serverTimestamp() }));
	await expect('lucia signs a removal as javier', false, () => updateDoc(doc(user('lucia'), 'communities/c1/issues/i1'), { deletedAt: serverTimestamp(), deletedBy: 'javier' }));

	await expect('carmen saves the categories', true, () => updateDoc(doc(user('carmen'), 'communities/c1'), { issueCategories: [{ id: 'x', name: 'X', icon: 'lucide:zap', color: 'rose' }], updatedAt: serverTimestamp(), updatedBy: 'carmen' }));
	await expect('lucia saves the categories', false, () => updateDoc(doc(user('lucia'), 'communities/c1'), { issueCategories: [] }));
}

// Finances (ROB-6): what's paid, remitted, reconciled or closed can't be overwritten or deleted by accident
await section('Finanzas');
{
	const c = 'communities/c1';
	const T = Timestamp.fromMillis(1_700_000_000_000);
	const T2 = Timestamp.fromMillis(1_700_000_100_000);
	const AT = AdminTimestamp.fromMillis(1_700_000_000_000);
	await set('users/admin1', { role: 'admin', communityIds: ['c1'], email: 'a@x.es', name: 'A' });
	await set(c, { name: 'C1', createdAt: AT });
	const charge = { communityId: 'c1', propertyId: 'p1', propertyName: 'P1', ownerUid: '', type: 'fee', concept: 'x', amount: 1000, dueDate: T, paidAt: null, batchId: 'b', createdAt: AT };
	const seedCharge = { ...charge, dueDate: AT, createdAt: AT };
	await set(`${c}/charges/ch1`, seedCharge);
	await set(`${c}/charges/paid`, { ...seedCharge, paidAt: AT });
	await set(`${c}/charges/inR1`, { ...seedCharge, remittanceId: 'R1' });
	await set(`${c}/charges/inM1`, { ...seedCharge, paidAt: AT, bankMovementId: 'M1' });
	await set(`${c}/bankMovements/M1`, { status: 'pending', amount: 1000, createdAt: AT });
	await set(`${c}/bankMovements/M2`, { status: 'matched', amount: 1000, createdAt: AT });
	await set(`${c}/remittances/Rg`, { status: 'generated', items: [], createdAt: AT });
	await set(`${c}/remittances/Rs`, { status: 'sent', items: [], createdAt: AT });
	await set(`${c}/remittances/Rc`, { status: 'collected', collectedAt: AT, items: [], createdAt: AT });
	await set(`${c}/paymentOrders/Og`, { status: 'generated', createdAt: AT });
	await set(`${c}/paymentOrders/Oe`, { status: 'executed', executedAt: AT, createdAt: AT });
	await set(`${c}/expenses/e1`, { concept: 'e', amount: 1, paidAt: null, paymentOrderId: 'Og', createdAt: AT });
	await set(`${c}/expenses/e2`, { concept: 'e', amount: 1, paidAt: null, paymentOrderId: 'Oe', createdAt: AT });
	await set('properties/p1', { communityId: 'c1', name: 'P1', ownerUid: '', createdAt: AT });
	await set(`${c}/payments/pay1`, { communityId: 'c1', amount: 1, bankMovementId: 'M2' });
	const d = path => doc(as('admin1'), path);
	const now = serverTimestamp();

	await expect('create a charge', true, () => setDoc(d(`${c}/charges/new`), { ...charge, createdAt: now }));
	await expect('issue again over an existing charge (new createdAt)', false, () => setDoc(d(`${c}/charges/ch1`), { ...charge, createdAt: now }));
	await expect('restore a charge with its createdAt', true, () => setDoc(d(`${c}/charges/ch1`), { ...charge, dueDate: T, createdAt: T, updatedAt: now }));
	await expect('mark a charge paid', true, () => updateDoc(d(`${c}/charges/ch1`), { paidAt: T, updatedAt: now }));
	await expect('mark it pending again', true, () => updateDoc(d(`${c}/charges/ch1`), { paidAt: null, updatedAt: now }));
	await expect('tie an unpaid charge to a remittance', true, () => updateDoc(d(`${c}/charges/ch1`), { remittanceId: 'R9', updatedAt: now }));
	await expect('tie a paid charge to a remittance', false, () => updateDoc(d(`${c}/charges/paid`), { remittanceId: 'R9', updatedAt: now }));
	await expect('move a charge to another remittance', false, () => updateDoc(d(`${c}/charges/inR1`), { remittanceId: 'R2', updatedAt: now }));
	await expect('collect a remitted charge (paidAt, same remittance)', true, () => updateDoc(d(`${c}/charges/inR1`), { paidAt: T, updatedAt: now }));
	await expect('free it from its remittance', true, () => updateDoc(d(`${c}/charges/inR1`), { paidAt: null, remittanceId: deleteField(), updatedAt: now }));
	await expect('reconcile a charge with another movement', false, () => updateDoc(d(`${c}/charges/inM1`), { bankMovementId: 'M9', updatedAt: now }));
	await expect('unreconcile it', true, () => updateDoc(d(`${c}/charges/inM1`), { paidAt: null, bankMovementId: deleteField(), updatedAt: now }));
	await expect('delete a charge', true, () => deleteDoc(d(`${c}/charges/new`)));

	await expect('import a movement', true, () => setDoc(d(`${c}/bankMovements/M3`), { status: 'pending', amount: 5, createdAt: now }));
	await expect('import it again over itself', false, () => setDoc(d(`${c}/bankMovements/M3`), { status: 'pending', amount: 5, createdAt: now }));
	await expect('match a pending movement', true, () => updateDoc(d(`${c}/bankMovements/M1`), { status: 'matched', match: { kind: 'charges' } }));
	await expect('match an already matched movement again', false, () => updateDoc(d(`${c}/bankMovements/M2`), { status: 'matched', match: { kind: 'other' } }));
	await expect('set aside a matched movement', false, () => updateDoc(d(`${c}/bankMovements/M2`), { status: 'ignored' }));
	await expect('unmatch a matched movement', true, () => updateDoc(d(`${c}/bankMovements/M2`), { status: 'pending', match: deleteField() }));
	await expect('delete a matched movement', false, () => deleteDoc(d(`${c}/bankMovements/M1`)));
	await expect('delete a pending movement', true, () => deleteDoc(d(`${c}/bankMovements/M3`)));

	await expect('create a remittance', true, () => setDoc(d(`${c}/remittances/Rn`), { status: 'generated', items: [], createdAt: now }));
	await expect('mark a remittance sent', true, () => updateDoc(d(`${c}/remittances/Rn`), { status: 'sent', sentAt: T }));
	await expect('delete a sent remittance', false, () => deleteDoc(d(`${c}/remittances/Rs`)));
	await expect('delete a generated remittance', true, () => deleteDoc(d(`${c}/remittances/Rg`)));
	await expect('collect a collected remittance on another day', false, () => updateDoc(d(`${c}/remittances/Rc`), { status: 'collected', collectedAt: T2 }));
	await expect('return a debit of a collected remittance (items)', true, () => updateDoc(d(`${c}/remittances/Rc`), { items: [{ returned: true }] }));
	await expect('undo collected back to sent', true, () => updateDoc(d(`${c}/remittances/Rc`), { status: 'sent', collectedAt: null }));
	await expect('delete an executed order', false, () => deleteDoc(d(`${c}/paymentOrders/Oe`)));
	await expect('execute an executed order on another day', false, () => updateDoc(d(`${c}/paymentOrders/Oe`), { status: 'executed', executedAt: T2 }));
	await expect('undo an executed order', true, () => updateDoc(d(`${c}/paymentOrders/Oe`), { status: 'generated', executedAt: null }));
	await expect('delete a generated order', true, () => deleteDoc(d(`${c}/paymentOrders/Og`)));

	await set(`${c}/paymentOrders/Og2`, { status: 'generated', createdAt: AT });
	await set(`${c}/paymentOrders/Oe2`, { status: 'executed', executedAt: AT, createdAt: AT });
	await set(`${c}/expenses/e1`, { concept: 'e', amount: 1, paidAt: null, paymentOrderId: 'Og2', createdAt: AT });
	await set(`${c}/expenses/e2`, { concept: 'e', amount: 1, paidAt: null, paymentOrderId: 'Oe2', createdAt: AT });
	await expect('put an invoice of a pending order in another', false, () => updateDoc(d(`${c}/expenses/e1`), { paymentOrderId: 'X' }));
	await expect('put a bounced invoice (executed order) in another', true, () => updateDoc(d(`${c}/expenses/e2`), { paymentOrderId: 'X' }));
	await expect('record an expense again over itself', false, () => setDoc(d(`${c}/expenses/e1`), { concept: 'e', amount: 1, paidAt: null, createdAt: now }));
	await expect('mark an expense paid', true, () => updateDoc(d(`${c}/expenses/e1`), { paidAt: T }));

	await expect('close a year', true, () => setDoc(d(`${c}/fiscalYears/2025`), { year: 2025, createdAt: now }));
	await expect('close it again over itself', false, () => setDoc(d(`${c}/fiscalYears/2025`), { year: 2025, createdAt: now }));
	await expect('reopen it', true, () => deleteDoc(d(`${c}/fiscalYears/2025`)));

	await expect('import a property again over itself', false, () => setDoc(d('properties/p1'), { communityId: 'c1', name: 'P1', ownerUid: '', createdAt: now }));
	await expect('edit a property (merge)', true, () => setDoc(d('properties/p1'), { name: 'P1b', updatedAt: now }, { merge: true }));
	await expect('create a community again over itself', false, () => setDoc(d(c), { name: 'C1', createdAt: now }));
	await expect('edit a community (merge)', true, () => setDoc(d(c), { name: 'C1b', updatedAt: now }, { merge: true }));

	await set(`${c}/charges/paid2`, { ...seedCharge, paidAt: AT });
	await set(`${c}/charges/inR2`, { ...seedCharge, remittanceId: 'R2' });
	await set(`${c}/expenses/e3`, { concept: 'e', amount: 1, paidAt: AT, paymentOrderId: 'Oe2', createdAt: AT });
	await set(`${c}/charges/ch2`, seedCharge);
	await expect('reconcile an unpaid charge', true, () => updateDoc(d(`${c}/charges/ch2`), { paidAt: T, bankMovementId: 'M7' }));
	await expect('reconcile a paid charge', false, () => updateDoc(d(`${c}/charges/paid2`), { paidAt: T, bankMovementId: 'M7' }));
	await expect('reconcile a charge in a remittance', false, () => updateDoc(d(`${c}/charges/inR2`), { paidAt: T, bankMovementId: 'M7' }));
	await expect('put a paid invoice of an executed order in another', false, () => updateDoc(d(`${c}/expenses/e3`), { paymentOrderId: 'X2' }));
	await expect('reconcile a paid invoice', false, () => updateDoc(d(`${c}/expenses/e3`), { bankMovementId: 'M7' }));

	await expect('reconcile a payment with another movement', false, () => updateDoc(d(`${c}/payments/pay1`), { bankMovementId: 'M1' }));
	await expect('unreconcile a payment', true, () => updateDoc(d(`${c}/payments/pay1`), { bankMovementId: deleteField() }));
}

// Sign-up by code: only the code's own account uses it, once, and takes only its homes and their unpaid charges
await section('Códigos de alta');
{
	await set('communities/c1', { name: 'C1' });
	await set('communities/c2', { name: 'C2' });
	for (const i of [1, 2, 3, 4]) {
		await set(`properties/p${i}`, { communityId: 'c1', name: `P${i}`, ownerUid: '', ownerName: 'Ana', coefficient: 1 });
	}
	await set('properties/q1', { communityId: 'c2', name: 'Q1', ownerUid: '', ownerName: 'Ana', coefficient: 1 });
	await set('properties/t1', { communityId: 'c1', name: 'T1', ownerUid: 'someone', ownerName: 'X', tenantName: 'Ten', coefficient: 1 });
	for (const [id, property, community] of [['ch1', 'p1', 'c1'], ['ch2', 'p2', 'c1'], ['ch3', 'q1', 'c2']]) {
		await set(`communities/${community}/charges/${id}`, { communityId: community, propertyId: property, ownerUid: '', paidAt: null, amount: 100 });
	}
	await set('communities/c1/charges/paid', { communityId: 'c1', propertyId: 'p1', ownerUid: '', paidAt: new Date(), amount: 100 });
	const codes = { home: 'ABCDEFGH23', other: 'ZXCVBNMK45', more: 'QWERTYUP67', tenant: 'TTTTTTTT89' };
	await set(`invitations/${codes.home}`, { email: codes.home, name: 'Ana', role: 'user', communityId: 'c1', byCode: true, propertyIds: ['p1', 'p2', 'p3'] });
	await set(`invitations/${codes.other}`, { email: codes.other, name: 'Ana', role: 'user', communityId: 'c2', byCode: true, propertyIds: ['q1'] });
	await set(`invitations/${codes.more}`, { email: codes.more, name: 'Ana', role: 'user', communityId: 'c1', byCode: true, propertyIds: ['p4'] });
	await set(`invitations/${codes.tenant}`, { email: codes.tenant, name: 'Ten', role: 'user', communityId: 'c1', byCode: true, tenantOf: 't1' });
	const withCode = (uid, code) => as(uid, { email: `${code.toLowerCase()}@codigo.gobernansa.dmoya.dev`, email_verified: false });

	async function redeem(db, uid, code) {
		const invitation = (await getDoc(doc(db, 'invitations', code))).data();
		const batch = writeBatch(db);
		batch.set(doc(db, 'users', uid), { email: '', name: invitation.name, role: 'user', communityId: invitation.communityId, inviteCode: code });
		for (const id of invitation.propertyIds ?? []) {
			batch.update(doc(db, 'properties', id), { ownerUid: uid, claimedWith: code });
		}
		if (invitation.tenantOf) {
			batch.update(doc(db, 'properties', invitation.tenantOf), { tenantUid: uid, claimedWith: code });
		}
		batch.delete(doc(db, 'invitations', code));
		await batch.commit();
	}
	async function join(db, uid, code, otherCommunity) {
		const invitation = (await getDoc(doc(db, 'invitations', code))).data();
		const batch = writeBatch(db);
		batch.update(doc(db, 'users', uid), { joinedWith: code, ...(otherCommunity ? { otherCommunityIds: arrayUnion(invitation.communityId) } : {}) });
		for (const id of invitation.propertyIds ?? []) {
			batch.update(doc(db, 'properties', id), { ownerUid: uid, claimedWith: code });
		}
		batch.delete(doc(db, 'invitations', code));
		await batch.commit();
	}
	const unpaid = (db, community, property) => getDocs(query(collection(db, 'communities', community, 'charges'), where('propertyId', '==', property), where('ownerUid', '==', ''), where('paidAt', '==', null)));

	const thief = as('thief', { email: 'x@codigo.gobernansa.dmoya.dev', email_verified: false });
	const ana = withCode('ana', codes.home);
	await expect('someone else redeems the code', false, () => redeem(thief, 'thief', codes.home));
	await expect('ana redeems it with three homes', true, () => redeem(ana, 'ana', codes.home));
	await expect('ana uses the code again', false, () => redeem(ana, 'ana', codes.home));
	await expect('ana reads her home', true, () => getDoc(doc(ana, 'properties', 'p1')));
	await expect('ana claims her home\'s unpaid charges', true, async () => {
		const charges = await unpaid(ana, 'c1', 'p1');
		if (charges.size !== 1) {
			throw new Error(`expected 1 charge, got ${charges.size}`);
		}
		await Promise.all(charges.docs.map(charge => updateDoc(charge.ref, { ownerUid: 'ana' })));
	});
	await expect('ana looks for the charges of a home not hers', false, () => unpaid(ana, 'c1', 'p4'));
	await expect('ana claims a paid charge', false, () => updateDoc(doc(ana, 'communities/c1/charges/paid'), { ownerUid: 'ana' }));
	await expect('ana adds a home in another community', true, () => join(ana, 'ana', codes.other, true));
	await expect('ana claims its charge', true, async () => {
		const charges = await unpaid(ana, 'c2', 'q1');
		if (charges.size !== 1) {
			throw new Error(`expected 1 charge, got ${charges.size}`);
		}
		await updateDoc(charges.docs[0].ref, { ownerUid: 'ana' });
	});
	await expect('ana adds another home in her community', true, () => join(ana, 'ana', codes.more, false));

	const tenant = withCode('tenant', codes.tenant);
	await expect('a tenant redeems their code', true, () => redeem(tenant, 'tenant', codes.tenant));
	await expect('the tenant takes the owner\'s place', false, () => updateDoc(doc(tenant, 'properties', 't1'), { ownerUid: 'tenant', claimedWith: codes.tenant }));
}

// Errors (MON-9): anyone signed in reports, only the team resolves, and only the team clears "seen since resolved"
await section('Errores');
{
	const id = 'ad690903b709a7ea';
	const AT = AdminTimestamp.now();
	await set('users/team', { role: 'superadmin', name: 'Equipo', email: 't@x.es' });
	await set('users/neighbour', { role: 'user', communityId: 'c1', name: 'Vecino', email: 'v@x.es' });
	await set(`errors/${id}`, { app: 'webapp', kind: 'js', code: 'TypeError', message: 'x', file: 'a.js', count: 1, sessions: 1, firstSeen: AT, lastSeen: AT, firstRelease: 'local', lastRelease: 'local', releases: ['local'], routes: [], status: 'resolved' });
	const neighbour = as('neighbour');
	const team = as('team');
	const seen = flag => ({ count: increment(1), lastSeen: serverTimestamp(), lastRelease: 'local', seenSinceResolved: flag });

	await expect('a report marks it seen', true, () => updateDoc(doc(neighbour, 'errors', id), seen(true)));
	await expect('a report clears seen', false, () => updateDoc(doc(neighbour, 'errors', id), seen(false)));
	await expect('a neighbour resolves it', false, () => updateDoc(doc(neighbour, 'errors', id), { status: 'resolved', seenSinceResolved: false }));
	await expect('the team resolves it and clears seen', true, () => updateDoc(doc(team, 'errors', id), { status: 'resolved', resolvedAt: serverTimestamp(), resolvedBy: 'team', seenSinceResolved: false }));
	await expect('the team sets seen to a non-boolean', false, () => updateDoc(doc(team, 'errors', id), { seenSinceResolved: 'x' }));
	await expect('a report without the flag (older client)', true, () => updateDoc(doc(neighbour, 'errors', id), { count: increment(1), lastSeen: serverTimestamp(), lastRelease: 'local' }));
	await expect('a neighbour reads the errors', false, () => getDoc(doc(neighbour, 'errors', id)));
}

// Performance (MON-6): up to three bands, one at a time, on at most three screens a write; only the team reads them
await section('Rendimiento');
{
	await set('users/team', { role: 'superadmin', name: 'Equipo', email: 't@x.es' });
	await set('users/neighbour', { role: 'user', communityId: 'c1', name: 'Vecino', email: 'v@x.es' });
	const neighbour = as('neighbour');
	const team = as('team');
	const anonymous = getFirestore(initializeApp({ projectId: PROJECT, apiKey: 'fake' }, `client${apps++}`));
	connectFirestoreEmulator(anonymous, host.split(':')[0], Number(host.split(':')[1]));
	const id = 'webapp_2026-11-04';
	const write = (db, screens, touched = Object.keys(screens), extra = {}, docId = id) => setDoc(doc(db, 'vitals', docId), { screens, touched, ...extra }, { merge: true });
	const one = increment(1);

	await expect('the first screen', true, () => write(neighbour, { Inicio: { lcp1: one, clsGood: one } }));
	await expect('a second screen', true, () => write(neighbour, { Inicio: { inpPoor: one }, Incidencias: { clsMid: one } }));
	await expect('three screens', true, () => write(neighbour, { Inicio: { lcp25: one }, A: { clsPoor: one }, B: { inpGood: one } }));
	await expect('two at a time', false, () => write(neighbour, { Inicio: { lcp1: increment(2) } }));
	await expect('four bands at once', false, () => write(neighbour, { Inicio: { lcp1: one, clsGood: one, inpGood: one, lcp4: one } }));
	await expect('a negative count', false, () => write(neighbour, { Inicio: { lcp1: increment(-1) } }));
	await expect('a screen not in touched', false, () => write(neighbour, { Inicio: { lcp1: one }, Otra: { clsGood: one } }, ['Inicio']));
	await expect('four screens', false, () => write(neighbour, { a: { lcp1: one }, b: { lcp1: one }, c: { lcp1: one }, d: { lcp1: one } }));
	await expect('an unknown band', false, () => write(neighbour, { Inicio: { foo: one } }));
	await expect('a text value', false, () => write(neighbour, { Nueva: { lcp1: 'x' } }));
	await expect('an extra field', false, () => write(neighbour, { Inicio: { lcp1: one } }, undefined, { hack: 1 }));
	await expect('a wrong id', false, () => write(neighbour, { Inicio: { lcp1: one } }, undefined, {}, 'other_2026-11-04'));
	await expect('signed out', false, () => write(anonymous, { Inicio: { lcp1: one } }));
	await expect('a neighbour reads them', false, () => getDoc(doc(neighbour, 'vitals', id)));
	await expect('the team reads them', true, () => getDoc(doc(team, 'vitals', id)));
	await expect('the team reads the last backup', true, () => getDoc(doc(team, 'ops', 'backup')));
	await expect('a neighbour reads the last backup', false, () => getDoc(doc(neighbour, 'ops', 'backup')));
	await expect('the team writes the last backup', false, () => setDoc(doc(team, 'ops', 'backup'), { documents: 1 }));
}

console.log(failures
	? styleText('red', `\n${failures} de ${checks} comprobaciones fallan: o las reglas tienen un error, o cambiaron a propósito y la comprobación se queda atrás`)
	: styleText('green', `\n✔ Las ${checks} comprobaciones de firestore.rules pasan`));
process.exit(failures ? 1 : 0);
