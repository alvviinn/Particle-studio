import { api, fmtBytes, fmtTime } from './api.js';
import { mountNav, toast } from './nav.js';
import { ParticleEngine } from './engine.js';
import { FORMS, PALETTES, BACKGROUNDS, DEFAULT_FORM } from './forms.js';
import { createDemoSource } from './demo.js';
import { SubjectMask } from './mask.js';
import { renderFormThumbs } from './thumbs.js';

const $ = (id) => document.getElementById(id);
const user = await mountNav('studio');
if (!user) location.href = 'auth.html?next=studio';

const canvas = $('view');
const video = document.createElement('video');
video.playsInline = true; video.loop = true; video.preload = 'auto';

let engine;
try { engine = new ParticleEngine(canvas); }
catch (e) { document.querySelector('.studio').innerHTML = `<div class="card"><h2>This browser can’t run the studio</h2><p class="muted">${e.message} Try a current version of Chrome, Edge, Firefox or Safari.</p></div>`; throw e; }

const demo = createDemoSource(1280, 720);
const mask = new SubjectMask();

/* ---------------- state ---------------- */
const state = {
  src: 'demo',            // 'demo' | 'video'
  name: 'Sample clip',
  playing: true,
  demoT: 0,
  muted: false,
  cfg: { form: DEFAULT_FORM, ...FORMS[DEFAULT_FORM].defaults, drift: 0.6, background: 'plum' },
  subject: 'off',
  res: 1080, fps: 30,
  recording: false,
};
engine.setConfig(state.cfg);
engine.setSource(demo.canvas);

const set = (patch) => { Object.assign(state.cfg, patch); engine.setConfig(patch); };

/* ---------------- controls ---------------- */
const SLIDERS = {
  'sl-particles': [
    ['density', 'Density', 20, 600, 10, (v) => `${v}k`],
    ['layers', 'Depth layers', 1, 4, 1, (v) => `${v}×`],
    ['size', 'Piece size', 0.3, 8, 0.05, (v) => v.toFixed(2)],
    ['depth', 'Depth', 0, 1.5, 0.01, (v) => v.toFixed(2)],
    ['motion', 'Movement', 0, 2, 0.01, (v) => v.toFixed(2)],
    ['speed', 'Speed', 0, 3, 0.05, (v) => v.toFixed(2) + '×'],
  ],
  'sl-colour': [
    ['sat', 'Saturation', 0, 2, 0.01, (v) => v.toFixed(2)],
    ['bright', 'Brightness', 0.4, 2, 0.01, (v) => v.toFixed(2)],
    ['cutoff', 'Hide darkest areas', 0, 0.5, 0.01, (v) => v.toFixed(2)],
  ],
  'sl-subject': [['bgKeep', 'Keep background', 0, 1, 0.01, (v) => Math.round(v * 100) + '%']],
  'sl-camera': [['drift', 'Camera drift', 0, 1.5, 0.01, (v) => v.toFixed(2)]],
};
const sliderEls = {};
for (const [host, defs] of Object.entries(SLIDERS)) {
  for (const [key, label, min, max, step, fmt] of defs) {
    const wrap = document.createElement('div');
    wrap.className = 'slider';
    wrap.innerHTML = `<label for="s-${key}">${label}</label><output id="o-${key}"></output><input type="range" id="s-${key}" min="${min}" max="${max}" step="${step}">`;
    $(host).append(wrap);
    const input = wrap.querySelector('input'), out = wrap.querySelector('output');
    sliderEls[key] = { input, out, fmt };
    input.addEventListener('input', () => { set({ [key]: +input.value }); out.textContent = fmt(+input.value); });
  }
}
function syncSliders() {
  for (const [key, { input, out, fmt }] of Object.entries(sliderEls)) {
    input.value = state.cfg[key]; out.textContent = fmt(+state.cfg[key]);
  }
}

function radioGroup(host, items, current, onPick) {
  const el = $(host);
  el.innerHTML = '';
  const buttons = items.map(({ key, label, style, title, cls }) => {
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'radio');
    if (label) b.textContent = label;
    if (style) b.style.background = style;
    if (title) { b.title = title; b.setAttribute('aria-label', title); }
    if (cls) b.className = cls;
    b.addEventListener('click', () => { mark(key); onPick(key); });
    el.append(b);
    return [key, b];
  });
  const mark = (k) => buttons.forEach(([key, b]) => b.setAttribute('aria-checked', String(key === k)));
  mark(current);
  return mark;
}

const markColor = radioGroup('seg-color',
  [{ key: 'original', label: 'Original' }, { key: 'gradient', label: 'Gradient' }, { key: 'scatter', label: 'Scatter' }],
  state.cfg.color, (k) => set({ color: k }));
