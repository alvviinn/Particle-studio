// Works out which parts of the frame are "the subject" so the background can be
// thinned out and the particles gather around the object itself.
//   motion - anything that moves against a static camera
//   person - MediaPipe selfie segmentation, loaded on demand

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

export class SubjectMask {
  constructor() {
    this.mode = 'off';
    this.seg = null;
    this.segLoading = null;
    this.reset();
  }

  reset() {
    this.bg = null; this.acc = null; this.frames = 0; this.lastTime = -1;
    this.votes = 0; this.prev = null;
  }

  async setMode(mode) {
    this.mode = mode;
    this.reset();
    if (mode === 'person' && !this.seg) {
      this.segLoading ??= this.#loadSegmenter();
      try { await this.segLoading; } catch (e) {
        this.segLoading = null;
        this.mode = 'motion';
        throw e;
      }
    }
  }

  async #loadSegmenter() {
    const vision = await import(/* @vite-ignore */ `${MP}/vision_bundle.mjs`);
    const files = await vision.FilesetResolver.forVisionTasks(`${MP}/wasm`);
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false,
    });
    try { this.seg = await vision.ImageSegmenter.createFromOptions(files, opts('GPU')); }
    catch { this.seg = await vision.ImageSegmenter.createFromOptions(files, opts('CPU')); }
  }

  // Returns { data, w, h } when there is a fresh mask, otherwise null.
  update(video, time = video.currentTime) {
    if (this.mode === 'off' || (video.readyState !== undefined && video.readyState < 2)) return null;
    if (time === this.lastTime && this.prev) return null;
    if (time < this.lastTime - 0.5) this.reset(); // looped or scrubbed back
    this.lastTime = time;
    return this.mode === 'person' ? this.#person(video) : this.#motion(video);
  }

  #motion(video) {
    const W = 160, H = Math.max(8, Math.round(W * (video.videoHeight || video.height) / (video.videoWidth || video.width)));
    if (!this.cv) { this.cv = document.createElement('canvas'); this.g = this.cv.getContext('2d', { willReadFrequently: true }); }
    if (this.cv.width !== W || this.cv.height !== H) { this.cv.width = W; this.cv.height = H; this.bg = null; }
    this.g.drawImage(video, 0, 0, W, H);
    const px = this.g.getImageData(0, 0, W, H).data;
    const n = W * H;
    if (!this.bg) { this.bg = new Float32Array(n * 3); this.acc = new Float32Array(n); this.frames = 0; }
    const rate = this.frames < 40 ? 1 / (this.frames + 1) : 0.005;
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
      const dr = Math.abs(r - this.bg[i * 3]), dg = Math.abs(g - this.bg[i * 3 + 1]), db = Math.abs(b - this.bg[i * 3 + 2]);
      const d = (dr + dg + db) / 765;
      const t = Math.min(1, Math.max(0, (d - 0.05) / 0.13));
      const m = t * t * (3 - 2 * t);
      this.acc[i] = Math.max(m, this.acc[i] * 0.94);
      raw[i] = Math.min(1, this.acc[i] * 1.4);
      this.bg[i * 3] += (r - this.bg[i * 3]) * rate;
      this.bg[i * 3 + 1] += (g - this.bg[i * 3 + 1]) * rate;
      this.bg[i * 3 + 2] += (b - this.bg[i * 3 + 2]) * rate;
    }
    this.frames++;
    return this.#finish(this.#blur(this.#blur(raw, W, H), W, H), W, H);
  }

  #person(video) {
    let result;
    try { result = this.seg.segmentForVideo(video, performance.now()); } catch { return null; }
    const mask = result.confidenceMasks?.[0];
    if (!mask) return null;
    const W = mask.width, H = mask.height;
    const f = mask.getAsFloat32Array();

    // The model's polarity differs between builds: assume the person is nearer the middle.
    let mid = 0, midN = 0, edge = 0, edgeN = 0;
    for (let y = 0; y < H; y += 4) for (let x = 0; x < W; x += 4) {
      const v = f[y * W + x];
      if (x > W * 0.3 && x < W * 0.7 && y > H * 0.25 && y < H * 0.85) { mid += v; midN++; } else { edge += v; edgeN++; }
    }
    this.votes += mid / midN < edge / edgeN ? 1 : -1;
    const invert = this.votes > 0;

    const out = new Float32Array(W * H);
    for (let i = 0; i < out.length; i++) {
      const v = invert ? 1 - f[i] : f[i];
      out[i] = v < 0.35 ? 0 : v > 0.65 ? 1 : (v - 0.35) / 0.3;
    }
    mask.close?.(); result.close?.();
    return this.#finish(this.#blur(out, W, H), W, H);
  }

  #blur(src, W, H) {
    const out = new Float32Array(src.length);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H) { s += src[yy * W + xx]; c++; }
      }
      out[y * W + x] = s / c;
    }
    return out;
  }

  #finish(f, W, H) {
    if (!this.prev || this.prev.length !== f.length) this.prev = new Float32Array(f);
    const data = new Uint8Array(W * H);
    for (let i = 0; i < f.length; i++) {
      const v = this.prev[i] * 0.45 + f[i] * 0.55; // light temporal smoothing
      this.prev[i] = v;
      data[i] = Math.round(Math.min(1, v) * 255);
    }
    return { data, w: W, h: H };
  }
}
