import { encodeWebP } from './vendor/webp/webp.js';

self.onmessage = async ({ data }) => {
  try {
    const image = new ImageData(new Uint8ClampedArray(data.pixels), data.width, data.height);
    const bytes = await encodeWebP(image, { quality: data.quality, lossless: data.lossless ? 1 : 0, exact: 1, method: 4, alpha_quality: 100, near_lossless: 100 });
    self.postMessage({ bytes }, [bytes]);
  } catch (error) { self.postMessage({ error: error.message }); }
};
self.postMessage({ ready: true });
