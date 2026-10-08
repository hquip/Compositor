import { morphology } from './raster.js';

export function boxMean(source, width, height, radius) {
  const span = radius * 2 + 1, pass = new Float32Array(source.length), result = new Float32Array(source.length);
  for (let y = 0; y < height; y++) {
    const row = y * width; let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += source[row + Math.min(width - 1, Math.max(0, x))];
    for (let x = 0; x < width; x++) { pass[row + x] = sum / span; sum += source[row + Math.min(width - 1, x + radius + 1)] - source[row + Math.max(0, x - radius)]; }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0; for (let y = -radius; y <= radius; y++) sum += pass[Math.min(height - 1, Math.max(0, y)) * width + x];
    for (let y = 0; y < height; y++) { result[y * width + x] = sum / span; sum += pass[Math.min(height - 1, y + radius + 1) * width + x] - pass[Math.max(0, y - radius) * width + x]; }
  } return result;
}

// The same guided-filter equations as the Mac GuidedMatte implementation.
export function guidedMatte(mask, guide, width, height, radius, epsilon = 1e-4) {
  const count = width * height, meanGuide = boxMean(guide, width, height, radius), meanMask = boxMean(mask, width, height, radius);
  const squares = Float32Array.from(guide, (value) => value * value), products = Float32Array.from(mask, (value, i) => value * guide[i]);
  const meanSquares = boxMean(squares, width, height, radius), meanProducts = boxMean(products, width, height, radius);
  for (let i = 0; i < count; i++) { squares[i] = (meanProducts[i] - meanGuide[i] * meanMask[i]) / (Math.max(0, meanSquares[i] - meanGuide[i] ** 2) + epsilon); products[i] = meanMask[i] - squares[i] * meanGuide[i]; }
  const slopes = boxMean(squares, width, height, radius), offsets = boxMean(products, width, height, radius);
  return Float32Array.from(mask, (_, i) => Math.max(0, Math.min(1, slopes[i] * guide[i] + offsets[i])));
}

export function refineMatte(pixels, alpha, settings, scale = 1) {
  const { width, height, data } = pixels, count = width * height;
  if (alpha.length !== count) throw new Error('The mask dimensions do not match the image.');
  let mask = Float32Array.from(alpha, (value) => value / 255);
  const guide = Float32Array.from(alpha, (_, i) => (.2126 * data[i * 4] + .7152 * data[i * 4 + 1] + .0722 * data[i * 4 + 2]) / 255);
  const radius = Math.max(0, Math.min(100, Math.round((settings.radius ?? 5) * scale)));
  if (radius) mask = guidedMatte(mask, guide, width, height, radius);
  const smooth = Math.max(0, Math.round((settings.smooth ?? 0) * scale)); if (smooth) mask = boxMean(mask, width, height, smooth);
  let values = Uint8ClampedArray.from(mask, (value) => value * 255);
  const shift = Math.round((settings.shift ?? 0) * scale); if (shift) values = morphology(values, width, height, Math.abs(shift), shift > 0);
  mask = Float32Array.from(values, (value) => value / 255);
  const feather = Math.max(0, Math.round((settings.feather ?? 0) * scale)); if (feather) mask = boxMean(mask, width, height, feather);
  const contrast = Math.max(1, 1 + (settings.contrast ?? 0) / 10);
  for (let i = 0; i < count; i++) mask[i] = Math.max(0, Math.min(1, (mask[i] - .5) * contrast + .5));
  for (const stroke of settings.strokes ?? []) {
    const radius = Math.max(.5, stroke.radius * scale);
    const points = stroke.points.map((p) => ({ x: p.x * width, y: p.y * height }));
    for (let j = 0; j < points.length; j++) {
      const a = points[Math.max(0, j - 1)], b = points[j], dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
      const left = Math.max(0, Math.floor(Math.min(a.x, b.x) - radius)), top = Math.max(0, Math.floor(Math.min(a.y, b.y) - radius));
      const right = Math.min(width, Math.ceil(Math.max(a.x, b.x) + radius)), bottom = Math.min(height, Math.ceil(Math.max(a.y, b.y) + radius));
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
        const t = length ? Math.max(0, Math.min(1, ((x + .5 - a.x) * dx + (y + .5 - a.y) * dy) / length)) : 0;
        const coverage = Math.max(0, Math.min(1, radius - Math.hypot(x + .5 - a.x - t * dx, y + .5 - a.y - t * dy) + .5));
        const index = y * width + x; mask[index] = stroke.mode === 'Keep' ? mask[index] + (1 - mask[index]) * coverage : mask[index] * (1 - coverage);
      }
    }
  }
  return Uint8ClampedArray.from(mask, (value) => value * 255);
}
