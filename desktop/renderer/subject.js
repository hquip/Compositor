import { surface, alphaSurface, clamp, morphology } from './raster.js';
let session;
const cache = new WeakMap();

export async function subjectMask(image) {
  if (cache.has(image)) return cache.get(image);
  const ort = await import('./vendor/ort/ort.wasm.min.mjs'); ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = new URL('./vendor/ort/', import.meta.url).href;
  session ??= await ort.InferenceSession.create(new URL('./models/u2netp.onnx', import.meta.url).href, { executionProviders: ['wasm'] });
  const input = surface(320, 320), context = input.getContext('2d'); context.drawImage(image, 0, 0, 320, 320);
  const pixels = context.getImageData(0, 0, 320, 320).data, data = new Float32Array(3 * 320 * 320), mean = [.485, .456, .406], deviation = [.229, .224, .225];
  let maximum = 0; for (let i = 0; i < pixels.length; i += 4) maximum = Math.max(maximum, pixels[i], pixels[i + 1], pixels[i + 2]); maximum ||= 255;
  for (let i = 0; i < 320 * 320; i++) for (let c = 0; c < 3; c++) data[c * 320 * 320 + i] = (pixels[i * 4 + c] / maximum - mean[c]) / deviation[c];
  const result = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', data, [1, 3, 320, 320]) });
  const values = result[session.outputNames[0]].data; let min = Infinity, max = -Infinity;
  for (const value of values) { min = Math.min(min, value); max = Math.max(max, value); }
  const coverage = Uint8ClampedArray.from(values, (value) => Math.round(clamp((value - min) / Math.max(.00001, max - min)) * 255));
  const mask = alphaSurface(coverage, 320, 320), output = surface(image.width, image.height); output.getContext('2d').drawImage(mask, 0, 0, image.width, image.height);
  cache.set(image, output); return output;
}
