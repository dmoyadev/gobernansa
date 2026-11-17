// With --volume, Fincas Jaén also runs 38 generated communities in Jaén with about 2.000 homes, so the portfolio, the search and
// the finances can be tried at the size of a real office. Only what the portfolio shows: the census, a third of the owners
// signed up, a few overdue fees and some issues. Same output on every run, so a reset overwrites the same documents
import process from 'node:process';
import { days, office, uids } from './cast.js';

export const VOLUME = process.argv.includes('--volume');

const STREETS = [
	['Avenida de Madrid', '23009'],
	['Avenida de Andalucía', '23006'],
	['Avenida de Granada', '23003'],
	['Avenida de Barcelona', '23006'],
	['Avenida de Muñoz Grandes', '23007'],
	['Avenida de Ruiz Jiménez', '23008'],
	['Avenida del Ejército Español', '23007'],
	['Avenida de Eduardo García Maroto', '23007'],
	['Calle Virgen de la Cabeza', '23008'],
	['Calle Millán de Priego', '23004'],
	['Calle Arquitecto Berges', '23007'],
	['Calle Bernabé Soriano', '23001'],
	['Calle Navas de Tolosa', '23003'],
	['Calle Roldán y Marín', '23001'],
	['Calle Hurtado', '23001'],
	['Calle Cerón', '23004'],
	['Calle Martínez Molina', '23004'],
	['Calle Maestra', '23002'],
	['Calle San Clemente', '23004'],
	['Calle Úbeda', '23003'],
	['Calle Federico de Mendizábal', '23003'],
	['Calle Doctor Eduardo Arroyo', '23004'],
];
const FIRST = ['Antonio', 'Manuel', 'José', 'Francisco', 'Juan', 'Rafael', 'Miguel', 'Pedro', 'Alfonso', 'Ana', 'María', 'Carmen', 'Isabel', 'Dolores', 'Pilar', 'Josefa', 'Rosario', 'Inmaculada', 'Lucía', 'Marta'];
const LAST = ['García', 'Martínez', 'López', 'Sánchez', 'Pérez', 'Moreno', 'Jiménez', 'Ruiz', 'Hernández', 'Díaz', 'Cobo', 'Expósito', 'Medina', 'Castillo', 'Ortega', 'Garrido', 'Cano', 'Torres', 'Navarro', 'Ramos'];
const ISSUES = [
	['La luz de la escalera no se apaga', 'El temporizador de la luz de la escalera se ha quedado encendido día y noche.', 'maintenance', 'Escalera'],
	['Gotera en el techo del garaje', 'Cuando llueve cae agua junto a las plazas del fondo.', 'maintenance', 'Garaje'],
	['El portero automático no abre', 'Desde ayer no abre la puerta del portal desde los pisos.', 'maintenance', 'Portal'],
	['El ascensor hace un ruido fuerte al frenar', 'Al llegar a cada planta da un golpe seco.', 'maintenance', 'Ascensor'],
	['Bolsas de basura en el portal', 'Algún vecino deja las bolsas en el portal por la noche.', 'cleaning', 'Portal'],
	['Música alta los fines de semana', 'Hasta las tres de la mañana los viernes y los sábados.', 'nuisance', 'Escalera'],
];
const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
const LETTERS = 'ABCD';
const STREET_KIND_REGEX = /^(?:Calle|Avenida) (?:del? )?/;
const DIACRITICS_REGEX = /\p{Diacritic}/gu;
const PHONE_GROUPS_REGEX = /(\d{2})(\d{3})(\d{3})/;

// ISO 13616 check digits of a Spanish account
function iban(account) {
	const check = 98n - BigInt(`${account}142800`) % 97n;
	return `ES${String(check).padStart(2, '0')}${account}`;
}

// A community's CIF (H, digit control) from 7 digits
function cif(digits) {
	const sum = [...digits].reduce((total, char, index) => total + (index % 2 ? Number(char) : Math.floor(char * 2 / 10) + (char * 2) % 10), 0);
	return `H${digits}${(10 - sum % 10) % 10}`;
}

export const communities = [];
export const properties = [];
export const users = [];
export const issues = [];
export const charges = [];

