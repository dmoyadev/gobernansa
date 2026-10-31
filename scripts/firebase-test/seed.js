import { readFileSync } from 'node:fs';
import process from 'node:process';
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

// Also deletes subcollections (e.g. issues, comments, votes) and has no 500 documents limit
async function deleteCollection(collectionName) {
	await db.recursiveDelete(db.collection(collectionName));
}

async function resetDatabase() {
	console.log('🧹 Borrando datos...');
	if (shouldRun('issues')) {
		const communities = await db.collection('communities').listDocuments();
		await Promise.all(communities.map(async community => db.recursiveDelete(community.collection('issues'))));
	}
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

	// COMMUNITIES
	if (shouldRun('communities')) {
		const comm1 = db.collection('communities').doc('comm1');
		batch.set(comm1, {
			name: 'Residencial Los Olivos',
			address: 'Calle Falsa 123, Jaén',
			constructionYear: 1990,
			commonAreas: [
				{ id: 'portal', name: 'Portal', icon: 'lucide:door-open' },
				{ id: 'escalera', name: 'Escalera', icon: 'lucide:door-stairwell' },
				{ id: 'ascensor', name: 'Ascensor', icon: 'lucide:arrow-down-up' },
				{ id: 'garaje', name: 'Garaje', icon: 'lucide:car' },
				{ id: 'piscina', name: 'Piscina', icon: 'lucide:waves-ladder' },
				{ id: 'jardin', name: 'Jardín', icon: 'lucide:trees' },
				{ id: 'padel', name: 'Pista de pádel', icon: 'lucide:volleyball', booking: { days: [1, 2, 3, 4, 5, 6, 7], opens: '09:00', closes: '22:00', slotMinutes: 90, maxPerWeek: 3, rules: 'Máximo 4 personas.' } },
			],
			monthlyVotes: 5,
			// Made-up data: the IBAN is the usual example one
			cif: 'H23123458',
			iban: 'ES9121000418450200051332',
			bank: 'Banco Ejemplo',
			bic: 'CAIXESBBXXX',
			// SEPA creditor identifier ES10000H23123458: the CIF with this suffix
			sepaSuffix: '000',
			contacts: [
				{ type: 'admin', name: 'Fincas Olivares S.L.', phone: '953 000 101', whatsapp: '600 000 101', email: 'administracion@example.com' },
				{ type: 'president', name: 'Carmen Ruiz', whatsapp: '600 000 102' },
				{
					type: 'janitor',
					name: 'Antonio García',
					phone: '600 000 103',
					whatsapp: '600 000 103',
					// ISO weekdays (1 is Monday) and 24 hour times
					schedule: [
						{ days: [1, 2, 3, 4, 5], from: '08:00', to: '15:00' },
						{ days: [6], from: '09:00', to: '13:00' },
					],
				},
				{ type: 'insurance', name: 'Seguros La Previsora · Póliza 123456', phone: '900 000 104' },
				{ type: 'elevator', name: 'Ascensores del Sur', phone: '900 000 105' },
				{ type: 'cleaning', name: 'Limpiezas Jaén', phone: '953 000 106', email: 'limpiezas@example.com' },
			],
			documents: [
				{ type: 'statutes', title: 'Estatutos de la comunidad', url: 'https://example.com/estatutos.pdf', date: new Date(1990, 5, 1) },
				{ type: 'regulations', title: 'Normas de uso de la piscina y zonas comunes', url: 'https://example.com/normas.pdf', date: new Date(2019, 3, 10) },
				{ type: 'insurance', title: 'Póliza multirriesgo · Seguros La Previsora', url: 'https://example.com/poliza-seguro.pdf', date: new Date(2026, 0, 1) },
				{ type: 'minutes', title: 'Junta general ordinaria', url: 'https://example.com/actas/2026-03.pdf', date: new Date(2026, 2, 14) },
				{ type: 'minutes', title: 'Junta extraordinaria: cámaras de seguridad', url: 'https://example.com/actas/2025-10.pdf', date: new Date(2025, 9, 20) },
				{ type: 'minutes', title: 'Junta general ordinaria', url: 'https://example.com/actas/2025-03.pdf', date: new Date(2025, 2, 15) },
				{ type: 'minutes', title: 'Junta general ordinaria', url: 'https://example.com/actas/2024-03.pdf', date: new Date(2024, 2, 16) },
			],
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
			['prop7', 'Solar 1', 'other', 'user5'],
		];

		// Domiciliaciones SEPA with made-up accounts (valid check digits), for the remittances
		const mandates = {
			prop1: { reference: 'GOB-PROP1-20250115', debtorName: 'User1', iban: 'ES6000491500051234567892', signedAt: '2025-01-15', status: 'active' },
			prop2: { reference: 'GOB-PROP2-20250203', debtorName: 'User2', iban: 'ES6520850001110123456789', bic: 'CAZRES2ZXXX', signedAt: '2025-02-03', status: 'active' },
			prop4: { reference: 'GOB-PROP4-20240610', debtorName: 'María Núñez', iban: 'ES7921000813610123456789', signedAt: '2024-06-10', status: 'cancelled' },
		};

		properties.forEach(([id, name, type, ownerUid]) => {
			const ref = db.collection('properties').doc(id);
			batch.set(ref, {
				communityId: 'comm1',
				name,
				type,
				ownerUid,
				...(mandates[id] ? { mandate: mandates[id] } : {}),
				...getDatableProperties(),
			});
		});
	}

	// USERS
	if (shouldRun('users')) {
		// The administrator manages comm1 without living there, so they have no community of their own
		const users = [
			['HMyFJhZ3GOQoXRoS7Y8taHpyb7H2', 'lynx9011+admin@gmail.com', 'superadmin'],
			['fincas1', 'lynx9011+fincas@gmail.com', 'admin', { communityId: '', communityIds: ['comm1'] }],
			['NfQwcVkiExgW9DSp5DykCxxmNK52', 'lynx9011+user1@gmail.com', 'user'],
			['9yDJtg9E0kSDa8uVwtHvP8MSox03', 'lynx9011+user2@gmail.com', 'user'],
			['01FbbUmlfHShICI9dlVs5gsvtPl2', 'lynx9011+manager1@gmail.com', 'manager'],
			['user4', 'lynx9011+user4@gmail.com', 'user'],
		];

		// Emulator only: real Auth users already exist with these UIDs. Earlier emulator sign-ins are wiped so emails map to the seeded UIDs
		if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
			const { users: existing } = await admin.auth().listUsers();
			await admin.auth().deleteUsers(existing.map(user => user.uid));
			await Promise.all(users.map(async ([uid, email]) => admin.auth().createUser({ uid, email })));
		}

		users.forEach(([uid, email, role, extra]) => {
			const ref = db.collection('users').doc(uid);
			const userDisplayName = email.split('@')[0].substring(email.indexOf('+') + 1);
			batch.set(ref, {
				email,
				communityId: 'comm1',
				name: userDisplayName[0].toUpperCase() + userDisplayName.slice(1),
				role,
				...extra,
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

	// ISSUES + COMMENTS + VOTES
	if (shouldRun('issues')) {
		const issues = [
			[
				'issue_1',
				'Luz fundida en portal 1',
				'No funciona desde hace 2 días',
				'open',
				'maintenance',
				null,
				{ type: 'common_area', reference: 'Portal 1' },
				[
					['comment_1', 'NfQwcVkiExgW9DSp5DykCxxmNK52', 'Sigue sin arreglarse'],
					['comment_2', '9yDJtg9E0kSDa8uVwtHvP8MSox03', 'Confirmo, no hay luz'],
				],
				[
					['NfQwcVkiExgW9DSp5DykCxxmNK52', 1],
					['9yDJtg9E0kSDa8uVwtHvP8MSox03', 1],
				],
				[
					'https://res.cloudinary.com/dqd7np8vk/image/upload/v1776855624/gobernan%C3%A7a/issues/Resi_ponfe_3_-krLB-U20721300682AMB-1200x840_Leonoticias_r7nbg4.webp',
					'https://res.cloudinary.com/dqd7np8vk/image/upload/v1776855576/gobernan%C3%A7a/issues/filtraciones-agua-residencia_tmvhv0.jpg',
				],
			],
			[
				'issue_2',
				'Ruido nocturno constante',
				'Vecino en 2A hace ruido por la noche',
				'in_progress',
				'nuisance',
				'01FbbUmlfHShICI9dlVs5gsvtPl2',
				{ type: 'property', propertyId: 'prop3', reference: '2A' },
				[
					['comment_3', 'user4', 'Pasa casi todas las noches'],
					['comment_4', '01FbbUmlfHShICI9dlVs5gsvtPl2', 'in_progress', 'status'],
					['comment_5', '01FbbUmlfHShICI9dlVs5gsvtPl2', 'Hemos hablado con el vecino, os mantenemos informados'],
				],
				[
					['user4', -1],
				],
				[
					'https://res.cloudinary.com/dqd7np8vk/image/upload/v1776855576/gobernan%C3%A7a/issues/filtraciones-agua-residencia_tmvhv0.jpg',
					'https://res.cloudinary.com/dqd7np8vk/image/upload/v1776855576/gobernan%C3%A7a/issues/inside-view_ftqxjx.jpg',
				],
			],
			[
				'issue_3',
				'La del vídeo y el título súper largo que alguien ha confundido con la descripción así que se va de madre',
				'Es una prueba de incidencia que tiene un vídeo como evidencia',
				'closed',
				'landscaping',
				'01FbbUmlfHShICI9dlVs5gsvtPl2',
				{ type: 'common_area', reference: 'Segunda planta' },
				[],
				[
					['NfQwcVkiExgW9DSp5DykCxxmNK52', 1],
					['9yDJtg9E0kSDa8uVwtHvP8MSox03', 1],
					['user4', -1],
					['01FbbUmlfHShICI9dlVs5gsvtPl2', 1],
				],
				[
					'https://res.cloudinary.com/dqd7np8vk/video/upload/v1776855577/gobernan%C3%A7a/issues/bigbuck_bunny_8bit_15000kbps_1080p_60.0fps_h264_tpr6rn.mp4',
				],
			],
		];

		// Comments keep the author's name and role, as the app writes them
		const authors = {
			'NfQwcVkiExgW9DSp5DykCxxmNK52': { authorName: 'User1' },
			'9yDJtg9E0kSDa8uVwtHvP8MSox03': { authorName: 'User2' },
			'user4': { authorName: 'User4' },
			'01FbbUmlfHShICI9dlVs5gsvtPl2': { authorName: 'Manager1', authorRole: 'manager' },
		};

		for (const [id, title, description, status, category, assignedTo, location, comments, votes, assets] of issues) {
			const issueRef = db.collection('communities').doc('comm1').collection('issues').doc(id);

			batch.set(issueRef, {
				title,
				description,
				status,
				category,
				assets,
				...(assignedTo ? { assignedTo } : {}),
				votesScore: votes.reduce((a, [, s]) => a + s, 0),
				votesCount: votes.length,
				commentsCount: comments.filter(([, , , type]) => type !== 'status').length,
				...(location ? { location } : {}),
				...getDatableProperties(),
				deletedAt: null,
			});

			// comments
			// Status changes are listed as comments too, with the new status in place of the message
			for (const [commentId, authorId, message, type = 'message'] of comments) {
				const commentRef = issueRef.collection('comments').doc(commentId);
				batch.set(commentRef, {
					type,
					...(type === 'status' ? { status: message, message: '' } : { message }),
					authorId,
					...authors[authorId],
					...getDatableProperties(),
					deletedAt: null,
				});
			}

			// votes
			for (const [voterId, score] of votes) {
				const voteRef = issueRef.collection('votes').doc(`${id}_${voterId}`);
				// Cast this month, so they use some of the voters' monthly votes
				batch.set(voteRef, { voterId, score, votedAt: new Date() });
			}
		}
	}

	// PROVIDERS + BUDGET + SUPPLIER INVOICES (made-up fiscal data with valid control characters)
	if (shouldRun('invoices')) {
		const year = new Date().getFullYear();
		const providers = [
			['prov_cleaning', 'Limpiezas Jaén', 'cleaning', { cif: 'B23000003', fiscalName: 'Limpiezas Jaén S.L.', address: 'Calle Mayor 1, 23001 Jaén', iban: 'ES7921000813610123456789' }],
			['prov_lawyer', 'Laura Pérez, abogada', 'other', { cif: '12345678Z', fiscalName: 'Laura Pérez Gómez', address: 'Plaza Nueva 3, 23002 Jaén', iban: 'ES9121000418450200051332' }],
		];
		for (const [id, name, category, fiscal] of providers) {
			batch.set(db.collection('providers').doc(id), { name, category, ...fiscal, communityIds: ['comm1'], ratingSum: 0, ratingCount: 0, ...getDatableProperties() });
		}

		const comm1 = db.collection('communities').doc('comm1');
		batch.set(comm1.collection('budgets').doc(String(year)), {
			year,
			items: [{ id: 'cleaning', name: 'Limpieza', amount: 480000 }, { id: 'legal', name: 'Asesoría jurídica', amount: 120000 }],
			// Fondo de reserva: 10 % of the items, and what it had on 1 January
			reserve: 60000,
			reserveOpening: 350000,
			...getDatableProperties(),
		});

		// Base, VAT and withholding in cents; amount is base + VAT, what it costs the community
		const invoices = [
			['inv_1', 'cleaning', 'prov_cleaning', 'Limpieza septiembre', 'LJ-2026/0901', 8, 30000, 21, 0, true],
			['inv_2', 'cleaning', 'prov_cleaning', 'Limpieza octubre', 'LJ-2026/1001', 9, 30000, 21, 0, false],
			['inv_3', 'legal', 'prov_lawyer', 'Reclamación de deuda Piso 2B', '2026-017', 9, 50000, 21, 15, false],
		];
		const providerById = Object.fromEntries(providers.map(([id, name, , fiscal]) => [id, { id, name, nif: fiscal.cif }]));
		for (const [id, itemId, providerId, concept, invoiceNumber, month, base, vatRate, withholdingRate, paid] of invoices) {
			const vat = Math.round(base * vatRate / 100);
			const withholding = Math.round(base * withholdingRate / 100);
			batch.set(comm1.collection('expenses').doc(id), {
				year,
				itemId,
				concept,
				amount: base + vat,
				date: new Date(year, month - 1, 5),
				provider: providerById[providerId],
				invoiceNumber,
				base,
				vatRate,
				vat,
				withholdingRate,
				withholding,
				...(withholdingRate ? { withholdingType: 'professional' } : {}),
				dueDate: new Date(year, month, 5, 23, 59, 59),
				paidAt: paid ? new Date(year, month, 1) : null,
				paymentMethod: 'transfer',
				...getDatableProperties(),
			});
		}

		// Asiento manual: a bank fee, the rest of the books are derived from the charges and invoices
		batch.set(comm1.collection('journalEntries').doc('entry_bank_fee'), {
			year,
			date: `${year}-10-31`,
			concept: 'Comisión de mantenimiento de la cuenta',
			lines: [{ account: '6260', debit: 1500, credit: 0 }, { account: '5720', debit: 0, credit: 1500 }],
			...getDatableProperties(),
		});
	}

	await batch.commit();
	console.log('✅ Seed completado');
}

void seed();
