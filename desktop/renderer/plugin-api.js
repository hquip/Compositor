export const PLUGIN_API_VERSION = 1;
export function validatePlugin(manifest, source) {
  if (!manifest || manifest.apiVersion !== PLUGIN_API_VERSION || typeof manifest.id !== 'string' || !/^[a-z][a-z0-9.-]{2,80}$/.test(manifest.id) || typeof manifest.name !== 'string' || manifest.name.length > 200 || typeof source !== 'string' || source.length > 1024 * 1024) throw new Error('Invalid image plugin manifest or source.');
  return { apiVersion: 1, id: manifest.id, name: manifest.name, description: typeof manifest.description === 'string' ? manifest.description.slice(0, 1000) : '' };
}
export function runImagePlugin(source, image, settings = {}, signal) {
  if (image.width * image.height > 16000000 || image.data.length !== image.width * image.height * 4) throw new Error('The plugin image exceeds the supported dimensions.');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./plugin-worker.js', import.meta.url), { type: 'module' }); let done = false;
    const finish = (error, result) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate(); error ? reject(error) : resolve(result); };
    const abort = () => finish(new DOMException('Canceled', 'AbortError')), timer = setTimeout(() => finish(new Error('The image plugin exceeded its execution time limit.')), 15000);
    if (signal?.aborted) { abort(); return; } signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = (event) => { event.preventDefault(); finish(new Error(event.message || 'The image plugin failed.')); };
    worker.onmessage = ({ data }) => {
      if (data.ready) { const pixels = image.data.slice().buffer; worker.postMessage({ source, width: image.width, height: image.height, pixels, settings }, [pixels]); return; }
      if (data.error) { finish(new Error(data.error)); return; }
      if (!(data.pixels instanceof ArrayBuffer) || data.pixels.byteLength !== image.data.byteLength) { finish(new Error('The image plugin returned invalid pixels.')); return; }
      finish(null, new Uint8ClampedArray(data.pixels));
    };
  });
}
