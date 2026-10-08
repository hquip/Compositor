import { clamp, curveValue } from './raster.js';
import { rgbToHsl, hslToRgb } from './adjustments.js';
import { mixFilterPixels } from './filter-mix.js';

const dictionary = (value) => Array.isArray(value) ? Object.fromEntries(Array.from({ length: value.length / 2 }, (_, i) => [value[i * 2], value[i * 2 + 1]])) : value ?? {};
const hash = (value) => { value ^= value >>> 16; value = Math.imul(value, 0x7feb352d); value ^= value >>> 15; value = Math.imul(value, 0x846ca68b); return (value ^ value >>> 16) >>> 0; };
const unit = (value) => (hash(value) >>> 8) / 16777216;
function hueWeight(name, hue, band) {
  if (name === 'Master') return 1;
  if (!band) return clamp((45 - Math.abs(((hue - ({ Reds: 0, Yellows: 60, Greens: 120, Cyans: 180, Blues: 240, Magentas: 300 }[name] ?? 0) + 540) % 360) - 180)) / 30);
  const forward = (a, b) => (b - a + 720) % 360, p = forward(band.falloffStart, hue), start = forward(band.falloffStart, band.rangeStart), end = forward(band.falloffStart, band.rangeEnd), last = forward(band.falloffStart, band.falloffEnd);
  return p > last ? 0 : p < start ? p / Math.max(.0001, start) : p <= end ? 1 : (last - p) / Math.max(.0001, last - end);
}
const levels = (v, range = {}) => ((range.outputBlack ?? 0) + clamp((v * 255 - (range.black ?? 0)) / Math.max(1, (range.white ?? 255) - (range.black ?? 0))) ** (1 / (range.gamma ?? 1)) * ((range.outputWhite ?? 255) - (range.outputBlack ?? 0))) / 255;
function grainField(x, y, size, seed) {
  const ix = Math.floor(x / size), iy = Math.floor(y / size); let tx = x / size - ix, ty = y / size - iy; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
  const lattice = (x, y) => { const h = hash(Math.imul(x, 0x9e3779b1) ^ hash(Math.imul(y, 0x85ebca77) ^ seed)); return (h & 65535) / 65535 + (h >>> 16) / 65535 - 1; };
  const top = lattice(ix, iy) * (1 - tx) + lattice(ix + 1, iy) * tx, bottom = lattice(ix, iy + 1) * (1 - tx) + lattice(ix + 1, iy + 1) * tx; return (top * (1 - ty) + bottom * ty) * 1.6;
}
function blur(data, width, height, sigma) {
  const count = width * height, output = new Float32Array(data.length), plane = new Float32Array(count), work = new Float32Array(count);
  let lower = Math.max(1, Math.floor(Math.sqrt(4 * sigma * sigma + 1))); if (lower % 2 === 0) lower--;
  const split = Math.round((12 * sigma * sigma - 3 * lower * lower - 12 * lower - 9) / (-4 * lower - 4));
  const scan = (source, target, length, lines, stride, offset, radius) => {
    for (let line = 0; line < lines; line++) { const first = line * offset; let sum = 0; for (let x = 0; x <= Math.min(radius, length - 1); x++) sum += source[first + x * stride];
      for (let x = 0; x < length; x++) { target[first + x * stride] = sum / (2 * radius + 1); if (x - radius >= 0) sum -= source[first + (x - radius) * stride]; if (x + radius + 1 < length) sum += source[first + (x + radius + 1) * stride]; }
    }
  };
  for (const c of [3, 0, 1, 2]) {
    for (let i = 0; i < count; i++) plane[i] = c === 3 ? data[i * 4 + 3] : data[i * 4 + c] * data[i * 4 + 3];
    for (let pass = 0; pass < 3; pass++) { const radius = ((pass < split ? lower : lower + 2) - 1) / 2; scan(plane, work, width, height, 1, width, radius); scan(work, plane, height, width, width, 1, radius); }
    for (let i = 0; i < count; i++) output[i * 4 + c] = c === 3 ? clamp(plane[i]) : output[i * 4 + 3] > 1e-9 ? clamp(plane[i] / output[i * 4 + 3]) : 0;
  } return output;
}
function motion(data, width, height, distance, angle) {
  const output = new Float32Array(data.length), steps = Math.max(2, Math.min(256, Math.ceil(distance))), theta = -angle * Math.PI / 180;
  for (let step = 0; step < steps; step++) {
    const d = distance * (step / (steps - 1) - .5), dx = Math.cos(theta) * d, dy = Math.sin(theta) * d;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const sx = x - dx, sy = y - dy, x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0, to = (y * width + x) * 4;
      for (let oy = 0; oy < 2; oy++) for (let ox = 0; ox < 2; ox++) { const xx = x0 + ox, yy = y0 + oy; if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue; const from = (yy * width + xx) * 4, a = data[from + 3] * (ox ? fx : 1 - fx) * (oy ? fy : 1 - fy) / steps; for (let c = 0; c < 3; c++) output[to + c] += data[from + c] * a; output[to + 3] += a; }
    }
  }
  for (let i = 0; i < output.length; i += 4) if (output[i + 3]) for (let c = 0; c < 3; c++) output[i + c] = clamp(output[i + c] / output[i + 3]); return output;
}
export function applyPrecisionFilters(source, filters, scale = 1, workingSpace = 'sRGB') {
  const { width, height } = source; let data = Float32Array.from(source.data, (value) => value / 65535);
  for (const entry of filters) {
    if (!entry.enabled || entry.opacity === 0) continue; const a = entry.adjustment, kind = a.kind;
    const before = (entry.opacity ?? 1) !== 1 || entry.mask && entry.maskEnabled !== false ? data.slice() : null;
    if (kind === 'Gaussian Blur') data = blur(data, width, height, (a.blurRadius ?? 10) * scale);
    else if (kind === 'Motion Blur') data = motion(data, width, height, (a.motionDistance ?? 10) * scale, a.motionAngle ?? 0);
    else for (let i = 0; i < data.length; i += 4) {
      if (!data[i + 3]) continue; let color = [data[i], data[i + 1], data[i + 2]];
      if (kind === 'Invert') color = color.map((v) => 1 - v);
      else if (kind === 'Exposure') color = color.map((v) => {
        const s = a.exposureSettings ?? {}, gamma = workingSpace === 'Adobe RGB (1998)' ? 2.19921875 : workingSpace === 'ProPhoto RGB' ? 1.8 : null;
        let linear = gamma ? v ** gamma : v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
        linear = Math.max(0, linear * 2 ** (s.exposure ?? 0) + (s.offset ?? 0)) ** (1 / (s.gamma ?? 1)); return gamma ? linear ** (1 / gamma) : linear <= .0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - .055;
      });
      else if (kind === 'Levels') color = color.map((v, c) => levels(levels(v, a.levels?.ranges?.[c + 1]), a.levels?.ranges?.[0]));
      else if (kind === 'Curves') color = color.map((v, c) => curveValue(a.curves?.channels?.[0], curveValue(a.curves?.channels?.[c + 1], v * 255)) / 255);
      else if (kind === 'Gradient Map') { const s = a.gradientMapSettings ?? {}; let t = color[0] * .2126 + color[1] * .7152 + color[2] * .0722; if (s.reversed) t = 1 - t; color = ['red', 'green', 'blue'].map((c) => (s.shadows?.[c] ?? 0) * (1 - t) + (s.highlights?.[c] ?? 1) * t); }
      else if (kind === 'Hue/Saturation') {
        let [h, s, l] = rgbToHsl(...color); const settings = a.hsvSettings, ranges = settings ? dictionary(settings.adjustments) : { Master: a }, bands = dictionary(settings?.bands);
        if (settings?.colorize ?? a.colorize) { const r = ranges[settings?.range ?? 'Master'] ?? a; h = r.hue ?? 0; s = (r.saturation ?? 25) / 100; l = (r.lightness ?? 0) >= 0 ? l + (1 - l) * (r.lightness ?? 0) / 100 : l * (1 + (r.lightness ?? 0) / 100); }
        else { let dh = 0, ds = 0, dl = 0; for (const [name, r] of Object.entries(ranges)) { let weight = hueWeight(name, h, bands[name]); if (settings?.invertRange && name === settings.range && name !== 'Master') weight = 1 - weight; dh += (r.hue ?? 0) * weight; ds += (r.saturation ?? 0) * weight; dl += (r.lightness ?? 0) * weight; } h += dh; ds = clamp(ds / 100, -1, 1); dl = clamp(dl / 100, -1, 1); s = ds <= 0 ? s * (1 + ds) : ds >= 1 ? s > 0 ? 1 : 0 : Math.min(1, s / (1 - ds)); l = dl >= 0 ? l + (1 - l) * dl : l * (1 + dl); }
        color = hslToRgb(h, clamp(s), clamp(l));
      } else if (kind === 'Black & White') {
        const s = { reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80, ...a.blackWhiteSettings }, [r, g, b] = color, max = Math.max(...color), min = Math.min(...color), middle = r + g + b - max - min;
        const primary = max === r ? 'reds' : max === g ? 'greens' : 'blues', secondary = max === r ? g >= b ? 'yellows' : 'magentas' : max === g ? r >= b ? 'yellows' : 'cyans' : g >= r ? 'cyans' : 'magentas';
        const gray = clamp(min + (middle - min) * s[secondary] / 100 + (max - middle) * s[primary] / 100); color = s.tint ? hslToRgb(s.tintHue ?? 40, (s.tintSaturation ?? 20) / 100, gray) : [gray, gray, gray];
      } else if (kind === 'Color Balance') {
        const s = a.colorBalanceSettings ?? {}, before = color[0] * .299 + color[1] * .587 + color[2] * .114;
        color = color.map((v, c) => { const key = ['CyanRed', 'MagentaGreen', 'YellowBlue'][c], shadow = clamp((v - .333) / -.25 + .5) * .7, mid = clamp((v - .333) / .25 + .5) * clamp((v + .333 - 1) / -.25 + .5) * .7, high = clamp((v + .333 - 1) / .25 + .5) * .7; return clamp(v + ((s['shadow' + key] ?? 0) * shadow + (s['mid' + key] ?? 0) * mid + (s['highlight' + key] ?? 0) * high) / 100); });
        const after = color[0] * .299 + color[1] * .587 + color[2] * .114; if (s.preserveLuminosity !== false && after > .0001) color = color.map((v) => v * before / after);
      } else if (kind === 'Add Noise') {
        const x = Math.floor(i / 4 % width / scale), y = Math.floor(Math.floor(i / 4 / width) / scale), seed = a.noiseSeed ?? 0, base = hash(seed ^ hash(Math.imul(x, 0x9e3779b9) ^ hash(Math.imul(y, 0x85ebca6b))));
        color = color.map((v, c) => { const key = a.noiseMonochromatic ? base : base + Math.imul(c, 0x9e3779b9), noise = a.noiseGaussian ? Math.sqrt(-2 * Math.log(1 - unit(key))) * Math.cos(6.2831853 * unit(key ^ 0x68e31da4)) * 2 / 3 : unit(key) * 2 - 1; return v + noise * (a.noiseAmount ?? 10) / 200; });
      } else if (kind === 'Grain') {
        const s = a.grainSettings ?? {}, size = s.size ?? 1.5, seed = s.seed ?? 0, x = (i / 4 % width + .5) / scale, y = (Math.floor(i / 4 / width) + .5) / scale;
        const smooth = grainField(x, y, size, seed), fine = grainField(x, y, Math.max(.5, size * .35), hash(seed ^ 0xa511e9b3)), noise = smooth + (fine - smooth) * (s.roughness ?? 50) / 100, level = color[0] * .2126 + color[1] * .7152 + color[2] * .0722, delta = noise * (s.amount ?? 25) / 100 * .35 * (.4 + 2.4 * level * (1 - level)); color = color.map((v) => v + delta);
      } else throw new Error('This filter does not support high-precision editing.');
      for (let c = 0; c < 3; c++) data[i + c] = clamp(color[c]);
    }
    if (before) mixFilterPixels(before, data, width, height, entry, 1);
  }
  return { ...source, data: Uint16Array.from(data, (value) => Math.round(clamp(value) * 65535)), bits: 16 };
}
