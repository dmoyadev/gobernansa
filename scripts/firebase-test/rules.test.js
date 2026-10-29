// What each role can do under firestore.rules, against the local emulator: npm run test:rules
import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import admin from 'firebase-admin';
import { deleteApp, initializeApp } from 'firebase/app';
import {
	collection,
	connectFirestoreEmulator,
	deleteDoc,
	doc,
	getDoc,
	getDocs,
	getFirestore,
	query,
	serverTimestamp,
	setDoc,
	setLogLevel,
	updateDoc,
	where,
	writeBatch,
} from 'firebase/firestore';

const projectId = 'demo-gobernansa';
admin.initializeApp({ projectId });
const seeded = admin.firestore();
setLogLevel('silent');

const users = {
	super: { role: 'superadmin', communityId: '' },
	fincas: { role: 'admin', communityId: '', communityIds: ['c1'] },
	manager1: { role: 'manager', communityId: 'c1' },
	vecino1: { role: 'user', communityId: 'c1' },
	vecino2: { role: 'user', communityId: 'c2' },
};

const apps = [];

// The database as seen by someone signed in with that uid and email
function as(uid, email = `${uid}@example.com`, emailVerified = true) {
	const app = initializeApp({ projectId, apiKey: 'fake' }, `${uid}-${apps.length}`);
	apps.push(app);
	const db = getFirestore(app);
	connectFirestoreEmulator(db, '127.0.0.1', 8080, { mockUserToken: { sub: uid, email, email_verified: emailVerified } });
	return db;
}

function denied(promise) {
	return assert.rejects(promise, { code: 'permission-denied' });
}

before(async () => {
	await seeded.recursiveDelete(seeded.collection('users'));
	await seeded.recursiveDelete(seeded.collection('communities'));
	await seeded.recursiveDelete(seeded.collection('invitations'));
	await seeded.recursiveDelete(seeded.collection('events'));
	const batch = seeded.batch();
	for (const [uid, user] of Object.entries(users)) {
		batch.set(seeded.doc(`users/${uid}`), { email: `${uid}@example.com`, name: uid, ...user });
	}
	batch.set(seeded.doc('communities/c1'), { name: 'Uno' });
	batch.set(seeded.doc('communities/c2'), { name: 'Dos' });
	batch.set(seeded.doc('communities/c1/issues/i1'), { communityId: 'c1', status: 'open' });
	batch.set(seeded.doc('events/e2'), { communityId: 'c2', title: 'De la otra comunidad' });
	batch.set(seeded.doc('invitations/nuevo@example.com'), { email: 'nuevo@example.com', name: 'Nuevo', role: 'user', communityId: 'c1' });
	await batch.commit();
});

// Open connections would keep the test process from exiting
after(async () => Promise.all([...apps.map(deleteApp), admin.app().delete()]));

it('administrators only reach the communities assigned to them, and only the superadmin lists or creates them', async () => {
	const fincas = as('fincas');
	await getDoc(doc(fincas, 'communities/c1'));
	await denied(getDoc(doc(fincas, 'communities/c2')));
	await denied(getDocs(collection(fincas, 'communities')));
	await denied(setDoc(doc(fincas, 'communities/c3'), { name: 'Tres' }));

	const superadmin = as('super');
	await getDocs(collection(superadmin, 'communities'));
	await setDoc(doc(superadmin, 'communities/c3'), { name: 'Tres' });
});

it('managers edit their own community only', async () => {
	const manager = as('manager1');
	await updateDoc(doc(manager, 'communities/c1'), { name: 'Uno bis' });
	await denied(updateDoc(doc(manager, 'communities/c2'), { name: 'Dos bis' }));
});

it('a community\'s accounts are listed by whoever manages it', async () => {
	const byCommunity = (db, id) => getDocs(query(collection(db, 'users'), where('communityId', '==', id)));
	await byCommunity(as('fincas'), 'c1');
	await byCommunity(as('manager1'), 'c1');
	await denied(byCommunity(as('fincas'), 'c2'));
	await denied(byCommunity(as('vecino1'), 'c1'));
	await getDocs(query(collection(as('super'), 'users'), where('role', 'in', ['admin', 'superadmin'])));
});

