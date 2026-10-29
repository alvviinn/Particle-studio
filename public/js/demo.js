// A procedurally drawn clip, used on the landing page, behind the sign-in form,
// and as a built-in sample in the studio so there is always something to play with.
// A layered valley at dusk: sky, sun, clouds, mountain ridges, a pagoda, a
// blossom tree, rising lanterns. Alongside the colour frame it draws an exact
// depth map (white = near) so the immersive mode has true parallax on the sample.

const TAU = Math.PI * 2;
const LOOP = 12;

// deterministic ridge profile: sum of a few sines
function ridge(seed, x) {
  return Math.sin(x * 1.7 + seed) * 0.5 + Math.sin(x * 3.9 + seed * 2.3) * 0.25
       + Math.sin(x * 8.3 + seed * 5.1) * 0.12 + Math.sin(x * 17.0 + seed * 1.3) * 0.05;
}

const RIDGES = [
  { seed: 1.3, base: 0.6, amp: 0.1, col: ['#b9a0d6', '#e7b6c8'], depth: 0.16, par: 0.02 },
  { seed: 4.1, base: 0.67, amp: 0.09, col: ['#8a6fb3', '#c98fb2'], depth: 0.3, par: 0.05 },
  { seed: 2.7, base: 0.74, amp: 0.08, col: ['#5a4385', '#9a5f95'], depth: 0.46, par: 0.09 },
  { seed: 6.2, base: 0.83, amp: 0.06, col: ['#2f2552', '#5c3863'], depth: 0.62, par: 0.15 },
];

const LANTERNS = Array.from({ length: 9 }, (_, i) => ({
  x: ((i * 0.618) % 1) * 0.9 + 0.05, ph: (i * 0.37) % 1, s: 0.6 + ((i * 0.71) % 1) * 0.8, sw: 0.5 + ((i * 0.53) % 1),
}));
const CLOUDS = [
  { x: 0.18, y: 0.22, s: 1.0, sp: 0.02 }, { x: 0.62, y: 0.14, s: 1.3, sp: 0.014 },
  { x: 0.86, y: 0.3, s: 0.8, sp: 0.025 }, { x: 0.4, y: 0.36, s: 0.7, sp: 0.018 },
];

