// The demo's people, communities, census and providers, shared by every group so their ids line up.
// Made-up fiscal data with valid control characters, and accounts that only exist here

export const now = new Date();
export const year = now.getFullYear();

// n days from today (before it when negative), at the given local time
export function days(n, time = '10:00') {
	const [hours, minutes] = time.split(':').map(Number);
	return new Date(now.getFullYear(), now.getMonth(), now.getDate() + n, hours, minutes);
}

// 'YYYY-MM-DD' of n days from today, as the domain keeps plain dates
export function isoDate(n) {
	const date = days(n);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// The ones with a real sign-in account in the live project keep their uids
export const uids = {
	team: 'HMyFJhZ3GOQoXRoS7Y8taHpyb7H2',
	office: 'fincas1',
	carmen: '01FbbUmlfHShICI9dlVs5gsvtPl2',
	lucia: 'NfQwcVkiExgW9DSp5DykCxxmNK52',
	javier: '9yDJtg9E0kSDa8uVwtHvP8MSox03',
	maria: 'user4',
	andres: 'user5',
	rosa: 'user6',
	tomas: 'manager2',
	elena: 'user7',
	pablo: 'user8',
};

// Created n days ago (or on a Date) and last touched then, by the office unless someone else is given
export function audit(n = -30, by = uids.office) {
	const at = n instanceof Date ? n : days(n);
	return { createdAt: at, updatedAt: at, createdBy: by, updatedBy: by };
}

// comm1 is the full demo, comm2 a smaller one of the same office, comm3 just created by the team, with no office nor census yet
export const communities = [
	{ id: 'comm1', name: 'Residencial Los Olivos', address: 'Calle de los Olivos 12, 23009 Jaén', constructionYear: 1990, cif: 'H23123458', iban: 'ES9121000418450200051332', bank: 'Banco Ejemplo', bic: 'CAIXESBBXXX', sepaSuffix: '000' },
	{ id: 'comm2', name: 'Edificio Mirador del Castillo', address: 'Calle Santa María del Valle 8, 23005 Jaén', constructionYear: 2006, cif: 'H23987654', iban: 'ES7000491500010512345678', bank: 'Banco Santander', bic: 'BSCHESMMXXX', sepaSuffix: '000' },
	{ id: 'comm3', name: 'Comunidad Plaza de Andalucía', address: 'Plaza de Andalucía 3, 23400 Úbeda', constructionYear: 1978, cif: 'H23456783', iban: 'ES9520859310610330012345', bank: 'Ibercaja', bic: 'CAZRES2ZXXX', sepaSuffix: '000' },
];

// Offered as places in issues, and booked when they have booking (ISO weekdays, prices and fianzas in cents)
export const commonAreas = {
	comm1: [
		{ id: 'portal', name: 'Portal', icon: 'lucide:door-open' },
		{ id: 'escalera', name: 'Escalera', icon: 'lucide:door-stairwell' },
		{ id: 'ascensor', name: 'Ascensor', icon: 'lucide:arrow-down-up' },
		{ id: 'garaje', name: 'Garaje', icon: 'lucide:car' },
		{ id: 'piscina', name: 'Piscina', icon: 'lucide:waves-ladder' },
		{ id: 'jardin', name: 'Jardín', icon: 'lucide:trees' },
		{ id: 'padel', name: 'Pista de pádel', icon: 'lucide:volleyball', booking: { days: [1, 2, 3, 4, 5, 6, 7], opens: '09:00', closes: '22:00', slotMinutes: 90, maxPerWeek: 3, advanceDays: 14, rules: 'Máximo 4 personas.' } },
		// Paid: 15 € per slot and a 50 € fianza, given back after
		{ id: 'sala', name: 'Sala común', icon: 'lucide:sofa', booking: { days: [5, 6, 7], opens: '10:00', closes: '22:00', slotMinutes: 240, maxPerWeek: 1, advanceDays: 30, price: 1500, deposit: 5000, rules: 'Recoger y limpiar la sala al terminar.' } },
		// Only a fianza
		{ id: 'barbacoa', name: 'Barbacoa', icon: 'lucide:flame', booking: { days: [6, 7], opens: '12:00', closes: '22:00', slotMinutes: 300, maxPerWeek: 1, advanceDays: 30, deposit: 2000, rules: 'Apagar las brasas con agua y dejar la parrilla limpia.' } },
	],
	comm2: [
		{ id: 'portal', name: 'Portal', icon: 'lucide:door-open' },
		{ id: 'ascensor', name: 'Ascensor', icon: 'lucide:arrow-down-up' },
		{ id: 'garaje', name: 'Garaje', icon: 'lucide:car' },
		{ id: 'azotea', name: 'Azotea', icon: 'lucide:sun' },
		{ id: 'sala', name: 'Sala de reuniones', icon: 'lucide:sofa', booking: { days: [1, 2, 3, 4, 5, 6, 7], opens: '09:00', closes: '21:00', slotMinutes: 60, maxPerWeek: 2, advanceDays: 14 } },
	],
	comm3: [],
};

// Everyone with a profile. Emails are the same inbox with a +alias, so every magic link reaches it
export const users = [
	{ uid: uids.team, email: 'lynx9011+admin@gmail.com', name: 'Equipo gobernança', role: 'superadmin', communityId: 'comm1' },
	{ uid: uids.office, email: 'lynx9011+fincas@gmail.com', name: 'Fincas Jaén', role: 'admin', communityId: '', communityIds: ['comm1', 'comm2'] },
	{ uid: uids.carmen, email: 'lynx9011+manager1@gmail.com', name: 'Carmen Ruiz', role: 'manager', communityId: 'comm1' },
	{ uid: uids.lucia, email: 'lynx9011+user1@gmail.com', name: 'Lucía Martín', role: 'user', communityId: 'comm1' },
	{ uid: uids.javier, email: 'lynx9011+user2@gmail.com', name: 'Javier Ortega', role: 'user', communityId: 'comm1' },
	{ uid: uids.maria, email: 'lynx9011+user4@gmail.com', name: 'María Núñez', role: 'user', communityId: 'comm1' },
	// Blocked for insulting neighbours in the comments: reads everything, can't write
	{ uid: uids.andres, email: 'lynx9011+user5@gmail.com', name: 'Andrés Molina', role: 'user', communityId: 'comm1', blocked: true },
	{ uid: uids.rosa, email: 'lynx9011+user6@gmail.com', name: 'Rosa Delgado', role: 'user', communityId: 'comm1' },
	{ uid: uids.tomas, email: 'lynx9011+manager2@gmail.com', name: 'Tomás Vidal', role: 'manager', communityId: 'comm2' },
	{ uid: uids.elena, email: 'lynx9011+user7@gmail.com', name: 'Elena Castro', role: 'user', communityId: 'comm2' },
	{ uid: uids.pablo, email: 'lynx9011+user8@gmail.com', name: 'Pablo Gil', role: 'user', communityId: 'comm2' },
];

export function userById(uid) {
	return users.find(user => user.uid === uid);
}

// The administrator's office, who invoices its fees to comm1 and comm2
export const office = {
	uid: uids.office,
	nif: 'B12345674',
	name: 'Fincas Jaén S.L.',
	address: 'Paseo de la Estación 10, 23008 Jaén',
	email: 'lynx9011+fincas@gmail.com',
	phone: '953 000 101',
	iban: 'ES6021000813606101234567',
};

// The census. Coefficients add up to 100 in each community. ownerUid '' is an owner without an account yet
export const properties = [
	{ id: 'prop1', communityId: 'comm1', name: 'Piso 1A', type: 'home', coefficient: 11.5, ownerUid: uids.lucia, ownerName: 'Lucía Martín', ownerEmail: 'lynx9011+user1@gmail.com', ownerNif: '12345678Z', ownerPhone: '600 100 001', mandate: { reference: 'GOB-PROP1-20250115', debtorName: 'Lucía Martín', iban: 'ES5101822370404201234567', signedAt: '2025-01-15', status: 'active' } },
	{ id: 'prop2', communityId: 'comm1', name: 'Piso 1B', type: 'home', coefficient: 11.5, ownerUid: uids.javier, ownerName: 'Javier Ortega', ownerEmail: 'lynx9011+user2@gmail.com', ownerNif: '87654321X', ownerPhone: '600 100 002', tenantName: 'Irene Campos', tenantEmail: 'irene.campos@example.com', mandate: { reference: 'GOB-PROP2-20250203', debtorName: 'Javier Ortega', iban: 'ES0800810216767300012345', bic: 'BSABESBBXXX', signedAt: '2025-02-03', status: 'active' } },
	{ id: 'prop3', communityId: 'comm1', name: 'Piso 2A', type: 'home', coefficient: 11.5, ownerUid: uids.carmen, ownerName: 'Carmen Ruiz', ownerEmail: 'lynx9011+manager1@gmail.com', ownerNif: '22222222J', ownerPhone: '600 000 102', mandate: { reference: 'GOB-PROP3-20240920', debtorName: 'Carmen Ruiz', iban: 'ES5921030700461234567890', signedAt: '2024-09-20', status: 'active' } },
	// The debtor: cancelled her domiciliación and owes three quarters
	{ id: 'prop4', communityId: 'comm1', name: 'Piso 2B', type: 'home', coefficient: 11.5, ownerUid: uids.maria, ownerName: 'María Núñez', ownerEmail: 'lynx9011+user4@gmail.com', ownerNif: '11111111H', ownerPhone: '600 100 004', mandate: { reference: 'GOB-PROP4-20240610', debtorName: 'María Núñez', iban: 'ES1430580990262712345678', signedAt: '2024-06-10', status: 'cancelled' } },
	{ id: 'prop5', communityId: 'comm1', name: 'Garaje 12', type: 'parking', coefficient: 2.5, ownerUid: uids.lucia, ownerName: 'Lucía Martín', ownerEmail: 'lynx9011+user1@gmail.com', ownerNif: '12345678Z', ownerPhone: '600 100 001', mandate: { reference: 'GOB-PROP5-20250115', debtorName: 'Lucía Martín', iban: 'ES5101822370404201234567', signedAt: '2025-01-15', status: 'active' } },
	{ id: 'prop6', communityId: 'comm1', name: 'Trastero 3', type: 'storage', coefficient: 1.5, ownerUid: uids.javier, ownerName: 'Javier Ortega', ownerEmail: 'lynx9011+user2@gmail.com', ownerNif: '87654321X', ownerPhone: '600 100 002' },
	// A company's shop, rented to a café. No account: the office sends it everything by post
	{ id: 'prop7', communityId: 'comm1', name: 'Local comercial', type: 'other', coefficient: 11.5, ownerUid: '', ownerName: 'Inversiones Jaén S.L.', ownerEmail: 'contabilidad@inversionesjaen.example.com', ownerNif: 'B23456783', ownerPhone: '953 222 333', tenantName: 'Cafetería La Plaza', tenantEmail: 'cafeterialaplaza@example.com', mandate: { reference: 'GOB-PROP7-20230301', debtorName: 'Inversiones Jaén S.L.', iban: 'ES7501280050871200123456', signedAt: '2023-03-01', status: 'active' } },
	{ id: 'prop8', communityId: 'comm1', name: 'Piso 3A', type: 'home', coefficient: 11.5, ownerUid: uids.andres, ownerName: 'Andrés Molina', ownerEmail: 'lynx9011+user5@gmail.com', ownerNif: '33333333P', ownerPhone: '600 100 008' },
	{ id: 'prop9', communityId: 'comm1', name: 'Piso 3B', type: 'home', coefficient: 11.5, ownerUid: uids.rosa, ownerName: 'Rosa Delgado', ownerEmail: 'lynx9011+user6@gmail.com', ownerNif: '44444444A', ownerPhone: '600 100 009', mandate: { reference: 'GOB-PROP9-20250410', debtorName: 'Rosa Delgado', iban: 'ES7721001234555612345678', signedAt: '2025-04-10', status: 'active' } },
	// Invited, hasn't signed in yet
	{ id: 'prop10', communityId: 'comm1', name: 'Piso 4A', type: 'home', coefficient: 11.5, ownerUid: '', ownerName: 'Francisco López', ownerEmail: 'lynx9011+user9@gmail.com', ownerNif: '55555555K', ownerPhone: '600 100 010' },
	{ id: 'prop11', communityId: 'comm1', name: 'Garaje 13', type: 'parking', coefficient: 2.5, ownerUid: uids.maria, ownerName: 'María Núñez', ownerEmail: 'lynx9011+user4@gmail.com', ownerNif: '11111111H', ownerPhone: '600 100 004' },
	{ id: 'prop12', communityId: 'comm1', name: 'Trastero 4', type: 'storage', coefficient: 1.5, ownerUid: uids.carmen, ownerName: 'Carmen Ruiz', ownerEmail: 'lynx9011+manager1@gmail.com', ownerNif: '22222222J', ownerPhone: '600 000 102' },

	{ id: 'c2prop1', communityId: 'comm2', name: 'Bajo A', type: 'home', coefficient: 16, ownerUid: '', ownerName: 'Antonia Herrera', ownerEmail: 'antonia.herrera@example.com', ownerNif: '66666666Q', ownerPhone: '600 200 001' },
	{ id: 'c2prop2', communityId: 'comm2', name: 'Bajo B', type: 'home', coefficient: 16, ownerUid: '', ownerName: 'Luis Romero', ownerEmail: 'luis.romero@example.com', ownerNif: '77777777B', ownerPhone: '600 200 002' },
	{ id: 'c2prop3', communityId: 'comm2', name: '1º A', type: 'home', coefficient: 17, ownerUid: uids.tomas, ownerName: 'Tomás Vidal', ownerEmail: 'lynx9011+manager2@gmail.com', ownerNif: '99999999R', ownerPhone: '600 200 003', mandate: { reference: 'GOB-C2PROP3-20250301', debtorName: 'Tomás Vidal', iban: 'ES1500496620861122334455', signedAt: '2025-03-01', status: 'active' } },
	{ id: 'c2prop4', communityId: 'comm2', name: '1º B', type: 'home', coefficient: 17, ownerUid: uids.elena, ownerName: 'Elena Castro', ownerEmail: 'lynx9011+user7@gmail.com', ownerNif: '45678912S', ownerPhone: '600 200 004', mandate: { reference: 'GOB-C2PROP4-20250301', debtorName: 'Elena Castro', iban: 'ES7820854567248901234567', signedAt: '2025-03-01', status: 'active' } },
	{ id: 'c2prop5', communityId: 'comm2', name: '2º A', type: 'home', coefficient: 17, ownerUid: uids.pablo, ownerName: 'Pablo Gil', ownerEmail: 'lynx9011+user8@gmail.com', ownerNif: '24681357B', ownerPhone: '600 200 005' },
	{ id: 'c2prop6', communityId: 'comm2', name: '2º B', type: 'home', coefficient: 17, ownerUid: '', ownerName: 'Beatriz Soto', ownerEmail: 'beatriz.soto@example.com', ownerNif: '13572468F', ownerPhone: '600 200 006' },
];

export function propertiesOf(communityId) {
	return properties.filter(property => property.communityId === communityId);
}

// Shared by the office's communities. Their fiscal data is what invoices, orders and the 347 need
export const providers = [
	{ id: 'prov_cleaning', name: 'Limpiezas Jaén', category: 'cleaning', phone: '953 000 106', email: 'limpiezas@example.com', cif: 'B23000003', fiscalName: 'Limpiezas Jaén S.L.', address: 'Calle Mayor 1, 23001 Jaén', iban: 'ES0401825555591112223334', communityIds: ['comm1', 'comm2'] },
	{ id: 'prov_lawyer', name: 'Laura Pérez, abogada', category: 'other', phone: '953 000 107', email: 'laura.perez@example.com', cif: '12345678Z', fiscalName: 'Laura Pérez Gómez', address: 'Plaza Nueva 3, 23002 Jaén', iban: 'ES0631870001781234500001', notes: 'Reclamaciones de deuda y monitorios', communityIds: ['comm1'] },
	{ id: 'prov_elevator', name: 'Ascensores del Sur', category: 'elevator', phone: '900 000 105', email: 'avisos@ascensoresdelsur.example.com', cif: 'B23112238', fiscalName: 'Ascensores del Sur S.L.', address: 'Polígono Los Olivares, parcela 4, 23009 Jaén', iban: 'ES6921002222063333444455', notes: 'Contrato de mantenimiento con revisión mensual', communityIds: ['comm1', 'comm2'] },
	{ id: 'prov_plumbing', name: 'Fontanería Hermanos Ortiz', category: 'plumbing', phone: '600 300 001', email: 'ortiz@example.com', cif: 'B23445562', fiscalName: 'Hermanos Ortiz Fontaneros S.L.', address: 'Calle Hornos 22, 23003 Jaén', iban: 'ES6600750001888706123456', communityIds: ['comm1', 'comm2'] },
	{ id: 'prov_electric', name: 'Electricidad Lumen', category: 'electricity', phone: '600 300 002', email: 'lumen@example.com', cif: 'B23778897', fiscalName: 'Instalaciones Lumen S.L.', address: 'Avenida de Madrid 40, 23008 Jaén', iban: 'ES2214650100969912345678', communityIds: ['comm1'] },
	{ id: 'prov_garden', name: 'Jardines del Guadalquivir', category: 'gardening', phone: '600 300 003', email: 'jardines@example.com', cif: 'B23990013', fiscalName: 'Jardines del Guadalquivir S.L.', address: 'Carretera de Córdoba km 2, 23005 Jaén', iban: 'ES5202390001501234567891', communityIds: ['comm1'] },
	{ id: 'prov_insurance', name: 'Seguros La Previsora', category: 'insurance', phone: '900 000 104', email: 'siniestros@laprevisora.example.com', cif: 'A23000011', fiscalName: 'La Previsora Compañía de Seguros S.A.', address: 'Calle Bernabé Soriano 5, 23001 Jaén', iban: 'ES8021000418424502000513', notes: 'Póliza multirriesgo 123456', communityIds: ['comm1', 'comm2'] },
	{ id: 'prov_fire', name: 'Extintores Jaén', category: 'fire_safety', phone: '953 000 108', email: 'extintores@example.com', cif: 'A23123128', fiscalName: 'Extintores y Seguridad Jaén S.A.', address: 'Calle Virgen de la Cabeza 7, 23008 Jaén', iban: 'ES6220850001651101234567', communityIds: ['comm1'] },
];

export function providerById(id) {
	return providers.find(provider => provider.id === id);
}

// Hosted pictures, as neighbours attach them to issues (Cloudinary only, the rules check it for work orders)
export const images = {
	leak: 'https://res.cloudinary.com/dqd7np8vk/image/upload/v1776855576/gobernan%C3%A7a/issues/filtraciones-agua-residencia_tmvhv0.jpg',
	flood: 'https://res.cloudinary.com/dqd7np8vk/image/upload/v1776855624/gobernan%C3%A7a/issues/Resi_ponfe_3_-krLB-U20721300682AMB-1200x840_Leonoticias_r7nbg4.webp',
	inside: 'https://res.cloudinary.com/dqd7np8vk/image/upload/v1776855576/gobernan%C3%A7a/issues/inside-view_ftqxjx.jpg',
	video: 'https://res.cloudinary.com/dqd7np8vk/video/upload/v1776855577/gobernan%C3%A7a/issues/bigbuck_bunny_8bit_15000kbps_1080p_60.0fps_h264_tpr6rn.mp4',
};
