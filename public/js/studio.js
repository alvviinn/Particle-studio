import { api, fmtBytes, fmtTime } from './api.js';
import { mountNav, toast } from './nav.js';
import { ParticleEngine } from './engine.js';
import { FORMS, KINDS, PALETTES, BACKGROUNDS, DEFAULT_FORM } from './forms.js';
import { createDemoSource } from './demo.js';
import { SubjectMask } from './mask.js';
import { DepthAI } from './depth.js';
import { renderFormThumbs } from './thumbs.js';

const $ = (id) => document.getElementById(id);
const user = await mountNav('studio');
if (!user) location.href = 'auth.html?next=studio';

const canvas = $('view');
const frame = $('frame');
let stereo = false;      // side-by-side for phone headsets
const video = document.createElement('video');
video.playsInline = true; video.loop = true; video.preload = 'auto';

let engine;
try { engine = new ParticleEngine(canvas); }
catch (e) { document.querySelector('.studio').innerHTML = `<div class="card"><h2>This browser can’t run the studio</h2><p class="muted">${e.message} Try a current version of Chrome, Edge, Firefox or Safari.</p></div>`; throw e; }

const demo = createDemoSource(1280, 720);
const mask = new SubjectMask();
const depthAI = new DepthAI();
depthAI.onUpdate = (d) => engine.setDepth(d);

/* ---------------- state ---------------- */
const initial = new URLSearchParams(location.search).get('look');
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
engine.setSource(demo.canvas, demo.depthCanvas);

const set = (patch) => { Object.assign(state.cfg, patch); engine.setConfig(patch); };
const kind = () => FORMS[state.cfg.form].kind;

