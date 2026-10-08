import { layerEntries, localPoint } from './core.js';
import { applyHDRFilters, HDR_BLENDS } from './hdr-pixels.js';
import { maskSample } from './filter-mix.js';

export function sampleHDR(image, x, y, nearest = false) {
  const { width, height, data } = image;
  if (x < -.5 || y < -.5 || x >= width - .5 || y >= height - .5) return [0, 0, 0, 0];
  x = Math.max(0, Math.min(width - 1, x)); y = Math.max(0, Math.min(height - 1, y));
  if (nearest) { const i = (Math.round(y) * width + Math.round(x)) * 4; return [...data.subarray(i, i + 4)]; }
  const left = Math.floor(x), top = Math.floor(y), right = Math.min(width - 1, left + 1), bottom = Math.min(height - 1, top + 1), fx = x - left, fy = y - top;
  const points = [top * width + left, top * width + right, bottom * width + left, bottom * width + right], weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy], color = [0, 0, 0]; let alpha = 0;
  points.forEach((p, n) => { const a = data[p * 4 + 3] * weights[n]; alpha += a; for (let c = 0; c < 3; c++) color[c] += data[p * 4 + c] * a; });
  return [...color.map((v) => alpha ? v / alpha : 0), alpha];
}
function blendHDR(back, front, mode = 'Normal') {
  if (!HDR_BLENDS.includes(mode)) throw new Error('This blend mode needs an SDR layer/document or an explicit rasterized HDR display.');
  return back.map((b, c) => { const f = front[c]; switch (mode) { case 'Multiply': return b * f; case 'Darken': return Math.min(b, f); case 'Lighten': return Math.max(b, f); case 'Screen': return b + f - b * f; case 'Linear Dodge (Add)': return b + f; case 'Difference': return Math.abs(b - f); case 'Subtract': return b - f; case 'Divide': return Math.abs(f) < 1e-12 ? b : b / f; default: return f; } });
}
export function composeHDRPixels(manifest, sources, masks, scale = 1) {
  const width = Math.max(1, Math.round(manifest.width * scale)), height = Math.max(1, Math.round(manifest.height * scale));
  if (width * height > 16000000) throw new Error('HDR compositing is limited to 16 megapixels.');
  const entries = layerEntries(manifest.layers), byID = new Map(manifest.layers.map((l) => [l.id, l])), entryByID = new Map(entries.map((e) => [e.layer.id, e])), visible = entries.filter((e) => e.visible && !e.layer.isGroup), stacks = new Map(), stacked = new Set();
  for (let i = 0; i < visible.length; i++) { const base = visible[i].layer; if (base.maskSourceID || base.adjustment) continue; const children = [];
    for (let j = i + 1; j < visible.length; j++) { const child = visible[j].layer; if (child.maskSourceID !== base.id || child.parentID !== base.parentID) break; children.push(visible[j]); stacked.add(child.id); } if (children.length) stacks.set(base.id, children);
  }
  const maskAt = (layer, point) => {
    const mask = layer.maskEnabled !== false && masks.get(layer.id); if (!mask) return 1;
    if (mask.width === 1 && mask.height === 1) return mask.values[0] / 255;
    const p = localPoint(point, layer.maskPlacement ?? layer.transform, mask.width, mask.height);
    if (p.x < 0 || p.y < 0 || p.x >= mask.width || p.y >= mask.height) return layer.maskPlacement ? mask.outside ?? 0 : 0;
    return maskSample(mask, p.x - .5, p.y - .5, mask.width, mask.height);
  };
  const own = (layer, point) => { const image = sources.get(layer.id); if (!image) return [0, 0, 0, 0]; const p = localPoint(point, layer.transform, image.width, image.height); return sampleHDR(image, p.x - .5, p.y - .5, layer.transform.sampling === 'Nearest'); };
  const coverage = (layer, point, depth = 0) => { if (depth > 256) throw new Error('Invalid HDR clipping chain.'); let a = own(layer, point)[3] * maskAt(layer, point); if (layer.maskSourceID) { const source = byID.get(layer.maskSourceID); a *= source ? coverage(source, point, depth + 1) * (entryByID.get(source.id)?.opacity ?? 1) : 0; } return a; };
  const applyAdjustment = (target, entry) => {
    const { layer } = entry, adjusted = applyHDRFilters({ width, height, data: target, bits: 32, linearSpace: manifest.hdrWorkingSpace ?? 'Linear sRGB' }, [{ enabled: true, adjustment: layer.adjustment }], scale).data;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const i = (y * width + x) * 4, point = { x: (x + .5) / scale, y: (y + .5) / scale }; let amount = entry.opacity * maskAt(layer, point); for (const parent of entry.ancestors) amount *= maskAt(parent, point);
      const color = blendHDR([...target.subarray(i, i + 3)], [...adjusted.subarray(i, i + 3)], layer.blendMode), a = target[i + 3] * (1 - amount), b = adjusted[i + 3] * amount, alpha = a + b;
      for (let c = 0; c < 3; c++) target[i + c] = alpha ? (target[i + c] * a + color[c] * b) / alpha : 0; target[i + 3] = alpha;
    }
  };
  const output = new Float32Array(width * height * 4);
  for (const entry of entries) {
    const layer = entry.layer; if (!entry.visible || layer.isGroup || !entry.opacity || stacked.has(layer.id)) continue;
    if (layer.adjustment) { applyAdjustment(output, entry); continue; }
    if (!sources.has(layer.id)) continue;
    let group, alpha;
    if (stacks.has(layer.id)) {
      group = new Float32Array(output.length); alpha = new Float32Array(width * height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const point = { x: (x + .5) / scale, y: (y + .5) / scale }, value = own(layer, point), i = (y * width + x) * 4; group.set(value.slice(0, 3), i); group[i + 3] = 1; alpha[i / 4] = value[3] * maskAt(layer, point) * entry.opacity; }
      for (const childEntry of stacks.get(layer.id)) {
        const child = childEntry.layer; if (child.adjustment) { applyAdjustment(group, childEntry); continue; }
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const point = { x: (x + .5) / scale, y: (y + .5) / scale }, value = own(child, point), i = (y * width + x) * 4, amount = value[3] * maskAt(child, point) * childEntry.opacity, color = blendHDR([...group.subarray(i, i + 3)], value.slice(0, 3), child.blendMode); for (let c = 0; c < 3; c++) group[i + c] += (color[c] - group[i + c]) * amount; }
      }
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const point = { x: (x + .5) / scale, y: (y + .5) / scale }, i = (y * width + x) * 4, value = group ? [...group.subarray(i, i + 3), alpha[i / 4]] : own(layer, point);
      let af = group ? value[3] : value[3] * maskAt(layer, point) * entry.opacity; for (const parent of entry.ancestors) af *= maskAt(parent, point);
      if (!group && layer.maskSourceID) { const source = byID.get(layer.maskSourceID); af *= source ? coverage(source, point) * (entryByID.get(source.id)?.opacity ?? 1) : 0; }
      const ab = output[i + 3], a = af + ab * (1 - af); if (!a) continue; const back = [...output.subarray(i, i + 3)], color = blendHDR(back, value.slice(0, 3), layer.blendMode);
      for (let c = 0; c < 3; c++) output[i + c] = ((1 - af) * ab * back[c] + (1 - ab) * af * value[c] + af * ab * color[c]) / a; output[i + 3] = a;
    }
  }
  return { width, height, data: output, bits: 32, linearSpace: manifest.hdrWorkingSpace ?? 'Linear sRGB' };
}
