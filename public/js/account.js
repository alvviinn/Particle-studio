import { api } from './api.js';
import { mountNav, footer, toast, escapeHtml } from './nav.js';

const $ = (id) => document.getElementById(id);
const user = await mountNav('account');
footer();
if (!user) location.href = '/auth?next=/account';

const say = (id, text, ok = false) => { const m = $(id); m.textContent = text; m.className = 'msg ' + (text ? (ok ? 'ok' : 'err') : ''); };
const post = (path, body, method = 'POST') => api(path, { method, body });
let me = user;

function paint() {
  $('who').textContent = `Signed in as ${me.name}.`;
  $('email-line').textContent = me.email;
  $('name').value = me.name;
  $('tf-pill').textContent = me.twoFactor ? 'On' : 'Off';
  $('tf-pill').classList.toggle('on', me.twoFactor);
  $('tf-off').hidden = me.twoFactor || !$('tf-setup').hidden;
  $('tf-on').hidden = !me.twoFactor || !$('tf-codes').hidden;
}
paint();

async function recoveryLeft() {
  if (!me.twoFactor) return;
  const { left } = await api('/account/2fa/recovery-count');
  $('rec-left').textContent = left > 0 ? `${left} recovery code${left === 1 ? '' : 's'} left.` : 'You have no recovery codes left. Turn two-factor off and on again to get a new set.';
}
recoveryLeft().catch(() => {});

/* profile */
$('f-profile').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { me = (await post('/account/profile', { name: $('name').value }, 'PATCH')).user; paint(); say('m-profile', 'Saved.', true); mountNav('account'); }
  catch (err) { say('m-profile', err.message); }
});

/* two-factor */
$('tf-start').addEventListener('click', async () => {
  say('m-2fa', '');
  try {
    const r = await post('/account/2fa/setup');
    $('qr').src = r.qr; $('secret').textContent = r.secret;
    $('tf-setup').hidden = false; $('tf-off').hidden = true;
    $('en-code').focus();
  } catch (err) { say('m-2fa', err.message); }
});
$('f-enable').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await post('/account/2fa/enable', { code: $('en-code').value });
    me = { ...me, twoFactor: true };
    $('tf-setup').hidden = true;
    $('codes').innerHTML = r.recoveryCodes.map((c) => `<code>${escapeHtml(c)}</code>`).join('');
    $('tf-codes').hidden = false;
    $('en-code').value = '';
    paint(); say('m-2fa', '');
    window.__codes = r.recoveryCodes;
  } catch (err) { say('m-2fa', err.message); }
});
$('codes-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(window.__codes.join('\n')); toast('Copied.'); } catch { toast('Select and copy them by hand.', 'err'); }
});
$('codes-dl').addEventListener('click', () => {
  const blob = new Blob([`Pollen recovery codes for ${me.email}\nEach code works once.\n\n${window.__codes.join('\n')}\n`], { type: 'text/plain' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'pollen-recovery-codes.txt' });
  a.click(); URL.revokeObjectURL(a.href);
});
$('codes-done').addEventListener('click', () => { window.__codes = null; $('codes').innerHTML = ''; $('tf-codes').hidden = true; paint(); recoveryLeft(); });
$('f-disable').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await post('/account/2fa/disable', { password: $('d-pw').value, code: $('d-code').value });
    me = { ...me, twoFactor: false }; $('d-pw').value = ''; $('d-code').value = '';
    paint(); say('m-2fa', 'Two-factor is off.', true);
  } catch (err) { say('m-2fa', err.message); }
});

/* password */
$('f-pw').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await post('/account/password', { current: $('p-cur').value, next: $('p-new').value });
    $('p-cur').value = ''; $('p-new').value = '';
    say('m-pw', 'Password changed.', true); loadSessions();
  } catch (err) { say('m-pw', err.message); }
});

/* sessions */
async function loadSessions() {
  const { sessions } = await api('/account/sessions');
  $('sessions').innerHTML = sessions.map((s) => `
    <div class="sess"><span>${escapeHtml(describeUA(s.ua))}${s.current ? ' <span class="pill on">This device</span>' : ''}<br><span class="muted small">${escapeHtml(s.ip || '')} &middot; ${new Date(s.createdAt).toLocaleString()}</span></span></div>`).join('');
}
function describeUA(ua = '') {
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const o = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return o ? `${b} on ${o}` : b;
}
loadSessions().catch(() => {});
$('revoke').addEventListener('click', async () => { await post('/account/sessions/revoke-others'); toast('Other devices signed out.'); loadSessions(); });

/* delete */
$('f-del').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!confirm('Delete your account and all saved videos for good?')) return;
  try { await post('/account/delete', { password: $('del-pw').value }); location.href = '/'; }
  catch (err) { say('m-del', err.message); }
});