const markPalette = radioGroup('palettes',
  Object.entries(PALETTES).map(([key, p]) => ({
    key, title: p.label, cls: 'sw',
    style: `linear-gradient(90deg, ${p.stops.join(',')})`,
  })), state.cfg.palette, (k) => {
    const patch = { palette: k };
    if (state.cfg.color === 'original') { patch.color = 'gradient'; markColor('gradient'); }
    set(patch);
  });
const markBackdrop = radioGroup('backdrops',
  Object.entries(BACKGROUNDS).map(([key, b]) => ({ key, title: b.label, cls: 'sw round', style: b.color })),
  state.cfg.background, (k) => set({ background: k }));

const SUBJECT_HINT = {
  off: 'Particles cover the whole frame.',
  motion: 'Best with a steady camera: whatever moves becomes the subject.',
  person: 'Finds people with an on-device model. The first use downloads a small file.',
};
radioGroup('seg-subject',
  [{ key: 'off', label: 'Off' }, { key: 'motion', label: 'Motion' }, { key: 'person', label: 'Person' }],
  'off', async (k) => {
    state.subject = k;
    $('subject-hint').textContent = SUBJECT_HINT[k];
    $('sl-subject').hidden = k === 'off';
    if (k === 'off') { engine.clearMask(); mask.setMode('off'); return; }
    if (k === 'person') $('subject-hint').textContent = 'Loading the person detector…';
    try { await mask.setMode(k); $('subject-hint').textContent = SUBJECT_HINT[k]; }
    catch {
      toast('Couldn’t load the person detector (are you offline?). Using motion instead.', 'err');
      state.subject = 'motion';
      document.querySelectorAll('#seg-subject button').forEach((b) => b.setAttribute('aria-checked', String(b.textContent === 'Motion')));
      $('subject-hint').textContent = SUBJECT_HINT.motion;
    }
  });
$('subject-hint').textContent = SUBJECT_HINT.off;
$('sl-subject').hidden = true;

/* look picker: real renders of the sample as thumbnails */
let thumbs = {};
try { thumbs = renderFormThumbs({ width: 240, height: 240 }); } catch { /* tiles just show labels */ }
const tiles = $('tiles');
for (const [key, f] of Object.entries(FORMS)) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'tile'; b.setAttribute('role', 'radio'); b.dataset.k = key;
  b.innerHTML = `${thumbs[key] ? `<img alt="" src="${thumbs[key]}">` : ''}<span>${f.label}</span>`;
  b.addEventListener('click', () => pickForm(key));
  tiles.append(b);
}
function pickForm(key) {
  const f = FORMS[key];
  const keep = { background: state.cfg.background, drift: state.cfg.drift };
  state.cfg = { form: key, ...f.defaults, ...keep };
  engine.setConfig(state.cfg);
  tiles.querySelectorAll('.tile').forEach((t) => t.setAttribute('aria-checked', String(t.dataset.k === key)));
  $('form-blurb').textContent = f.blurb;
  markColor(state.cfg.color); markPalette(state.cfg.palette);
  syncSliders();
}
pickForm(DEFAULT_FORM);

$('res').addEventListener('change', (e) => { state.res = +e.target.value; sizeCanvas(); });
$('fps-sel').addEventListener('change', (e) => { state.fps = +e.target.value; });

/* ---------------- sizing ---------------- */
function srcAspect() {
  return state.src === 'video' && video.videoWidth ? video.videoWidth / video.videoHeight : demo.canvas.width / demo.canvas.height;
}
function sizeCanvas() {
  const a = srcAspect(), s = state.res;
  let w = a >= 1 ? s * a : s, h = a >= 1 ? s : s / a;
  const k = Math.min(1, 2560 / Math.max(w, h));
  w = Math.round((w * k) / 2) * 2; h = Math.round((h * k) / 2) * 2;
  engine.resize(w, h);
  canvas.style.aspectRatio = `${w} / ${h}`;
}
sizeCanvas();

/* ---------------- audio ---------------- */
let audio = null;
function ensureAudio() {
  if (audio) { audio.ctx.resume?.(); return audio; }
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaElementSource(video);
    const mon = ctx.createGain(), rec = ctx.createGain();
    const dest = ctx.createMediaStreamDestination();
    src.connect(mon).connect(ctx.destination);
    src.connect(rec).connect(dest);
    mon.gain.value = state.muted ? 0 : 1;
    audio = { ctx, mon, dest };
  } catch { audio = null; }
  return audio;
}

/* ---------------- transport ---------------- */
const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
  vol: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 4V5L7 9zM16 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 4V5L7 9z"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};
const paintTransport = () => {
  $('play').innerHTML = state.playing ? ICON.pause : ICON.play;
  $('mute').innerHTML = state.muted ? ICON.mute : ICON.vol;
};
paintTransport();

