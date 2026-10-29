// WebGL2 renderer. The CPU only uploads the current video frame; everything
// else happens on the GPU. Three kinds of look share one context:
//   particles - every particle is placed, coloured, sized and animated from its
//               vertex index, so hundreds of thousands of them stay smooth
//   toon      - the frame is repainted as a cartoon (toon.js)
//   immersive - the frame becomes a 3D room you can walk into (immersive.js)

import { FORMS, PALETTES, BACKGROUNDS, SHAPES, DEFAULT_FORM, hexToRgb } from './forms.js';
import { mul, perspective, translate, rotX, rotY, compile, makeTexture, Target } from './mat4.js';
import { ToonRenderer } from './toon.js';
import { ImmersiveRoom } from './immersive.js';

const VERT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uVideo;
uniform sampler2D uMask;
uniform float uMaskOn;
uniform mat4 uMVP;
uniform float uTime;
uniform vec2 uGrid;
uniform float uCells;
uniform float uAspect;
uniform float uPxUnit;
uniform float uRefDist;
uniform float uMaxPoint;

uniform float uSize, uDepth, uMotion, uSpeed, uSat, uBright, uBgKeep, uCutoff, uAlpha;
uniform float uAbstract;
uniform float uJitter, uLife, uSizeLuma, uSizeVar, uSpin, uRandRot, uSides, uTwinkle, uRise;
uniform int uColorMode;
uniform vec3 uPal[5];

out vec4 vColor;
out vec2 vInfo;
out float vRot;

