// Repaints each frame as a cartoon, entirely on the GPU:
//   1. paint   - Kuwahara filter: flattens texture into painterly patches
//   2. bloom   - bright parts, blurred at quarter size
//   3. style   - colour bands, ink lines that "boil", grading and extras
// Frames are held like hand-drawn animation ("on twos" = 12 fps).

import { compile, Target, FULLSCREEN_VS } from './mat4.js';

const PAINT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uRadius;
out vec4 o;
void main() {
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  float st = uRadius / 3.0;
  for (int k = 0; k < 4; k++) {
    vec2 sg = vec2(k == 1 || k == 3 ? 1.0 : -1.0, k >= 2 ? 1.0 : -1.0);
    vec3 m = vec3(0.0), s = vec3(0.0);
    for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) {
      vec3 c = texture(uSrc, vUv + vec2(float(i), float(j)) * st * sg * uTexel).rgb;
      m += c; s += c * c;
    }
    m /= 16.0;
    vec3 v = abs(s / 16.0 - m * m);
    float sigma = v.r + v.g + v.b;
    float w = 1.0 / (1.0 + pow(sigma * 300.0, 3.0));
    acc += m * w; wsum += w;
  }
  o = vec4(acc / wsum, 1.0);
}
`;

const BRIGHT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
out vec4 o;
void main() {
  vec3 c = texture(uSrc, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  o = vec4(c * smoothstep(0.55, 0.95, l), 1.0);
}
`;

