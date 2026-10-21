// Browser-only stand-in for the server API, used when the site is hosted
// statically (e.g. GitHub Pages). Accounts, 2FA and saved renders live in this
// browser's IndexedDB. Same routes and responses as server/api.js.
//
// Honest limits: data never leaves this device, and because everything runs in
// the visitor's own browser this is a convenience gate, not hardened security.

const enc = new TextEncoder();
const SESSION_KEY = 'pollen.session';
const PENDING_KEY = 'pollen.pending';
const FAIL_KEY = 'pollen.fails';
const SESSION_MS = 14 * 24 * 3600e3;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

const fail = (status, error, extra = {}) => Object.assign(new Error(error), { status, data: { error, ...extra } });
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/* ---------------- storage ---------------- */
let dbp;
function open() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('pollen-local', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('users', { keyPath: 'email' });
      db.createObjectStore('exports', { keyPath: 'id' }).createIndex('owner', 'owner');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(fail(500, 'This browser blocked local storage, so accounts can’t be saved. Check your privacy settings.'));
  });
  return dbp;
}
async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = t.onabort = () => reject(t.error);
  });
}
const getUser = (email) => run('users', 'readonly', (s) => s.get(email));
const putUser = (u) => run('users', 'readwrite', (s) => s.put(u));
const ownerExports = (email) => run('exports', 'readonly', (s) => s.index('owner').getAll(email));
const getExport = (id) => run('exports', 'readonly', (s) => s.get(id));
const putExport = (e) => run('exports', 'readwrite', (s) => s.put(e));
const delExport = (id) => run('exports', 'readwrite', (s) => s.delete(id));

