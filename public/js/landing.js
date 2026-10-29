import { mountNav, footer } from './nav.js';
import { ParticleEngine } from './engine.js';
import { FORMS } from './forms.js';
import { createDemoSource } from './demo.js';
import { renderFormThumbs } from './thumbs.js';

mountNav('');
footer();

const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const glow = $('glow');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => x * x * (3 - 2 * x);

/* ---------- scroll chapters: each pins for data-len screens ---------- */
const chapters = [...document.querySelectorAll('.chapter')].map((el) => {
  el.style.height = `${(+el.dataset.len || 2) * 100}vh`;
  return { el, id: el.id, p: 0 };
});
const solid = document.querySelector('.solid');
function measure() {
  const vh = innerHeight;
  let active = null;
  for (const c of chapters) {
    const r = c.el.getBoundingClientRect();
    c.p = clamp01(-r.top / Math.max(1, r.height - vh));
    if (r.top <= vh * 0.5 && r.bottom > vh * 0.5) active = c;
  }
  return { active: active || chapters[0], hidden: solid.getBoundingClientRect().top <= 0 };
}

/* ---------- the stage ---------- */
let engine = null;
try { engine = new ParticleEngine(canvas); } catch { document.body.classList.add('no-gl'); }
const demo = createDemoSource(1280, 720);

function sizeStage() {
  const d = Math.min(1.5, devicePixelRatio || 1);
  let w = innerWidth * d, h = innerHeight * d;
  const k = Math.min(1, Math.sqrt(2.4e6 / (w * h)));
  engine?.resize(Math.round(w * k), Math.round(h * k));
}
addEventListener('resize', sizeStage);
sizeStage();

const GLOW = {
  hero: ['#ff4d2e', '#7b2fff'],
  toon: ['#7dff3b', '#00c2ff'],
  anime: ['#ff4fd8', '#4c6bff'],
  kungfu: ['#ffb21b', '#ff4d2e'],
  immersive: ['#2bf0ff', '#7b2fff'],
};
let glowKey = '';
function setGlow(k) {
  if (k === glowKey) return;
  glowKey = k;
  glow.style.setProperty('--g1', GLOW[k][0]);
  glow.style.setProperty('--g2', GLOW[k][1]);
}

let current = '';
function use(form, extra = {}) {
  if (current !== form) {
    current = form;
    engine.setConfig({ form, ...FORMS[form].defaults, background: 'black', drift: 0.5, ...extra });
  } else if (Object.keys(extra).length) engine.setConfig(extra);
}

// hero: the clip comes apart as you scroll
function hero(p) {
  const e = ease(p);
  use('particles', {
    density: 140, layers: 2, abstract: 0.2 + e * 0.8, depth: 0.5 + e * 1.0, motion: 0.3 + e * 1.4,
    size: 1.0 + e * 0.6, dolly: e * 1.9, turn: e * 0.7, color: 'original', sat: 1.25, bright: 1.15,
  });
  const t = $('ch-hero').querySelector('.hero-type');
  t.style.opacity = String(1 - clamp01(p * 3));
  t.style.transform = `translateY(${-p * 120}px) scale(${1 - p * 0.15})`;
  $('cue').style.opacity = String(1 - clamp01(p * 8));
  $('hero-bar').style.transform = `scaleX(${p})`;
  const items = [...$('hero-callouts').children];
  items.forEach((li, i) => {
    const at = +li.dataset.at, next = items[i + 1] ? +items[i + 1].dataset.at : 1.05;
    li.classList.toggle('on', p >= at && p < next);
  });
  setGlow('hero');
}

// animate: one style per third of the chapter
const styleEls = [...$('styles').children];
const meter = [...$('style-meter').children];
function animate(p) {
  const i = Math.min(2, Math.floor(p * 3));
  const k = styleEls[i].dataset.k;
  use(k);
  styleEls.forEach((li, j) => li.classList.toggle('on', j === i));
  meter.forEach((m, j) => m.style.setProperty('--f', String(j < i ? 1 : j > i ? 0 : clamp01(p * 3 - i))));
  setGlow(k);
}

