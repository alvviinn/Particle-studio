import { db } from './db.js';
import { randomToken, sha256 } from './security.js';

const FULL_TTL = 14 * 24 * 3600 * 1000;   // 14 days
const PENDING_TTL = 5 * 60 * 1000;        // 2FA step must finish in 5 minutes
const COOKIE = 'sid';

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(req, res, token, maxAgeMs) {
  const secure = req.secure || process.env.COOKIE_SECURE === '1';
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

export function startSession(req, res, userId, stage = 'full') {
  const token = randomToken();
  const ttl = stage === 'full' ? FULL_TTL : PENDING_TTL;
  const now = Date.now();
  db.prepare(`INSERT INTO sessions (id, user_id, stage, created_at, expires_at, ip, ua) VALUES (?,?,?,?,?,?,?)`)
    .run(sha256(token), userId, stage, now, now + ttl, req.ip, String(req.get('user-agent') || '').slice(0, 200));
  setCookie(req, res, token, ttl);
}

export function endSession(req, res) {
  if (req.session) db.prepare('DELETE FROM sessions WHERE id = ?').run(req.session.id);
  setCookie(req, res, '', 0);
}

export function dropOtherSessions(userId, keepId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, keepId);
}

// Attaches req.session and req.user (when the session is valid).
export function sessionMiddleware(req, _res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const row = db.prepare(`
      SELECT s.id, s.stage, s.attempts, s.expires_at, s.user_id
      FROM sessions s WHERE s.id = ?`).get(sha256(token));
    if (row && row.expires_at > Date.now()) {
      req.session = row;
      req.user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
    } else if (row) {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(row.id);
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (req.user && req.session?.stage === 'full') return next();
  res.status(401).json({ error: 'Please sign in first.' });
}

export function pageGuard(req, res, next) {
  if (req.user && req.session?.stage === 'full') return next();
  res.redirect('/auth?next=' + encodeURIComponent(req.path));
}

setInterval(() => {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}, 10 * 60 * 1000).unref();