/* ---------------- controls ---------------- */
const pct = (v) => Math.round(v * 100) + '%';
const SLIDERS = {
  'sl-particles': [
    ['density', 'Density', 20, 600, 10, (v) => `${v}k`],
    ['layers', 'Depth layers', 1, 4, 1, (v) => `${v}×`],
    ['abstract', 'Abstraction', 0, 1, 0.01, pct],
    ['size', 'Piece size', 0.3, 8, 0.05, (v) => v.toFixed(2)],
    ['depth', 'Depth', 0, 1.5, 0.01, (v) => v.toFixed(2)],
    ['motion', 'Movement', 0, 2, 0.01, (v) => v.toFixed(2)],
    ['speed', 'Speed', 0, 3, 0.05, (v) => v.toFixed(2) + '×'],
  ],
  'sl-toon': [
    ['lines', 'Line weight', 0, 3, 0.05, (v) => v.toFixed(2)],
    ['bands', 'Shading steps', 2, 8, 1, (v) => String(v)],
    ['smooth', 'Paint smoothing', 0, 1, 0.01, pct],
    ['boil', 'Line wobble', 0, 2, 0.05, (v) => v.toFixed(2)],
    ['glow', 'Glow', 0, 1.5, 0.01, pct],
    ['extras', 'Effects (sparkles, petals)', 0, 1, 0.01, pct],
  ],
  'sl-imm': [
    ['pop', 'Depth pop', 0, 1.5, 0.01, (v) => v.toFixed(2)],
    ['wrap', 'Wrap around you', 0, 1, 0.01, pct],
    ['swarm', 'Floating pieces', 0, 1.5, 0.01, pct],
    ['ambient', 'Light spill', 0, 1.5, 0.01, pct],
    ['tour', 'Auto-tour when idle', 0, 1.5, 0.01, pct],
  ],
  'sl-colour': [
    ['sat', 'Saturation', 0, 2, 0.01, (v) => v.toFixed(2)],
    ['bright', 'Brightness', 0.4, 2, 0.01, (v) => v.toFixed(2)],
    ['cutoff', 'Hide darkest areas', 0, 0.5, 0.01, (v) => v.toFixed(2), 'particles'],
  ],
  'sl-subject': [['bgKeep', 'Keep background', 0, 1, 0.01, pct, 'particles']],
  'sl-camera': [['drift', 'Camera drift', 0, 1.5, 0.01, (v) => v.toFixed(2)]],
};
const sliderEls = {};
for (const [host, defs] of Object.entries(SLIDERS)) {
  for (const [key, label, min, max, step, fmt, only] of defs) {
    const wrap = document.createElement('div');
    wrap.className = 'slider';
    if (only) wrap.dataset.kind = only;
    wrap.innerHTML = `<label for="s-${key}">${label}</label><output id="o-${key}"></output><input type="range" id="s-${key}" min="${min}" max="${max}" step="${step}">`;
    $(host).append(wrap);
    const input = wrap.querySelector('input'), out = wrap.querySelector('output');
    sliderEls[key] = { input, out, fmt };
    input.addEventListener('input', () => { set({ [key]: +input.value }); out.textContent = fmt(+input.value); });
  }
}
function syncSliders() {
  for (const [key, { input, out, fmt }] of Object.entries(sliderEls)) {
    if (state.cfg[key] === undefined) continue;
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
  [{ key: 'artistic', label: 'Artistic' }, { key: 'original', label: 'Original' }, { key: 'gradient', label: 'Gradient' }, { key: 'scatter', label: 'Scatter' }],
  state.cfg.color, (k) => set({ color: k }));
const markPalette = radioGroup('palettes',
  Object.entries(PALETTES).map(([key, p]) => ({
    key, title: p.label, cls: 'sw',
    style: `linear-gradient(90deg, ${p.stops.join(',')})`,
  })), state.cfg.palette, (k) => {
    const patch = { palette: k };
    if (state.cfg.color === 'original') { patch.color = 'artistic'; markColor('artistic'); }
    set(patch);
  });
radioGroup('backdrops',
  Object.entries(BACKGROUNDS).map(([key, b]) => ({ key, title: b.label, cls: 'sw round', style: b.color })),
  state.cfg.background, (k) => set({ background: k }));

const markHold = radioGroup('seg-hold',
  [{ key: 0, label: 'Smooth' }, { key: 24, label: '24' }, { key: 12, label: '12' }, { key: 8, label: '8' }],
  12, (k) => set({ hold: k }));
const markSkin = radioGroup('seg-skin',
  [{ key: 'original', label: 'Original' }, { key: 'toon', label: 'Toon' }, { key: 'anime', label: 'Anime' }, { key: 'kungfu', label: 'Kung Fu' }],
  'original', (k) => set({ skin: k }));

/* depth source for the immersive mode */
const DEPTH_HINT = {
  auto: 'Smart: estimates depth from the picture on the fly (the sample clip has an exact depth map).',
  ai: 'AI: a depth model runs on your device for real 3D. Downloads about 27–50 MB once.',
};
const markDepth = radioGroup('seg-depth',
  [{ key: 'auto', label: 'Smart' }, { key: 'ai', label: 'AI depth' }],
  'auto', async (k) => {
    set({ depthSrc: k });
    $('depth-hint').textContent = DEPTH_HINT[k];
    if (k !== 'ai' || depthAI.ready) return;
    try {
      $('depth-hint').textContent = 'Loading the depth model…';
      const device = await depthAI.load((p) => { $('depth-hint').textContent = `Downloading the depth model… ${Math.round(p * 100)}%`; });
      $('depth-hint').textContent = device === 'webgpu'
        ? 'AI depth is on, running on your graphics card.'
        : 'AI depth is on. Your browser has no WebGPU, so it runs on the processor and updates a few times a second.';
    } catch (e) {
      toast(`Couldn’t start AI depth (${e.message}). Using Smart depth.`, 'err');
      set({ depthSrc: 'auto' }); markDepth('auto'); $('depth-hint').textContent = DEPTH_HINT.auto;
    }
  });
$('depth-hint').textContent = DEPTH_HINT.auto;

const SUBJECT_HINT = {
  off: 'Particles cover the whole frame.',
  motion: 'Best with a steady camera: whatever moves becomes the subject.',
  person: 'Finds people with an on-device model. The first use downloads a small file.',
};
const subjectHint = (k) => (kind() === 'immersive' && k !== 'off' ? 'The subject is pulled toward you in the 3D room (used by Smart depth).' : SUBJECT_HINT[k]);
const markSubject = radioGroup('seg-subject',
  [{ key: 'off', label: 'Off' }, { key: 'motion', label: 'Motion' }, { key: 'person', label: 'Person' }],
  'off', async (k) => {
    state.subject = k;
    $('subject-hint').textContent = subjectHint(k);
    $('sl-subject').hidden = k === 'off';
    if (k === 'off') { engine.clearMask(); mask.setMode('off'); return; }
    if (k === 'person') $('subject-hint').textContent = 'Loading the person detector…';
    try { await mask.setMode(k); $('subject-hint').textContent = subjectHint(k); }
    catch {
      toast('Couldn’t load the person detector (are you offline?). Using motion instead.', 'err');
      state.subject = 'motion'; markSubject('motion');
      $('subject-hint').textContent = subjectHint('motion');
    }
  });
$('subject-hint').textContent = SUBJECT_HINT.off;
$('sl-subject').hidden = true;

/* look picker: real renders of the sample as thumbnails, grouped by kind */
let thumbs = {};
try { thumbs = renderFormThumbs({ width: 240, height: 240 }); } catch { /* tiles just show labels */ }
const tiles = $('tiles');
for (const [k, info] of Object.entries(KINDS)) {
  const head = document.createElement('p');
  head.className = 'label tiles-head'; head.textContent = info.label;
  const grid = document.createElement('div');
  grid.className = 'tiles';
  for (const [key, f] of Object.entries(FORMS)) {
    if (f.kind !== k) continue;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tile' + (k === 'immersive' ? ' wide' : ''); b.setAttribute('role', 'radio'); b.dataset.k = key;
    b.innerHTML = `${thumbs[key] ? `<img alt="" src="${thumbs[key]}">` : ''}<span>${f.label}</span>`;
    b.addEventListener('click', () => pickForm(key));
    grid.append(b);
  }
  tiles.append(head, grid);
}

function showKind(k) {
  document.querySelectorAll('#panel [data-kind]').forEach((el) => { el.hidden = !el.dataset.kind.split(' ').includes(k); });
  frame.classList.toggle('immersive', k === 'immersive');
  $('subject-hint').textContent = subjectHint(state.subject);
  $('hud-keys').hidden = k !== 'immersive';
}

function pickForm(key) {
  const f = FORMS[key];
  const keep = { background: state.cfg.background, drift: state.cfg.drift };
  state.cfg = { form: key, ...f.defaults, ...keep };
  engine.setConfig(state.cfg);
  tiles.querySelectorAll('.tile').forEach((t) => t.setAttribute('aria-checked', String(t.dataset.k === key)));
  $('form-blurb').textContent = f.blurb;
  if (f.kind === 'particles') { markColor(state.cfg.color); markPalette(state.cfg.palette); }
  if (f.kind === 'toon') markHold(state.cfg.hold);
  if (f.kind === 'immersive') { markSkin(state.cfg.skin); markDepth('auto'); $('depth-hint').textContent = DEPTH_HINT.auto; }
  if (f.kind !== 'immersive' && stereo) toggleStereo(false);
  showKind(f.kind);
  syncSliders();
}

$('res').addEventListener('change', (e) => { state.res = +e.target.value; sizeCanvas(); });
$('fps-sel').addEventListener('change', (e) => { state.fps = +e.target.value; });

/* ---------------- sizing ---------------- */
function srcAspect() {
  return state.src === 'video' && video.videoWidth ? video.videoWidth / video.videoHeight : demo.canvas.width / demo.canvas.height;
}
function sizeCanvas() {
  // fullscreen immersive fills the screen; everything else matches the clip
  if (document.fullscreenElement === frame && !state.recording) {
    const d = Math.min(2, devicePixelRatio || 1);
    engine.resize(Math.round(innerWidth * d / 2) * 2, Math.round(innerHeight * d / 2) * 2);
    canvas.style.aspectRatio = '';
    return;
  }
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
    engine.setDepth(null);
    mask.reset();
    sizeCanvas();
    $('src-name').textContent = `${file.name} · ${video.videoWidth}×${video.videoHeight} · ${fmtTime(video.duration)} · ${fmtBytes(file.size)}`;
    setPlaying(true);
  };
  video.onerror = () => {
    toast('Your browser can’t play that file. Try an MP4 (H.264) or WebM.', 'err');
  };
  video.src = objectUrl;
  video.load();
}
$('file').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
$('demo-btn').addEventListener('click', () => {
  if (state.recording) return;
  video.pause(); state.src = 'demo'; state.name = 'Sample clip'; state.demoT = 0;
  engine.setSource(demo.canvas, demo.depthCanvas); engine.setDepth(null); mask.reset(); sizeCanvas();
  $('src-name').textContent = 'Built-in sample, 12 seconds, no sound.';
  setPlaying(true);
});
['dragenter', 'dragover'].forEach((ev) => frame.addEventListener(ev, (e) => { e.preventDefault(); frame.classList.add('dragging'); $('drop').hidden = false; }));
['dragleave', 'drop'].forEach((ev) => frame.addEventListener(ev, (e) => { e.preventDefault(); frame.classList.remove('dragging'); $('drop').hidden = true; }));
frame.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));

