// Immersive mode: you stand inside the clip.
//   depth   - per-pixel depth (exact for the sample, AI if loaded, otherwise a
//             smart guess from position, focus, colour and the subject mask)
//   dome    - the video's light spills around you, with a glossy mirrored floor
//   screen  - the frame wraps around you as a mesh, each pixel pushed toward you
//             along its own view ray, so it looks right from the start and
//             opens up into real parallax as soon as you move
//   swarm   - pieces of the picture drift off the screen into the room
// Works with mouse/touch, device orientation, side-by-side stereo, and WebXR.

import { compile, Target, FULLSCREEN_VS, mul, perspective, translate, rotX, rotY, invert, transformPoint } from './mat4.js';

const SHARED = /* glsl */ `
uniform sampler2D uDepth;
uniform float uArc, uRad, uH, uPop, uTime, uAspect;
uniform vec4 uRip[4];
uniform vec3 uTouch;

float rippleAt(vec2 uv) {
  float w = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 r = uRip[i];
    float age = uTime - r.z;
    if (r.w <= 0.0 || age < 0.0 || age > 5.0) continue;
    float dist = length((uv - r.xy) * vec2(uAspect, 1.0));
    float x = dist - age * 0.75;
    w += sin(x * 26.0) * exp(-x * x * 22.0) * exp(-age * 0.8) * r.w;
  }
  return w;
}
float depthAt(vec2 uv) {
  float d = texture(uDepth, uv).r;
  d += rippleAt(uv) * 0.22;
  vec2 td = (uv - uTouch.xy) * vec2(uAspect, 1.0);
  d -= uTouch.z * 0.3 * exp(-dot(td, td) * 40.0);
  return d;
}
vec3 screenPos(vec2 uv, float d) {
  float th = (uv.x - 0.5) * uArc;
  vec3 p = vec3(sin(th) * uRad, (uv.y - 0.5) * uH, -cos(th) * uRad);
  return p * max(0.15, 1.0 - clamp(d, -0.3, 1.2) * uPop * 0.6);
}
`;

