export async function api(path, { method = 'GET', body, raw, headers } = {}) {
  const init = { method, credentials: 'same-origin', headers: { ...headers } };
  if (raw !== undefined) init.body = raw;
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  let res;
  try { res = await fetch('/api' + path, init); }
  catch { throw Object.assign(new Error('Can’t reach the server. Check your connection.'), { status: 0 }); }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw Object.assign(new Error(data?.error || 'Something went wrong.'), { status: res.status, data });
  return data;
}

export const fmtBytes = (n) => (n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB');
export const fmtDate = (ms) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