uint pcg(uint v) {
  uint s = v * 747796405u + 2891336009u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float rnd(uint seed) { return float(pcg(seed)) / 4294967295.0; }

// Simplex noise (Ashima / Stefan Gustavson, MIT)
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

vec3 palette(float t) {
  t = clamp(t, 0.0, 1.0) * 4.0;
  int i = int(min(floor(t), 3.0));
  return mix(uPal[i], uPal[i + 1], t - float(i));
}

// flat, saturated swatches with short blends between them
vec3 palettePop(float t) {
  t = clamp(t, 0.0, 1.0) * 4.0;
  int i = int(min(floor(t), 3.0));
  float f = smoothstep(0.38, 0.62, t - float(i));
  return mix(uPal[i], uPal[i + 1], f);
}

void main() {
  int id = gl_VertexID;
  uint uid = uint(id);
  int cols = int(uGrid.x);
  int cells = int(uCells);
  int cell = id % cells;

  float h1 = rnd(uid * 11u + 1u);
  float h2 = rnd(uid * 11u + 2u);
  float h3 = rnd(uid * 11u + 3u);
  float h4 = rnd(uid * 11u + 4u);
  float h5 = rnd(uid * 11u + 5u);
  float h6 = rnd(uid * 11u + 6u);
  float h7 = rnd(uid * 11u + 7u);
  float h8 = rnd(uid * 11u + 8u);

  vec2 g = vec2(float(cell % cols), float(cell / cols));
  vec2 cuv = (g + 0.5 + (vec2(h1, h2) - 0.5) * uJitter) / uGrid;
  vec2 uv = vec2(cuv.x, 1.0 - cuv.y);

  // average five taps so shrinking a big frame doesn't alias
  vec2 px = 0.5 / uGrid;
  vec3 c = texture(uVideo, uv).rgb * 2.0
         + texture(uVideo, uv + vec2( px.x,  px.y)).rgb
         + texture(uVideo, uv + vec2(-px.x,  px.y)).rgb
         + texture(uVideo, uv + vec2( px.x, -px.y)).rgb
         + texture(uVideo, uv + vec2(-px.x, -px.y)).rgb;
  c /= 6.0;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));

  float m = mix(1.0, texture(uMask, uv).r, uMaskOn);
  float keep = mix(uBgKeep, 1.0, m);
  float vis = smoothstep(uCutoff, uCutoff + 0.06, lum);
  if (h3 > keep || vis < 0.002 || h8 < uAbstract * 0.2) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vColor = vec4(0.0);
    vInfo = vec2(0.0);
    vRot = 0.0;
    return;
  }

  float t = uTime * uSpeed;
  vec2 pxy = vec2((cuv.x - 0.5) * 2.0 * uAspect, (0.5 - cuv.y) * 2.0);
  float z = (lum - 0.5) * uDepth + (m - 0.5) * uDepth * 0.8 * uMaskOn
          + (h4 - 0.5) * (uDepth * 0.5 + 0.03);

  vec3 q = vec3(pxy * 1.7, t * 0.3);
  vec2 flow = vec2(snoise(q), snoise(q + vec3(19.7, 7.3, 3.1)));
  float fade = 1.0;
  if (uLife > 0.5) {
    float life = fract(t * 0.16 + h5);
    fade = sin(life * 3.14159265);
    fade *= fade;
    pxy += flow * (0.12 + life * 0.88) * uMotion * 0.2;
    pxy.y += uRise * life * uMotion * 0.16;
    z += snoise(q * 1.3 + 5.0) * uMotion * 0.12 * life;
  } else {
    pxy += flow * uMotion * 0.022;
    z += snoise(q + vec3(9.1, 2.2, t * 0.2)) * uMotion * 0.05;
  }

  // loosen the picture: scatter pieces off the grid and throw a few strays
  pxy += (vec2(h2, h1) - 0.5) * (2.0 / uGrid.y) * uAbstract * 2.5;
  if (h6 > 0.96) {
    pxy += flow * uAbstract * 0.12;
    z += (h4 - 0.5) * uAbstract * 0.3;
  }

  vec4 clip = uMVP * vec4(pxy, z, 1.0);
  gl_Position = clip;

  float s = (2.0 / uGrid.y) * uPxUnit * uSize;
  s *= mix(1.0, 0.35 + lum * 1.15, uSizeLuma);
  s *= mix(1.0, 0.4 + 1.2 * h6, max(uSizeVar, uAbstract * 0.7));
  s *= uRefDist / clip.w;
  gl_PointSize = clamp(s, 1.0, uMaxPoint);

  vec3 col = mix(vec3(lum), c, uSat);
  if (uColorMode == 1) {
    col = palette(pow(lum, 0.85) * 1.05);
  } else if (uColorMode == 2) {
    col = palette(clamp(lum * 0.5 + h7 * 0.55, 0.0, 1.0));
    col *= mix(0.5, 1.1, smoothstep(0.0, 0.7, lum));
  } else if (uColorMode == 3) {
    // artistic: colour follows the picture's structure (hue and light) but is
    // remapped through the palette, with painterly drift and per-piece variation
    float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
    float d = mx - mn;
    float sat = d / max(mx, 0.001);
    float hue = 0.0;
    if (d > 0.0001) {
      hue = (mx == c.r ? mod((c.g - c.b) / d, 6.0) : (mx == c.g ? (c.b - c.r) / d + 2.0 : (c.r - c.g) / d + 4.0)) / 6.0;
    }
    float base = mix(lum * 1.25 + 0.15, hue, smoothstep(0.12, 0.45, sat));
    vec2 fp = cuv * vec2(uAspect, 1.0);
    float patch1 = snoise(vec3(fp * 4.5, t * 0.07)) * 0.38;          // large colour patches
    float patch2 = snoise(vec3(fp * 13.0 + 7.0, t * 0.14)) * 0.14;   // confetti-sized flecks
    float pick = (h7 - 0.5) * 0.45;                                   // each piece chooses a neighbouring colour
    float x = base * 2.4 + patch1 + patch2 + pick + t * 0.03;
    col = palettePop(1.0 - abs(2.0 * fract(x) - 1.0));
    col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, 1.3);   // keep it vivid
    col *= mix(0.3, 1.3, smoothstep(0.05, 0.95, lum));
  }
  col *= uBright;

  float a = uAlpha * vis * fade;
  a *= mix(1.0, 0.5 + 0.5 * sin(t * 3.0 + h7 * 40.0), uTwinkle);
  vColor = vec4(col, a);
  vInfo = vec2(h2, uSides > 0.5 ? uSides : 3.0 + floor(h7 * 4.0));
  vRot = uRandRot * h6 * 6.2831853 + (h5 - 0.5) * 2.0 * uSpin * t;
}
`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec4 vColor;
in vec2 vInfo;
in float vRot;
uniform int uShape;
uniform float uShade;
out vec4 o;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = length(p);
  vec3 col = vColor.rgb;
  float a = vColor.a;

  float cr = cos(vRot), sr = sin(vRot);
  vec2 r = vec2(cr * p.x - sr * p.y, sr * p.x + cr * p.y);

  if (uShape == 0) {                      // lit disc
    float edge = 1.0 - smoothstep(0.8, 1.0, d);
    if (edge <= 0.0) discard;
    vec3 n = vec3(p.x, -p.y, sqrt(max(0.0, 1.0 - d * d)));
    float l = max(dot(n, normalize(vec3(-0.4, 0.5, 0.8))), 0.0);
    col *= mix(1.0, 0.5 + 0.7 * l, uShade);
    col += uShade * 0.3 * pow(l, 24.0);
    a *= edge;
  } else if (uShape == 2) {               // polygon
    float n = vInfo.y;
    float ang = atan(r.y, r.x);
    float seg = 6.2831853 / n;
    float k = floor(0.5 + ang / seg);
    float dd = cos(k * seg - ang) * length(r);
    float ap = 0.95 * cos(3.14159265 / n);
    float edge = 1.0 - smoothstep(ap - 0.09, ap, dd);
    if (edge <= 0.0) discard;
    float facet = fract(sin((k + 3.0) * 12.9898 + vInfo.x * 78.233) * 43758.5453);
    col *= 0.84 + 0.3 * facet;
    a *= edge;
  } else if (uShape == 4) {               // star
    float ang = atan(r.y, r.x);
    float edge = 0.3 + 0.62 * pow(abs(cos(2.5 * ang)), 2.2);
    float core = 1.0 - smoothstep(edge - 0.1, edge, d);
    float glow = exp(-d * d * 5.0) * 0.5;
    col += core * 0.3;
    a *= clamp(core + glow, 0.0, 1.0) * (1.0 - smoothstep(0.9, 1.0, d));
  } else {                                // ember
    float e = exp(-d * d * 10.0) + 0.3 * exp(-d * d * 2.4);
    col = mix(col, vec3(1.0, 0.95, 0.8), exp(-d * d * 20.0) * 0.5);
    a *= clamp(e, 0.0, 1.0) * (1.0 - smoothstep(0.9, 1.0, d));
  }

  if (a <= 0.003) discard;
  o = vec4(col, a);
}
`;

