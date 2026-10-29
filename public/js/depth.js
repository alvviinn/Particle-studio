// AI depth for the immersive mode. Downloads a small depth model once
// (cached by the browser afterwards) and keeps estimating depth from the
// current frame in a worker, as fast as the device allows.

export class DepthAI {
  constructor() {
    this.worker = null;
    this.ready = false;
    this.busy = false;
    this.latest = null;   // { data, w, h }
    this.onUpdate = null;
  }

  // onProgress(0..1) while the model downloads. Resolves with 'webgpu' | 'wasm'.
  load(onProgress) {
    if (this.loading) return this.loading;
    this.loading = new Promise((resolve, reject) => {
      this.worker = new Worker(new URL('./depth-worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }) => {
        if (data.type === 'progress') onProgress?.(data.value);
        else if (data.type === 'ready') { this.ready = true; resolve(data.device); }
        else if (data.type === 'depth') { this.busy = false; this.latest = data; this.onUpdate?.(data); }
        else if (data.type === 'error') {
          this.busy = false;
          if (!this.ready) { this.stop(); reject(new Error(data.message)); }
        }
      };
      this.worker.onerror = (e) => { this.stop(); reject(new Error(e.message || 'The depth worker failed to start.')); };
      this.worker.postMessage({ type: 'load' });
    });
    return this.loading;
  }

  // Call every frame; only sends one when the worker is free.
  async feed(source) {
    if (!this.ready || this.busy || !source) return;
    const w = source.videoWidth || source.width, h = source.videoHeight || source.height;
    if (!w || !h || (source.readyState !== undefined && source.readyState < 2)) return;
    this.busy = true;
    try {
      const s = Math.min(1, 384 / Math.max(w, h));
      const bitmap = await createImageBitmap(source, { resizeWidth: Math.round(w * s), resizeHeight: Math.round(h * s) });
      this.worker.postMessage({ type: 'frame', bitmap }, [bitmap]);
    } catch { this.busy = false; }
  }

  stop() {
    this.worker?.terminate();
    this.worker = null; this.ready = false; this.busy = false; this.loading = null; this.latest = null;
  }
}