/* ---------------- pointer, keys and devices ---------------- */
const hudKeys = Object.assign(document.createElement('div'), { id: 'hud-keys', className: 'hud-keys', hidden: true });
hudKeys.innerHTML = '<span>Drag to look</span><span>Scroll / WASD to move</span><span>Click to ripple</span>';
frame.append(hudKeys);

const ndc = (e) => {
  const r = canvas.getBoundingClientRect();
  let x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  if (stereo) x = (x * 2) % 1; // either eye
  return [x * 2 - 1, 1 - y * 2];
};
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (kind() !== 'immersive') return;
  drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId };
  canvas.setPointerCapture(e.pointerId);
  canvas.focus({ preventScroll: true });
});
canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  if (kind() !== 'immersive') {
    engine.setPointer(((e.clientX - r.left) / r.width - 0.5) * 2, ((e.clientY - r.top) / r.height - 0.5) * 2);
    return;
  }
  if (drag && drag.id === e.pointerId) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.x = e.clientX; drag.y = e.clientY;
    const k = 2.2 / r.height;
    engine.immersive.look(dx * k, dy * k);
  } else engine.immersive.hover(...ndc(e));
});
canvas.addEventListener('pointerup', (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  if (drag.moved < 6) engine.immersive.ripple(...ndc(e));
  drag = null;
});
canvas.addEventListener('pointercancel', () => { drag = null; });
canvas.addEventListener('pointerleave', () => { engine.setPointer(0, 0); if (kind() === 'immersive') engine.immersive.leave(); });
canvas.addEventListener('dblclick', () => { if (kind() === 'immersive') engine.immersive.reset(); });
canvas.addEventListener('wheel', (e) => {
  if (kind() !== 'immersive') return;
  e.preventDefault();
  engine.immersive.move(-e.deltaY * 0.0025, 0, 0);
}, { passive: false });
// two-finger pinch walks forward/back on touch screens
const touches = new Map();
let pinch = null;
canvas.addEventListener('touchstart', (e) => { for (const t of e.changedTouches) touches.set(t.identifier, t); if (touches.size === 2) { const [a, b] = [...touches.values()]; pinch = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); drag = null; } }, { passive: true });
canvas.addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches) touches.set(t.identifier, t);
  if (touches.size === 2 && pinch && kind() === 'immersive') {
    const [a, b] = [...touches.values()];
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    engine.immersive.move((d - pinch) * 0.01, 0, 0); pinch = d;
  }
}, { passive: true });
canvas.addEventListener('touchend', (e) => { for (const t of e.changedTouches) touches.delete(t.identifier); if (touches.size < 2) pinch = null; }, { passive: true });

