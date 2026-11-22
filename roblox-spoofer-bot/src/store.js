// Simpan API key user (terenkripsi AES-256-GCM) di data/keys.json
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'keys.json');

function secretKey() {
  const s = process.env.ENCRYPTION_SECRET;
  if (!s || s.length < 32) throw new Error('ENCRYPTION_SECRET di .env wajib diisi (min 32 karakter)');
  return createHash('sha256').update(s).digest();
}

function encrypt(text) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', secretKey(), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

function decrypt(blob) {
  const [iv, tag, enc] = blob.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = createDecipheriv('aes-256-gcm', secretKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

function load() {
  if (!existsSync(FILE)) return {};
  try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch { return {}; }
}

function save(db) {
  mkdirSync(dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  renameSync(tmp, FILE);
}

export function setUserKey(discordId, { apiKey, creatorType, creatorId }) {
  const db = load();
  db[discordId] = { key: encrypt(apiKey), creatorType, creatorId: String(creatorId), updatedAt: Date.now() };
  save(db);
}

export function getUserKey(discordId) {
  const row = load()[discordId];
  if (!row) return null;
  try {
    return { apiKey: decrypt(row.key), creatorType: row.creatorType, creatorId: row.creatorId };
  } catch {
    return null; // ENCRYPTION_SECRET berubah → key lama tidak bisa dibaca
  }
}

export function deleteUserKey(discordId) {
  const db = load();
  const had = !!db[discordId];
  delete db[discordId];
  save(db);
  return had;
}
