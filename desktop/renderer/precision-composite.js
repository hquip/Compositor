import { layerEntries, localPoint } from './core.js';
import { decodePNG } from './png-pixels.js';
import { base64Bytes, precisionLayer, convertPrecision, resizePrecision } from './precision-raster.js';
import { profileBytes } from './color-engine.js';
import { applyPrecisionFilters } from './precision-filters.js';
import { affine, inverse } from './affine.js';
import { preparedFilters } from './filter-resources.js';

const clamp = (v) => Math.max(0, Math.min(1, v));
function blend(back, front, mode) {
  const channel = (b, f) => {
    const burn = (b, f) => f === 0 ? 0 : 1 - Math.min(1, (1 - b) / f), dodge = (b, f) => f === 1 ? 1 : Math.min(1, b / (1 - f));
    switch (mode) {
      case 'Normal': return f; case 'Multiply': return b * f; case 'Screen': return b + f - b * f; case 'Darken': return Math.min(b, f); case 'Lighten': return Math.max(b, f);
      case 'Overlay': return b <= .5 ? 2 * b * f : 1 - 2 * (1 - b) * (1 - f); case 'Hard Light': return f <= .5 ? 2 * b * f : 1 - 2 * (1 - b) * (1 - f);
      case 'Soft Light': return f <= .5 ? b - (1 - 2 * f) * b * (1 - b) : b + (2 * f - 1) * ((b <= .25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)) - b);
      case 'Color Burn': return burn(b, f); case 'Color Dodge': return dodge(b, f); case 'Linear Burn': return Math.max(0, b + f - 1); case 'Linear Dodge (Add)': return Math.min(1, b + f);
      case 'Difference': return Math.abs(b - f); case 'Exclusion': return b + f - 2 * b * f; case 'Subtract': return Math.max(0, b - f); case 'Divide': return f === 0 ? 1 : Math.min(1, b / f);
      case 'Vivid Light': return f < .5 ? burn(b, 2 * f) : dodge(b, 2 * (f - .5)); case 'Linear Light': return clamp(b + 2 * f - 1); case 'Pin Light': return f < .5 ? Math.min(b, 2 * f) : Math.max(b, 2 * f - 1); case 'Hard Mix': return (f < .5 ? burn(b, 2 * f) : dodge(b, 2 * (f - .5))) < .5 ? 0 : 1;
      default: return f;
    }
  };
  if (!['Hue', 'Saturation', 'Color', 'Luminosity'].includes(mode)) return back.map((v, c) => channel(v, front[c]));
  const lum = (color) => color[0] * .3 + color[1] * .59 + color[2] * .11, sat = (color) => Math.max(...color) - Math.min(...color);
  const setLum = (color, value) => { let result = color.map((c) => c + value - lum(color)); const min = Math.min(...result), max = Math.max(...result), l = lum(result); if (min < 0) result = result.map((c) => l + (c - l) * l / Math.max(1e-9, l - min)); if (max > 1) result = result.map((c) => l + (c - l) * (1 - l) / Math.max(1e-9, max - l)); return result.map(clamp); };
  const setSat = (color, value) => { const min = Math.min(...color), max = Math.max(...color); return color.map((c) => max > min ? (c - min) * value / (max - min) : 0); };
  return mode === 'Hue' ? setLum(setSat(front, sat(back)), lum(back)) : mode === 'Saturation' ? setLum(setSat(back, sat(front)), lum(back)) : mode === 'Color' ? setLum(front, lum(back)) : setLum(back, lum(front));
}
function sample(image, x, y, nearest = false) {
  const { width, height, data } = image; if (x < -.5 || y < -.5 || x >= width - .5 || y >= height - .5) return [0, 0, 0, 0];
  x = Math.max(0, Math.min(width - 1, x)); y = Math.max(0, Math.min(height - 1, y));
  if (nearest) { const i = (Math.round(y) * width + Math.round(x)) * 4; return [data[i] / 65535, data[i + 1] / 65535, data[i + 2] / 65535, data[i + 3] / 65535]; }
  const left = Math.floor(x), top = Math.floor(y), fx = x - left, fy = y - top, result = [0, 0, 0, 0];
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const i = (Math.min(height - 1, top + dy) * width + Math.min(width - 1, left + dx)) * 4, alpha = data[i + 3] / 65535 * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy); for (let c = 0; c < 3; c++) result[c] += data[i + c] / 65535 * alpha; result[3] += alpha; }
  if (result[3]) for (let c = 0; c < 3; c++) result[c] /= result[3]; return result;
}
export async function composePrecision(snapshot, { preview = false, workingSpace = 'ProPhoto RGB' } = {}) {
  const { manifest, assets } = snapshot, scale = preview ? Math.min(1, 1000 / Math.max(manifest.width, manifest.height)) : 1, width = Math.max(1, Math.round(manifest.width * scale)), height = Math.max(1, Math.round(manifest.height * scale));
  if (width * height > 16000000) throw new Error('High-precision export currently supports up to 16 megapixels.');
  const profile = await profileBytes(workingSpace), entries = layerEntries(manifest.layers), byID = new Map(manifest.layers.map((layer) => [layer.id, layer])), entryByID = new Map(entries.map((entry) => [entry.layer.id, entry]));
  const sources = new Map(), masks = new Map(); let pixels = 0;
  for (const layer of manifest.layers) {
    if (layer.effects && Object.values(layer.effects).some((effect) => effect && effect.enabled !== false)) throw new Error('Enable 8-bit rendering of layers with effects to export this composition.');
    if (layer.imageFile) {
      let image = await decodePNG(base64Bytes(assets[layer.filterSourceFile] ?? assets[layer.imageFile]));
      if (image.bits === 16 && layer.filterSourceFile) {
        if (preview) image = resizePrecision(image, Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
        image = await precisionLayer(image, await preparedFilters(layer.filters ?? [], assets), layer.filterWorkingSpace ?? 'sRGB', preview ? scale : 1);
      } else {
        image = await decodePNG(base64Bytes(assets[layer.imageFile])); if (preview) image = resizePrecision(image, Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
      }
      image = await convertPrecision(image, profile);
      const targetWidth = Math.max(1, Math.ceil(layer.transform.size[0] * scale)), targetHeight = Math.max(1, Math.ceil(layer.transform.size[1] * scale));
      if (layer.transform.sampling !== 'Nearest' && targetWidth < image.width && targetHeight < image.height) image = resizePrecision(image, targetWidth, targetHeight);
      pixels += image.width * image.height; if (pixels > 48000000) throw new Error('The high-precision source stack exceeds the memory budget.'); sources.set(layer.id, image);
    }
    if (layer.maskFile) { const image = await decodePNG(base64Bytes(assets[layer.maskFile])); for (let i = 0; i < image.data.length; i += 4) image.data[i + 3] = image.data[i]; let sum = 0, count = 0;
      for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (!x || !y || x === image.width - 1 || y === image.height - 1) { sum += image.data[(y * image.width + x) * 4 + 3]; count++; }
      image.outside = sum >= count * 32767.5 ? 1 : 0; masks.set(layer.id, image); }
  }
  const matrices = new Map();
  const pointIn = (layer, image, point, mask = false) => {
    const key = layer.id + (mask ? ':mask' : ':image'); let matrix = matrices.get(key);
    if (!matrix) { const m = inverse(affine(mask ? layer.maskPlacement ?? layer.transform : layer.transform)); matrix = [m[0] * image.width, m[1] * image.height, m[2] * image.width, m[3] * image.height, m[4] * image.width, m[5] * image.height]; matrices.set(key, matrix); }
    return { x: matrix[0] * point.x + matrix[2] * point.y + matrix[4], y: matrix[1] * point.x + matrix[3] * point.y + matrix[5] };
  };
  const maskAt = (layer, point) => {
    const mask = layer.maskEnabled !== false && masks.get(layer.id); if (!mask) return 1;
    if (mask.width === 1 && mask.height === 1) return mask.data[3] / 65535;
    const p = pointIn(layer, mask, point, true);
    if (layer.maskPlacement && (p.x < 0 || p.y < 0 || p.x >= mask.width || p.y >= mask.height)) return mask.outside;
    return sample(mask, p.x - .5, p.y - .5)[3];
  };
  const coverage = (layer, point, depth = 0) => { if (depth > 256) throw new Error('Invalid clipping mask chain.'); const source = sources.get(layer.id); if (!source) return 0; const p = pointIn(layer, source, point); let alpha = sample(source, p.x - .5, p.y - .5, layer.transform.sampling === 'Nearest')[3] * maskAt(layer, point); if (layer.maskSourceID) { const base = byID.get(layer.maskSourceID); alpha *= base ? coverage(base, point, depth + 1) * (entryByID.get(base.id)?.opacity ?? base.opacity ?? 1) : 0; } return alpha; };
  const visible = entries.filter((entry) => entry.visible && !entry.layer.isGroup), stacks = new Map(), stacked = new Set();
  for (let i = 0; i < visible.length; i++) { const base = visible[i].layer; if (base.maskSourceID || base.adjustment) continue; const children = [];
    for (let j = i + 1; j < visible.length; j++) { const child = visible[j].layer; if (child.maskSourceID !== base.id || child.parentID !== base.parentID) break; children.push(visible[j]); stacked.add(child.id); } if (children.length) stacks.set(base.id, children);
  }
  let output = new Float32Array(width * height * 4);
  for (const entry of entries) {
    const layer = entry.layer; if (!entry.visible || layer.isGroup || !entry.opacity || stacked.has(layer.id)) continue;
    const image = sources.get(layer.id);
    if (stacks.has(layer.id) && image) {
      const group = new Float32Array(output.length), alpha = new Float32Array(width * height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const point = { x: (x + .5) / scale, y: (y + .5) / scale }, p = pointIn(layer, image, point), own = sample(image, p.x - .5, p.y - .5, layer.transform.sampling === 'Nearest'), i = (y * width + x) * 4; group.set(own.slice(0, 3), i); group[i + 3] = 1; alpha[i / 4] = own[3] * maskAt(layer, point) * entry.opacity; }
      for (const childEntry of stacks.get(layer.id)) {
        const child = childEntry.layer, source = sources.get(child.id), adjusted = child.adjustment ? applyPrecisionFilters({ width, height, data: Uint16Array.from(group, (v) => Math.round(clamp(v) * 65535)) }, [{ enabled: true, adjustment: child.adjustment }], scale, workingSpace).data : null;
        if (!source && !adjusted) continue;
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const point = { x: (x + .5) / scale, y: (y + .5) / scale }, i = (y * width + x) * 4; let own;
          if (adjusted) own = [adjusted[i] / 65535, adjusted[i + 1] / 65535, adjusted[i + 2] / 65535, 1]; else { const p = pointIn(child, source, point); own = sample(source, p.x - .5, p.y - .5, child.transform.sampling === 'Nearest'); }
          let amount = own[3] * maskAt(child, point) * childEntry.opacity; if (adjusted) for (const parent of childEntry.ancestors) amount *= maskAt(parent, point);
          const back = [group[i], group[i + 1], group[i + 2]], color = blend(back, own.slice(0, 3), child.blendMode); for (let c = 0; c < 3; c++) group[i + c] = back[c] * (1 - amount) + color[c] * amount;
        }
      }
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const point = { x: (x + .5) / scale, y: (y + .5) / scale }, i = (y * width + x) * 4; let af = alpha[i / 4]; for (const parent of entry.ancestors) af *= maskAt(parent, point); const ab = output[i + 3], a = af + ab * (1 - af); if (!a) continue;
        const back = [output[i], output[i + 1], output[i + 2]], front = [group[i], group[i + 1], group[i + 2]], color = blend(back, front, layer.blendMode); for (let c = 0; c < 3; c++) output[i + c] = clamp(((1 - af) * ab * back[c] + (1 - ab) * af * front[c] + af * ab * color[c]) / a); output[i + 3] = a;
      } continue;
    }
    if (layer.adjustment && layer.maskSourceID) continue;
    let adjusted;
    if (layer.adjustment) adjusted = applyPrecisionFilters({ width, height, data: Uint16Array.from(output, (v) => Math.round(clamp(v) * 65535)) }, [{ enabled: true, adjustment: layer.adjustment }], scale, workingSpace).data;
    if (!image && !adjusted) continue;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const point = { x: (x + .5) / scale, y: (y + .5) / scale }, index = (y * width + x) * 4, back = [output[index], output[index + 1], output[index + 2]];
      let amount = entry.opacity * maskAt(layer, point); for (const parent of entry.ancestors) amount *= maskAt(parent, point);
      if (layer.maskSourceID) { const base = byID.get(layer.maskSourceID); amount *= base ? coverage(base, point) * (entryByID.get(base.id)?.opacity ?? base.opacity ?? 1) : 0; }
      if (adjusted) { const color = blend(back, [adjusted[index] / 65535, adjusted[index + 1] / 65535, adjusted[index + 2] / 65535], layer.blendMode), a = output[index + 3] * (1 - amount), b = (layer.blendMode && layer.blendMode !== 'Normal' ? output[index + 3] : adjusted[index + 3] / 65535) * amount, alpha = a + b; for (let c = 0; c < 3; c++) output[index + c] = alpha ? (back[c] * a + color[c] * b) / alpha : 0; output[index + 3] = alpha; continue; }
      const p = pointIn(layer, image, point), front = sample(image, p.x - .5, p.y - .5, layer.transform.sampling === 'Nearest'), af = front[3] * amount, ab = output[index + 3], alpha = af + ab * (1 - af); if (!alpha) continue;
      const color = blend(back, front.slice(0, 3), layer.blendMode); for (let c = 0; c < 3; c++) output[index + c] = clamp(((1 - af) * ab * back[c] + (1 - ab) * af * front[c] + af * ab * color[c]) / alpha); output[index + 3] = alpha;
    }
  }
  return { width, height, profile, bits: 16, data: Uint16Array.from(output, (value) => Math.round(clamp(value) * 65535)) };
}
