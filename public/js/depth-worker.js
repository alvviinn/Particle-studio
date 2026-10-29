// Runs Depth Anything V2 (small) off the main thread. Frames come in as
// ImageBitmaps; depth maps go back as 8-bit arrays (white = near).

const TF = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const MODEL = 'onnx-community/depth-anything-v2-small';
let estimator = null, RawImage = null, canvas = null, g = null;

async function load() {
  const tf = await import(`${TF}/dist/transformers.min.js`);
  RawImage = tf.RawImage;
  tf.env.allowLocalModels = false;
  let device = 'wasm';
  try { if (self.navigator?.gpu && await navigator.gpu.requestAdapter()) device = 'webgpu'; } catch { /* wasm it is */ }
  const progress = (p) => { if (p.status === 'progress' && p.file?.endsWith('.onnx')) postMessage({ type: 'progress', value: p.progress / 100 }); };
  try {
    estimator = await tf.pipeline('depth-estimation', MODEL, { device, dtype: device === 'webgpu' ? 'fp16' : 'q8', progress_callback: progress });
  } catch (e) {
    if (device === 'wasm') throw e;
    device = 'wasm';
    estimator = await tf.pipeline('depth-estimation', MODEL, { device, dtype: 'q8', progress_callback: progress });
  }
  return device;
}

self.onmessage = async ({ data }) => {
  if (data.type === 'load') {
    try { postMessage({ type: 'ready', device: await load() }); }
    catch (e) { postMessage({ type: 'error', message: String(e?.message || e) }); }
    return;
  }
  if (data.type === 'frame' && estimator) {
    const bmp = data.bitmap;
    try {
      canvas ??= new OffscreenCanvas(bmp.width, bmp.height);
      if (canvas.width !== bmp.width || canvas.height !== bmp.height) { canvas.width = bmp.width; canvas.height = bmp.height; g = null; }
      g ??= canvas.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0);
      const px = g.getImageData(0, 0, bmp.width, bmp.height);
      const img = new RawImage(px.data, bmp.width, bmp.height, 4);
      const { depth } = await estimator(img);
      const out = new Uint8Array(depth.data.length / depth.channels);
      for (let i = 0; i < out.length; i++) out[i] = depth.data[i * depth.channels];
      postMessage({ type: 'depth', data: out, w: depth.width, h: depth.height }, [out.buffer]);
    } catch (e) {
      postMessage({ type: 'error', message: String(e?.message || e) });
    } finally { bmp.close(); }
  }
};
