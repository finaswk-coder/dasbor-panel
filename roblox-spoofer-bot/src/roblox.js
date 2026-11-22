// Semua urusan ke API Roblox: download asset, deteksi tipe, upload, polling operation.
import { gunzipSync } from 'node:zlib';

const DELIVERY_URL = (id) => `https://apis.roblox.com/asset-delivery-api/v1/assetId/${id}`;
// Asset Delivery lama, tanpa API key: cuma bisa asset publik, tapi cukup buat cadangan.
const PUBLIC_DELIVERY_URL = (id) => `https://assetdelivery.roblox.com/v2/assetId/${id}`;
const ASSETS_URL = 'https://apis.roblox.com/assets/v1/assets';
const OPERATION_URL = (path) => `https://apis.roblox.com/assets/v1/${path}`;
const DETAILS_URL = (id) => `https://economy.roblox.com/v2/assets/${id}/details`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class RobloxError extends Error {
  constructor(message, { status, retryable = false } = {}) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

/**
 * fetch dengan retry otomatis untuk 429 / 5xx / error jaringan.
 * Menghormati header Retry-After kalau ada.
 */
async function fetchRetry(url, options = {}, { tries = 5, label = 'request' } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(60_000) });
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get('retry-after'));
        const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(30_000, 1000 * 2 ** attempt);
        lastErr = new RobloxError(`${label}: HTTP ${res.status}`, { status: res.status, retryable: true });
        if (attempt < tries) { await sleep(wait); continue; }
        throw lastErr;
      }
      return res;
    } catch (err) {
      if (err instanceof RobloxError && !err.retryable) throw err;
      lastErr = err;
      if (attempt < tries) { await sleep(Math.min(30_000, 1000 * 2 ** attempt)); continue; }
    }
  }
  throw lastErr;
}

async function readError(res) {
  const text = await res.text().catch(() => '');
  try {
    const j = JSON.parse(text);
    return j.message || j.errors?.[0]?.message || j.error || text;
  } catch {
    return text.slice(0, 300) || `HTTP ${res.status}`;
  }
}

// ---------------------------------------------------------------- deteksi tipe

export function detectKind(buf) {
  const head = buf.subarray(0, 16);
  const ascii = head.toString('latin1');
  if (ascii.startsWith('<roblox!')) return { kind: 'animation', ext: 'rbxm', mime: 'model/x-rbxm' };
  if (ascii.startsWith('<roblox')) return { kind: 'animation', ext: 'rbxmx', mime: 'model/x-rbxmx' };
  if (ascii.startsWith('OggS')) return { kind: 'audio', ext: 'ogg', mime: 'audio/ogg' };
  if (ascii.startsWith('ID3') || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0))
    return { kind: 'audio', ext: 'mp3', mime: 'audio/mpeg' };
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE') return { kind: 'audio', ext: 'wav', mime: 'audio/wav' };
  if (ascii.startsWith('fLaC')) return { kind: 'audio', ext: 'flac', mime: 'audio/flac' };
  return { kind: 'unknown', ext: 'bin', mime: 'application/octet-stream' };
}

// ---------------------------------------------------------------- info asset

