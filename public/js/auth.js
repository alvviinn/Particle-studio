import { api, isLocal } from './api.js';
import { LOGO, getUser } from './nav.js';
import { ParticleEngine } from './engine.js';
import { FORMS } from './forms.js';
import { createDemoSource } from './demo.js';

document.getElementById('logo').innerHTML = LOGO;
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const next = (() => {
  const n = (params.get('next') || 'studio').replace(/^\//, '').replace(/\.html$/, '');
  return ['studio', 'library', 'account'].includes(n) ? `${n}.html` : 'studio.html'; // same-site pages only
})();

getUser().then((u) => { if (u) location.replace(next); });
isLocal().then((local) => {
  if (!local) return;
  const note = document.createElement('p');
  note.className = 'hint local-note';
  note.textContent = 'This is the static version of Pollen: accounts and saved videos are stored in this browser only, on this device.';
  document.querySelector('.auth-box').append(note);
});

/* ---- decorative particle backdrop ---- */
try {
  const eng = new ParticleEngine($('art'));
  const demo = createDemoSource(960, 540);
  eng.setSource(demo.canvas, demo.depthCanvas);
  eng.setConfig({ form: 'anime', ...FORMS.anime.defaults });
  const t0 = performance.now();
  (function loop() {
    requestAnimationFrame(loop);
    if (document.hidden) return;
    const t = (performance.now() - t0) / 1000;
    demo.draw(t); eng.render(t);
  })();
} catch { /* backdrop is optional */ }

/* ---- view switching ---- */
function show(view) {
  for (const v of ['login', 'register', '2fa']) $('v-' + v).hidden = v !== view;
  document.title = { login: 'Sign in', register: 'Create account', '2fa': 'Verify' }[view] + ' — Pollen';
  const first = $('v-' + view).querySelector('input');
  first?.focus();
}
document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  if (go) { clearMessages(); show(go.dataset.go); }
  const tg = e.target.closest('[data-toggle]');
  if (tg) {
    const input = $(tg.dataset.toggle);
    const hide = input.type === 'text';
    input.type = hide ? 'password' : 'text';
    tg.textContent = hide ? 'Show' : 'Hide';
  }
});
const clearMessages = () => document.querySelectorAll('.msg').forEach((m) => { m.textContent = ''; });
show(params.get('mode') === 'register' ? 'register' : 'login');

function busy(form, on) {
  const b = form.querySelector('button[type=submit]');
  b.disabled = on;
  b.dataset.label ??= b.textContent;
  b.innerHTML = on ? '<span class="spin"></span>' : b.dataset.label;
}

/* ---- sign in ---- */
$('f-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget, msg = $('m-login');
  msg.textContent = '';
  const email = $('l-email').value.trim(), password = $('l-pw').value;
  if (!email || !password) { msg.textContent = 'Enter your email and password.'; return; }
  busy(form, true);
  try {
    const r = await api('/auth/login', { method: 'POST', body: { email, password } });
    if (r.needs2fa) { $('l-pw').value = ''; show('2fa'); }
    else location.href = next;
  } catch (err) { msg.textContent = err.message; }
  busy(form, false);
});

/* ---- register ---- */
function strength(pw) {
  let s = 0;
  if (pw.length >= 10) s++;
  if (pw.length >= 14) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw) || /\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw) || pw.length >= 18) s++;
  return pw.length < 10 ? Math.min(s, 1) : Math.max(s, 1);
}
$('r-pw').addEventListener('input', (e) => {
  const v = e.target.value;
  $('meter').dataset.s = v ? strength(v) : 0;
  $('pw-hint').textContent = !v ? 'At least 10 characters. A few random words work well.'
    : v.length < 10 ? `${10 - v.length} more character${10 - v.length > 1 ? 's' : ''} to go.` : ['', 'Okay, longer is stronger.', 'Decent.', 'Good.', 'Strong.'][strength(v)];
});
$('f-register').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget, msg = $('m-register');
  msg.textContent = '';
  const body = { name: $('r-name').value.trim(), email: $('r-email').value.trim(), password: $('r-pw').value };
  if (!body.name) { msg.textContent = 'Tell us what to call you.'; return; }
  if (!/^\S+@\S+\.\S+$/.test(body.email)) { msg.textContent = 'That email address doesn’t look right.'; return; }
  if (body.password.length < 10) { msg.textContent = 'Use at least 10 characters for your password.'; return; }
  busy(form, true);
  try {
    await api('/auth/register', { method: 'POST', body });
    location.href = next;
  } catch (err) { msg.textContent = err.message; }
  busy(form, false);
});

/* ---- second factor ---- */
let recoveryMode = false;
$('toggle-recovery').addEventListener('click', () => {
  recoveryMode = !recoveryMode;
  const input = $('t-code');
  input.value = ''; $('m-2fa').textContent = '';
  input.classList.toggle('code-input', !recoveryMode);
  input.maxLength = recoveryMode ? 11 : 7;
  input.placeholder = recoveryMode ? 'xxxxx-xxxxx' : '000000';
  input.inputMode = recoveryMode ? 'text' : 'numeric';
  $('t-label').textContent = recoveryMode ? 'Recovery code' : 'Authentication code';
  $('tf-lead').textContent = recoveryMode ? 'Enter one of the recovery codes you saved. Each works once.' : 'Enter the 6-digit code from your authenticator app.';
  $('toggle-recovery').textContent = recoveryMode ? 'Use my authenticator app' : 'Use a recovery code instead';
  input.focus();
});
$('f-2fa').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget, msg = $('m-2fa');
  msg.textContent = '';
  const code = $('t-code').value.trim();
  if (!code) { msg.textContent = 'Enter the code first.'; return; }
  busy(form, true);
  try {
    await api('/auth/2fa', { method: 'POST', body: { code } });
    location.href = next;
  } catch (err) {
    msg.textContent = err.message;
    if (err.data?.expired) { setTimeout(() => { show('login'); $('m-login').textContent = err.message; }, 900); }
  }
  busy(form, false);
});