// immersive: the camera walks into the shot
let nextRipple = 0;
function immersive(p, t) {
  use('immersive', { tour: 0, swarm: 0.7, wrap: 0.55, pop: 1.0 });
  const room = engine.immersive;
  const e = ease(p);
  Object.assign(room.cam, { yaw: Math.sin(p * Math.PI * 1.5) * 0.45, pitch: -0.05 + e * 0.08, x: Math.sin(p * Math.PI * 2) * 0.9, y: e * 0.2, z: -e * 2.2 });
  room.idle = 0;
  if (!reduced && t > nextRipple) { room.ripple(); nextRipple = t + 2.8; }
  setGlow('immersive');
}

addEventListener('pointermove', (e) => {
  if (current === 'immersive') engine.immersive.hover((e.clientX / innerWidth) * 2 - 1, 1 - (e.clientY / innerHeight) * 2);
  else engine?.setPointer((e.clientX / innerWidth - 0.5) * 2, (e.clientY / innerHeight - 0.5) * 2);
});
addEventListener('pointerdown', (e) => {
  if (current === 'immersive' && !e.target.closest('a, button')) engine.immersive.ripple((e.clientX / innerWidth) * 2 - 1, 1 - (e.clientY / innerHeight) * 2, 1.4);
});

if (engine) {
  engine.setSource(demo.canvas, demo.depthCanvas);
  const t0 = performance.now();
  const loop = () => {
    requestAnimationFrame(loop);
    if (document.hidden) return;
    const { active, hidden } = measure();
    canvas.classList.toggle('off', hidden);
    glow.classList.toggle('off', hidden);
    if (hidden) return;
    const t = (performance.now() - t0) / 1000;
    if (active.id === 'ch-hero') hero(active.p);
    else if (active.id === 'ch-animate') animate(active.p);
    else immersive(active.p, t);
    demo.draw(t);
    engine.render(t);
  };
  loop();
}

/* ---------- counters ---------- */
const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n.toLocaleString());
const counters = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    counters.unobserve(en.target);
    const el = en.target, to = +el.dataset.count, suf = el.dataset.suffix || '';
    const t0 = performance.now(), dur = reduced ? 0 : 1400;
    const step = (now) => {
      const k = dur ? clamp01((now - t0) / dur) : 1;
      el.textContent = fmt(Math.round(to * (1 - Math.pow(1 - k, 3)))) + suf;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}, { threshold: 0.6 });
document.querySelectorAll('[data-count]').forEach((el) => counters.observe(el));

/* ---------- marquee ---------- */
const names = Object.values(FORMS).map((f) => f.label);
$('marquee').innerHTML = [...names, ...names].map((n, i) => `<span class="${i % 2 ? 'outline' : ''}">${n}</span><i>✺</i>`).join('');

/* ---------- gallery: one real render per look ---------- */
try {
  const thumbs = renderFormThumbs();
  for (const [key, f] of Object.entries(FORMS)) {
    const a = document.createElement('a');
    a.className = 'gal-card reveal' + (f.kind === 'immersive' ? ' wide' : '');
    a.href = `studio.html?look=${key}`;
    a.innerHTML = `<img alt="" width="640" height="360" loading="lazy"><div><small></small><h3></h3><p></p></div>`;
    a.querySelector('img').src = thumbs[key];
    a.querySelector('small').textContent = { particles: 'Particles', toon: 'Animate', immersive: 'Immersive' }[f.kind];
    a.querySelector('h3').textContent = f.label;
    a.querySelector('p').textContent = f.blurb;
    $('gallery').append(a);
  }
} catch { /* no WebGL: the gallery stays empty */ }

/* ---------- reveal on scroll ---------- */
const rev = new IntersectionObserver((entries) => {
  for (const en of entries) if (en.isIntersecting) { en.target.classList.add('in'); rev.unobserve(en.target); }
}, { threshold: 0.15 });
document.querySelectorAll('.reveal, .how-step, .finale .line, .stat-grid > div, .gal-head').forEach((el) => rev.observe(el));
