import { mountNav, footer } from './nav.js';
import { ParticleEngine } from './engine.js';
import { FORMS } from './forms.js';
import { createDemoSource } from './demo.js';
import { renderFormThumbs } from './thumbs.js';

mountNav('');
footer();

const canvas = document.getElementById('hero');
const chips = document.getElementById('chips');
const grid = document.getElementById('forms-grid');

let engine;
try {
  engine = new ParticleEngine(canvas);
} catch (e) {
  canvas.replaceWith(Object.assign(document.createElement('p'), { className: 'muted', textContent: e.message }));
}

if (engine) {
  const demo = createDemoSource(960, 540);
  engine.setSource(demo.canvas);
  const pick = (key) => {
    engine.setConfig({ form: key, ...FORMS[key].defaults, density: Math.min(FORMS[key].defaults.density, 160), layers: Math.min(FORMS[key].defaults.layers, 2), drift: 0.9, background: 'plum' });
    chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.k === key)));
  };
  for (const [key, f] of Object.entries(FORMS)) {
    const b = document.createElement('button');
    b.className = 'chip'; b.dataset.k = key; b.textContent = f.label;
    b.addEventListener('click', () => pick(key));
    chips.append(b);
  }
  pick('gas');

  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    engine.setPointer(((e.clientX - r.left) / r.width - 0.5) * 2, ((e.clientY - r.top) / r.height - 0.5) * 2);
  });

  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
  const t0 = performance.now();
  const loop = () => {
    requestAnimationFrame(loop);
    if (!visible || document.hidden) return;
    const t = (performance.now() - t0) / 1000;
    demo.draw(t);
    engine.render(t);
  };
  loop();
}

// Gallery: one real render per form.
try {
  const thumbs = renderFormThumbs();
  for (const [key, f] of Object.entries(FORMS)) {
    const card = document.createElement('article');
    card.className = 'form-card';
    card.innerHTML = `<img alt="" width="640" height="360" loading="lazy"><div><h3></h3><p></p></div>`;
    card.querySelector('img').src = thumbs[key];
    card.querySelector('h3').textContent = f.label;
    card.querySelector('p').textContent = f.blurb;
    grid.append(card);
  }
} catch { grid.textContent = ''; }
