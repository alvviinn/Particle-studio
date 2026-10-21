// Talks to the Node server when there is one. On static hosting (GitHub Pages)
// there is no server, so everything is handled in the browser by localapi.js.

let modePromise = null;

function detect() {
  modePromise ??= (async () => {
    if (/\.github\.io$/.test(location.hostname)) return 'local'; // Pages never has a backend
    try {
      const r = await fetch(new URL('api/me', document.baseURI), { credentials: 'same-origin' });
      if (r.ok && (r.headers.get('content-type') || '').includes('json')) return 'server';
    } catch { /* no server */ }
    return 'local';
  })();
  return modePromise;
}

export const isLocal = async () => (await detect()) === 'local';

export async function api(path, opts = {}) {
  if ((await detect()) === 'local') {
    const { handle } = await import('./localapi.js');
    return handle(path, opts);
  }
  const { method = 'GET', body, raw, headers } = opts;
  const init = { method, credentials: 'same-origin', headers: { ...headers } };
  if (raw !== undefined) init.body = raw;
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  let res;
  try { res = await fetch(new URL('api' + path, document.baseURI), init); }
  catch { throw Object.assign(new Error('Can’t reach the server. Check your connection.'), { status: 0 }); }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw Object.assign(new Error(data?.error || 'Something went wrong.'), { status: res.status, data });
  return data;
}

// URL + filename for playing or downloading a saved render.
export async function exportFile(id, { download = false } = {}) {
  if ((await detect()) === 'local') {
    const { getExportFile } = await import('./localapi.js');
    return getExportFile(id);
  }
  return { url: `api/exports/${id}/file${download ? '?download=1' : ''}`, filename: null };
}

export const fmtBytes = (n) => (n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB');
export const fmtDate = (ms) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
