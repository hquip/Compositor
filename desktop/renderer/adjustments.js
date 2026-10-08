import { kernels, allocate, pixelKernel } from './kernels.js';
import { surface, copySurface, clamp, curveValue } from './raster.js';
import { warpImage } from './transforms.js';
import { blurPixels } from './pixel-surface.js';

export const ADJUSTMENT_KINDS = ['Hue/Saturation', 'Levels', 'Curves', 'Exposure', 'Gradient Map', 'Grain', 'Black & White', 'Color Balance', 'Invert', 'Gaussian Blur', 'Motion Blur', 'Add Noise'];
export function adjustmentDefaults(kind) {
  return { kind, hue: 0, saturation: 0, lightness: 0, colorize: false,
    levels: { channel: 'RGB', ranges: Array.from({ length: 4 }, () => ({ black: 0, gamma: 1, white: 255, outputBlack: 0, outputWhite: 255 })) },
    curves: { channel: 'RGB', channels: Array.from({ length: 4 }, () => [{ x: 0, y: 0 }, { x: 255, y: 255 }]) } };
}
export function editableAdjustment(adjustment) {
  const result = structuredClone(adjustment); if (result.kind !== 'Hue/Saturation') return result;
  const s = result.hsvSettings, ranges = dictionary(s?.adjustments), bands = dictionary(s?.bands);
  result.editRange = s?.range ?? 'Master'; result.colorize = s?.colorize ?? result.colorize; result.invertRange = s?.invertRange ?? false;
  result.editRanges = {}; result.editBands = {};
  ['Master', 'Reds', 'Yellows', 'Greens', 'Cyans', 'Blues', 'Magentas'].forEach((name, i) => {
    result.editRanges[name] = ranges[name] ?? (name === 'Master' && !s ? { hue: result.hue, saturation: result.saturation, lightness: result.lightness } : { hue: 0, saturation: 0, lightness: 0 });
    const center = (i - 1) * 60, wrap = (v) => (v + 720) % 360;
    result.editBands[name] = bands[name] ?? (i ? { falloffStart: wrap(center - 45), rangeStart: wrap(center - 15), rangeEnd: wrap(center + 15), falloffEnd: wrap(center + 45) } : { falloffStart: 0, rangeStart: 0, rangeEnd: 360, falloffEnd: 360 });
  }); return result;
}
export function savedAdjustment(edit) {
  const result = structuredClone(edit);
  if (result.levels?.ranges) for (const range of result.levels.ranges) { range.black = clamp(range.black ?? 0, 0, 254); range.white = clamp(range.white ?? 255, range.black + 1, 255); range.gamma = clamp(range.gamma ?? 1, .1, 9.99); range.outputBlack = clamp(range.outputBlack ?? 0, 0, 255); range.outputWhite = clamp(range.outputWhite ?? 255, 0, 255); }
  if (result.curves?.channels) result.curves.channels = result.curves.channels.map((points) => {
    const unique = new Map(points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).map((p) => [clamp(p.x, 0, 255), { x: clamp(p.x, 0, 255), y: clamp(p.y, 0, 255) }]));
    if (!unique.has(0)) unique.set(0, { x: 0, y: 0 }); if (!unique.has(255)) unique.set(255, { x: 255, y: 255 }); const sorted = [...unique.values()].sort((a, b) => a.x - b.x); return sorted.length > 32 ? [...sorted.slice(0, 31), sorted.at(-1)] : sorted;
  });
  if (result.editRanges) {
    result.hsvSettings = { range: result.editRange, colorize: result.colorize, invertRange: result.invertRange, adjustments: Object.entries(result.editRanges).flat(), bands: Object.entries(result.editBands).flat() };
    Object.assign(result, result.editRanges.Master); for (const key of ['editRange', 'editRanges', 'editBands', 'invertRange']) delete result[key];
  }
  return result;
}
export function automaticLevels(image, mode = 'Color') {
  const result = adjustmentDefaults('Levels'), data = image.getContext('2d').getImageData(0, 0, image.width, image.height); let histogram;
  pixelKernel(data.data, image.width, image.height, (p, w, h) => { const bins = allocate(new Float64Array(1024)); kernels.levels_histogram(p, 0, w * h, bins); histogram = new Float64Array(kernels.memory.buffer, bins, 1024).slice(); });
  for (const channel of mode === 'Contrast' ? [0] : [1, 2, 3]) {
    const bins = histogram.slice(channel * 256, (channel + 1) * 256), total = bins.reduce((sum, value) => sum + value, 0); if (!total) continue;
    let sum = 0, low = 0, high = 255; for (let i = 0; i < 256; i++) { sum += bins[i]; if (sum >= total * .005) { low = i; break; } }
    sum = 0; for (let i = 255; i >= 0; i--) { sum += bins[i]; if (sum >= total * .005) { high = i; break; } }
    if (high > low) { result.levels.ranges[channel].black = low; result.levels.ranges[channel].white = high; }
  } return result;
}
function tableFilter(image, callback) {
  const canvas = copySurface(image), context = canvas.getContext('2d'), data = context.getImageData(0, 0, canvas.width, canvas.height);
  pixelKernel(data.data, canvas.width, canvas.height, (p, w, h, stride) => callback(p, w, h, stride)); context.putImageData(data, 0, 0); return canvas;
}
export function blurSurface(image, radius) {
  // Use the same software filter path on the UI thread and the worker.
  const canvas = surface(image.width, image.height, { willReadFrequently: true }), context = canvas.getContext('2d');
  if (!('filter' in context)) { context.putImageData(blurPixels(image.getContext('2d').getImageData(0, 0, image.width, image.height), Math.max(0, radius)), 0, 0); return canvas; }
  context.filter = `blur(${Math.max(0, radius)}px)`;
  context.drawImage(image, 0, 0); return canvas;
}
function levelsValue(value, range = {}) {
  const black = range.black ?? 0, white = range.white ?? 255, gamma = range.gamma ?? 1;
  return ((range.outputBlack ?? 0) + clamp((value * 255 - black) / Math.max(1, white - black)) ** (1 / gamma) * ((range.outputWhite ?? 255) - (range.outputBlack ?? 0))) / 255;
}
export function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  if (!d) return [0, 0, l];
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, d / (1 - Math.abs(2 * l - 1)), l];
}
export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 60;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(h % 2 - 1)), m = l - c / 2;
  const rgb = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return rgb.map((v) => clamp(v + m));
}
const dictionary = (value) => Array.isArray(value) ? Object.fromEntries(Array.from({ length: value.length / 2 }, (_, i) => [value[i * 2], value[i * 2 + 1]])) : value ?? {};
function hueWeight(name, hue, band) {
  if (name === 'Master') return 1;
  const centers = { Reds: 0, Yellows: 60, Greens: 120, Cyans: 180, Blues: 240, Magentas: 300 };
  if (!band) { const d = Math.abs(((hue - (centers[name] ?? 0) + 540) % 360) - 180); return clamp((45 - d) / 30); }
  const forward = (a, b) => (b - a + 720) % 360;
  const position = forward(band.falloffStart, hue), start = forward(band.falloffStart, band.rangeStart), end = forward(band.falloffStart, band.rangeEnd), last = forward(band.falloffStart, band.falloffEnd);
  return position > last ? 0 : position < start ? position / Math.max(.0001, start) : position <= end ? 1 : (last - position) / Math.max(.0001, last - end);
}

