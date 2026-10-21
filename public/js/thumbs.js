// Renders one still of the demo clip per form, so previews are the real thing.
import { ParticleEngine } from './engine.js';
import { FORMS } from './forms.js';
import { createDemoSource } from './demo.js';

export function renderFormThumbs({ width = 640, height = 360, type = 'image/jpeg' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const engine = new ParticleEngine(canvas);
  const demo = createDemoSource(640, 360);
  demo.draw(3.2);
  engine.setSource(demo.canvas);
  const out = {};
  for (const [key, form] of Object.entries(FORMS)) {
    engine.setConfig({ form: key, ...form.defaults, drift: 0.4, background: 'plum' });
    engine.render(3.2);
    out[key] = canvas.toDataURL(type, 0.88);
  }
  engine.gl.getExtension('WEBGL_lose_context')?.loseContext();
  return out;
}