export function createDemoSource(w = 960, h = 540) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d');
  const depthCanvas = document.createElement('canvas');
  depthCanvas.width = 320; depthCanvas.height = Math.round(320 * h / w);
  const d = depthCanvas.getContext('2d');

  const gray = (v) => { const c = Math.round(Math.max(0, Math.min(1, v)) * 255); return `rgb(${c},${c},${c})`; };

  function draw(t) {
    const lt = (t % LOOP) / LOOP;           // 0..1 loop phase
    const pan = Math.sin(lt * TAU) * 0.5;   // camera pan, seamless
    d.setTransform(depthCanvas.width / w, 0, 0, depthCanvas.height / h, 0, 0);

    // sky
    const sky = g.createLinearGradient(0, 0, 0, h * 0.8);
    sky.addColorStop(0, '#120a36');
    sky.addColorStop(0.35, '#3a1f6e');
    sky.addColorStop(0.62, '#c4467a');
    sky.addColorStop(0.82, '#ff8a4c');
    sky.addColorStop(1, '#ffd38a');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    d.fillStyle = gray(0); d.fillRect(0, 0, w, h);

    // stars
    g.fillStyle = 'rgba(255,240,255,0.8)';
    for (let i = 0; i < 70; i++) {
      const x = ((i * 0.7548 + pan * 0.01) % 1) * w, y = ((i * 0.5698) % 1) * h * 0.4;
      const tw = 0.5 + 0.5 * Math.sin(t * 2 + i * 1.7);
      g.globalAlpha = tw * (1 - y / (h * 0.4)); g.fillRect(x, y, 2, 2);
    }
    g.globalAlpha = 1;

    // sun
    const sx = w * (0.52 - pan * 0.03), sy = h * (0.6 + Math.sin(lt * TAU) * 0.015);
    const glow = g.createRadialGradient(sx, sy, 0, sx, sy, h * 0.55);
    glow.addColorStop(0, 'rgba(255,236,170,0.95)');
    glow.addColorStop(0.18, 'rgba(255,170,90,0.6)');
    glow.addColorStop(1, 'rgba(255,80,120,0)');
    g.fillStyle = glow; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff3c4';
    g.beginPath(); g.arc(sx, sy, h * 0.085, 0, TAU); g.fill();
    d.fillStyle = gray(0.03); d.beginPath(); d.arc(sx, sy, h * 0.085, 0, TAU); d.fill();

    // clouds
    for (const c of CLOUDS) {
      const cx = (((c.x + t * c.sp - pan * 0.02) % 1.3) + 1.3) % 1.3 * w - w * 0.15, cy = c.y * h, s = c.s * h * 0.07;
      for (const [ox, oy, r] of [[0, 0, 1], [1.1, 0.2, 0.8], [-1.0, 0.25, 0.75], [0.4, -0.45, 0.7], [2.0, 0.35, 0.55]]) {
        const x = cx + ox * s, y = cy + oy * s, rr = r * s * 1.2;
        const cg = g.createLinearGradient(0, y - rr, 0, y + rr);
        cg.addColorStop(0, '#f3c6e8'); cg.addColorStop(1, '#ff9a8a');
        g.fillStyle = cg; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
        d.fillStyle = gray(0.08); d.beginPath(); d.arc(x, y, rr, 0, TAU); d.fill();
      }
    }

    // birds
    g.strokeStyle = '#2a1640'; g.lineWidth = Math.max(1.5, h * 0.004); g.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const bx = ((lt * 1 + i * 0.13) % 1) * w * 1.2 - w * 0.1, by = h * (0.3 + i * 0.03 + Math.sin(t * 1.5 + i) * 0.01);
      const f = Math.sin(t * 9 + i * 2) * h * 0.012, s = h * 0.016;
      g.beginPath(); g.moveTo(bx - s, by - f); g.quadraticCurveTo(bx - s * 0.4, by - s * 0.3, bx, by); g.quadraticCurveTo(bx + s * 0.4, by - s * 0.3, bx + s, by - f); g.stroke();
    }

    // ridges, far to near, with parallax
    RIDGES.forEach((r, idx) => {
      const off = pan * r.par * 4;
      const path = (ctx) => {
        ctx.beginPath(); ctx.moveTo(0, h);
        for (let i = 0; i <= 96; i++) {
          const x = i / 96;
          ctx.lineTo(x * w, (r.base - r.amp * ridge(r.seed, x * 2.2 + off)) * h);
        }
        ctx.lineTo(w, h); ctx.closePath();
      };
      const top = (r.base - r.amp) * h;
      const rg = g.createLinearGradient(0, top, 0, h);
      rg.addColorStop(0, r.col[1]); rg.addColorStop(0.5, r.col[0]); rg.addColorStop(1, r.col[0]);
      path(g); g.fillStyle = rg; g.fill();
      const dg = d.createLinearGradient(0, top, 0, h);
      dg.addColorStop(0, gray(r.depth)); dg.addColorStop(1, gray(r.depth + 0.06));
      path(d); d.fillStyle = dg; d.fill();

      if (idx === 2) pagoda(w * (0.3 - off * 0.25), (r.base - r.amp * ridge(r.seed, 0.3 * 2.2 + off)) * h + h * 0.01, h * 0.2, r.depth + 0.02);
    });

    // haze over the valley floor
    const hz = g.createLinearGradient(0, h * 0.7, 0, h);
    hz.addColorStop(0, 'rgba(255,170,150,0)'); hz.addColorStop(1, 'rgba(255,150,160,0.35)');
    g.fillStyle = hz; g.fillRect(0, h * 0.7, w, h * 0.3);

    // foreground hill
    const fo = pan * 0.32;
    const hill = (ctx) => {
      ctx.beginPath(); ctx.moveTo(0, h);
      for (let i = 0; i <= 64; i++) { const x = i / 64; ctx.lineTo(x * w, h * (0.9 - 0.07 * Math.sin((x + fo) * 3.1 + 0.6) - 0.03 * Math.sin((x + fo) * 9 + 1))); }
      ctx.lineTo(w, h); ctx.closePath();
    };
    hill(g); g.fillStyle = '#1a1030'; g.fill();
    hill(d); d.fillStyle = gray(0.86); d.fill();

    // blossom tree on the right
    tree(w * (0.82 - fo * 0.3), h * 0.86, h * 0.42, t);

    // lanterns rising
    for (const L of LANTERNS) {
      const p = (lt + L.ph) % 1;
      const x = (L.x + Math.sin(t * L.sw + L.ph * 9) * 0.02 - pan * 0.12 * L.s) * w;
      const y = h * (1.05 - p * 1.1);
      const s = h * 0.03 * L.s, a = Math.sin(p * Math.PI);
      const lg = g.createRadialGradient(x, y, 0, x, y, s * 3);
      lg.addColorStop(0, `rgba(255,200,110,${0.55 * a})`); lg.addColorStop(1, 'rgba(255,120,60,0)');
      g.fillStyle = lg; g.fillRect(x - s * 3, y - s * 3, s * 6, s * 6);
      g.globalAlpha = a;
      g.fillStyle = '#ffb347'; roundRect(g, x - s * 0.55, y - s * 0.8, s * 1.1, s * 1.6, s * 0.35); g.fill();
      g.fillStyle = '#fff0c0'; roundRect(g, x - s * 0.3, y - s * 0.5, s * 0.6, s * 1.0, s * 0.25); g.fill();
      g.globalAlpha = 1;
      if (a > 0.1) { d.fillStyle = gray(0.55 + L.s * 0.3); roundRect(d, x - s * 0.55, y - s * 0.8, s * 1.1, s * 1.6, s * 0.35); d.fill(); }
    }
  }

  function pagoda(x, y, s, depth) {
    const tiers = 4;
    for (let i = 0; i < tiers; i++) {
      const k = 1 - i * 0.18, ty = y - i * s * 0.22;
      const body = (ctx) => { ctx.beginPath(); ctx.rect(x - s * 0.12 * k, ty - s * 0.16, s * 0.24 * k, s * 0.16); };
      const roof = (ctx) => {
        ctx.beginPath();
        ctx.moveTo(x - s * 0.3 * k, ty - s * 0.15);
        ctx.quadraticCurveTo(x - s * 0.18 * k, ty - s * 0.19, x - s * 0.1 * k, ty - s * 0.25);
        ctx.lineTo(x + s * 0.1 * k, ty - s * 0.25);
        ctx.quadraticCurveTo(x + s * 0.18 * k, ty - s * 0.19, x + s * 0.3 * k, ty - s * 0.15);
        ctx.closePath();
      };
      body(g); g.fillStyle = '#3b1f4a'; g.fill();
      g.fillStyle = 'rgba(255,190,120,0.9)'; g.fillRect(x - s * 0.03 * k, ty - s * 0.12, s * 0.06 * k, s * 0.07);
      roof(g); g.fillStyle = '#c2324f'; g.fill();
      body(d); d.fillStyle = gray(depth); d.fill(); roof(d); d.fill();
    }
    g.fillStyle = '#c2324f'; g.fillRect(x - s * 0.008, y - s * 1.08, s * 0.016, s * 0.18);
  }

  function tree(x, y, s, t) {
    const sway = Math.sin(t * 0.8) * 0.02;
    g.strokeStyle = '#2b1426'; g.lineCap = 'round';
    d.strokeStyle = gray(0.92); d.lineCap = 'round';
    const branch = (x0, y0, ang, len, wdt, n) => {
      const x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
      for (const ctx of [g, d]) { ctx.lineWidth = wdt; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
      if (n > 0) {
        branch(x1, y1, ang - 0.45 + sway, len * 0.72, wdt * 0.68, n - 1);
        branch(x1, y1, ang + 0.38 + sway, len * 0.68, wdt * 0.68, n - 1);
      } else blossom(x1, y1, s * 0.09);
    };
    branch(x, y, -Math.PI / 2 - 0.15, s * 0.32, s * 0.06, 4);
  }

  function blossom(x, y, r) {
    for (const [ox, oy, k, c] of [[0, 0, 1, '#ff8fb8'], [0.5, -0.3, 0.7, '#ffb3cf'], [-0.45, -0.2, 0.75, '#ff7aa8'], [0.1, -0.55, 0.6, '#ffd0e2']]) {
      g.fillStyle = c; g.beginPath(); g.arc(x + ox * r, y + oy * r, r * k, 0, TAU); g.fill();
      d.fillStyle = gray(0.93); d.beginPath(); d.arc(x + ox * r, y + oy * r, r * k, 0, TAU); d.fill();
    }
  }

  draw(0);
  return { canvas, depthCanvas, draw, duration: LOOP };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
