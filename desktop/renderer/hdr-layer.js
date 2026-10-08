import { surface } from './raster.js';
import { toneMapHDR, srgbToLinear, HDR_BLENDS, HDR_FILTERS } from './hdr-pixels.js';
import { composeHDRPixels } from './hdr-compose.js';
import { maskValues } from './masks.js';
import { decodeFloatTIFF } from './vendor/float-tiff.js';
import { base64Bytes } from './precision-raster.js';
import { preparedFilters } from './filter-resources.js';
import { applyHDRFilters } from './hdr-pixels.js';
import { convertHDRColor } from './hdr-color.js';

export function hdrCanvas(source, view = {}, original = source) {
  const display = toneMapHDR(source, view), canvas = surface(source.width, source.height); canvas.getContext('2d').putImageData(new ImageData(display.data, display.width, display.height), 0, 0);
  canvas.compositorHDR = source; canvas.compositorHDRSource = original; canvas.compositorHDRView = view; return canvas;
}
export async function attachHDRAssets(layer, canvas, assets) {
  const source = decodeFloatTIFF(base64Bytes(assets[layer.hdrSourceFile]), 16000000, true), filters = await preparedFilters(layer.filters ?? [], assets);
  canvas.compositorHDRSource = source; canvas.compositorHDR = applyHDRFilters(source, filters); return canvas;
}
export function assertHDRCompatible(manifest) {
  for (const layer of manifest.layers) {
    if (!layer.isGroup && !HDR_BLENDS.includes(layer.blendMode ?? 'Normal')) throw new Error('Choose a supported HDR blend mode before adding or exporting HDR content.');
    if (Object.values(layer.effects ?? {}).some((effect) => effect && effect.enabled !== false)) throw new Error('Rasterize layer effects on an SDR layer before HDR compositing.');
    if (layer.adjustment && !HDR_FILTERS.includes(layer.adjustment.kind)) throw new Error('This adjustment layer needs an SDR document or a rasterized HDR display.');
  }
}
const cache = new WeakMap();
const converted = new WeakMap();
function workingSource(source, from, to) { if (from === to) return source; const saved = converted.get(source); if (saved?.space === to) return saved.value; const value = convertHDRColor(source, from, to); converted.set(source, { space: to, value }); return value; }
export function composeHDRCanvas(manifest, images, masks, scale = 1, raw = false) {
  assertHDRCompatible(manifest); const sources = new Map(), mattes = new Map(), workingSpace = manifest.hdrWorkingSpace ?? 'Linear sRGB';
  for (const layer of manifest.layers) {
    const image = images.get(layer.id);
    if (image) {
      if (layer.hdrSourceFile && image.compositorHDR) { const source = image.compositorHDR; sources.set(layer.id, workingSource(source, source.linearSpace ?? 'Linear sRGB', workingSpace)); }
      else {
        let source = cache.get(image); if (!source || source.revision !== (image.compositorRevision ?? 0)) {
          const rgba = image.getContext('2d').getImageData(0, 0, image.width, image.height).data, data = new Float32Array(rgba.length);
          for (let i = 0; i < rgba.length; i += 4) { for (let c = 0; c < 3; c++) data[i + c] = srgbToLinear(rgba[i + c] / 255); data[i + 3] = rgba[i + 3] / 255; } source = { width: image.width, height: image.height, data, revision: image.compositorRevision ?? 0 }; cache.set(image, source);
        } sources.set(layer.id, workingSource(source, 'Linear sRGB', workingSpace));
      }
    }
    const mask = masks.get(layer.id); if (mask) {
      const values = maskValues(mask); let sum = 0, count = 0;
      for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) if (!x || !y || x === mask.width - 1 || y === mask.height - 1) { sum += values[y * mask.width + x]; count++; }
      mattes.set(layer.id, { width: mask.width, height: mask.height, values, outside: sum * 2 >= count * 255 ? 1 : 0 });
    }
  }
  const result = composeHDRPixels(manifest, sources, mattes, scale); return raw ? result : hdrCanvas(result, manifest.hdrView);
}
