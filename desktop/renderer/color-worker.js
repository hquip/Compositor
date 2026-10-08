import { composePrecision } from './precision-composite.js';
import { profileBytes, convertColors, validateProfile } from './color-engine.js';
import { encodeTIFF } from './tiff-export.js';

self.onmessage = async ({ data: options }) => {
  try {
    const source = await composePrecision(options.snapshot, { preview: options.preview, workingSpace: options.workingSpace ?? 'sRGB' }), count = source.width * source.height, rgb = new Uint16Array(count * 3), space = validateProfile(options.profile);
    if (!['RGB', 'CMYK'].includes(space)) throw new Error('Select an RGB or CMYK output profile.');
    for (let i = 0; i < count; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = space === 'CMYK' ? Math.round(source.data[i * 4 + c] * source.data[i * 4 + 3] / 65535 + 65535 - source.data[i * 4 + 3]) : source.data[i * 4 + c];
    if (options.preview) {
      const srgb = await profileBytes('sRGB'), result = await convertColors(rgb, source.profile, srgb, { intent: options.intent, blackPoint: options.blackPoint, proofProfile: options.proof ? options.profile : null });
      const pixels = new Uint8ClampedArray(count * 4); for (let i = 0; i < count; i++) { for (let c = 0; c < 3; c++) pixels[i * 4 + c] = Math.round(result.samples[i * 3 + c] / 257); pixels[i * 4 + 3] = space === 'CMYK' ? 255 : Math.round(source.data[i * 4 + 3] / 257); }
      self.postMessage({ width: source.width, height: source.height, pixels }, [pixels.buffer]); return;
    }
    const result = await convertColors(rgb, source.profile, options.profile, { intent: options.intent, blackPoint: options.blackPoint, outputBits: options.bits });
    const alpha = space === 'RGB'; let samples = result.samples, channels = result.channels;
    if (alpha) { samples = options.bits === 16 ? new Uint16Array(count * 4) : new Uint8Array(count * 4); channels = 4; for (let i = 0; i < count; i++) { samples.set(result.samples.subarray(i * 3, i * 3 + 3), i * 4); samples[i * 4 + 3] = Math.round(source.data[i * 4 + 3] / (options.bits === 16 ? 1 : 257)); } }
    const bytes = encodeTIFF({ width: source.width, height: source.height, samples, channels, bits: options.bits, profile: options.profile, resolution: options.snapshot.manifest.resolution ?? 72, cmyk: space === 'CMYK', alpha }); self.postMessage({ bytes }, [bytes.buffer]);
  } catch (error) { self.postMessage({ error: error?.message ?? String(error) }); }
};
self.postMessage({ ready: true });
