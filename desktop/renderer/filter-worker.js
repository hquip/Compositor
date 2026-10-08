import { surface } from './raster.js';
import { configureCanvasLimits } from './core.js';
import { applyAdjustment, applyCameraRaw, savedAdjustment } from './adjustments.js';
import { finishingFilter } from './finishing.js';
import { refineMatte } from './refine-matte.js';
import { alphaSurface } from './raster.js';
import { precisionLayer, precisionDisplay } from './precision-raster.js';
import { mixFilterPixels } from './filter-mix.js';
import { paintFilterMask, featherFilterMask } from './filter-mask-pixels.js';
import { applyHDRFilters, toneMapHDR } from './hdr-pixels.js';

self.onmessage = async ({ data }) => {
  try {
    const { pixels, action, kind, settings, scale, limits } = data;
    configureCanvasLimits(limits.side, limits.pixels);
    const input = surface(pixels.width, pixels.height); input.getContext('2d').putImageData(pixels, 0, 0);
    const adjusted = structuredClone(settings);
    if (action === 'finishing' && scale !== 1) {
      for (const key of ['radius', 'cell', 'pixelSize', 'wobble']) if (adjusted[key] != null) adjusted[key] *= scale;
      for (const key of ['cell', 'pixelSize']) if (adjusted[key] != null) adjusted[key] = Math.max(1, Math.round(adjusted[key]));
    }
    let output, hdr;
    if (action === 'filter-mask') {
      const values = paintFilterMask(pixels.width, pixels.height, settings.mask, settings.edits, scale);
      output = alphaSurface(featherFilterMask(values, pixels.width, pixels.height, settings.feather * scale), pixels.width, pixels.height);
    } else if (action === 'hdr-filters') {
      hdr = applyHDRFilters(settings.source, settings.filters, scale); const display = toneMapHDR(hdr, settings.view); output = surface(display.width, display.height); output.getContext('2d').putImageData(new ImageData(display.data, display.width, display.height), 0, 0);
    } else if (action === 'filter-stack') {
      output = input;
      for (const entry of settings.filters) if (entry.enabled && (entry.opacity ?? 1) > 0) {
        const filtered = applyAdjustment(output, entry.adjustment, scale);
        if ((entry.opacity ?? 1) !== 1 || entry.mask && entry.maskEnabled !== false) {
          const before = output.getContext('2d').getImageData(0, 0, output.width, output.height), after = filtered.getContext('2d').getImageData(0, 0, output.width, output.height);
          mixFilterPixels(before.data, after.data, output.width, output.height, entry); filtered.getContext('2d').putImageData(after, 0, 0);
        }
        output = filtered;
      }
    } else if (action === 'precision-filters') {
      const result = await precisionDisplay(await precisionLayer(settings.source, settings.filters, settings.workingSpace, scale)); output = surface(result.width, result.height);
      const context = output.getContext('2d'), rgba = context.createImageData(result.width, result.height); rgba.data.set(result.data); context.putImageData(rgba, 0, 0);
    } else output = action === 'refine-mask' ? alphaSurface(refineMatte(pixels, settings.matte, settings, scale), pixels.width, pixels.height) : action === 'camera-raw' ? applyCameraRaw(input, settings, scale) : action === 'finishing' ? finishingFilter(input, kind, adjusted) : applyAdjustment(input, savedAdjustment(settings), scale);
    const result = output.getContext('2d').getImageData(0, 0, output.width, output.height);
    self.postMessage({ pixels: result, hdr }, hdr ? [result.data.buffer, hdr.data.buffer] : [result.data.buffer]);
  } catch (error) { self.postMessage({ error: error?.message ?? String(error) }); }
};
self.postMessage({ ready: true });