const FOV = (32 * Math.PI) / 180;
const REF_DIST = 1 / Math.tan(FOV / 2); // puts the plane (height 2) exactly in frame

export class ParticleEngine {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('This browser can’t run WebGL 2, which the engine needs.');
    this.gl = gl;
    ({ p: this.prog, u: this.u } = compile(gl, VERT, FRAG));
    this.vao = gl.createVertexArray();
    this.maxPoint = Math.min(gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1], 256);

    this.videoTex = makeTexture(gl);
    this.maskTex = makeTexture(gl);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([255]));
    gl.activeTexture(gl.TEXTURE0);
    this.maskOn = false;
    this.mips = false;

    this.toon = null;   // built on first use
    this.room = null;
    this.skin = null;
    this.depthSource = null;
    this.aiDepth = null;
    this.xr = null;

    this.texW = 0; this.texH = 0;
    this.source = null;
    this.aspect = 16 / 9;
    this.cfg = null;
    this.grid = { cols: 1, rows: 1, cells: 1 };
    this.mouse = { x: 0, y: 0, sx: 0, sy: 0 };
    this.count = 0;
    this.stereo = false;
    this.lastTime = 0;
    this.setConfig({ form: DEFAULT_FORM, ...FORMS[DEFAULT_FORM].defaults, drift: 0.6, background: 'plum' });
  }

  // depthCanvas: an exact depth map drawn alongside the source (the sample clip has one)
  setSource(el, depthCanvas = null) { this.source = el; this.depthSource = depthCanvas; this.toon?.invalidate(); }

  setConfig(patch) {
    this.cfg = { ...(this.cfg || {}), ...patch };
    this.grid.dirty = true;
    this.toon?.invalidate();
  }

  get kind() { return (FORMS[this.cfg.form] || FORMS[DEFAULT_FORM]).kind; }

  setPointer(x, y) { this.mouse.x = x; this.mouse.y = y; }

  setMask(data, w, h) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    if (this.maskW === w && this.maskH === h) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RED, gl.UNSIGNED_BYTE, data);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, data);
      this.maskW = w; this.maskH = h;
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.activeTexture(gl.TEXTURE0);
    this.maskOn = true;
  }

  clearMask() { this.maskOn = false; }

  // AI depth from depth.js: { data, w, h }, or null to go back to the built-in estimate
  setDepth(d) { this.aiDepth = d; this.aiDirty = true; }

  // The 3D room, created on demand. The studio sends input straight to it.
  get immersive() { return (this.room ??= new ImmersiveRoom(this.gl)); }

  resize(w, h) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
  }

  get particleCount() {
    const k = this.kind;
    if (k === 'toon') return 0;
    if (k === 'immersive') return Math.round(50000 * (this.cfg.swarm ?? 0.5));
    return this.count;
  }

  #uploadSource() {
    const gl = this.gl, s = this.source;
    if (!s) return false;
    const w = s.videoWidth || s.width, h = s.videoHeight || s.height;
    if (!w || !h) return false;
    if (s.readyState !== undefined && s.readyState < 2) return false;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    if (w !== this.texW || h !== this.texH) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, s);
      this.texW = w; this.texH = h;
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, s);
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    // the 3D room samples blurred versions of the frame, so it needs mipmaps
    const wantMips = this.kind === 'immersive';
    if (wantMips) gl.generateMipmap(gl.TEXTURE_2D);
    if (wantMips !== this.mips) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, wantMips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      this.mips = wantMips;
    }
    const aspect = w / h;
    if (Math.abs(aspect - this.aspect) > 1e-4) { this.aspect = aspect; this.grid.dirty = true; }
    return true;
  }

  #rebuildGrid() {
    const cells = Math.max(1000, (this.cfg.density ?? 150) * 1000);
    const rows = Math.max(8, Math.round(Math.sqrt(cells / this.aspect)));
    const cols = Math.max(8, Math.round(rows * this.aspect));
    this.grid = { cols, rows, cells: cols * rows, dirty: false };
    this.count = cols * rows * Math.max(1, Math.round(this.cfg.layers ?? 1));
  }

  render(time, xrFrame = null) {
    const gl = this.gl, c = this.cfg, form = FORMS[c.form] || FORMS[DEFAULT_FORM];
    const dt = Math.max(0, Math.min(0.1, time - this.lastTime));
    this.lastTime = time;
    const hasFrame = this.#uploadSource();
    if (this.grid.dirty) this.#rebuildGrid();

    if (form.kind === 'toon') {
      if (!hasFrame) return this.#clear();
      this.toon ??= new ToonRenderer(gl);
      this.toon.render({ src: this.videoTex, srcW: this.texW, srcH: this.texH, outW: this.canvas.width, outH: this.canvas.height, time, cfg: c, style: form.style });
      return;
    }
    if (form.kind === 'immersive') {
      if (!hasFrame) return this.#clear();
      this.#renderRoom(time, dt, xrFrame);
      return;
    }
    this.#renderParticles(time, hasFrame, form);
  }

  #clear() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  #renderRoom(time, dt, xrFrame) {
    const gl = this.gl, c = this.cfg, room = this.immersive;
    // what is painted on the walls: the clip itself, or one of the cartoon styles
    let skin = this.videoTex;
    const skinForm = FORMS[c.skin];
    if (skinForm?.kind === 'toon') {
      this.toon ??= new ToonRenderer(gl);
      if (!this.skin) {
        this.skin = new Target(gl);
        gl.bindTexture(gl.TEXTURE_2D, this.skin.tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      }
      const h = Math.min(this.texH, 1080), w = Math.round(h * this.aspect);
      this.toon.render({ src: this.videoTex, srcW: this.texW, srcH: this.texH, outW: w, outH: h, target: this.skin, time, cfg: { ...skinForm.defaults, sat: 1, bright: 1 }, style: skinForm.style });
      gl.bindTexture(gl.TEXTURE_2D, this.skin.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      skin = this.skin.tex;
    }

    // depth: AI if it is on and ready, else the sample's exact map, else the room's own estimate
    if (c.depthSrc === 'ai' && this.aiDepth) {
      if (this.aiDirty) { room.setExternalDepth(this.aiDepth); this.aiDirty = false; }
    } else if (this.depthSource && c.depthSrc !== 'guess') {
      room.setExternalDepth(this.depthSource); this.aiDirty = true;
    } else {
      room.setExternalDepth(null); this.aiDirty = true;
    }

    let views, fb = null;
    if (xrFrame) {
      const layer = xrFrame.session.renderState.baseLayer;
      views = room.xrViews(xrFrame, this.xr.ref, layer);
      if (!views) return;
      fb = layer.framebuffer;
    } else {
      views = room.viewsFor(this.canvas.width, this.canvas.height, this.stereo);
    }
    room.render({ time, dt, skin, vidTex: this.videoTex, maskTex: this.maskTex, maskOn: this.maskOn, aspect: this.aspect, cfg: c, views, fb });
  }

  #renderParticles(time, hasFrame, form) {
    const gl = this.gl, c = this.cfg;
    const bg = hexToRgb((BACKGROUNDS[c.background] || BACKGROUNDS.plum).color);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!hasFrame) return;

    // gentle camera drift + pointer parallax (+ optional scripted dolly/turn for the landing page)
    const m = this.mouse;
    m.sx += (m.x - m.sx) * 0.06; m.sy += (m.y - m.sy) * 0.06;
    const dr = c.drift ?? 0.6;
    const ry = (Math.sin(time * 0.25) * 0.05 + m.sx * 0.3) * dr + (c.turn ?? 0);
    const rx = (Math.cos(time * 0.19) * 0.03 + m.sy * 0.18) * dr;
    const mvp = mul(perspective(FOV, this.canvas.width / this.canvas.height, 0.05, 20),
      mul(translate(0, 0, -REF_DIST + (c.dolly ?? 0)), mul(rotX(rx), rotY(ry))));

    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.maskTex);

    const u = this.u, f1 = (n, v) => gl.uniform1f(u[n], v);
    gl.uniform1i(u.uVideo, 0);
    gl.uniform1i(u.uMask, 1);
    f1('uMaskOn', this.maskOn ? 1 : 0);
    gl.uniformMatrix4fv(u.uMVP, false, mvp);
    f1('uTime', time);
    gl.uniform2f(u.uGrid, this.grid.cols, this.grid.rows);
    f1('uCells', this.grid.cells);
    f1('uAspect', this.aspect);
    f1('uPxUnit', this.canvas.height / 2);
    f1('uRefDist', REF_DIST);
    f1('uMaxPoint', this.maxPoint);
    f1('uSize', c.size); f1('uDepth', c.depth); f1('uMotion', c.motion); f1('uSpeed', c.speed);
    f1('uAbstract', c.abstract ?? 0); f1('uSat', c.sat); f1('uBright', c.bright); f1('uBgKeep', c.bgKeep); f1('uCutoff', c.cutoff);
    f1('uAlpha', form.alpha); f1('uJitter', form.jitter); f1('uLife', form.life);
    f1('uSizeLuma', form.sizeLuma); f1('uSizeVar', form.sizeVar); f1('uSpin', form.spin);
    f1('uRandRot', form.randRot); f1('uSides', form.sides); f1('uTwinkle', form.twinkle); f1('uRise', form.rise);
    f1('uShade', form.shade);
    gl.uniform1i(u.uShape, SHAPES[form.shape]);
    gl.uniform1i(u.uColorMode, { original: 0, gradient: 1, scatter: 2, artistic: 3 }[c.color] ?? 0);
    const stops = (PALETTES[c.palette] || PALETTES.sunset).stops.flatMap(hexToRgb);
    gl.uniform3fv(u.uPal, stops);

    if (form.blend === 'add') {
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    } else {
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
      gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    }
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.activeTexture(gl.TEXTURE0);
  }

  /* ---------------- WebXR ---------------- */
  static async vrSupported() {
    try { return !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-vr')); } catch { return false; }
  }

  // Runs the room inside a headset. onFrame(dt) lets the page keep its own
  // per-frame work going (sample clip, subject mask), since window rAF pauses.
  async enterVR(onFrame, onEnd) {
    const gl = this.gl;
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
    try {
      await gl.makeXRCompatible();
      const layer = new XRWebGLLayer(session, gl, { antialias: true });
      session.updateRenderState({ baseLayer: layer, depthNear: 0.05, depthFar: 60 });
      this.xr = { session, ref: await session.requestReferenceSpace('local') };
    } catch (e) { session.end().catch(() => {}); throw e; }
    const room = this.immersive;
    let last = null;
    session.addEventListener('select', () => room.ripple(undefined, undefined, 1.2));
    session.addEventListener('end', () => { this.xr = null; onEnd?.(); });
    const loop = (t, frame) => {
      if (!this.xr) return;
      session.requestAnimationFrame(loop);
      const dt = last == null ? 0 : Math.min(0.1, (t - last) / 1000);
      last = t;
      // thumbsticks: left walks, right turns
      for (const src of session.inputSources) {
        const ax = src.gamepad?.axes;
        if (!ax || ax.length < 4) continue;
        const x = ax[2], y = ax[3];
        if (src.handedness === 'right') { if (Math.abs(x) > 0.2) room.look(x * dt * 1.6, 0); }
        else if (Math.abs(x) > 0.2 || Math.abs(y) > 0.2) room.move(-y * dt * 1.5, x * dt * 1.5, 0);
      }
      onFrame?.(dt);
      this.render(this.lastTime + dt, frame);
    };
    session.requestAnimationFrame(loop);
    return session;
  }

  exitVR() { this.xr?.session.end().catch(() => {}); }

  // Current frame as a PNG (must be called right after render()).
  snapshot() {
    return new Promise((res) => this.canvas.toBlob(res, 'image/png'));
  }
}
