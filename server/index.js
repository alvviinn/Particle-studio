import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api } from './api.js';
import { sessionMiddleware, pageGuard } from './sessions.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const app = express();

app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : process.env.TRUST_PROXY);

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'",
  "style-src 'self' https://fonts.googleapis.com",
  "style-src-attr 'unsafe-inline'",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self' https://cdn.jsdelivr.net https://storage.googleapis.com data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
});

app.use(sessionMiddleware);
app.use('/api', api);

// Pages that need an account.
for (const page of ['studio', 'library', 'account']) {
  app.get(`/${page}`, pageGuard, (_req, res) => res.sendFile(path.join(pub, `${page}.html`)));
}
app.get('/auth', (req, res) => {
  if (req.user && req.session?.stage === 'full') return res.redirect('/studio');
  res.sendFile(path.join(pub, 'auth.html'));
});

app.use(express.static(pub, { extensions: ['html'], maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
app.use((_req, res) => res.status(404).sendFile(path.join(pub, '404.html')));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Pollen is running at http://localhost:${port}`));
