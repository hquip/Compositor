import { decodePNG } from './png-pixels.js';
import { base64Bytes } from './precision-raster.js';
import { filterMaskName } from './filter-mix.js';

export async function preparedFilters(filters, assets) {
  const result = [];
  for (const entry of filters) {
    const copy = structuredClone(entry);
    if (entry.maskFile && entry.maskEnabled !== false && entry.enabled && (entry.opacity ?? 1) > 0) {
      if (!assets?.[entry.maskFile]) throw new Error('A filter mask is missing.');
      const image = await decodePNG(base64Bytes(assets[entry.maskFile]), 200000000);
      copy.mask = { width: image.width, height: image.height, values: Uint8Array.from({ length: image.width * image.height }, (_, i) => Math.round(image.data[i * 4] / 257)) };
    }
    result.push(copy);
  } return result;
}
export function copyFilterResources(filters, assets, layerID) {
  const output = {}, copies = filters.map((item) => {
    const entry = structuredClone(item); entry.id = crypto.randomUUID().toUpperCase();
    if (item.maskFile) { if (!assets?.[item.maskFile]) throw new Error('A filter mask is missing.'); entry.maskFile = filterMaskName(layerID, entry.id); output[entry.maskFile] = assets[item.maskFile]; }
    return entry;
  }); return { filters: copies, assets: output };
}
