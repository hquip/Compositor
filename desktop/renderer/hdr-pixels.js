import { mixFilterPixels } from './filter-mix.js';
import { hslToRgb } from './adjustments.js';
import { convertHDRColor, hdrLuminance } from './hdr-color.js';

export const HDR_FILTERS = ['Exposure', 'Gaussian Blur', 'Motion Blur', 'Invert', 'Add Noise', 'Color Balance', 'Black & White'];
export const HDR_BLENDS = ['Normal', 'Multiply', 'Darken', 'Lighten', 'Screen', 'Linear Dodge (Add)', 'Difference', 'Subtract', 'Divide'];
export const srgbToLinear = (v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
export const linearToSrgb = (v) => v <= .0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - .055;
const clamp = (v) => Math.max(0, Math.min(1, v));
function blurFloat(data, width, height, radius) {
  const output = new Float32Array(data.length), plane = new Float32Array(width * height), work = new Float32Array(plane.length);
  let lower = Math.max(1, Math.floor(Math.sqrt(4 * radius * radius + 1))); if (lower % 2 === 0) lower--;
  const split = Math.round((12 * radius * radius - 3 * lower * lower - 12 * lower - 9) / (-4 * lower - 4));
  const scan = (input, out, length, lines, stride, offset, r) => {
    for (let line = 0; line < lines; line++) { const first = line * offset; let sum = 0; for (let x = 0; x <= Math.min(r, length - 1); x++) sum += input[first + x * stride];
      for (let x = 0; x < length; x++) { out[first + x * stride] = sum / (2 * r + 1); if (x - r >= 0) sum -= input[first + (x - r) * stride]; if (x + r + 1 < length) sum += input[first + (x + r + 1) * stride]; }
    }
  };
  for (const c of [3, 0, 1, 2]) { for (let i = 0; i < plane.length; i++) plane[i] = c === 3 ? data[i * 4 + 3] : data[i * 4 + c] * data[i * 4 + 3];
    for (let n = 0; n < 3; n++) { const r = ((n < split ? lower : lower + 2) - 1) / 2; scan(plane, work, width, height, 1, width, r); scan(work, plane, height, width, width, 1, r); }
    for (let i = 0; i < plane.length; i++) output[i * 4 + c] = c === 3 ? clamp(plane[i]) : output[i * 4 + 3] > 1e-12 ? plane[i] / output[i * 4 + 3] : 0;
  } return output;
}
function motionFloat(data, width, height, distance, angle) {
  const output = new Float32Array(data.length), steps = Math.max(2, Math.min(128, Math.ceil(distance))), theta = -angle * Math.PI / 180;
  for (let n = 0; n < steps; n++) { const delta = distance * (n / (steps - 1) - .5), dx = Math.cos(theta) * delta, dy = Math.sin(theta) * delta;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const sx = x - dx, sy = y - dy, left = Math.floor(sx), top = Math.floor(sy), fx = sx - left, fy = sy - top, to = (y * width + x) * 4;
      for (let oy = 0; oy < 2; oy++) for (let ox = 0; ox < 2; ox++) { const xx = left + ox, yy = top + oy; if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue; const from = (yy * width + xx) * 4, a = data[from + 3] * (ox ? fx : 1 - fx) * (oy ? fy : 1 - fy) / steps; for (let c = 0; c < 3; c++) output[to + c] += data[from + c] * a; output[to + 3] += a; }
    }
  }
  for (let i = 0; i < output.length; i += 4) if (output[i + 3]) for (let c = 0; c < 3; c++) output[i + c] /= output[i + 3]; return output;
}
export function applyHDRFilters(source, filters, scale = 1) {
  let data = source.data.slice(); const { width, height } = source, luminance = hdrLuminance(source.linearSpace);
  for (const entry of filters) {
    if (!entry.enabled || entry.opacity === 0) continue; const a = entry.adjustment;
    if (!HDR_FILTERS.includes(a.kind)) throw new Error('This filter requires rasterizing the HDR display or an SDR layer.');
    const before = (entry.opacity ?? 1) !== 1 || entry.mask && entry.maskEnabled !== false ? data.slice() : null;
    if (a.kind === 'Gaussian Blur') data = blurFloat(data, width, height, (a.blurRadius ?? 10) * scale);
    else if (a.kind === 'Motion Blur') data = motionFloat(data, width, height, (a.motionDistance ?? 10) * scale, a.motionAngle ?? 0);
    else for (let i = 0; i < data.length; i += 4) {
      let color = [data[i], data[i + 1], data[i + 2]];
      if (a.kind === 'Black & White') { const s = { reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80, ...a.blackWhiteSettings }, [r, g, b] = color, max = Math.max(...color), min = Math.min(...color), middle = r + g + b - max - min;
        const primary = max === r ? 'reds' : max === g ? 'greens' : 'blues', secondary = max === r ? g >= b ? 'yellows' : 'magentas' : max === g ? r >= b ? 'yellows' : 'cyans' : g >= r ? 'cyans' : 'magentas', gray = min + (middle - min) * s[secondary] / 100 + (max - middle) * s[primary] / 100, peak = Math.max(1, gray);
        color = s.tint && gray >= 0 ? hslToRgb(s.tintHue ?? 40, (s.tintSaturation ?? 20) / 100, gray / peak).map((v) => v * peak) : [gray, gray, gray];
      }
      if (a.kind === 'Color Balance') { const s = a.colorBalanceSettings ?? {}, beforeLum = color.reduce((sum, value, c) => sum + value * luminance[c], 0);
        color = color.map((v, c) => { const key = ['CyanRed', 'MagentaGreen', 'YellowBlue'][c], shadow = clamp((v - .333) / -.25 + .5) * .7, mid = clamp((v - .333) / .25 + .5) * clamp((v + .333 - 1) / -.25 + .5) * .7, high = clamp((v + .333 - 1) / .25 + .5) * .7; return v + ((s['shadow' + key] ?? 0) * shadow + (s['mid' + key] ?? 0) * mid + (s['highlight' + key] ?? 0) * high) / 100; });
        const afterLum = color.reduce((sum, value, c) => sum + value * luminance[c], 0); if (s.preserveLuminosity !== false && Math.abs(afterLum) > .0001) color = color.map((v) => v * beforeLum / afterLum);
      }
      for (let c = 0; c < 3; c++) {
        let value = color[c];
        if (a.kind === 'Exposure') { const s = a.exposureSettings ?? {}; value = value * 2 ** (s.exposure ?? 0) + (s.offset ?? 0); value = Math.sign(value) * Math.abs(value) ** (1 / (s.gamma ?? 1)); }
        if (a.kind === 'Invert') value = 1 - value;
        if (a.kind === 'Add Noise') { const hash = (n) => { n ^= n >>> 16; n = Math.imul(n, 0x7feb352d); n ^= n >>> 15; return (n >>> 0) / 4294967296; }, seed = (a.noiseSeed ?? 0) ^ Math.imul(i / 4, 0x9e3779b9) ^ (a.noiseMonochromatic ? 0 : Math.imul(c, 0x85ebca77)), random = hash(seed), noise = a.noiseGaussian ? Math.sqrt(-2 * Math.log(Math.max(1e-12, 1 - random))) * Math.cos(2 * Math.PI * hash(seed ^ 0x68e31da4)) * 2 / 3 : random * 2 - 1; value += noise * (a.noiseAmount ?? 10) / 200; }
        if (!Number.isFinite(value) || Math.abs(value) > 1000000) throw new Error('The HDR filter exceeds the supported intensity range.'); data[i + c] = value;
      }
    }
    if (before) mixFilterPixels(before, data, width, height, entry, 1);
  }
  return { ...source, data, bits: 32 };
}
export function toneMapHDR(source, view = {}) {
  if (source.linearSpace && source.linearSpace !== 'Linear sRGB') source = convertHDRColor(source, source.linearSpace);
  const output = new Uint8ClampedArray(source.data.length), exposure = 2 ** (view.exposure ?? 0), method = view.toneMap ?? 'Reinhard';
  for (let i = 0; i < output.length; i += 4) { for (let c = 0; c < 3; c++) { const value = Math.max(0, source.data[i + c] * exposure), mapped = method === 'Clip' ? Math.min(1, value) : value / (1 + value); output[i + c] = Math.round(clamp(linearToSrgb(mapped)) * 255); } output[i + 3] = Math.round(clamp(source.data[i + 3]) * 255); }
  return { width: source.width, height: source.height, data: output };
}
export function resizeHDR(source, width, height) {
  if (source.width === width && source.height === height) return source;
  const output = new Float32Array(width * height * 4), rx = source.width / width, ry = source.height / height;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const left = x * rx, top = y * ry, right = (x + 1) * rx, bottom = (y + 1) * ry, color = [0, 0, 0]; let alpha = 0;
    for (let yy = Math.floor(top); yy < Math.min(source.height, Math.ceil(bottom)); yy++) for (let xx = Math.floor(left); xx < Math.min(source.width, Math.ceil(right)); xx++) { const i = (yy * source.width + xx) * 4, weight = (Math.min(xx + 1, right) - Math.max(xx, left)) * (Math.min(yy + 1, bottom) - Math.max(yy, top)), a = source.data[i + 3] * weight; alpha += a; for (let c = 0; c < 3; c++) color[c] += source.data[i + c] * a; }
    const i = (y * width + x) * 4; output[i + 3] = alpha / (rx * ry); for (let c = 0; c < 3; c++) output[i + c] = alpha ? color[c] / alpha : 0;
  } return { ...source, width, height, data: output };
}