function setPlaying(on) {
  state.playing = on;
  if (state.src === 'video') { if (on) { ensureAudio(); video.play().catch(() => {}); } else video.pause(); }
  paintTransport();
}
$('play').addEventListener('click', () => setPlaying(!state.playing));
$('mute').addEventListener('click', () => {
  state.muted = !state.muted;
  if (audio) audio.mon.gain.value = state.muted ? 0 : 1;
  paintTransport();
});
const duration = () => (state.src === 'video' ? video.duration || 0 : demo.duration);
const position = () => (state.src === 'video' ? video.currentTime : state.demoT);
let scrubbing = false;
$('seek').addEventListener('input', () => {
  scrubbing = true;
  const t = ($('seek').value / 1000) * duration();
  if (state.src === 'video') video.currentTime = t; else state.demoT = t;
});
$('seek').addEventListener('change', () => { scrubbing = false; });

/* ---------------- loading a video ---------------- */
let objectUrl = null;
function loadFile(file) {
  if (!file) return;
  if (!file.type.startsWith('video/')) { toast('That doesn’t look like a video file.', 'err'); return; }
  if (state.recording) return;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  ensureAudio();
  video.onloadedmetadata = () => {
    state.src = 'video';
    state.name = file.name.replace(/\.[^.]+$/, '') || 'Untitled';
    engine.setSource(video);
    mask.reset();
    sizeCanvas();
    $('src-name').textContent = `${file.name} · ${video.videoWidth}×${video.videoHeight} · ${fmtTime(video.duration)} · ${fmtBytes(file.size)}`;
    setPlaying(true);
  };
  video.onerror = () => {
    toast('Your browser can’t play that file. Try an MP4 (H.264) or WebM.', 'err');
    if (state.src !== 'video') return;
  };
  video.src = objectUrl;
  video.load();
}
$('file').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
$('demo-btn').addEventListener('click', () => {
  if (state.recording) return;
  video.pause(); state.src = 'demo'; state.name = 'Sample clip'; state.demoT = 0;
  engine.setSource(demo.canvas); mask.reset(); sizeCanvas();
  $('src-name').textContent = 'Built-in sample, 12 seconds, no sound.';
  setPlaying(true);
});
const frame = $('frame');
['dragenter', 'dragover'].forEach((ev) => frame.addEventListener(ev, (e) => { e.preventDefault(); frame.classList.add('dragging'); $('drop').hidden = false; }));
['dragleave', 'drop'].forEach((ev) => frame.addEventListener(ev, (e) => { e.preventDefault(); frame.classList.remove('dragging'); $('drop').hidden = true; }));
frame.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));
canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  engine.setPointer(((e.clientX - r.left) / r.width - 0.5) * 2, ((e.clientY - r.top) / r.height - 0.5) * 2);
});
canvas.addEventListener('pointerleave', () => engine.setPointer(0, 0));

/* ---------------- render loop ---------------- */
let last = performance.now(), fpsAvg = 60, hudTick = 0, clock = 0;
let onFrame = null; // export hooks in here

function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (dt > 0) fpsAvg += (1 / dt - fpsAvg) * 0.08;
  clock += dt;

  if (state.src === 'demo') {
    if (state.playing) state.demoT = (state.demoT + dt) % (state.recording ? 1e9 : demo.duration);
    demo.draw(state.demoT);
  }

  if (state.subject !== 'off') {
    const src = state.src === 'video' ? video : demo.canvas;
    const m = mask.update(src, position());
    if (m) engine.setMask(m.data, m.w, m.h);
  }

  engine.render(clock);

  const d = duration();
  if (!scrubbing && d) $('seek').value = Math.min(1000, (position() / d) * 1000);
  $('time').textContent = fmtTime(position());

  if ((hudTick += dt) > 0.5) {
    hudTick = 0;
    $('count').textContent = engine.particleCount.toLocaleString() + ' particles';
    $('fps').textContent = Math.round(fpsAvg) + ' fps';
    $('total').textContent = `${engine.particleCount.toLocaleString()} pieces in total at ${canvas.width}×${canvas.height}.`;
  }
  onFrame?.();
}
requestAnimationFrame(tick);

/* ---------------- export ---------------- */
function pickMime() {
  const list = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return list.find((m) => MediaRecorder.isTypeSupported(m));
}
const safeName = (s) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'pollen-render';
let lastResultUrl = null, cancelled = false;

