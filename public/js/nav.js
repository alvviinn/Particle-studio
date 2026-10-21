import { api } from './api.js';

export const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true">
  <circle cx="16" cy="16" r="5" fill="#ee4e2c"/>
  <circle cx="16" cy="5.5" r="3.6" fill="#f7a81b"/><circle cx="25.2" cy="10.8" r="3.2" fill="#e23e6b"/>
  <circle cx="25.2" cy="21.2" r="3.6" fill="#f7a81b"/><circle cx="16" cy="26.5" r="3.2" fill="#e23e6b"/>
  <circle cx="6.8" cy="21.2" r="3.6" fill="#f7a81b"/><circle cx="6.8" cy="10.8" r="3.2" fill="#e23e6b"/>
</svg>`;

export function toast(message, type = '') {
  let box = document.querySelector('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.append(box); }
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = message;
  box.append(t);
  setTimeout(() => t.remove(), type === 'err' ? 6000 : 3800);
}

export async function getUser() {
  try { return (await api('/me')).user; } catch { return null; }
}

export async function signOut() {
  try { await api('/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
  location.href = '/';
}

// Builds the top bar. `active` is one of studio | library | account | ''.
export async function mountNav(active = '') {
  const host = document.getElementById('nav');
  if (!host) return null;
  const user = await getUser();
  const link = (href, label, key) => `<a href="${href}"${active === key ? ' aria-current="page"' : ''}>${label}</a>`;
  host.className = 'nav';
  host.innerHTML = `
    <div class="wrap">
      <a class="brand" href="/">${LOGO}<span>Pollen</span></a>
      <nav class="nav-links" aria-label="Main">
        ${link('/studio', 'Studio', 'studio')}
        ${user ? link('/library', 'My videos', 'library') : ''}
        ${user ? link('/account', 'Account', 'account') : ''}
      </nav>
      <div class="nav-end">
        ${user
          ? `<a class="avatar" href="/account" title="${escapeHtml(user.name)}" aria-label="Account">${escapeHtml(user.name.trim()[0]?.toUpperCase() || '?')}</a>
             <button class="btn btn-ghost btn-sm" id="signout">Sign out</button>`
          : `<a class="btn btn-ghost btn-sm" href="/auth?mode=login">Sign in</a>
             <a class="btn btn-primary btn-sm" href="/auth?mode=register">Create account</a>`}
      </div>
    </div>`;
  host.querySelector('#signout')?.addEventListener('click', signOut);
  return user;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function footer() {
  const el = document.getElementById('footer');
  if (!el) return;
  el.className = 'footer';
  el.innerHTML = `<div class="wrap"><span>© ${new Date().getFullYear()} Pollen. Videos are processed in your browser; only the renders you choose to save are stored.</span><span><a href="/studio">Studio</a> · <a href="/auth?mode=register">Create account</a></span></div>`;
}