/* ---------------- crypto ---------------- */
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 310000 }, key, 256));
}
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: b64(salt), hash: await pbkdf2(password, salt) };
}
async function checkPassword(user, password) {
  return typeof password === 'string' && (await pbkdf2(password, unb64(user.salt))) === user.hash;
}
async function sha256(text) { return b64(await crypto.subtle.digest('SHA-256', enc.encode(text))); }

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(bytes) {
  let bits = 0, value = 0, out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(s) {
  let bits = 0, value = 0; const out = [];
  for (const ch of s.toUpperCase()) {
    const i = B32.indexOf(ch); if (i < 0) continue;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}
async function hotp(secret, counter) {
  const key = await crypto.subtle.importKey('raw', base32Decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const buf = new ArrayBuffer(8);
  new DataView(buf).setBigUint64(0, BigInt(counter));
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf));
  const o = h[19] & 15;
  const code = (((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000;
  return String(code).padStart(6, '0');
}
// Returns the matched step (blocks replay) or null.
async function verifyTotp(secret, code, lastStep = 0) {
  const clean = String(code).replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const now = Math.floor(Date.now() / 30000);
  for (const d of [0, -1, 1]) {
    const step = now + d;
    if (step > lastStep && (await hotp(secret, step)) === clean) return step;
  }
  return null;
}
function recoveryCodes(n = 8) {
  return Array.from({ length: n }, () => {
    const raw = [...crypto.getRandomValues(new Uint8Array(5))].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}
const normRecovery = (c) => String(c).toLowerCase().replace(/[^0-9a-f]/g, '');

function passwordProblem(pw, email = '') {
  if (typeof pw !== 'string' || pw.length < 10) return 'Use at least 10 characters.';
  if (pw.length > 200) return 'That password is too long.';
  if (['password', 'password1', 'password123', '1234567890', 'qwertyuiop', 'iloveyou12', 'letmein123', 'welcome123', 'admin12345'].includes(pw.toLowerCase())) return 'That password is far too common.';
  const local = email.split('@')[0]?.toLowerCase();
  if (local && local.length > 3 && pw.toLowerCase().includes(local)) return 'Keep your email name out of your password.';
  if (new Set(pw).size < 5) return 'Mix in more different characters.';
  return null;
}

async function qrDataUrl(text) {
  if (!window.qrcode) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = new URL('./vendor/qrcode.js', import.meta.url);
      s.onload = res; s.onerror = () => rej(fail(500, 'Couldn’t load the QR code generator.'));
      document.head.append(s);
    });
  }
  const q = window.qrcode(0, 'M');
  q.addData(text); q.make();
  return q.createDataURL(6, 3);
}

/* ---------------- sessions ---------------- */
const readJSON = (store, key) => { try { return JSON.parse(store.getItem(key) || 'null'); } catch { return null; } };
const writeJSON = (store, key, v) => { try { store.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } };

async function currentUser() {
  const s = readJSON(localStorage, SESSION_KEY);
  if (!s || s.exp < Date.now()) return null;
  return (await getUser(s.email)) || null;
}
const startSession = (email) => writeJSON(localStorage, SESSION_KEY, { email, exp: Date.now() + SESSION_MS, at: Date.now() });
const requireUser = async () => { const u = await currentUser(); if (!u) throw fail(401, 'Please sign in first.'); return u; };
const pub = (u) => ({ id: u.email, email: u.email, name: u.name, twoFactor: !!u.totpEnabled, createdAt: u.createdAt });

function throttle() {
  const f = readJSON(localStorage, FAIL_KEY);
  if (f && f.reset > Date.now() && f.n >= 8) throw fail(429, 'Too many sign-in attempts. Try again in a few minutes.');
}
const noteFailure = () => {
  const f = readJSON(localStorage, FAIL_KEY);
  writeJSON(localStorage, FAIL_KEY, f && f.reset > Date.now() ? { ...f, n: f.n + 1 } : { n: 1, reset: Date.now() + 15 * 60e3 });
};

/* ---------------- saved renders ---------------- */
const QUOTA = 2 * 1024 ** 3;
const exportInfo = (r) => ({ id: r.id, title: r.title, form: r.form, mime: r.mime, size: r.size, width: r.width, height: r.height, duration: r.duration, createdAt: r.createdAt });
const urlCache = new Map();

export async function getExportFile(id) {
  const user = await requireUser();
  const row = await getExport(id);
  if (!row || row.owner !== user.email) throw fail(404, 'Not found.');
  let url = urlCache.get(id);
  if (!url) { url = URL.createObjectURL(row.blob); urlCache.set(id, url); }
  const safe = row.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'pollen-render';
  return { url, filename: `${safe}.${row.mime === 'video/mp4' ? 'mp4' : 'webm'}` };
}

/* ---------------- router ---------------- */
export async function handle(fullPath, { method = 'GET', body, raw, headers = {} } = {}) {
  const [path, query = ''] = fullPath.split('?');
  const q = new URLSearchParams(query);
  const m = `${method} ${path}`;
  const b = body || {};

  /* auth */
  if (m === 'GET /me') { const u = await currentUser(); return { user: u ? pub(u) : null }; }

  if (m === 'POST /auth/register') {
    const name = str(b.name, 60), email = str(b.email, 320).toLowerCase();
    if (!name) throw fail(400, 'Tell us what to call you.');
    if (!EMAIL_RE.test(email)) throw fail(400, 'That email address doesn’t look right.');
    const problem = passwordProblem(b.password, email);
    if (problem) throw fail(400, problem, { field: 'password' });
    if (await getUser(email)) throw fail(409, 'An account with this email already exists in this browser. Try signing in.', { field: 'email' });
    const user = { email, name, ...(await hashPassword(b.password)), totpEnabled: false, totpSecret: null, totpPending: null, lastStep: 0, recovery: [], createdAt: Date.now() };
    await putUser(user);
    startSession(email);
    return { user: pub(user) };
  }

  if (m === 'POST /auth/login') {
    throttle();
    const email = str(b.email, 320).toLowerCase();
    const user = email ? await getUser(email) : null;
    const ok = user ? await checkPassword(user, b.password) : (await hashPassword(String(b.password || '')), false);
    if (!ok) { noteFailure(); throw fail(401, 'Email or password is incorrect.'); }
    localStorage.removeItem(FAIL_KEY);
    if (user.totpEnabled) {
      localStorage.removeItem(SESSION_KEY);
      writeJSON(sessionStorage, PENDING_KEY, { email, exp: Date.now() + 5 * 60e3, attempts: 0 });
      return { needs2fa: true };
    }
    startSession(email);
    return { user: pub(user) };
  }

  if (m === 'POST /auth/2fa') {
    const p = readJSON(sessionStorage, PENDING_KEY);
    if (!p || p.exp < Date.now()) throw fail(401, 'Your sign-in expired. Start again.', { expired: true });
    if (p.attempts >= 5) { sessionStorage.removeItem(PENDING_KEY); throw fail(429, 'Too many wrong codes. Sign in again.', { expired: true }); }
    const user = await getUser(p.email);
    const code = str(b.code, 32);
    let good = false;
    if (/^\d{3}\s?\d{3}$/.test(code)) {
      const step = await verifyTotp(user.totpSecret, code, user.lastStep);
      if (step) { user.lastStep = step; await putUser(user); good = true; }
    } else {
      const norm = normRecovery(code);
      if (norm.length === 10) {
        const h = await sha256(norm);
        const hit = user.recovery.find((r) => r.hash === h && !r.used);
        if (hit) { hit.used = true; await putUser(user); good = true; }
      }
    }
    if (!good) {
      p.attempts++; writeJSON(sessionStorage, PENDING_KEY, p);
      throw fail(401, 'That code didn’t work. Check your authenticator app and try again.');
    }
    sessionStorage.removeItem(PENDING_KEY);
    startSession(user.email);
    return { user: pub(user), recoveryLeft: user.recovery.filter((r) => !r.used).length };
  }

  if (m === 'POST /auth/logout') { localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(PENDING_KEY); return { ok: true }; }

  /* account */
  if (m === 'PATCH /account/profile') {
    const u = await requireUser(); const name = str(b.name, 60);
    if (!name) throw fail(400, 'Name can’t be empty.');
    u.name = name; await putUser(u); return { user: pub(u) };
  }
  if (m === 'POST /account/password') {
    const u = await requireUser();
    if (!(await checkPassword(u, b.current))) throw fail(401, 'Your current password is incorrect.', { field: 'current' });
    const problem = passwordProblem(b.next, u.email);
    if (problem) throw fail(400, problem, { field: 'next' });
    Object.assign(u, await hashPassword(b.next)); await putUser(u); return { ok: true };
  }
  if (m === 'GET /account/sessions') {
    await requireUser(); const s = readJSON(localStorage, SESSION_KEY);
    return { sessions: [{ current: true, createdAt: s?.at || Date.now(), ip: 'This browser', ua: navigator.userAgent }] };
  }
  if (m === 'POST /account/sessions/revoke-others') { await requireUser(); return { ok: true }; }

  if (m === 'POST /account/2fa/setup') {
    const u = await requireUser();
    if (u.totpEnabled) throw fail(400, 'Two-factor is already on.');
    const secret = base32Encode(crypto.getRandomValues(new Uint8Array(20)));
    u.totpPending = secret; await putUser(u);
    const uri = `otpauth://totp/${encodeURIComponent('Pollen:' + u.email)}?secret=${secret}&issuer=Pollen&algorithm=SHA1&digits=6&period=30`;
    return { secret: secret.match(/.{1,4}/g).join(' '), qr: await qrDataUrl(uri) };
  }
  if (m === 'POST /account/2fa/enable') {
    const u = await requireUser();
    if (u.totpEnabled) throw fail(400, 'Two-factor is already on.');
    if (!u.totpPending) throw fail(400, 'Start the setup again.');
    const step = await verifyTotp(u.totpPending, str(b.code, 12), 0);
    if (!step) throw fail(400, 'That code didn’t match. Wait for a fresh one and try again.');
    const codes = recoveryCodes(8);
    u.totpSecret = u.totpPending; u.totpPending = null; u.totpEnabled = true; u.lastStep = step;
    u.recovery = await Promise.all(codes.map(async (c) => ({ hash: await sha256(normRecovery(c)), used: false })));
    await putUser(u);
    return { recoveryCodes: codes };
  }
  if (m === 'POST /account/2fa/disable') {
    const u = await requireUser();
    if (!u.totpEnabled) throw fail(400, 'Two-factor is already off.');
    const step = await verifyTotp(u.totpSecret, str(b.code, 12), u.lastStep);
    if (!(await checkPassword(u, b.password)) || !step) throw fail(401, 'Password or code is wrong.');
    Object.assign(u, { totpEnabled: false, totpSecret: null, totpPending: null, lastStep: 0, recovery: [] });
    await putUser(u); return { ok: true };
  }
  if (m === 'GET /account/2fa/recovery-count') { const u = await requireUser(); return { left: u.recovery.filter((r) => !r.used).length }; }
  if (m === 'POST /account/delete') {
    const u = await requireUser();
    if (!(await checkPassword(u, b.password))) throw fail(401, 'Password is incorrect.');
    for (const e of await ownerExports(u.email)) await delExport(e.id);
    await run('users', 'readwrite', (s) => s.delete(u.email));
    localStorage.removeItem(SESSION_KEY); return { ok: true };
  }

  /* saved renders */
  if (m === 'GET /exports') {
    const u = await requireUser();
    const rows = (await ownerExports(u.email)).sort((a, z) => z.createdAt - a.createdAt);
    return { exports: rows.map(exportInfo), used: rows.reduce((a, r) => a + r.size, 0), quota: QUOTA };
  }
  if (m === 'POST /exports') {
    const u = await requireUser();
    const mime = String(headers['Content-Type'] || raw?.type || '').split(';')[0].toLowerCase();
    if (!['video/mp4', 'video/webm'].includes(mime)) throw fail(415, 'Only mp4 or webm video can be saved.');
    if (!raw?.size) throw fail(400, 'Empty video.');
    const used = (await ownerExports(u.email)).reduce((a, r) => a + r.size, 0);
    if (used + raw.size > QUOTA) throw fail(413, 'Your library is full. Delete something first.');
    const num = (v) => (Number.isFinite(+v) && +v > 0 ? +v : null);
    const row = { id: crypto.randomUUID(), owner: u.email, title: str(q.get('title'), 80) || 'Untitled render', form: str(q.get('form'), 30), mime, blob: raw, size: raw.size, width: num(q.get('w')), height: num(q.get('h')), duration: num(q.get('d')), createdAt: Date.now() };
    try { await putExport(row); }
    catch { throw fail(413, 'This browser has no room left to store the video. Download it instead.'); }
    return { export: exportInfo(row) };
  }
  let mm;
  if ((mm = path.match(/^\/exports\/([\w-]+)$/))) {
    const u = await requireUser();
    const row = await getExport(mm[1]);
    if (!row || row.owner !== u.email) throw fail(404, 'Not found.');
    if (method === 'PATCH') {
      const title = str(b.title, 80); if (!title) throw fail(400, 'Give it a name.');
      row.title = title; await putExport(row); return { export: exportInfo(row) };
    }
    if (method === 'DELETE') {
      await delExport(row.id);
      const url = urlCache.get(row.id); if (url) { URL.revokeObjectURL(url); urlCache.delete(row.id); }
      return { ok: true };
    }
  }
  throw fail(404, 'Not found.');
}
