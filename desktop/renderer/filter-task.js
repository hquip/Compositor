import { surface } from './raster.js';
import { glyphAtlas } from './finishing.js';

export class FilterTask {
  cancel() {
    clearTimeout(this.startupTimer);
    if (this.worker) this.worker.terminate(); this.worker = null;
    this.reject?.(new DOMException('Canceled', 'AbortError')); this.reject = null;
  }
  async run(image, action, kind, settings, scale = 1, limits = { side: 30000, pixels: 200000000 }) {
    this.cancel();
    const worker = new Worker(new URL('./filter-worker.js', import.meta.url), { type: 'module' }); this.worker = worker;
    return await new Promise((resolve, reject) => {
      this.reject = reject;
      const finish = (error, result) => { clearTimeout(this.startupTimer); if (this.worker === worker) { this.worker = null; this.reject = null; } worker.terminate(); error ? reject(error) : resolve(result); };
      this.startupTimer = setTimeout(() => finish(new Error('Could not start image processing.')), 15000);
      worker.onerror = (event) => { event.preventDefault(); finish(new Error(event.message || 'Could not process the image.')); };
      worker.onmessage = ({ data }) => {
        if (this.worker !== worker) { data.image?.close(); return; }
        if (data.ready) {
          clearTimeout(this.startupTimer);
          try {
            const pixels = image.getContext('2d').getImageData(0, 0, image.width, image.height);
            const prepared = kind === 'Dither' && settings.style === 'Glyphs' ? { ...settings, glyphAtlas: glyphAtlas({ ...settings, cell: Math.max(1, Math.round((settings.cell ?? 8) * scale)) }) } : settings;
            worker.postMessage({ pixels, action, kind, settings: prepared, scale, limits }, [pixels.data.buffer]);
          }
          catch (error) { finish(error); } return;
        }
        if (data.error) { finish(new Error(data.error)); return; }
        try {
          const source = data.image ?? data.pixels, output = surface(source.width, source.height);
          if (data.image) output.getContext('2d').drawImage(data.image, 0, 0); else output.getContext('2d').putImageData(new ImageData(data.pixels.data, source.width, source.height), 0, 0);
          if (data.hdr) output.compositorHDR = data.hdr;
          finish(null, output);
        } catch (error) { finish(error); } finally { data.image?.close(); }
      };
    });
  }
}