async function renderVideo() {
  if (state.recording) return;
  if (!window.MediaRecorder || !canvas.captureStream) { toast('This browser can’t record video from the canvas. Try Chrome, Edge or Firefox.', 'err'); return; }
  const mime = pickMime();
  if (!mime) { toast('No supported video format found in this browser.', 'err'); return; }
  const isVideo = state.src === 'video';
  if (isVideo && !(video.duration > 0)) { toast('Wait for the video to finish loading.', 'err'); return; }

  state.recording = true; cancelled = false;
  $('panel').inert = true;
  for (const id of ['export', 'still', 'file', 'demo-btn']) $(id).disabled = true;
  $('result').hidden = true;
  $('rendering').hidden = false;
  $('r-title').textContent = 'Rendering';
  $('r-sub').textContent = 'Keep this tab open and visible.';
  $('r-bar').style.width = '0%';
  sizeCanvas();

  const fps = state.fps;
  const stream = canvas.captureStream(fps);
  const a = isVideo ? ensureAudio() : null;
  if (a) {
    a.ctx.resume?.();
    a.dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    a.mon.gain.value = 0; // don't blast the speakers while recording
  }
  const bps = Math.min(40e6, Math.round(canvas.width * canvas.height * fps * 0.25));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bps, audioBitsPerSecond: 192000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise((res) => { rec.onstop = res; });

  // restart from the beginning
  const wasLoop = video.loop;
  if (isVideo) {
    video.loop = false; video.pause();
    await new Promise((res) => { video.onseeked = res; video.currentTime = 0; setTimeout(res, 800); });
    video.onseeked = null;
  } else state.demoT = 0;
  mask.reset();

  const total = duration();
  let finished = false;
  const finish = () => { if (!finished) { finished = true; rec.state !== 'inactive' && rec.stop(); } };

  rec.start(1000);
  state.playing = true; paintTransport();
  if (isVideo) { try { await video.play(); } catch { finish(); } }

  onFrame = () => {
    const p = Math.min(1, position() / total);
    $('r-bar').style.width = (p * 100).toFixed(1) + '%';
    $('r-sub').textContent = `${Math.round(p * 100)}% · ${fmtTime(position())} of ${fmtTime(total)} · keep this tab visible`;
    if (cancelled || (isVideo ? video.ended : state.demoT >= total - 0.05)) finish();
  };
  $('r-cancel').onclick = () => { cancelled = true; finish(); };

  await stopped;
  onFrame = null;
  stream.getTracks().forEach((t) => t.stop());
  video.loop = wasLoop;
  if (audio) audio.mon.gain.value = state.muted ? 0 : 1;
  state.recording = false;
  $('panel').inert = false;
  for (const id of ['export', 'still', 'file', 'demo-btn']) $(id).disabled = false;
  $('rendering').hidden = true;
  if (isVideo) { video.currentTime = 0; video.play().catch(() => {}); }

  if (cancelled) { toast('Render cancelled.'); return; }
  const type = mime.split(';')[0];
  const blob = new Blob(chunks, { type });
  if (!blob.size) { toast('The render came out empty. Try a lower quality setting.', 'err'); return; }
  showResult(blob, type, total);
}

async function showResult(blob, type, dur) {
  if (lastResultUrl) URL.revokeObjectURL(lastResultUrl);
  lastResultUrl = URL.createObjectURL(blob);
  const ext = type === 'video/mp4' ? 'mp4' : 'webm';
  const title = `${state.name} – ${FORMS[state.cfg.form].label}`;
  $('r-video').src = lastResultUrl;
  $('r-name').textContent = title;
  $('r-meta').textContent = `${canvas.width}×${canvas.height} · ${fmtTime(dur)} · ${fmtBytes(blob.size)} · ${ext.toUpperCase()}`;
  const dl = $('r-dl');
  dl.href = lastResultUrl; dl.download = `${safeName(title)}.${ext}`;
  $('result').hidden = false;
  $('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const msg = $('r-save');

  if (!$('save-lib').checked) { msg.textContent = ''; msg.className = 'msg'; return; }
  msg.textContent = 'Saving to My videos…'; msg.className = 'msg';
  const q = new URLSearchParams({ title, form: state.cfg.form, w: canvas.width, h: canvas.height, d: dur.toFixed(2) });
  try {
    await api('/exports?' + q, { method: 'POST', raw: blob, headers: { 'Content-Type': type } });
    msg.innerHTML = 'Saved. Find it in <a href="library.html">My videos</a>.'; msg.className = 'msg ok';
  } catch (e) {
    msg.textContent = `Couldn’t save a copy: ${e.message} You can still download it.`; msg.className = 'msg err';
  }
}

$('export').addEventListener('click', renderVideo);
$('still').addEventListener('click', async () => {
  engine.render(clock);
  const blob = await engine.snapshot();
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${safeName(state.name)}-${state.cfg.form}.png` });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.recording) toast('Tab hidden: the render pauses until you come back.', 'err');
});
window.addEventListener('beforeunload', (e) => { if (state.recording) { e.preventDefault(); e.returnValue = ''; } });