// ponytail: plain modular arithmetic instead of a seeded random, enough for names and sizes to look varied
for (let index = 0; index < 38; index++) {
	const [street, zip] = STREETS[index % STREETS.length];
	const number = 3 + (index * 7) % 40;
	const id = `vol${String(index + 1).padStart(2, '0')}`;
	const homes = 20 + (index * 37) % 70;
	const quarterly = 9000 + (index * 1300) % 9000;
	const since = -900 + index * 20;
	communities.push({
		id,
		name: `Comunidad ${street.replace(STREET_KIND_REGEX, '')} ${number}`,
		address: `${street} ${number}, ${zip} Jaén`,
		constructionYear: 1965 + (index * 3) % 55,
		cif: cif(`23${String(10000 + index * 211).padStart(5, '0')}`),
		iban: iban(`2100${String(4000 + index).padStart(4, '0')}50${String(200000000 + index * 7919).padStart(10, '0')}`),
		bank: 'CaixaBank',
		bic: 'CAIXESBBXXX',
		sepaSuffix: '000',
		commonAreas: [],
		bookingFees: {},
		contacts: [{ type: 'admin', name: office.name, phone: office.phone, email: office.email }],
		createdAt: days(since, '09:00'),
		createdBy: uids.office,
		updatedAt: days(since, '09:00'),
		updatedBy: uids.office,
	});

	// Coefficients in hundredths add up to 100,00: the first homes take what the division leaves
	const share = Math.floor(10000 / homes);
	for (let n = 0; n < homes; n++) {
		const seq = index * 100 + n;
		const name = `${FIRST[seq % FIRST.length]} ${LAST[(seq * 7) % LAST.length]} ${LAST[(seq * 3 + 5) % LAST.length]}`;
		const dni = String(30000000 + seq * 1237).padStart(8, '0');
		const email = `${name.normalize('NFD').replace(DIACRITICS_REGEX, '').toLowerCase().replaceAll(' ', '.')}.${seq}@example.com`;
		const signedUp = (seq * 11) % 100 < 20 + index % 30;
		const uid = signedUp ? `${id}_u${n}` : '';
		const property = {
			id: `${id}_p${n}`,
			communityId: id,
			// Portals of up to 8 floors of 4 flats, as the big blocks have them
			name: `${homes > 32 ? `Portal ${Math.floor(n / 32) + 1} · ` : ''}${Math.floor(n % 32 / 4) + 1}º ${LETTERS[n % 4]}`,
			type: 'home',
			coefficient: (share + (n < 10000 - share * homes ? 1 : 0)) / 100,
			ownerUid: uid,
			ownerName: name,
			ownerEmail: email,
			ownerNif: `${dni}${DNI_LETTERS[Number(dni) % 23]}`,
			ownerPhone: `6${String(seq).padStart(8, '0').replace(PHONE_GROUPS_REGEX, '$1 $2 $3')}`,
			...((seq % 10) < 7 && { mandate: { reference: `GOB-${id}-${n}`.toUpperCase(), debtorName: name, iban: iban(`0049${String(1500 + index).padStart(4, '0')}10${String(300000000 + seq * 104729).padStart(10, '0').slice(-10)}`), signedAt: days(since, '00:00').toISOString().slice(0, 10), status: 'active' } }),
			createdAt: days(since, '11:30'),
			createdBy: uids.office,
			updatedAt: days(since, '11:30'),
			updatedBy: uids.office,
		};
		properties.push(property);
		if (uid) {
			users.push({ uid, email, name, role: 'user', communityId: id });
		}

		// About 3 % owe from one to four quarters
		const owed = (seq * 13) % 100 < 3 ? 1 + seq % 4 : 0;
		for (let q = 0; q < owed; q++) {
			const due = days(-10 - q * 91, '23:59');
			charges.push({
				communityId: id,
				id: `${id}_fee${q}_p${n}`,
				propertyId: property.id,
				propertyName: property.name,
				ownerUid: uid,
				ownerName: name,
				type: 'fee',
				concept: `Cuota ${due.toLocaleDateString('es', { month: 'long', year: 'numeric' })}`,
				amount: Math.round(quarterly * property.coefficient * homes / 100),
				dueDate: due,
				paidAt: null,
				collected: 0,
				createdAt: days(-40 - q * 91, '09:00'),
				createdBy: uids.office,
				updatedAt: days(-40 - q * 91, '09:00'),
				updatedBy: uids.office,
			});
		}
	}

	// Up to three open ones, and one solved this month in every other community
	for (let n = 0; n < (index % 4); n++) {
		const [title, description, category, reference] = ISSUES[(index + n) % ISSUES.length];
		const at = days(-1 - (index + n * 5) % 20, '10:00');
		issues.push({ communityId: id, id: `${id}_issue${n}`, title, description, category, status: n ? 'in_progress' : 'open', location: { type: 'common_area', reference }, createdAt: at, updatedAt: at });
	}
	if (index % 2) {
		const [title, description, category, reference] = ISSUES[(index + 3) % ISSUES.length];
		const resolvedAt = days(-2 - index % 6, '13:00');
		issues.push({ communityId: id, id: `${id}_solved`, title, description, category, status: 'resolved', location: { type: 'common_area', reference }, createdAt: days(-4 - index % 6 - index % 11, '09:00'), updatedAt: resolvedAt, resolvedAt });
	}
}

export function seedVolume(set) {
	for (const { id, ...community } of communities) {
		set(`communities/${id}`, community);
	}
	for (const { id, ...property } of properties) {
		set(`properties/${id}`, property);
	}
	for (const { uid, ...user } of users) {
		set(`users/${uid}`, user);
	}
	for (const { communityId, id, ...charge } of charges) {
		set(`communities/${communityId}/charges/${id}`, { communityId, ...charge });
	}
	// Called in by phone, so the office opened them
	for (const { communityId, id, ...issue } of issues) {
		const path = `communities/${communityId}/issues/${id}`;
		set(path, { ...issue, communityId, votesScore: 0, votesCount: 0, commentsCount: 0, updatedBy: uids.office, deletedAt: null });
		set(`${path}/private/author`, { uid: uids.office });
	}
}