it('administrators give manager and neighbour roles in theirs, managers none, and nobody changes their own', async () => {
	const fincas = as('fincas');
	await updateDoc(doc(fincas, 'users/vecino1'), { role: 'manager' });
	await updateDoc(doc(fincas, 'users/vecino1'), { role: 'user' });
	await denied(updateDoc(doc(fincas, 'users/vecino2'), { role: 'manager' }));
	await denied(updateDoc(doc(fincas, 'users/vecino1'), { communityId: 'c2' }));
	await denied(updateDoc(doc(fincas, 'users/manager1'), { role: 'admin' }));
	await denied(updateDoc(doc(fincas, 'users/manager1'), { communityIds: ['c2'] }));
	await denied(updateDoc(doc(fincas, 'users/fincas'), { communityIds: ['c1', 'c2'] }));

	await denied(updateDoc(doc(as('manager1'), 'users/vecino1'), { role: 'manager' }));
	await denied(updateDoc(doc(as('manager1'), 'users/manager1'), { role: 'user' }));
	await denied(updateDoc(doc(as('vecino1'), 'users/vecino1'), { role: 'manager' }));

	await updateDoc(doc(as('super'), 'users/fincas'), { communityIds: ['c1', 'c2'] });
	await updateDoc(doc(as('super'), 'users/fincas'), { communityIds: ['c1'] });
});

it('invitations are sent for the roles one can give, once per email', async () => {
	const invite = (uid, email, data) => setDoc(doc(as(uid), 'invitations', email), { email, name: 'Alguien', invitedBy: uid, invitedAt: serverTimestamp(), ...data });
	await invite('manager1', 'a@example.com', { role: 'user', communityId: 'c1' });
	await denied(invite('manager1', 'b@example.com', { role: 'manager', communityId: 'c1' }));
	await denied(invite('manager1', 'b@example.com', { role: 'user', communityId: 'c2' }));

	await invite('fincas', 'c@example.com', { role: 'manager', communityId: 'c1' });
	await denied(invite('fincas', 'c@example.com', { role: 'user', communityId: 'c1' }));
	await denied(invite('fincas', 'd@example.com', { role: 'admin', communityId: '' }));
	await denied(invite('fincas', 'd@example.com', { role: 'manager', communityId: 'c1', communityIds: ['c2'] }));
	await invite('super', 'd@example.com', { role: 'admin', communityId: '', communityIds: ['c2'] });

	const fincas = as('fincas');
	await getDocs(query(collection(fincas, 'invitations'), where('communityId', '==', 'c1')));
	await denied(getDocs(query(collection(fincas, 'invitations'), where('communityId', '==', ''))));
});

it('an invitation becomes the profile of whoever it\'s for, with a verified email and exactly as it was sent', async () => {
	const accept = (db, uid, data) => {
		const batch = writeBatch(db);
		batch.set(doc(db, 'users', uid), { email: 'nuevo@example.com', name: 'Nuevo', role: 'user', communityId: 'c1', ...data });
		batch.delete(doc(db, 'invitations/nuevo@example.com'));
		return batch.commit();
	};
	await denied(getDoc(doc(as('otro'), 'invitations/nuevo@example.com')));
	await denied(accept(as('nuevo', 'nuevo@example.com', false), 'nuevo'));
	await denied(accept(as('nuevo', 'nuevo@example.com'), 'nuevo', { role: 'manager' }));
	await denied(accept(as('otro'), 'otro'));

	const invitee = as('nuevo', 'nuevo@example.com');
	await getDoc(doc(invitee, 'invitations/nuevo@example.com'));
	await accept(invitee, 'nuevo');
	assert.equal((await getDoc(doc(invitee, 'users/nuevo'))).data().role, 'user');
});

it('managers remove neighbours of theirs, not administrators', async () => {
	await denied(deleteDoc(doc(as('manager1'), 'users/fincas')));
	await deleteDoc(doc(as('manager1'), 'users/nuevo'));
});

it('the status of an issue is changed by who manages the community, and events stay in theirs', async () => {
	await denied(updateDoc(doc(as('vecino1'), 'communities/c1/issues/i1'), { status: 'resolved', updatedAt: serverTimestamp(), updatedBy: 'vecino1' }));
	await updateDoc(doc(as('manager1'), 'communities/c1/issues/i1'), { status: 'resolved', updatedAt: serverTimestamp(), updatedBy: 'manager1' });

	const manager = as('manager1');
	await setDoc(doc(manager, 'events/e1'), { communityId: 'c1', title: 'Junta' });
	await updateDoc(doc(manager, 'events/e1'), { title: 'Junta ordinaria' });
	await denied(updateDoc(doc(manager, 'events/e1'), { communityId: 'c2' }));
	await denied(setDoc(doc(manager, 'events/e2'), { communityId: 'c1', title: 'Ahora en la mía' }));
});
