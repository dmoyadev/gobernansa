import { readFileSync } from 'node:fs';
import admin from 'firebase-admin';

const serviceAccount = JSON.parse(
	readFileSync('./scripts/firebase-test/serviceAccountKey.local.json', 'utf-8'),
);

admin.initializeApp({
	credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const SHOULD_RESET = process.argv.includes('--reset');

const onlyArg = process.argv.find(arg => arg.startsWith('--only='));
const ONLY = onlyArg
	? onlyArg.replace('--only=', '').split(',')
	: null;

function shouldRun(collection) {
	if (!ONLY) {
		return true;
	}
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

	if (shouldRun('communities')) {
		await deleteCollection('communities');
	}
	if (shouldRun('properties')) {
		await deleteCollection('properties');
	}
	if (shouldRun('users')) {
		await deleteCollection('users');
	}
	if (shouldRun('events')) {
		await deleteCollection('events');
	}
}

function getRandomDate() {
	const start = new Date(2020, 0, 1);
	const end = new Date();
	return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function getDatableProperties() {
	return {
		createdAt: getRandomDate(),
		updatedAt: new Date(),
		createdBy: 'admin1',
		updatedBy: 'admin1',
	};
}

async function seed() {
	if (SHOULD_RESET) {
		await resetDatabase();
	}

	const batch = db.batch();

	// COMMUNITY
	if (shouldRun('communities')) {
		const comm1 = db.collection('communities').doc('comm1');
		batch.set(comm1, {
			name: 'Residencial Los Olivos',
			address: 'Calle Falsa 123, Jaén',
			constructionYear: 1990,
			...getDatableProperties(),
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
				communityId: 'comm1',
				name,
				type,
				ownerUid,
				...getDatableProperties(),
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
				communityId: 'comm1',
				name: userDisplayName[0].toUpperCase() + userDisplayName.slice(1),
				role,
			});
		});
	}

	// EVENTS
	if (shouldRun('events')) {
		const now = new Date();
		function daysFromNow(d) {
			return new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, 10, 0);
		}

		const events = [
			['event_1', 'Junta general ordinaria', 'Revisión anual de cuentas', 'other', daysFromNow(2), 'comm1'],
			['event_2', 'Limpieza de garaje', 'Limpieza profunda mensual', 'maintenance', daysFromNow(3), 'comm1'],
			['event_3', 'Barbacoa comunitaria', 'Evento social en el jardín', 'community', daysFromNow(5), 'comm1'],
			['event_4', 'Revisión ascensor', 'Mantenimiento técnico', 'maintenance', daysFromNow(6), 'comm1'],
			['event_5', 'Instalación cámaras seguridad', undefined, 'improvements', daysFromNow(8), 'comm1'],
			['event_6', 'Reunión vecinos bloque A', undefined, 'other', daysFromNow(10), 'comm1'],
			['event_7', 'Cambio luces portal', undefined, 'maintenance', daysFromNow(12), 'comm1'],
			['event_8', 'Fiesta verano', undefined, 'community', daysFromNow(15), 'comm1'],
			['event_9', 'Pintado zonas comunes', undefined, 'improvements', daysFromNow(18), 'comm1'],
			['event_10', 'Revisión fontanería', undefined, 'maintenance', daysFromNow(20), 'comm1'],
			...Array.from({ length: 20 }).map((_, i) => {
				const index = i + 11;
				const types = ['community', 'maintenance', 'improvements', 'other'];
				const type = types[i % types.length];

				const titles = {
					community: 'Evento social vecinos',
					maintenance: 'Mantenimiento general',
					improvements: 'Mejora instalaciones',
					other: 'Aviso comunidad',
				};

				return [`event_${index}`, `${titles[type]} ${index}`, `Descripción del evento ${index}`, type, daysFromNow(index * 2), 'comm1'];
			}),
		];

		events.forEach(([id, title, description, type, date, communityId]) => {
			const ref = db.collection('events').doc(id);
			batch.set(ref, {
				title,
				...(description ? { description } : {}),
				type,
				date,
				communityId,
				...getDatableProperties(),
			});
		});
	}

	await batch.commit();
	console.log('✅ Seed completado');
}

seed();
