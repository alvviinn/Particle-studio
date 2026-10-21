import { api, fmtBytes, fmtDate, fmtTime } from './api.js';
import { mountNav, footer, toast, escapeHtml } from './nav.js';
import { FORMS } from './forms.js';

const user = await mountNav('library');
footer();
if (!user) location.href = '/auth?next=/library';

const grid = document.getElementById('grid');

async function load() {
  const { exports: list, used, quota } = await api('/exports');
  document.getElementById('empty').hidden = list.length > 0;
  const bar = document.getElementById('bar');
  bar.hidden = list.length === 0;
  document.getElementById('bar-i').style.width = Math.min(100, (used / quota) * 100) + '%';
  document.getElementById('usage').textContent = list.length ? `${list.length} saved · ${fmtBytes(used)} of ${fmtBytes(quota)} used` : '';
  grid.innerHTML = '';
  for (const v of list) {
    const el = document.createElement('article');
    el.className = 'vid';
    const meta = [FORMS[v.form]?.label, v.width && `${v.width}×${v.height}`, v.duration && fmtTime(v.duration), fmtBytes(v.size), fmtDate(v.createdAt)].filter(Boolean).join(' · ');
    el.innerHTML = `
      <video controls preload="metadata" playsinline src="/api/exports/${v.id}/file"></video>
      <div class="meta">
        <h3>${escapeHtml(v.title)}</h3>
        <p class="muted small">${escapeHtml(meta)}</p>
        <div class="acts">
          <a class="btn btn-primary btn-sm" href="/api/exports/${v.id}/file?download=1" download>Download</a>
          <button class="btn btn-ghost btn-sm" data-act="rename">Rename</button>
          <button class="btn btn-danger btn-sm" data-act="delete">Delete</button>
        </div>
      </div>`;
    el.querySelector('[data-act=rename]').addEventListener('click', async () => {
      const title = prompt('Name this video', v.title);
      if (!title?.trim()) return;
      try { await api(`/exports/${v.id}`, { method: 'PATCH', body: { title } }); load(); } catch (e) { toast(e.message, 'err'); }
    });
    el.querySelector('[data-act=delete]').addEventListener('click', async () => {
      if (!confirm(`Delete “${v.title}”?`)) return;
      try { await api(`/exports/${v.id}`, { method: 'DELETE' }); toast('Deleted.'); load(); } catch (e) { toast(e.message, 'err'); }
    });
    grid.append(el);
  }
}
load().catch((e) => toast(e.message, 'err'));
