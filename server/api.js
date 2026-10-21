import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { db, EXPORT_DIR } from './db.js';
import {
  hashPassword, verifyPassword, burnPasswordCheck, passwordProblem, sha256,
  encrypt, decrypt, newTotpSecret, verifyTotp, totpUri,
  makeRecoveryCodes, normalizeRecovery, rateLimit,
} from './security.js';
import { startSession, endSession, dropOtherSessions, requireAuth } from './sessions.js';

export const api = express.Router();
const json = express.json({ limit: '20kb' });

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const MAX_EXPORT_BYTES = 600 * 1024 * 1024;
const USER_QUOTA_BYTES = 3 * 1024 * 1024 * 1024;
const ALLOWED_MIME = { 'video/mp4': 'mp4', 'video/webm': 'webm' };

const publicUser = (u) => ({
  id: u.id, email: u.email, name: u.name,
  twoFactor: !!u.totp_enabled, createdAt: u.created_at,
});

const ipKey = (req) => req.ip;
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000, max: 8,
  key: (req) => `${req.ip}|${String(req.body?.email || '').toLowerCase()}`,
  message: 'Too many sign-in attempts. Try again in a few minutes.',
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60_000, max: 10, key: ipKey,
  message: 'Too many accounts created from this network. Try again later.',
});
const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60_000, max: 10, key: (req) => `u${req.user?.id}`,
});

// Reject cross-site writes: the Origin (when sent) must be our own host.
api.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Cross-site request blocked.' });
    } catch { return res.status(403).json({ error: 'Bad origin.' }); }
  }
  next();
});

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/* ================= auth ================= */