const keys = new Set();
const KEYS = ['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
addEventListener('keydown', (e) => {
  if (kind() !== 'immersive' || e.target.closest?.('input, select, textarea')) return;
  if (!frame.matches(':hover') && document.activeElement !== canvas && !document.fullscreenElement) return;
  const k = e.key.toLowerCase();
  if (KEYS.includes(k)) { keys.add(k); e.preventDefault(); }
  if (k === 'r') engine.immersive.reset();
  if (k === ' ') { e.preventDefault(); engine.immersive.ripple(); }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());
function applyKeys(dt) {
  if (!keys.size || kind() !== 'immersive') return;
  const on = (...k) => (k.some((x) => keys.has(x)) ? 1 : 0);
  const sp = 1.6 * dt;
  engine.immersive.move((on('w', 'arrowup') - on('s', 'arrowdown')) * sp, (on('d') - on('a')) * sp, (on('e') - on('q')) * sp);
  const turn = on('arrowright') - on('arrowleft');
  if (turn) engine.immersive.look(turn * dt * 1.4, 0);
}

// fullscreen
const fsTarget = frame;
$('b-full').addEventListener('click', () => fsTarget.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => toast('Fullscreen isn’t available here.', 'err')));
$('fs-exit').addEventListener('click', () => document.exitFullscreen?.());
document.addEventListener('fullscreenchange', () => {
  $('fs-exit').hidden = document.fullscreenElement !== frame;
  sizeCanvas();
  if (document.fullscreenElement === frame) canvas.focus({ preventScroll: true });
});
addEventListener('resize', () => { if (document.fullscreenElement) sizeCanvas(); });

// side-by-side stereo for phone headsets
function toggleStereo(on = !stereo) {
  stereo = on; engine.stereo = on;
  $('b-stereo').setAttribute('aria-pressed', String(on));
  if (on && !document.fullscreenElement) fsTarget.requestFullscreen?.().catch(() => {});
}
$('b-stereo').addEventListener('click', () => toggleStereo());

// look around by moving the phone
let gyro = false;
const onOrient = (e) => engine.immersive.setOrientation({ alpha: e.alpha, beta: e.beta, gamma: e.gamma, screen: screen.orientation?.angle ?? window.orientation ?? 0 });
if ('DeviceOrientationEvent' in window && matchMedia('(pointer: coarse)').matches) $('b-gyro').hidden = false;
$('b-gyro').addEventListener('click', async () => {
  if (!gyro) {
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function' && (await DeviceOrientationEvent.requestPermission()) !== 'granted') throw new Error('denied');
      addEventListener('deviceorientation', onOrient);
      gyro = true;
    } catch { toast('Motion sensors weren’t allowed.', 'err'); return; }
  } else {
    removeEventListener('deviceorientation', onOrient);
    engine.immersive.setOrientation(null);
    gyro = false;
  }
  $('b-gyro').setAttribute('aria-pressed', String(gyro));
});

