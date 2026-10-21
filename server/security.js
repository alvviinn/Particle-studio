import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { DATA_DIR } from './db.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };

// Master key used to encrypt TOTP secrets at rest.
function loadMasterKey() {
  if (process.env.APP_SECRET) {
    return crypto.createHash('sha256').update(process.env.APP_SECRET).digest();
  }
  const file = path.join(DATA_DIR, 'master.key');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
}
const MASTER = loadMasterKey();

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const [alg, N, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem,
  });
  return crypto.timingSafeEqual(key, expected);
}

// Used when an email does not exist so response time doesn't reveal it.
let dummyHash;
export async function burnPasswordCheck(password) {
  dummyHash ??= await hashPassword('not-a-real-password');
  await verifyPassword(password, dummyHash);
}

export const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', MASTER, iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

export function decrypt(blob) {
  const raw = Buffer.from(blob, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', MASTER, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

/* ---------- TOTP (RFC 6238, SHA-1, 6 digits, 30s) ---------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of str.replace(/=+$/, '').toUpperCase()) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(crypto.randomBytes(20));

function hotp(secretB32, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secretB32)).update(buf).digest();
  const off = h[h.length - 1] & 15;
  const code = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(code % 1_000_000).padStart(6, '0');
}

// Returns the matched time-step (so a code can't be replayed) or null.
export function verifyTotp(secretB32, code, lastStep = 0) {
  const clean = String(code).replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const now = Math.floor(Date.now() / 30000);
  for (const drift of [0, -1, 1]) {
    const step = now + drift;
    if (step <= lastStep) continue;
    const a = Buffer.from(hotp(secretB32, step));
    if (crypto.timingSafeEqual(a, Buffer.from(clean))) return step;
  }
  return null;
}

export function currentTotp(secretB32) {
  return hotp(secretB32, Math.floor(Date.now() / 30000));
}

export function totpUri(secret, email) {
  const label = encodeURIComponent(`Pollen:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=Pollen&algorithm=SHA1&digits=6&period=30`;
}

/* ---------- recovery codes ---------- */
export function makeRecoveryCodes(n = 8) {
  return Array.from({ length: n }, () => {
    const raw = crypto.randomBytes(5).toString('hex'); // 10 hex chars
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}
export const normalizeRecovery = (c) => String(c).toLowerCase().replace(/[^0-9a-f]/g, '');

/* ---------- tiny in-memory rate limiter ---------- */
export function rateLimit({ windowMs, max, key, message = 'Too many attempts. Please wait a little and try again.' }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, 60_000).unref();
  return (req, res, next) => {
    const k = key(req);
    const now = Date.now();
    let e = hits.get(k);
    if (!e || e.reset < now) { e = { n: 0, reset: now + windowMs }; hits.set(k, e); }
    if (e.n >= max) {
      res.set('Retry-After', Math.ceil((e.reset - now) / 1000));
      return res.status(429).json({ error: message });
    }
    req.rateHit = () => { e.n++; };            // call on failure
    req.rateClear = () => { hits.delete(k); }; // call on success
    next();
  };
}

const COMMON = new Set(['password', 'password1', 'password123', '1234567890', 'qwertyuiop', 'iloveyou12', 'letmein123', 'welcome123', 'admin12345']);
export function passwordProblem(pw, email = '') {
  if (typeof pw !== 'string' || pw.length < 10) return 'Use at least 10 characters.';
  if (pw.length > 200) return 'That password is too long.';
  if (COMMON.has(pw.toLowerCase())) return 'That password is far too common.';
  const local = email.split('@')[0]?.toLowerCase();
  if (local && local.length > 3 && pw.toLowerCase().includes(local)) return 'Keep your email name out of your password.';
  if (new Set(pw).size < 5) return 'Mix in more different characters.';
  return null;
}
