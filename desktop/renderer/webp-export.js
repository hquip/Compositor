import { settingsDialog, numberField, boolField } from './settings-dialog.js';
import { binaryBase64 } from './psd-export.js';

export function encodeWebPImage(image, options, signal) {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.width > 16383 || image.height > 16383 || image.width * image.height > 16_000_000) throw new Error('WebP export supports up to 16 megapixels and 16,383 pixels per side.');
  if (image.data.length !== image.width * image.height * 4 || !Number.isFinite(options.quality) || options.quality < 0 || options.quality > 100) throw new Error('Invalid WebP export settings.');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./webp-worker.js', import.meta.url), { type: 'module' }); let done = false;
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate(); error ? reject(error) : resolve(value); };
    const abort = () => finish(new DOMException('Canceled', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('Could not start the WebP encoder.')), 15000);
    if (signal?.aborted) { abort(); return; } signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = (event) => { event.preventDefault(); finish(new Error(event.message || 'WebP encoding failed.')); };
    worker.onmessage = ({ data }) => {
      if (data.ready) { clearTimeout(timer); const pixels = image.data.slice().buffer; worker.postMessage({ pixels, width: image.width, height: image.height, quality: options.quality, lossless: !!options.lossless }, [pixels]); }
      else if (data.error) finish(new Error(data.error)); else finish(null, new Uint8Array(data.bytes));
    };
  });
}

export async function webpExport(canvas) {
  let encoded;
  const fields = [boolField('lossless', 'Lossless', false), numberField('quality', 'Quality', 0, 100, 90), boolField('transparency', 'Preserve transparency', true)];
  const options = await settingsDialog('Export WebP', fields, {}, null, {
    apply: async (value, signal) => {
      const image = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      if (!value.transparency) for (let i = 0; i < image.data.length; i += 4) { const alpha = image.data[i + 3] / 255; for (let c = 0; c < 3; c++) image.data[i + c] = image.data[i + c] * alpha + 255 * (1 - alpha); image.data[i + 3] = 255; }
      encoded = await encodeWebPImage(image, value, signal);
    },
  });
  return options ? 'data:image/webp;base64,' + binaryBase64(encoded) : null;
}
