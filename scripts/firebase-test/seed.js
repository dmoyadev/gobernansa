import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const serviceAccount = JSON.parse(
	readFileSync('./scripts/firebase-test/serviceAccountKey.local.json', 'utf-8')
);

admin.initializeApp({
	credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const SHOULD_RESET = process.argv.includes('--reset');

const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
const ONLY = onlyArg
	? onlyArg.replace('--only=', '').split(',')
	: null;

function shouldRun(collection) {
	if (!ONLY) return true;
	return ONLY.includes(collection);
}

async function deleteCollection(collectionName) {
	const snapshot = await db.collection(collectionName).get();
	const batch = db.batch();

	snapshot.docs.forEach((doc) => {
		batch.delete(doc.ref);
	});

	await batch.commit();
}

async function resetDatabase() {
	console.log('🧹 Borrando datos...');

	if (shouldRun('communities')) await deleteCollection('communities');
	if (shouldRun('properties')) await deleteCollection('properties');
	if (shouldRun('users')) await deleteCollection('users');
}

async function seed() {
	if (SHOULD_RESET) {
		await resetDatabase();
	}

	const batch = db.batch();

	// COMMUNITY
	if (shouldRun('communities')) {
		const res1 = db.collection('communities').doc('res1');
		batch.set(res1, {
			name: 'Residencial Los Olivos',
			address: 'Calle Falsa 123, Jaén',
			createdAt: new Date(),
			createdBy: 'admin1',
		});
	}

	// PROPERTIES
	if (shouldRun('properties')) {
		const properties = [
			['prop1', 'Piso 1A', 'home', 'NfQwcVkiExgW9DSp5DykCxxmNK52'],
			['prop2', 'Piso 1B', 'home', '9yDJtg9E0kSDa8uVwtHvP8MSox03'],
			['prop3', 'Piso 2A', 'home', 'user3'],
			['prop4', 'Piso 2B', 'home', 'user4'],
			['prop5', 'Garaje 12', 'parking', 'NfQwcVkiExgW9DSp5DykCxxmNK52'],
			['prop6', 'Trastero 3', 'storage', '9yDJtg9E0kSDa8uVwtHvP8MSox03'],
			['prop7', 'Solar 1', 'other', 'user 5'],
		];

		properties.forEach(([id, name, type, ownerUid]) => {
			const ref = db.collection('properties').doc(id);
			batch.set(ref, {
				communityId: 'res1',
				name,
				type,
				ownerUid,
			});
		});
	}

	// USERS
	if (shouldRun('users')) {
		const users = [
			['HMyFJhZ3GOQoXRoS7Y8taHpyb7H2', 'lynx9011+admin@gmail.com', 'admin'],
			['NfQwcVkiExgW9DSp5DykCxxmNK52', 'lynx9011+user1@gmail.com', 'user'],
			['9yDJtg9E0kSDa8uVwtHvP8MSox03', 'lynx9011+user2@gmail.com', 'user'],
			['01FbbUmlfHShICI9dlVs5gsvtPl2', 'lynx9011+manager1@gmail.com', 'manager'],
			['user4', 'lynx9011+user4@gmail.com', 'user'],
		];

		users.forEach(([uid, email, role]) => {
			const ref = db.collection('users').doc(uid);
			const userDisplayName = email.split('@')[0].substring(email.indexOf('+') + 1);
			batch.set(ref, {
				email,
				communityId: 'res1',
				name: userDisplayName[0].toUpperCase() + userDisplayName.slice(1),
				role,
			});
		});
	}

	await batch.commit();
	console.log('✅ Seed completado');
}

seed();