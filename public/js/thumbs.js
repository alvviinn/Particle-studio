// Renders one still of the sample clip per look, so previews are the real thing.
import { ParticleEngine } from './engine.js';
import { FORMS } from './forms.js';
import { createDemoSource } from './demo.js';

export function renderFormThumbs({ width = 640, height = 360, type = 'image/jpeg' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const engine = new ParticleEngine(canvas);
  const demo = createDemoSource(640, 360);
  demo.draw(3.2);
  engine.setSource(demo.canvas, demo.depthCanvas);
  const out = {};
  for (const [key, form] of Object.entries(FORMS)) {
    engine.setConfig({ form: key, ...form.defaults, drift: 0.4, background: 'plum' });
    // the 3D room eases its camera in, so give it a few frames
    const n = form.kind === 'immersive' ? 30 : 1;
    for (let i = 0; i < n; i++) engine.render(3.2 + i / 30);
    out[key] = canvas.toDataURL(type, 0.88);
  }
  engine.gl.getExtension('WEBGL_lose_context')?.loseContext();
  return out;
}