// real VR headsets
ParticleEngine.vrSupported().then((ok) => { $('b-vr').hidden = !ok; });
$('b-vr').addEventListener('click', async () => {
  if (engine.xr) { engine.exitVR(); return; }
  try {
    if (state.src === 'video') { ensureAudio(); video.play().catch(() => {}); }
    await engine.enterVR((dt) => update(dt), () => { $('b-vr').textContent = 'VR headset (optional)'; });
    $('b-vr').textContent = 'Exit VR';
  } catch (e) { toast(`Couldn’t start VR: ${e.message}`, 'err'); }
});
$('b-reset').addEventListener('click', () => engine.immersive.reset());

/* ---------------- render loop ---------------- */
let last = performance.now(), fpsAvg = 60, hudTick = 0, clock = 0;
let onFrame = null; // export hooks in here

// per-frame work that also has to run inside a VR session
function update(dt) {
  clock += dt;
  if (state.src === 'demo') {
    if (state.playing) state.demoT = (state.demoT + dt) % (state.recording ? 1e9 : demo.duration);
    demo.draw(state.demoT);
  }
  const src = state.src === 'video' ? video : demo.canvas;
  if (state.subject !== 'off' && kind() !== 'toon') {
    const m = mask.update(src, position());
    if (m) engine.setMask(m.data, m.w, m.h);
  }
  if (kind() === 'immersive' && state.cfg.depthSrc === 'ai') depthAI.feed(src);
  applyKeys(dt);
}

function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.max(0, Math.min(0.25, (now - last) / 1000));
  last = now;
  if (engine.xr) return; // the headset drives frames
  if (dt > 0) fpsAvg += (1 / dt - fpsAvg) * 0.08;
  update(dt);
  engine.render(clock);

  const d = duration();
  if (!scrubbing && d) $('seek').value = Math.min(1000, (position() / d) * 1000);
  $('time').textContent = fmtTime(position());

  if ((hudTick += dt) > 0.5) {
    hudTick = 0;
    const n = engine.particleCount;
    $('count').textContent = kind() === 'toon' ? `${FORMS[state.cfg.form].label} · ${state.cfg.hold ? state.cfg.hold + ' drawings/s' : 'smooth'}` : n.toLocaleString() + (kind() === 'immersive' ? ' floating pieces' : ' particles');
    $('fps').textContent = Math.round(fpsAvg) + ' fps';
    $('total').textContent = `${engine.particleCount.toLocaleString()} pieces in total at ${canvas.width}×${canvas.height}.`;
  }
  onFrame?.();
}

pickForm(FORMS[initial] ? initial : DEFAULT_FORM);
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