api.post('/auth/register', registerLimiter, json, async (req, res) => {
  req.rateHit();
  const name = str(req.body?.name, 60);
  const email = str(req.body?.email, 320).toLowerCase();
  const password = req.body?.password;
  if (!name) return res.status(400).json({ error: 'Tell us what to call you.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'That email address doesn’t look right.' });
  const problem = passwordProblem(password, email);
  if (problem) return res.status(400).json({ error: problem, field: 'password' });

  const exists = db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
  if (exists) return res.status(409).json({ error: 'An account with this email already exists. Try signing in.', field: 'email' });

  const hash = await hashPassword(password);
  let info;
  try {
    info = db.prepare('INSERT INTO users (email, name, pw_hash, created_at) VALUES (?,?,?,?)')
      .run(email, name, hash, Date.now());
  } catch {
    return res.status(409).json({ error: 'An account with this email already exists. Try signing in.', field: 'email' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  startSession(req, res, user.id, 'full');
  res.status(201).json({ user: publicUser(user) });
});

api.post('/auth/login', json, loginLimiter, async (req, res) => {
  const email = str(req.body?.email, 320).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const user = email ? db.prepare('SELECT * FROM users WHERE email = ?').get(email) : null;
  const ok = user ? await verifyPassword(password, user.pw_hash) : (await burnPasswordCheck(password), false);
  if (!ok) {
    req.rateHit();
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  if (user.totp_enabled) {
    // password was right, but nothing is unlocked until the second factor passes
    startSession(req, res, user.id, 'pending');
    return res.json({ needs2fa: true });
  }
  req.rateClear();
  startSession(req, res, user.id, 'full');
  res.json({ user: publicUser(user) });
});

api.post('/auth/2fa', json, (req, res) => {
  if (!req.user || req.session?.stage !== 'pending') {
    return res.status(401).json({ error: 'Your sign-in expired. Start again.', expired: true });
  }
  const sess = req.session;
  if (sess.attempts >= 5) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sess.id);
    return res.status(429).json({ error: 'Too many wrong codes. Sign in again.', expired: true });
  }
  const user = req.user;
  const code = str(req.body?.code, 32);
  let good = false;

  if (/^\d{3}\s?\d{3}$/.test(code)) {
    const step = verifyTotp(decrypt(user.totp_secret), code, user.totp_last_step);
    if (step) {
      db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ?').run(step, user.id);
      good = true;
    }
  } else {
    const norm = normalizeRecovery(code);
    if (norm.length === 10) {
      const row = db.prepare('SELECT id FROM recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL')
        .get(user.id, sha256(norm));
      if (row) {
        db.prepare('UPDATE recovery_codes SET used_at = ? WHERE id = ?').run(Date.now(), row.id);
        good = true;
      }
    }
  }

  if (!good) {
    db.prepare('UPDATE sessions SET attempts = attempts + 1 WHERE id = ?').run(sess.id);
    return res.status(401).json({ error: 'That code didn’t work. Check your authenticator app and try again.' });
  }

  db.prepare('DELETE FROM sessions WHERE id = ?').run(sess.id);
  startSession(req, res, user.id, 'full');
  const left = db.prepare('SELECT COUNT(*) c FROM recovery_codes WHERE user_id = ? AND used_at IS NULL').get(user.id).c;
  res.json({ user: publicUser(user), recoveryLeft: left });
});

api.post('/auth/logout', (req, res) => {
  endSession(req, res);
  res.json({ ok: true });
});

api.get('/me', (req, res) => {
  if (!req.user || req.session?.stage !== 'full') return res.json({ user: null });
  res.json({ user: publicUser(req.user) });
});

/* ================= account ================= */

api.patch('/account/profile', requireAuth, json, (req, res) => {
  const name = str(req.body?.name, 60);
  if (!name) return res.status(400).json({ error: 'Name can’t be empty.' });
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id);
  res.json({ user: publicUser({ ...req.user, name }) });
});

api.post('/account/password', requireAuth, sensitiveLimiter, json, async (req, res) => {
  const { current, next } = req.body || {};
  if (typeof current !== 'string' || !(await verifyPassword(current, req.user.pw_hash))) {
    req.rateHit();
    return res.status(401).json({ error: 'Your current password is incorrect.', field: 'current' });
  }
  const problem = passwordProblem(next, req.user.email);
  if (problem) return res.status(400).json({ error: problem, field: 'next' });
  db.prepare('UPDATE users SET pw_hash = ? WHERE id = ?').run(await hashPassword(next), req.user.id);
  dropOtherSessions(req.user.id, req.session.id);
  res.json({ ok: true });
});

api.get('/account/sessions', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT id, created_at, ip, ua FROM sessions WHERE user_id = ? AND stage = 'full' ORDER BY created_at DESC`).all(req.user.id);
  res.json({ sessions: rows.map((r) => ({ current: r.id === req.session.id, createdAt: r.created_at, ip: r.ip, ua: r.ua })) });
});

api.post('/account/sessions/revoke-others', requireAuth, (req, res) => {
  dropOtherSessions(req.user.id, req.session.id);
  res.json({ ok: true });
});

api.post('/account/2fa/setup', requireAuth, sensitiveLimiter, async (req, res) => {
  if (req.user.totp_enabled) return res.status(400).json({ error: 'Two-factor is already on.' });
  const secret = newTotpSecret();
  db.prepare('UPDATE users SET totp_pending = ? WHERE id = ?').run(encrypt(secret), req.user.id);
  const uri = totpUri(secret, req.user.email);
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 240, color: { dark: '#2a1620', light: '#fffaf3' } });
  res.json({ secret: secret.match(/.{1,4}/g).join(' '), qr });
});

api.post('/account/2fa/enable', requireAuth, sensitiveLimiter, json, (req, res) => {
  const u = req.user;
  if (u.totp_enabled) return res.status(400).json({ error: 'Two-factor is already on.' });
  if (!u.totp_pending) return res.status(400).json({ error: 'Start the setup again.' });
  const step = verifyTotp(decrypt(u.totp_pending), str(req.body?.code, 12), 0);
  if (!step) {
    req.rateHit();
    return res.status(400).json({ error: 'That code didn’t match. Wait for a fresh one and try again.' });
  }
  const codes = makeRecoveryCodes(8);
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_enabled = 1, totp_last_step = ? WHERE id = ?').run(step, u.id);
    db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(u.id);
    const ins = db.prepare('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?,?)');
    for (const c of codes) ins.run(u.id, sha256(normalizeRecovery(c)));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  dropOtherSessions(u.id, req.session.id);
  res.json({ recoveryCodes: codes });
});

api.post('/account/2fa/disable', requireAuth, sensitiveLimiter, json, async (req, res) => {
  const u = req.user;
  if (!u.totp_enabled) return res.status(400).json({ error: 'Two-factor is already off.' });
  const okPw = typeof req.body?.password === 'string' && await verifyPassword(req.body.password, u.pw_hash);
  const step = verifyTotp(decrypt(u.totp_secret), str(req.body?.code, 12), u.totp_last_step);
  if (!okPw || !step) {
    req.rateHit();
    return res.status(401).json({ error: 'Password or code is wrong.' });
  }
  db.prepare('UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled = 0, totp_last_step = 0 WHERE id = ?').run(u.id);
  db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(u.id);
  res.json({ ok: true });
});

api.get('/account/2fa/recovery-count', requireAuth, (req, res) => {
  const left = db.prepare('SELECT COUNT(*) c FROM recovery_codes WHERE user_id = ? AND used_at IS NULL').get(req.user.id).c;
  res.json({ left });
});

api.post('/account/delete', requireAuth, sensitiveLimiter, json, async (req, res) => {
  if (typeof req.body?.password !== 'string' || !(await verifyPassword(req.body.password, req.user.pw_hash))) {
    req.rateHit();
    return res.status(401).json({ error: 'Password is incorrect.' });
  }
  const files = db.prepare('SELECT file FROM exports WHERE user_id = ?').all(req.user.id);
  for (const f of files) fs.rm(path.join(EXPORT_DIR, f.file), { force: true }, () => {});
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
  endSession(req, res);
  res.json({ ok: true });
});

/* ================= saved videos ================= */

const exportRow = (r) => ({
  id: r.id, title: r.title, form: r.form, mime: r.mime, size: r.size,
  width: r.width, height: r.height, duration: r.duration, createdAt: r.created_at,
});

api.get('/exports', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM exports WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  const used = rows.reduce((a, r) => a + r.size, 0);
  res.json({ exports: rows.map(exportRow), used, quota: USER_QUOTA_BYTES });
});

// Raw video body; metadata travels in the query string.
api.post('/exports', requireAuth, (req, res) => {
  const mime = String(req.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = ALLOWED_MIME[mime];
  if (!ext) return res.status(415).json({ error: 'Only mp4 or webm video can be saved.' });

  const declared = Number(req.get('content-length') || 0);
  if (declared > MAX_EXPORT_BYTES) return res.status(413).json({ error: 'That render is larger than the 600 MB limit.' });
  const used = db.prepare('SELECT COALESCE(SUM(size),0) s FROM exports WHERE user_id = ?').get(req.user.id).s;
  if (used + declared > USER_QUOTA_BYTES) return res.status(413).json({ error: 'Your library is full. Delete something first.' });

  const id = crypto.randomUUID();
  const file = `${id}.${ext}`;
  const full = path.join(EXPORT_DIR, file);
  const out = fs.createWriteStream(full, { flags: 'wx' });
  let size = 0, aborted = false;

  const bail = (code, msg) => {
    if (aborted) return;
    aborted = true;
    out.destroy();
    fs.rm(full, { force: true }, () => {});
    if (!res.headersSent) res.status(code).json({ error: msg });
    req.destroy();
  };

  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_EXPORT_BYTES || used + size > USER_QUOTA_BYTES) bail(413, 'That render is too large to save.');
  });
  req.on('error', () => bail(400, 'Upload interrupted.'));
  req.on('aborted', () => bail(400, 'Upload interrupted.'));
  req.pipe(out);

  out.on('finish', () => {
    if (aborted) return;
    if (size === 0) { fs.rm(full, { force: true }, () => {}); return res.status(400).json({ error: 'Empty video.' }); }
    const q = req.query;
    const num = (v) => (Number.isFinite(+v) && +v > 0 ? +v : null);
    const title = str(q.title, 80) || 'Untitled render';
    db.prepare(`INSERT INTO exports (id, user_id, title, form, mime, file, size, width, height, duration, created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, req.user.id, title, str(q.form, 30), mime, file, size, num(q.w), num(q.h), num(q.d), Date.now());
    res.status(201).json({ export: exportRow(db.prepare('SELECT * FROM exports WHERE id = ?').get(id)) });
  });
});