/** Nama asli asset (opsional, cuma buat nama upload). Tidak butuh auth; kalau gagal ya pakai fallback. */
export async function getAssetName(id) {
  try {
    const res = await fetch(DETAILS_URL(id), { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const j = await res.json();
    return j?.Name || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- download

/**
 * Download konten mentah asset lewat Open Cloud Asset Delivery.
 * Butuh API key dengan scope legacy-asset:manage.
 */
export async function downloadAsset(id, apiKey) {
  if (!apiKey) throw new RobloxError('Tidak ada API key untuk download');
  const res = await fetchRetry(DELIVERY_URL(id), { headers: { 'x-api-key': apiKey } }, { label: 'download' });
  if (!res.ok) {
    const msg = await readError(res);
    throw new RobloxError(`Download ${id} gagal (HTTP ${res.status}): ${msg}`, { status: res.status });
  }
  return fetchFromMeta(id, await res.json());
}

/** Download asset publik tanpa API key (assetdelivery v2). */
export async function downloadPublic(id) {
  const res = await fetchRetry(PUBLIC_DELIVERY_URL(id), { headers: { Accept: 'application/json' } }, { label: 'download publik' });
  if (!res.ok) {
    const msg = await readError(res);
    throw new RobloxError(`Download publik ${id} gagal (HTTP ${res.status}): ${msg}`, { status: res.status });
  }
  return fetchFromMeta(id, await res.json());
}

/** Ambil file dari CDN berdasarkan respon asset delivery (v1 Open Cloud maupun v2 publik). */
async function fetchFromMeta(id, meta) {
  const location = meta.location || meta.Location || meta.locations?.[0]?.location;
  if (!location) {
    const msg = meta.errors?.[0]?.message || JSON.stringify(meta).slice(0, 200);
    throw new RobloxError(`Download ${id} gagal: ${msg}`);
  }

  const cdn = await fetchRetry(location, { headers: { 'Accept-Encoding': 'gzip' } }, { label: 'cdn' });
  if (!cdn.ok) throw new RobloxError(`CDN ${id} gagal (HTTP ${cdn.status})`, { status: cdn.status });
  let buf = Buffer.from(await cdn.arrayBuffer());
  // Kadang CDN kirim gzip tanpa header Content-Encoding → dekompres manual
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
  return buf;
}

/**
 * Coba download pakai beberapa key berurutan (misal: key user dulu, lalu key bot).
 * Entri { public: true } = coba tanpa key (asset publik).
 * Return { buf, usedKeyLabel }.
 */
export async function downloadWithFallback(id, keys) {
  const errors = [];
  for (const { key, label, public: isPublic } of keys) {
    if (!key && !isPublic) continue;
    try {
      const buf = isPublic ? await downloadPublic(id) : await downloadAsset(id, key);
      return { buf, usedKeyLabel: label };
    } catch (e) {
      errors.push(`[${label}] ${e.message}`);
    }
  }
  throw new RobloxError(errors.join(' | ') || 'Tidak ada API key yang bisa dipakai');
}

// ---------------------------------------------------------------- upload

function cleanName(name, fallback) {
  // displayName Roblox: maks 50 karakter, hindari karakter aneh
  const n = String(name || fallback).replace(/[^\p{L}\p{N} _\-().]/gu, '').trim().slice(0, 50);
  return n || fallback;
}

/**
 * Upload asset ke akun/grup pemilik API key.
 * creator = { userId } atau { groupId }
 */
export async function uploadAsset({ apiKey, creator, kind, buf, mime, ext, name, description }) {
  const assetType = kind === 'animation' ? 'Animation' : 'Audio';
  const request = {
    assetType,
    displayName: cleanName(name, `Spoofed ${assetType}`),
    description: String(description || '').slice(0, 1000),
    creationContext: { creator },
  };

  // FormData harus dibuat ulang tiap percobaan (body stream sekali pakai)
  const makeBody = () => {
    const fd = new FormData();
    fd.append('request', JSON.stringify(request));
    fd.append('fileContent', new Blob([buf], { type: mime }), `file.${ext}`);
    return fd;
  };

  let res;
  for (let attempt = 1; attempt <= 5; attempt++) {
    res = await fetch(ASSETS_URL, {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
      body: makeBody(),
      signal: AbortSignal.timeout(120_000),
    }).catch((e) => ({ ok: false, status: 0, _err: e }));
    if (res.ok) break;
    if (res.status === 429 || res.status >= 500 || res.status === 0) {
      const ra = Number(res.headers?.get?.('retry-after'));
      await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(30_000, 1000 * 2 ** attempt));
      continue;
    }
    break;
  }
  if (!res.ok) {
    const msg = res._err ? res._err.message : await readError(res);
    throw new RobloxError(`Upload gagal (HTTP ${res.status}): ${msg}`, { status: res.status });
  }

  const op = await res.json();
  if (op.done && op.response?.assetId) return String(op.response.assetId);
  if (!op.path) throw new RobloxError(`Upload: respon tidak dikenal ${JSON.stringify(op).slice(0, 200)}`);
  return pollOperation(op.path, apiKey);
}

async function pollOperation(path, apiKey) {
  // Polling sampai ~3 menit
  for (let i = 0; i < 40; i++) {
    await sleep(i < 5 ? 1500 : 5000);
    const res = await fetchRetry(OPERATION_URL(path), { headers: { 'x-api-key': apiKey } }, { label: 'operation' });
    if (!res.ok) {
      const msg = await readError(res);
      throw new RobloxError(`Cek status upload gagal (HTTP ${res.status}): ${msg}`, { status: res.status });
    }
    const op = await res.json();
    if (op.done) {
      if (op.error) throw new RobloxError(`Upload ditolak: ${op.error.message || JSON.stringify(op.error)}`);
      const id = op.response?.assetId;
      if (!id) throw new RobloxError('Upload selesai tapi assetId kosong');
      const mod = op.response?.moderationResult?.moderationState;
      if (mod === 'MODERATION_STATE_REJECTED') throw new RobloxError(`Asset ${id} kena moderasi (rejected)`);
      return String(id);
    }
  }
  throw new RobloxError('Upload timeout: Roblox belum selesai memproses (coba cek Creator Dashboard)');
}