const DEPTH_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uVid, uMask, uExt, uPrev;
uniform float uMaskOn, uExtOn, uKeep;
out vec4 o;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main() {
  vec2 uv = vUv;
  float d;
  if (uExtOn > 0.5) {
    d = texture(uExt, uv).r;
  } else {
    vec3 c = textureLod(uVid, uv, 3.0).rgb;
    vec3 b = textureLod(uVid, uv, 5.5).rgb;
    float l = luma(c);
    float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
    float sat = (mx - mn) / max(mx, 1e-3);
    float detail = clamp(length(c - b) * 4.0, 0.0, 1.0);        // in-focus things tend to be close
    float low = mix(0.78, 0.12, smoothstep(0.0, 1.0, uv.y));      // lower in frame = nearer
    vec2 cc = (uv - vec2(0.5, 0.45)) * vec2(1.3, 1.0);
    float centre = 1.0 - smoothstep(0.1, 0.75, length(cc));       // subjects sit near the middle
    float sky = smoothstep(0.55, 0.85, uv.y) * smoothstep(0.45, 0.8, l) * (1.0 - detail);
    d = low * 0.5 + centre * 0.22 + detail * 0.2 + sat * 0.12 - sky * 0.35;
    float m = texture(uMask, uv).r;
    d = mix(d, max(d, 0.55 + m * 0.4), uMaskOn * smoothstep(0.2, 0.7, m));
  }
  float p = texture(uPrev, uv).r;
  o = vec4(vec3(mix(d, p, uKeep)), 1.0);
}
`;

const ENV_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform mat4 uInvVP;
uniform vec3 uCam;
uniform sampler2D uSkin;
uniform float uArc, uRad, uH, uAmb, uFloorY, uTime, uSat, uBright;
out vec4 o;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
vec2 mirror(vec2 x) { return 1.0 - abs(1.0 - mod(x, 2.0)); }
vec3 grade(vec3 c) { return mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, uSat) * uBright; }
void main() {
  vec4 p4 = uInvVP * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dir = normalize(p4.xyz / p4.w - uCam);
  vec3 avg = grade(textureLod(uSkin, vec2(0.5), 12.0).rgb);

  // dome: the frame, extended and blurred all around you
  float th = atan(dir.x, -dir.z);
  vec2 uv = vec2(th / uArc + 0.5, dir.y / max(length(dir.xz), 1e-3) * uRad / uH + 0.5);
  float out_ = max(abs(uv.x - 0.5), abs(uv.y - 0.5)) - 0.5;
  vec3 dome = grade(textureLod(uSkin, mirror(uv), 6.0).rgb);
  vec3 col = dome * uAmb * (0.18 + 0.82 * exp(-max(out_, 0.0) * 2.2));
  // a few stars in the dark
  vec3 sd = floor(dir * 160.0);
  float st = step(0.9975, hash(sd)) * (0.5 + 0.5 * sin(uTime * 2.0 + hash(sd + 1.0) * 30.0));
  col += vec3(0.9, 0.85, 1.0) * st * 0.6;

  // floor: glossy, reflects the screen, with a faint grid
  if (dir.y < 0.0) {
    float t = (uFloorY - uCam.y) / dir.y;
    vec3 hit = uCam + dir * t;
    vec3 r = vec3(dir.x, -dir.y, dir.z);
    vec2 ox = hit.xz, dx = r.xz;
    float a = dot(dx, dx), b = 2.0 * dot(ox, dx), c = dot(ox, ox) - uRad * uRad;
    float disc = b * b - 4.0 * a * c;
    vec3 refl = vec3(0.0);
    if (disc > 0.0 && a > 1e-5) {
      float s = (-b + sqrt(disc)) / (2.0 * a);
      vec3 P = hit + r * s;
      vec2 ruv = vec2(atan(P.x, -P.z) / uArc + 0.5, P.y / uH + 0.5);
      float inside = step(abs(ruv.x - 0.5), 0.5) * step(abs(ruv.y - 0.5), 0.5);
      refl = grade(textureLod(uSkin, clamp(ruv, 0.0, 1.0), 1.5 + s * 0.35).rgb) * inside;
    }
    float fres = 0.18 + 0.6 * pow(1.0 - abs(dir.y), 4.0);
    vec2 gq = abs(fract(hit.xz * 0.8) - 0.5);
    float line = smoothstep(0.47, 0.5, max(gq.x, gq.y)) * exp(-t * 0.12);
    float fade = exp(-t * 0.05);
    vec3 fl = refl * fres + avg * 0.06 + (avg * 1.5 + 0.06) * line * 0.5;
    col = mix(col, fl * fade + col * 0.15, smoothstep(0.0, -0.02, dir.y));
  }
  o = vec4(col, 1.0);
}
`;

const MESH_VS = /* glsl */ `#version 300 es
precision highp float;
uniform mat4 uVP;
uniform vec2 uCells;
${SHARED}
out vec2 vUv;
out float vStretch, vWave;
void main() {
  int q = gl_VertexID / 6, k = gl_VertexID % 6;
  int cols = int(uCells.x);
  vec2 off = vec2(k == 1 || k == 4 || k == 5 ? 1.0 : 0.0, k == 2 || k == 3 || k == 5 ? 1.0 : 0.0);
  vec2 uv = (vec2(float(q % cols), float(q / cols)) + off) / uCells;
  float d = depthAt(uv);
  vec2 e = 1.5 / uCells;
  float sx = abs(depthAt(uv + vec2(e.x, 0.0)) - depthAt(uv - vec2(e.x, 0.0)));
  float sy = abs(depthAt(uv + vec2(0.0, e.y)) - depthAt(uv - vec2(0.0, e.y)));
  vStretch = (sx + sy) * uPop;
  vWave = rippleAt(uv);
  vUv = uv;
  gl_Position = uVP * vec4(screenPos(uv, d), 1.0);
}
`;