export function applyAdjustment(image, adjustment, scale = 1) {
  const kind = adjustment.kind;
  if (kind === 'Gaussian Blur') return blurSurface(image, (adjustment.blurRadius ?? 10) * scale);
  if (kind === 'Motion Blur') {
    const output = surface(image.width, image.height), context = output.getContext('2d');
    const distance = (adjustment.motionDistance ?? 10) * scale, angle = -(adjustment.motionAngle ?? 0) * Math.PI / 180, steps = Math.max(2, Math.min(256, Math.ceil(distance)));
    context.globalCompositeOperation = 'lighter'; context.globalAlpha = 1 / steps;
    for (let i = 0; i < steps; i++) { const d = distance * (i / (steps - 1) - .5); context.drawImage(image, Math.cos(angle) * d, Math.sin(angle) * d); }
    return output;
  }
  if (kind === 'Hue/Saturation' || kind === 'Invert') {
    const output = copySurface(image), context = output.getContext('2d'), data = context.getImageData(0, 0, output.width, output.height);
    const settings = adjustment.hsvSettings, adjustments = settings ? dictionary(settings.adjustments) : { Master: adjustment }, bands = dictionary(settings?.bands);
    for (let i = 0; i < data.data.length; i += 4) {
      if (!data.data[i + 3]) continue;
      if (kind === 'Invert') { for (let c = 0; c < 3; c++) data.data[i + c] = 255 - data.data[i + c]; continue; }
      let [h, s, l] = rgbToHsl(data.data[i] / 255, data.data[i + 1] / 255, data.data[i + 2] / 255);
      if (settings?.colorize ?? adjustment.colorize) { const a = adjustments[settings?.range ?? 'Master'] ?? adjustment; h = a.hue ?? 0; s = (a.saturation ?? 25) / 100; l = (a.lightness ?? 0) >= 0 ? l + (1 - l) * (a.lightness ?? 0) / 100 : l * (1 + (a.lightness ?? 0) / 100); }
      else {
        let dh = 0, ds = 0, dl = 0;
        for (const [name, a] of Object.entries(adjustments)) {
          let weight = hueWeight(name, Math.round(h), bands[name]); if (settings?.invertRange && name === settings.range && name !== 'Master') weight = 1 - weight;
          dh += (a.hue ?? 0) * weight; ds += (a.saturation ?? 0) * weight; dl += (a.lightness ?? 0) * weight;
        }
        h += dh; const amount = clamp(ds / 100, -1, 1); s = amount <= 0 ? s * (1 + amount) : amount >= 1 ? (s > 0 ? 1 : 0) : Math.min(1, s / (1 - amount)); const lightness = clamp(dl / 100, -1, 1); l = lightness >= 0 ? l + (1 - l) * lightness : l * (1 + lightness);
      }
      const rgb = hslToRgb(h, clamp(s), clamp(l)); for (let c = 0; c < 3; c++) data.data[i + c] = Math.round(rgb[c] * 255);
    }
    context.putImageData(data, 0, 0); return output;
  }
  return tableFilter(image, (p, w, h, stride) => {
    if (['Levels', 'Curves', 'Exposure'].includes(kind)) {
      const tables = new Float32Array(768);
      for (let c = 0; c < 3; c++) for (let i = 0; i < 256; i++) {
        let value = i / 255;
        if (kind === 'Levels') value = levelsValue(levelsValue(value, adjustment.levels?.ranges?.[c + 1]), adjustment.levels?.ranges?.[0]);
        else if (kind === 'Curves') value = curveValue(adjustment.curves?.channels?.[0], curveValue(adjustment.curves?.channels?.[c + 1], i)) / 255;
        else {
          const s = adjustment.exposureSettings ?? {}; let linear = value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
          linear = Math.max(0, linear * 2 ** (s.exposure ?? 0) + (s.offset ?? 0)) ** (1 / (s.gamma ?? 1)); value = linear <= .0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - .055;
        }
        tables[c * 256 + i] = clamp(value);
      }
      kernels.levels_apply(p, w * h, allocate(tables));
    } else if (kind === 'Gradient Map') {
      const s = adjustment.gradientMapSettings ?? {}, black = { red: 0, green: 0, blue: 0 }, white = { red: 1, green: 1, blue: 1 };
      let a = s.shadows ?? black, b = s.highlights ?? white; if (s.reversed) [a, b] = [b, a];
      const table = new Uint8Array(768); for (let i = 0; i < 256; i++) ['red', 'green', 'blue'].forEach((key, c) => { table[i * 3 + c] = Math.round(255 * a[key] + (b[key] - a[key]) * i); });
      kernels.adjust_gradient_map(p, w, h, stride, allocate(table));
    } else if (kind === 'Black & White') {
      const s = { reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80, tintHue: 40, tintSaturation: 20, ...adjustment.blackWhiteSettings };
      kernels.adjust_black_white(p, w, h, stride, allocate(new Float32Array(['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'].map((key) => s[key] / 100))), s.tint ? 1 : 0, s.tintHue, s.tintSaturation / 100);
    } else if (kind === 'Color Balance') {
      const s = adjustment.colorBalanceSettings ?? {};
      const band = (name) => allocate(new Float32Array(['CyanRed', 'MagentaGreen', 'YellowBlue'].map((key) => (s[name + key] ?? 0) / 100)));
      kernels.adjust_color_balance(p, w, h, stride, band('shadow'), band('mid'), band('highlight'), s.preserveLuminosity === false ? 0 : 1);
    } else if (kind === 'Grain') {
      const s = adjustment.grainSettings ?? {}; kernels.adjust_grain(p, w, h, stride, s.amount ?? 25, s.size ?? 1.5, s.roughness ?? 50, s.seed ?? 0, 0, 0, 1 / scale);
    } else if (kind === 'Add Noise') kernels.noise_add(p, w, h, stride, adjustment.noiseAmount ?? 10, adjustment.noiseGaussian ? 1 : 0, adjustment.noiseMonochromatic ? 1 : 0, adjustment.noiseSeed ?? 0);
    else throw new Error(`Unknown adjustment: ${kind}`);
  });
}