function ownedExport(req, res) {
  const row = db.prepare('SELECT * FROM exports WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) res.status(404).json({ error: 'Not found.' });
  return row;
}

api.get('/exports/:id/file', requireAuth, (req, res) => {
  const row = ownedExport(req, res);
  if (!row) return;
  const safe = row.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'pollen-render';
  const ext = path.extname(row.file);
  res.set('Content-Type', row.mime);
  res.set('X-Content-Type-Options', 'nosniff');
  if (req.query.download) res.set('Content-Disposition', `attachment; filename="${safe}${ext}"`);
  res.sendFile(path.join(EXPORT_DIR, row.file), { acceptRanges: true, cacheControl: false });
});

api.patch('/exports/:id', requireAuth, json, (req, res) => {
  const row = ownedExport(req, res);
  if (!row) return;
  const title = str(req.body?.title, 80);
  if (!title) return res.status(400).json({ error: 'Give it a name.' });
  db.prepare('UPDATE exports SET title = ? WHERE id = ?').run(title, row.id);
  res.json({ export: exportRow({ ...row, title }) });
});

api.delete('/exports/:id', requireAuth, (req, res) => {
  const row = ownedExport(req, res);
  if (!row) return;
  db.prepare('DELETE FROM exports WHERE id = ?').run(row.id);
  fs.rm(path.join(EXPORT_DIR, row.file), { force: true }, () => {});
  res.json({ ok: true });
});

api.use((_req, res) => res.status(404).json({ error: 'Not found.' }));
api.use((err, _req, res, _next) => {
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on our side.' });
});