const BLUR = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uDir;
out vec4 o;
void main() {
  vec3 c = texture(uSrc, vUv).rgb * 0.227;
  c += (texture(uSrc, vUv + uDir * 1.384).rgb + texture(uSrc, vUv - uDir * 1.384).rgb) * 0.316;
  c += (texture(uSrc, vUv + uDir * 3.230).rgb + texture(uSrc, vUv - uDir * 3.230).rgb) * 0.070;
  o = vec4(c, 1.0);
}
`;

const STYLE = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uS, uB;
uniform vec2 uRes, uCrop;
uniform float uAspect, uT;
uniform int uStyle;
uniform float uLines, uBands, uBoil, uGlow, uExtras, uSat, uBright;
out vec4 o;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// Sobel on colour; returns magnitude in .x and luminance gradient in .yz
vec3 edges(vec2 uv, vec2 o) {
  vec3 tl = texture(uS, uv + o * vec2(-1,  1)).rgb, tc = texture(uS, uv + o * vec2(0,  1)).rgb, tr = texture(uS, uv + o * vec2(1,  1)).rgb;
  vec3 ml = texture(uS, uv + o * vec2(-1,  0)).rgb,                                            mr = texture(uS, uv + o * vec2(1,  0)).rgb;
  vec3 bl = texture(uS, uv + o * vec2(-1, -1)).rgb, bc = texture(uS, uv + o * vec2(0, -1)).rgb, br = texture(uS, uv + o * vec2(1, -1)).rgb;
  vec3 gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
  vec3 gy = (tl + 2.0 * tc + tr) - (bl + 2.0 * bc + br);
  float m = sqrt(dot(gx, gx) + dot(gy, gy));
  return vec3(m, luma(gx), luma(gy));
}

// soft cel bands: n steps with a blend of width w at each step
float bands(float v, float n, float w) {
  float f = v * n;
  return (floor(f) + smoothstep(0.5 - w, 0.5 + w, fract(f))) / n;
}

// 4-point twinkle
float sparkle(vec2 p, float r) {
  vec2 a = abs(p);
  float star = max(0.0, 1.0 - (a.x * a.y * 40.0 + length(p) * 0.9) / r);
  return pow(star, 3.0) + exp(-dot(p, p) / (r * r * 0.02)) * 0.6;
}

// one falling blossom petal per cell
float petals(vec2 uv, float scale, float t, float seed) {
  vec2 p = uv * vec2(uAspect, 1.0) * scale;
  p += vec2(t * 0.35, t * 0.55) * scale * 0.18;
  vec2 id = floor(p), f = fract(p) - 0.5;
  float h = hash(id + seed);
  if (h > 0.45) return 0.0;
  f -= (vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5) * 0.6;
  float a = t * (1.5 + h * 3.0) + h * 40.0;
  f = mat2(cos(a), -sin(a), sin(a), cos(a)) * f;
  f.x *= 1.0 + 0.6 * sin(t * 3.0 + h * 20.0);  // tumbling
  float d = length(f * vec2(1.0, 2.0)) - 0.12;
  return 1.0 - smoothstep(-0.01, 0.02, d);
}

void main() {
  vec2 uv = 0.5 + (vUv - 0.5) * uCrop;   // cover-fit when the output shape differs from the clip
  vec2 q = uv * vec2(uAspect, 1.0);
  // boiling line work: everything wobbles a little, re-rolled every held frame
  vec2 boil = (vec2(vnoise(q * 6.0 + uT * 17.3), vnoise(q * 6.0 + 41.7 + uT * 17.3)) - 0.5) * uBoil * 3.0 / uRes;
  vec3 c = texture(uS, uv + boil * 0.4).rgb;
  vec3 bloom = texture(uB, uv).rgb;
  float lum = luma(c);

  float lw = uLines * (uStyle == 0 ? 1.7 : uStyle == 1 ? 0.9 : 1.3);
  if (uStyle == 2) lw *= 0.55 + 0.9 * vnoise(q * 9.0 + 3.0);          // brush pressure
  vec3 e = edges(uv + boil, max(lw, 0.35) * uRes.y / 1080.0 / uRes);
  float th = uStyle == 0 ? 0.22 : uStyle == 1 ? 0.2 : 0.26;
  float edge = smoothstep(th, th * 1.7, e.x) * step(0.05, uLines);

  vec3 hsv = rgb2hsv(c);
  vec3 col;

  if (uStyle == 0) {
    // ---- toon: flat colour, hard bands, ink outlines ----
    hsv.x = mix(hsv.x, floor(hsv.x * 12.0 + 0.5) / 12.0, 0.3);
    hsv.y = clamp(hsv.y * uSat + 0.03, 0.0, 1.0);
    float v = bands(hsv.z, uBands, 0.03);
    v = clamp(v * 1.1 + 0.08, 0.0, 1.0);
    col = hsv2rgb(vec3(hsv.x, hsv.y, v));
    float shade = 1.0 - smoothstep(0.0, 1.6 / uBands, hsv.z);
    col = mix(col, col * vec3(0.55, 0.52, 0.9) + vec3(0.03, 0.0, 0.07), shade * 0.7);
    col = mix(col, vec3(1.0, 1.0, 0.96), smoothstep(0.9, 0.93, hsv.z) * uExtras * 0.7);   // gloss blobs
    col += bloom * vec3(0.4, 1.0, 0.35) * uGlow * 0.8;                                  // portal-green glow
    col = mix(col, vec3(0.02, 0.02, 0.035), edge);
  } else if (uStyle == 1) {
    // ---- anime: soft cel shading, cool shadows, warm light, coloured lines, bloom ----
    hsv.y = clamp(hsv.y * uSat * 1.1 + 0.04, 0.0, 1.0);
    float v = mix(hsv.z, bands(hsv.z, uBands, 0.08), 0.8);
    col = hsv2rgb(vec3(hsv.x, hsv.y, v));
    float shade = 1.0 - smoothstep(0.25, 0.55, hsv.z);
    col = mix(col, col * vec3(0.62, 0.66, 1.0), shade * 0.55);
    col = mix(col, col * vec3(1.08, 1.02, 0.9) + vec3(0.04, 0.03, 0.0), smoothstep(0.6, 0.85, hsv.z) * 0.6);
    // painted sky: open bright areas high in frame get the anime blue push
    float sky = smoothstep(0.5, 0.85, uv.y) * smoothstep(0.35, 0.7, hsv.z) * (1.0 - smoothstep(0.05, 0.25, e.x));
    col = mix(col, col * vec3(0.82, 0.96, 1.22) + vec3(0.0, 0.02, 0.06), sky * 0.55);
    col = mix(col, col * 0.32, edge * 0.92);                                             // coloured line art
    col = 1.0 - (1.0 - col) * (1.0 - bloom * uGlow * 1.2);                               // screen bloom
    // sparkles riding on the highlights
    vec2 g = q * 34.0;
    vec2 id = floor(g), f = fract(g) - 0.5;
    float h = hash(id + floor(uT * 2.0) * 0.13);
    float b = luma(texture(uB, (id + 0.5) / 34.0 / vec2(uAspect, 1.0)).rgb);
    if (h < 0.08 * uExtras && b > 0.12) col += vec3(1.0, 0.97, 0.9) * sparkle(f - (vec2(hash(id + 1.0), hash(id + 2.0)) - 0.5) * 0.5, 0.45) * min(1.0, b * 3.0);
    // light leak from the top corner
    float leak = smoothstep(1.2, 0.0, length((uv - vec2(0.05, 1.05)) * vec2(uAspect, 1.0)));
    col += vec3(1.0, 0.7, 0.85) * leak * uGlow * 0.18;
  } else {
    // ---- kung fu: painterly, golden grade, rim light, brush ink, blossom ----
    vec3 base = mix(vec3(lum), c, uSat);
    vec3 hs = rgb2hsv(base);
    hs.z = mix(hs.z, bands(hs.z, uBands, 0.25), 0.55);
    col = hsv2rgb(hs);
    col = mix(col, col * vec3(1.18, 0.98, 0.7) + vec3(0.04, 0.02, 0.0), smoothstep(0.3, 0.9, lum));   // amber light
    col = mix(col, col * vec3(0.62, 0.9, 1.0) + vec3(0.0, 0.03, 0.05), 1.0 - smoothstep(0.04, 0.45, lum)); // teal shade
    // rim light on silhouettes that face the sun
    vec2 gd = normalize(e.yz + 1e-5);
    float rim = max(0.0, dot(gd, normalize(vec2(-0.4, 0.9)))) * smoothstep(0.08, 0.4, e.x);
    col += vec3(1.0, 0.72, 0.35) * rim * 0.45 * uGlow;
    // canvas / paper tooth
    float tooth = vnoise(q * 220.0) * 0.6 + vnoise(q * 60.0) * 0.4;
    col *= 0.93 + tooth * 0.12;
    // brush ink: broken, tapered strokes
    float brk = smoothstep(0.25, 0.6, vnoise(q * vec2(28.0, 16.0) + 9.0));
    col = mix(col, vec3(0.13, 0.06, 0.035), edge * mix(0.45, 0.95, brk));
    // god rays from the top
    vec2 lp = vec2(0.62, 1.15);
    vec2 dv = (uv - lp) * vec2(uAspect, 1.0);
    float ang = atan(dv.x, dv.y);
    float rays = pow(vnoise(vec2(ang * 9.0, uT * 0.15)), 3.0) * smoothstep(1.6, 0.2, length(dv));
    col += vec3(1.0, 0.78, 0.45) * rays * uGlow * 0.45;
    col = 1.0 - (1.0 - col) * (1.0 - bloom * vec3(1.0, 0.8, 0.5) * uGlow * 1.3);
    // drifting blossom petals, two depths
    float p1 = petals(uv, 7.0, uT, 1.0), p2 = petals(uv, 13.0, uT * 0.8, 5.0);
    col = mix(col, vec3(1.0, 0.62, 0.74), p1 * uExtras * 0.9);
    col = mix(col, vec3(1.0, 0.78, 0.86), p2 * uExtras * 0.6);
    // grain
    col += (hash(uv * uRes + fract(uT * 7.1) * 100.0) - 0.5) * 0.045;
  }

  // vignette
  vec2 vv = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  col *= 1.0 - smoothstep(0.55, 1.25, length(vv)) * (uStyle == 2 ? 0.55 : 0.3);
  col *= uBright;
  o = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export class ToonRenderer {
  constructor(gl) {
    this.gl = gl;
    this.paint = compile(gl, FULLSCREEN_VS, PAINT);
    this.bright = compile(gl, FULLSCREEN_VS, BRIGHT);
    this.blur = compile(gl, FULLSCREEN_VS, BLUR);
    this.style = compile(gl, FULLSCREEN_VS, STYLE);
    this.S = new Target(gl);
    this.B1 = new Target(gl);
    this.B2 = new Target(gl);
    this.vao = gl.createVertexArray();
    this.lastStep = null;
    this.sig = '';
  }

  // src: texture with the current frame. target: Target, or null for the canvas.
  render({ src, srcW, srcH, outW, outH, target = null, time, cfg, style }) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);

    const hold = cfg.hold ?? 12;
    const step = hold > 0 ? Math.floor(time * hold) : time;
    const t = hold > 0 ? step / hold : time;

    // working size: smaller when the paint is heavier (cheaper and more painterly)
    const workH = Math.min(srcH, outH, 720) * (1 - (cfg.smooth ?? 0.5) * 0.35);
    const workW = workH * (srcW / srcH);
    const sig = `${Math.round(workW)}x${Math.round(workH)}:${cfg.smooth}:${outW}x${outH}`;
    if (step !== this.lastStep || sig !== this.sig) {
      this.lastStep = step; this.sig = sig;
      // 1. paint
      this.S.size(workW, workH).bind();
      gl.useProgram(this.paint.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
      gl.uniform1i(this.paint.u.uSrc, 0);
      gl.uniform2f(this.paint.u.uTexel, 1 / this.S.w, 1 / this.S.h);
      gl.uniform1f(this.paint.u.uRadius, 1.5 + (cfg.smooth ?? 0.5) * 4.5);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // 2. bloom
      this.B1.size(this.S.w / 4, this.S.h / 4).bind();
      this.B2.size(this.B1.w, this.B1.h);
      gl.useProgram(this.bright.p);
      gl.bindTexture(gl.TEXTURE_2D, this.S.tex);
      gl.uniform1i(this.bright.u.uSrc, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.useProgram(this.blur.p);
      gl.uniform1i(this.blur.u.uSrc, 0);
      for (let i = 0; i < 2; i++) {
        this.B2.bind(); gl.bindTexture(gl.TEXTURE_2D, this.B1.tex);
        gl.uniform2f(this.blur.u.uDir, (1.5 + i) / this.B1.w, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
        this.B1.bind(); gl.bindTexture(gl.TEXTURE_2D, this.B2.tex);
        gl.uniform2f(this.blur.u.uDir, 0, (1.5 + i) / this.B1.h); gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    }

    // 3. style, at full output size
    if (target) target.size(outW, outH).bind();
    else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, outW, outH); }
    const u = this.style.u;
    gl.useProgram(this.style.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.S.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.B1.tex);
    gl.uniform1i(u.uS, 0); gl.uniform1i(u.uB, 1);
    gl.uniform2f(u.uRes, outW, outH);
    gl.uniform1f(u.uAspect, srcW / srcH);
    const ka = (outW / outH) / (srcW / srcH);
    gl.uniform2f(u.uCrop, Math.min(1, ka), Math.min(1, 1 / ka));
    gl.uniform1f(u.uT, t);
    gl.uniform1i(u.uStyle, style);
    gl.uniform1f(u.uLines, cfg.lines ?? 1);
    gl.uniform1f(u.uBands, Math.max(2, cfg.bands ?? 4));
    gl.uniform1f(u.uBoil, cfg.boil ?? 0.5);
    gl.uniform1f(u.uGlow, cfg.glow ?? 0.5);
    gl.uniform1f(u.uExtras, cfg.extras ?? 0.5);
    gl.uniform1f(u.uSat, cfg.sat ?? 1);
    gl.uniform1f(u.uBright, cfg.bright ?? 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
    if (target) gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  invalidate() { this.lastStep = null; }
}
