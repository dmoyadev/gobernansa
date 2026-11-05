import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { gunzipSync, gzipSync } from 'node:zlib';
import admin from 'firebase-admin';

/*
 * The backup file (ROB-2, docs/fiabilidad.md): every document as [path, data], gzipped and encrypted with AES-256-GCM.
 * Firestore's own types go tagged, so a restore writes them back as they were
 */

const MAGIC = Buffer.from('GOBK1');
export const BACKUP_DIR = process.env.BACKUP_DIR ?? join(homedir(), 'Documents', 'Backups', 'gobernansa');
// Outside the backups' folder, so a copy of it elsewhere can't be read. Lost, the backups are lost with it: keep a copy in
// the password manager
export const KEY_FILE = process.env.BACKUP_KEY ?? join(homedir(), '.config', 'gobernansa', 'backup.key');
export const SERVICE_ACCOUNT = new URL('../firebase-test/serviceAccountKey.local.json', import.meta.url);

export function readKey({ create = false } = {}) {
	if (!existsSync(KEY_FILE)) {
		if (!create) {
			throw new Error(`No está la clave de las copias en ${KEY_FILE}`);
		}
		mkdirSync(dirname(KEY_FILE), { recursive: true });
		writeFileSync(KEY_FILE, randomBytes(32).toString('base64'), { mode: 0o600 });
		chmodSync(KEY_FILE, 0o600);
		console.warn(`Clave nueva en ${KEY_FILE}: guarda una copia en el gestor de contraseñas, sin ella no se pueden restaurar las copias`);
	}
	const key = Buffer.from(readFileSync(KEY_FILE, 'utf8').trim(), 'base64');
	if (key.length !== 32) {
		throw new Error(`${KEY_FILE} no es una clave de 32 bytes en base64`);
	}
	return key;
}

export function encrypt(content, key) {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const data = Buffer.concat([cipher.update(gzipSync(JSON.stringify(content))), cipher.final()]);
	return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), data]);
}

export function decrypt(file, key) {
	if (!file.subarray(0, MAGIC.length).equals(MAGIC)) {
		throw new Error('No es una copia de gobernança');
	}
	const iv = file.subarray(MAGIC.length, MAGIC.length + 12);
	const tag = file.subarray(MAGIC.length + 12, MAGIC.length + 28);
	const decipher = createDecipheriv('aes-256-gcm', key, iv);
	decipher.setAuthTag(tag);
	return JSON.parse(gunzipSync(Buffer.concat([decipher.update(file.subarray(MAGIC.length + 28)), decipher.final()])).toString());
}

export function encode(value) {
	if (value instanceof admin.firestore.Timestamp) {
		return { __ts: [value.seconds, value.nanoseconds] };
	}
	if (value instanceof admin.firestore.GeoPoint) {
		return { __geo: [value.latitude, value.longitude] };
	}
	if (value instanceof admin.firestore.DocumentReference) {
		return { __ref: value.path };
	}
	if (value instanceof Uint8Array) {
		return { __bytes: Buffer.from(value).toString('base64') };
	}
	if (Array.isArray(value)) {
		return value.map(encode);
	}
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
	}
	return value;
}

export function decode(value, db) {
	if (Array.isArray(value)) {
		return value.map(item => decode(item, db));
	}
	if (!value || typeof value !== 'object') {
		return value;
	}
	if (value.__ts) {
		return new admin.firestore.Timestamp(...value.__ts);
	}
	if (value.__geo) {
		return new admin.firestore.GeoPoint(...value.__geo);
	}
	if (value.__ref) {
		return db.doc(value.__ref);
	}
	if (value.__bytes) {
		return Buffer.from(value.__bytes, 'base64');
	}
	return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item, db)]));
}