export function applyCameraRaw(image, s, scale = 1) {
  const output = tableFilter(image, (p, w, h, stride) => {
    const c = s.calibration ?? {};
    kernels.adjust_camera_raw_calibration(p, w, h, stride, c.shadowTint ?? 0, c.redHue ?? 0, c.redSaturation ?? 0, c.greenHue ?? 0, c.greenSaturation ?? 0, c.blueHue ?? 0, c.blueSaturation ?? 0, c.processVersion ?? 6);
    kernels.adjust_camera_raw(p, w, h, stride, 1 + (s.temperature ?? 0) * .0035 + (s.tint ?? 0) * .0015, 1 - (s.tint ?? 0) * .003,
      1 - (s.temperature ?? 0) * .0035 + (s.tint ?? 0) * .0015, s.exposure ?? 0, s.contrast ?? 0, s.highlights ?? 0, s.shadows ?? 0, s.whites ?? 0, s.blacks ?? 0, s.vibrance ?? 0, s.saturation ?? 0, s.clipping ?? 0);
    const curve = s.curve ?? {}, mixer = s.mixer ?? {}, grading = s.grading ?? {};
    const bend = (tone, lower, low, upper, high) => tone < lower && lower > 0 ? lower * (tone / lower) ** (2 ** (-low / 100 * 1.66)) : tone > upper && upper < 1 ? 1 - (1 - upper) * ((1 - tone) / (1 - upper)) ** (2 ** (high / 100 * 1.66)) : tone;
    const parametric = Array.from({ length: 33 }, (_, i) => { const x = i / 32; return { x, y: bend(bend(x, (curve.shadowSplit ?? 25) / 100, curve.shadows ?? 0, (curve.lightSplit ?? 75) / 100, curve.highlights ?? 0), (curve.darkSplit ?? 50) / 100, curve.darks ?? 0, (curve.darkSplit ?? 50) / 100, curve.lights ?? 0) }; });
    const table = (points, tone = false) => allocate(new Float32Array(Array.from({ length: 256 }, (_, i) => curveValue(points ?? [{ x: 0, y: 0 }, { x: 1, y: 1 }], tone ? curveValue(parametric, i / 255) : i / 255))));
    const mix = new Float32Array(['hue', 'saturation', 'luminance'].flatMap((key) => Array.from({ length: 8 }, (_, i) => (mixer[key]?.[i] ?? 0) / 100)));
    const grade = new Float32Array(['shadows', 'midtones', 'highlights', 'global'].flatMap((key) => [(grading[key]?.hue ?? 0) / 360, (grading[key]?.saturation ?? 0) / 100, (grading[key]?.luminance ?? 0) / 100]));
    const points = (mixer.points ?? []).flatMap((point) => [point.hue / 360, point.saturation, point.luminance, (point.hueShift ?? 0) / 100, (point.saturationShift ?? 0) / 100, (point.luminanceShift ?? 0) / 100, (point.hueRange ?? 30) / 360, point.saturationRange ?? .4, point.luminanceRange ?? .4]);
    kernels.adjust_camera_raw_curve_color(p, w, h, stride, table(curve.rgb, true), table(curve.red), table(curve.green), table(curve.blue), (curve.refineSaturation ?? 0) / 100, allocate(mix), mixer.points?.length ?? 0, points.length ? allocate(new Float32Array(points)) : 0, allocate(grade), (grading.blending ?? 50) / 100, (grading.balance ?? 0) / 100, s.visualizesPointColor ?? -1);
    kernels.adjust_camera_raw_effects(p, w, h, stride, s.texture ?? 0, s.clarity ?? 0, s.dehaze ?? 0, s.glow ?? 0,
      ['Diffusion', 'Bloom', 'Halation'].indexOf(s.glowStyle ?? 'Diffusion'), s.glowRange ?? 0, s.glowSpread ?? 0, s.glowWarmth ?? 0,
      s.vignetteAmount ?? 0, s.vignetteMidpoint ?? 50, s.vignetteRoundness ?? 0, s.vignetteFeather ?? 50, s.vignetteHighlights ?? 0,
      ['Highlight Priority', 'Color Priority', 'Paint Overlay'].indexOf(s.vignetteStyle ?? 'Highlight Priority'), scale);
    const detail = s.detail ?? {}, optics = s.optics ?? {};
    kernels.adjust_camera_raw_optics(p, w, h, stride, optics.removeChromaticAberration ? 1 : 0, optics.enableLensProfile ? 1 : 0,
      optics.profileDistortion ?? 100, optics.profileVignetting ?? 100, ((optics.distortion ?? 0) + (optics.enableLensProfile ? optics.profileDistortion ?? 100 : 0)) / 100 * .35, optics.purpleAmount ?? 0, optics.purpleHueLow ?? 270, optics.purpleHueHigh ?? 310,
      optics.greenAmount ?? 0, optics.greenHueLow ?? 60, optics.greenHueHigh ?? 120, optics.vignetteAmount ?? 0, optics.vignetteMidpoint ?? 50, scale);
    kernels.adjust_camera_raw_detail(p, w, h, stride, detail.sharpenAmount ?? 0, detail.sharpenRadius ?? 1, detail.sharpenDetail ?? 25, detail.sharpenMasking ?? 0,
      detail.noiseLuminance ?? 0, detail.noiseLuminanceDetail ?? 50, detail.noiseLuminanceContrast ?? 0, detail.noiseColor ?? 0, detail.noiseColorDetail ?? 50, detail.noiseColorSmoothness ?? 50, scale);
    if (s.grainAmount) kernels.adjust_grain(p, w, h, stride, s.grainAmount, .5 + (s.grainSize ?? 25) / 100 * 19.5, s.grainRoughness ?? 50, 0, 0, 0, 1 / scale);
  });
  const geometry = s.geometry ?? {};
  const guides = geometry.upright === 'Guided' ? geometry.guides ?? [] : [];
  if (!guides.length && !['vertical', 'horizontal', 'rotate', 'aspect', 'scale', 'offsetX', 'offsetY'].some((key) => geometry[key])) return output;
  let vertical = geometry.vertical ?? 0, horizontal = geometry.horizontal ?? 0, rotation = geometry.rotate ?? 0;
  if (guides[0]) { const g = guides[0]; let correction = -Math.atan2(g.endY - g.startY, g.endX - g.startX) * 180 / Math.PI; if (correction > 45) correction -= 90; else if (correction < -45) correction += 90; rotation += correction; }
  if (guides[1]) { const g = guides[1], angle = Math.atan2(g.endY - g.startY, g.endX - g.startX) * 180 / Math.PI; if (Math.abs(angle) > 45) vertical += angle > 0 ? 25 : -25; else horizontal += angle > 0 ? 25 : -25; }
  const w = output.width, h = output.height, strength = geometry.projection === 'Rectilinear' ? .55 : 1;
  const v = vertical / 100 * w * .18 * strength, hz = horizontal / 100 * h * .18 * strength;
  const shiftX = (geometry.offsetX ?? 0) / 100 * w * .15, shiftY = (geometry.offsetY ?? 0) / 100 * h * .15, center = { x: w / 2 + shiftX, y: h / 2 + shiftY };
  const angle = rotation * Math.PI / 180, aspect = 1 + (geometry.aspect ?? 0) / 200, zoom = Math.max(.01, 1 + (geometry.scale ?? 0) / 100);
  const corners = [{ x: -v + shiftX, y: h + shiftY }, { x: w + v + shiftX, y: h + shiftY }, { x: w + hz + shiftX, y: -shiftY }, { x: -hz + shiftX, y: -shiftY }].map((p) => {
    const dx = p.x - center.x, dy = p.y - center.y;
    return { x: center.x + (dx * Math.cos(angle) - dy * Math.sin(angle)) * aspect * zoom, y: h - (center.y + (dx * Math.sin(angle) + dy * Math.cos(angle)) / aspect * zoom) };
  });
  const warped = warpImage(output, corners), result = surface(w, h); result.getContext('2d').drawImage(warped.image, ...warped.origin); return result;
}