const MESH_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
in float vStretch, vWave;
uniform sampler2D uSkin;
uniform float uSat, uBright;
out vec4 o;
void main() {
  vec3 c = texture(uSkin, vUv).rgb;
  c = mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, uSat) * uBright;
  c += vec3(0.5, 0.8, 1.0) * max(vWave, 0.0) * 0.35;
  // soft borders and torn-open depth edges, via alpha-to-coverage
  vec2 b = min(vUv, 1.0 - vUv);
  float a = smoothstep(0.0, 0.03, min(b.x, b.y));
  a *= 1.0 - smoothstep(0.3, 0.55, vStretch);
  if (a < 0.02) discard;
  o = vec4(c, a);
}
`;

const SWARM_VS = /* glsl */ `#version 300 es
precision highp float;
uniform mat4 uVP;
uniform sampler2D uSkin;
uniform vec3 uHit;
uniform float uSwarm, uPx;
${SHARED}
out vec4 vCol;
uint pcg(uint v) { uint s = v * 747796405u + 2891336009u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
float rnd(uint s) { return float(pcg(s)) / 4294967295.0; }
void main() {
  uint id = uint(gl_VertexID);
  float h1 = rnd(id * 7u + 1u), h2 = rnd(id * 7u + 2u), h3 = rnd(id * 7u + 3u), h4 = rnd(id * 7u + 4u), h5 = rnd(id * 7u + 5u);
  vec2 uv = vec2(h1, h2);
  float life = fract(uTime * (0.05 + h4 * 0.07) + h3);
  vec3 base = screenPos(uv, depthAt(uv));
  float reach = mix(0.15, 0.92, h5 * h5);
  vec3 p = base * (1.0 - life * reach);
  float a = uTime * 0.3 + h3 * 40.0;
  p += vec3(sin(a + p.y * 1.3), cos(a * 0.8 + p.x), sin(a * 1.1 + p.z)) * life * 0.35;
  p.y += life * life * 0.6;
  // pieces near your pointer scatter away
  vec3 dv = p - uHit;
  p += normalize(dv + 1e-4) * 0.9 * exp(-dot(dv, dv) * 1.8) * step(0.0, uHit.y + 100.0);
  vec4 clip = uVP * vec4(p, 1.0);
  gl_Position = clip;
  vec3 c = textureLod(uSkin, uv, 1.0).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  float fade = sin(life * 3.14159);
  vCol = vec4(c * 1.3 + 0.04, fade * (0.15 + smoothstep(0.2, 0.7, l)) * 0.28);
  gl_PointSize = clamp(uPx * (0.006 + h4 * h4 * 0.018) / clip.w, 1.0, 40.0);
}
`;

const SWARM_FS = /* glsl */ `#version 300 es
precision highp float;
in vec4 vCol;
out vec4 o;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = dot(p, p);
  float a = exp(-d * 3.5) * (1.0 - smoothstep(0.7, 1.0, d));
  if (a * vCol.a < 0.004) discard;
  o = vec4(vCol.rgb * a * vCol.a, 1.0);
}
`;

const EYE = 0.032; // half of a typical interpupillary distance, in metres
const DIST = 3.5;  // metres from you to the screen

export class ImmersiveRoom {
  constructor(gl) {
    this.gl = gl;
    this.depthProg = compile(gl, FULLSCREEN_VS, DEPTH_FS);
    this.envProg = compile(gl, FULLSCREEN_VS, ENV_FS);
    this.meshProg = compile(gl, MESH_VS, MESH_FS);
    this.swarmProg = compile(gl, SWARM_VS, SWARM_FS);
    this.vao = gl.createVertexArray();
    this.D = [new Target(gl), new Target(gl)];
    this.di = 0;
    this.extTex = null; this.extOn = false; this.extFresh = 0;

    // camera: what you control, plus a smoothed copy that is actually used
    this.cam = { yaw: 0, pitch: 0, x: 0, y: 0, z: 0 };
    this.view = { yaw: 0, pitch: 0, x: 0, y: 0, z: 0 };
    this.orient = null;           // device orientation, if enabled
    this.idle = 10;
    this.ripples = [];
    this.touch = { u: 0.5, v: 0.5, s: 0, target: 0 };
    this.hit = [0, -1000, 0];
    this.time = 0;
    this.geo = { arc: 2, rad: DIST, h: 3, aspect: 16 / 9 };
    this.lastVP = null;
  }

  /* ---------------- input ---------------- */
  look(dx, dy) {
    this.cam.yaw -= dx; this.cam.pitch = Math.max(-1.35, Math.min(1.35, this.cam.pitch - dy));
    this.idle = 0;
  }
  // move in the direction you are facing
  move(fwd, side, up) {
    const y = this.cam.yaw;
    this.cam.x += -Math.sin(y) * fwd + Math.cos(y) * side;
    this.cam.z += -Math.cos(y) * fwd - Math.sin(y) * side;
    this.cam.y += up;
    const r = Math.hypot(this.cam.x, this.cam.z), lim = DIST * 0.85;
    if (r > lim) { this.cam.x *= lim / r; this.cam.z *= lim / r; }
    this.cam.y = Math.max(-1.2, Math.min(1.6, this.cam.y));
    this.idle = 0;
  }
  reset() { Object.assign(this.cam, { yaw: 0, pitch: 0, x: 0, y: 0, z: 0 }); this.idle = 0; }
  setOrientation(q) { this.orient = q; if (!q) this.alpha0 = null; }   // { alpha, beta, gamma, screen } in degrees, or null

  // pointer in normalised device coords (-1..1). Returns screen uv or null.
  #pick(nx, ny) {
    if (!this.lastVP) return null;
    const inv = invert(this.lastVP);
    const a = transformPoint(inv, nx, ny, -1), b = transformPoint(inv, nx, ny, 1);
    const wa = inv[3] * nx + inv[7] * ny + inv[11] * -1 + inv[15], wb = inv[3] * nx + inv[7] * ny + inv[11] + inv[15];
    const o = a.map((v) => v / wa), f = b.map((v) => v / wb);
    const d = [f[0] - o[0], f[1] - o[1], f[2] - o[2]];
    const R = this.geo.rad;
    const A = d[0] * d[0] + d[2] * d[2], B = 2 * (o[0] * d[0] + o[2] * d[2]), C = o[0] * o[0] + o[2] * o[2] - R * R;
    const disc = B * B - 4 * A * C;
    if (disc < 0 || A < 1e-9) return null;
    const t = (-B + Math.sqrt(disc)) / (2 * A);
    if (t < 0) return null;
    const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    const u = Math.atan2(p[0], -p[2]) / this.geo.arc + 0.5, v = p[1] / this.geo.h + 0.5;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    // point a little in front of the screen, for the swarm to avoid
    return { u, v, world: p.map((x) => x * 0.8) };
  }
  hover(nx, ny) {
    const p = this.#pick(nx, ny);
    if (p) { this.touch.u = p.u; this.touch.v = p.v; this.hit = p.world; this.touch.target = 1; }
    else { this.touch.target = 0; this.hit = [0, -1000, 0]; }
  }
  leave() { this.touch.target = 0; this.hit = [0, -1000, 0]; }
  ripple(nx, ny, strength = 1) {
    const p = nx === undefined ? { u: 0.5, v: 0.5 } : this.#pick(nx, ny);
    if (!p) return false;
    this.ripples.push([p.u, p.v, this.time, strength]);
    if (this.ripples.length > 4) this.ripples.shift();
    return true;
  }

  /* ---------------- depth ---------------- */
  // External depth: a canvas/image, or { data, w, h } (8-bit, white = near).
  setExternalDepth(src) {
    const gl = this.gl;
    if (!src) { this.extOn = false; return; }
    this.extTex ??= (() => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); return t; })();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.extTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (src.data) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, src.w, src.h, 0, gl.RED, gl.UNSIGNED_BYTE, src.data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    this.extOn = true;
  }

  #updateDepth(vidTex, maskTex, maskOn, keep) {
    const gl = this.gl, a = this.geo.aspect;
    const w = 256, h = Math.max(32, Math.round(256 / a));
    const prev = this.D[this.di], next = this.D[1 - this.di];
    if (prev.w !== w || prev.h !== h) { prev.size(w, h); next.size(w, h); keep = 0; }
    next.bind();
    const { p, u } = this.depthProg;
    gl.useProgram(p);
    const bind = (unit, tex, name) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(u[name], unit); };
    bind(0, vidTex, 'uVid'); bind(1, maskTex, 'uMask'); bind(2, this.extTex || vidTex, 'uExt'); bind(3, prev.tex, 'uPrev');
    gl.uniform1f(u.uMaskOn, maskOn ? 1 : 0);
    gl.uniform1f(u.uExtOn, this.extOn ? 1 : 0);
    gl.uniform1f(u.uKeep, keep);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.di = 1 - this.di;
    gl.activeTexture(gl.TEXTURE0);
    return next.tex;
  }

  /* ---------------- camera ---------------- */
  #step(dt, tour) {
    const c = this.cam, v = this.view;
    this.idle += dt;
    const k = 1 - Math.exp(-dt * 7);
    // auto tour: once you let go, the camera keeps gently moving so the depth reads
    const t = this.time, w = Math.min(1, Math.max(0, (this.idle - 2.5) / 3)) * tour;
    const target = {
      yaw: c.yaw + Math.sin(t * 0.13) * 0.32 * w,
      pitch: c.pitch + Math.sin(t * 0.19) * 0.06 * w,
      x: c.x + Math.sin(t * 0.21) * 0.9 * w,
      y: c.y + Math.sin(t * 0.17) * 0.25 * w,
      z: c.z + Math.sin(t * 0.11) * 0.6 * w,
    };
    for (const key of Object.keys(v)) v[key] += (target[key] - v[key]) * k;
    this.touch.s += (this.touch.target - this.touch.s) * (1 - Math.exp(-dt * 5));
  }

  #headRotation() {
    const v = this.view;
    const o = this.orient;
    if (!o || o.alpha == null) return mul(rotY(v.yaw), rotX(v.pitch));
    // device orientation -> camera: R = Ry(alpha) Rx(beta) Rz(-gamma) Rx(-90°) Rz(-screen),
    // with the heading at the moment it was switched on treated as "straight ahead"
    const d2r = Math.PI / 180;
    this.alpha0 ??= o.alpha;
    let R = mul(rotY((o.alpha - this.alpha0) * d2r), mul(rotX(o.beta * d2r), rotZ_(-o.gamma * d2r)));
    R = mul(R, mul(rotX(-Math.PI / 2), rotZ_(-(o.screen || 0) * d2r)));
    return mul(rotY(v.yaw), R);
  }

  viewsFor(width, height, stereo) {
    const v = this.view;
    const R = this.#headRotation();
    const head = mul(translate(v.x, v.y, v.z), R);       // camera to world
    const views = [];
    const eyes = stereo ? [-EYE, EYE] : [0];
    eyes.forEach((e, i) => {
      const vw = stereo ? width / 2 : width;
      const proj = perspective((stereo ? 80 : 74) * Math.PI / 180, vw / height, 0.05, 60);
      const camToWorld = mul(head, translate(e, 0, 0));
      views.push({ viewport: [i * vw, 0, vw, height], proj, view: invert(camToWorld) });
    });
    return views;
  }

  // XR: wrap the headset's views with your own walking offset/turn
  xrViews(frame, refSpace, layer) {
    const pose = frame.getViewerPose(refSpace);
    if (!pose) return null;
    const v = this.view;
    const rig = invert(mul(translate(v.x, v.y, v.z), rotY(v.yaw)));
    return pose.views.map((xv) => {
      const vp = layer.getViewport(xv);
      return { viewport: [vp.x, vp.y, vp.width, vp.height], proj: new Float32Array(xv.projectionMatrix), view: mul(new Float32Array(xv.transform.inverse.matrix), rig) };
    });
  }

  /* ---------------- draw ---------------- */
  render({ time, dt, skin, vidTex, maskTex, maskOn, aspect, cfg, views, fb = null, pxScale }) {
    const gl = this.gl;
    this.time = time;
    this.#step(dt, cfg.tour ?? 0.5);

    // geometry from the wrap setting
    const wrap = cfg.wrap ?? 0.5;
    let arc = 1.0 + wrap * 2.6;
    arc = Math.min(arc, 1.3 * aspect);  // keep the height within ~66° so the whole frame fits in view
    const W = DIST * arc, H = W / aspect;
    this.geo = { arc, rad: DIST, h: H, aspect };
    const floorY = Math.min(-1.6, -H / 2 - 0.05);

    const keep = this.extOn ? (cfg.depthSrc === 'ai' ? 0.82 : 0.4) : 0.9;
    const depthTex = this.#updateDepth(vidTex, maskTex, maskOn, keep);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.clearColor(0, 0, 0, 1);
    gl.disable(gl.SCISSOR_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.bindVertexArray(this.vao);

    const cellsY = Math.round(Math.sqrt(42000 / aspect)), cellsX = Math.round(cellsY * aspect);
    const rip = new Float32Array(16);
    this.ripples.forEach((r, i) => rip.set(r, i * 4));
    const touch = [this.touch.u, this.touch.v, this.touch.s];
    const swarmN = Math.round(50000 * (cfg.swarm ?? 0.5));

    const shared = (u) => {
      gl.uniform1f(u.uArc, arc); gl.uniform1f(u.uRad, DIST); gl.uniform1f(u.uH, H);
      gl.uniform1f(u.uPop, cfg.pop ?? 0.8); gl.uniform1f(u.uTime, time); gl.uniform1f(u.uAspect, aspect);
      gl.uniform4fv(u.uRip, rip); gl.uniform3fv(u.uTouch, touch);
    };

    for (const vw of views) {
      const [x, y, w, h] = vw.viewport;
      gl.viewport(x, y, w, h);
      const vp = mul(vw.proj, vw.view);
      if (views.length === 1) this.lastVP = vp;
      const camPos = transformPoint(invert(vw.view), 0, 0, 0);

      // dome + floor
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      let { p, u } = this.envProg;
      gl.useProgram(p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, skin);
      gl.uniform1i(u.uSkin, 0);
      gl.uniformMatrix4fv(u.uInvVP, false, invert(vp));
      gl.uniform3fv(u.uCam, camPos);
      gl.uniform1f(u.uArc, arc); gl.uniform1f(u.uRad, DIST); gl.uniform1f(u.uH, H);
      gl.uniform1f(u.uAmb, cfg.ambient ?? 0.75); gl.uniform1f(u.uFloorY, floorY); gl.uniform1f(u.uTime, time);
      gl.uniform1f(u.uSat, cfg.sat ?? 1); gl.uniform1f(u.uBright, cfg.bright ?? 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // the screen
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
      gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      ({ p, u } = this.meshProg);
      gl.useProgram(p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, skin);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, depthTex);
      gl.uniform1i(u.uSkin, 0); gl.uniform1i(u.uDepth, 1);
      gl.uniformMatrix4fv(u.uVP, false, vp);
      gl.uniform2f(u.uCells, cellsX, cellsY);
      gl.uniform1f(u.uSat, cfg.sat ?? 1); gl.uniform1f(u.uBright, cfg.bright ?? 1);
      shared(u);
      gl.drawArrays(gl.TRIANGLES, 0, cellsX * cellsY * 6);
      gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);

      // the swarm
      if (swarmN > 0) {
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
        ({ p, u } = this.swarmProg);
        gl.useProgram(p);
        gl.uniform1i(u.uSkin, 0); gl.uniform1i(u.uDepth, 1);
        gl.uniformMatrix4fv(u.uVP, false, vp);
        gl.uniform3fv(u.uHit, this.hit);
        gl.uniform1f(u.uSwarm, cfg.swarm ?? 0.5);
        gl.uniform1f(u.uPx, h * (pxScale ?? 1));
        shared(u);
        gl.drawArrays(gl.POINTS, 0, swarmN);
        gl.depthMask(true); gl.disable(gl.BLEND);
      }
    }
    gl.activeTexture(gl.TEXTURE0);
  }
}

function rotZ_(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); }
