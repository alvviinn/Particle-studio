// A procedurally drawn clip, used on the landing page, behind the sign-in form,
// and as a built-in sample in the studio so there is always something to play with.

export function createDemoSource(w = 960, h = 540) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d');

  const orbs = [
    { c: '#ff5a36', r: 0.13, ax: 0.30, ay: 0.26, sp: 0.55, ph: 0.0 },
    { c: '#ffb52e', r: 0.10, ax: 0.38, ay: 0.20, sp: -0.42, ph: 1.7 },
    { c: '#ff3d7f', r: 0.12, ax: 0.22, ay: 0.32, sp: 0.38, ph: 3.1 },
    { c: '#2fd4c0', r: 0.08, ax: 0.42, ay: 0.30, sp: -0.65, ph: 4.4 },
    { c: '#fff1d6', r: 0.07, ax: 0.18, ay: 0.16, sp: 0.8, ph: 5.2 },
  ];

  function draw(t) {
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#0c0610';
    g.fillRect(0, 0, w, h);

    // low sun
    const sx = w * 0.5, sy = h * (0.58 + Math.sin(t * 0.3) * 0.02);
    const sun = g.createRadialGradient(sx, sy, 0, sx, sy, h * 0.62);
    sun.addColorStop(0, 'rgba(255,196,90,0.95)');
    sun.addColorStop(0.35, 'rgba(255,92,54,0.6)');
    sun.addColorStop(1, 'rgba(120,20,70,0)');
    g.fillStyle = sun;
    g.fillRect(0, 0, w, h);

    // orbs
    g.globalCompositeOperation = 'lighter';
    for (const o of orbs) {
      const a = t * o.sp + o.ph;
      const x = w / 2 + Math.cos(a) * o.ax * w;
      const y = h / 2 + Math.sin(a * 1.3) * o.ay * h;
      const r = o.r * h * (1 + Math.sin(t * 1.4 + o.ph) * 0.12);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, o.c);
      gr.addColorStop(0.7, o.c + 'cc');
      gr.addColorStop(1, o.c + '00');
      g.fillStyle = gr;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }

    // spinning ring
    g.globalCompositeOperation = 'source-over';
    g.save();
    g.translate(w / 2, h / 2);
    g.rotate(t * 0.5);
    g.lineWidth = h * 0.035;
    const ring = g.createLinearGradient(-h * 0.3, 0, h * 0.3, 0);
    ring.addColorStop(0, '#ffe3a1'); ring.addColorStop(1, '#ff4b6e');
    g.strokeStyle = ring;
    g.beginPath(); g.arc(0, 0, h * (0.3 + Math.sin(t) * 0.015), 0.3, Math.PI * 1.55); g.stroke();
    g.restore();

    // word mark, so you can watch a clean shape turn into particles
    g.save();
    g.translate(w / 2, h / 2 + h * 0.03);
    const s = 1 + Math.sin(t * 0.9) * 0.025;
    g.scale(s, s);
    g.font = `900 ${Math.round(h * 0.27)}px Fraunces, Georgia, serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const tg = g.createLinearGradient(-w * 0.25, -h * 0.1, w * 0.25, h * 0.1);
    tg.addColorStop(0, '#fff4dc'); tg.addColorStop(1, '#ffc15a');
    g.fillStyle = tg;
    g.fillText('pollen', 0, 0);
    g.restore();
  }

  draw(0);
  return { canvas, draw, duration: 12 };
}
