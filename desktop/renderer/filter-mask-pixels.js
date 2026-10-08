import { maskSample } from './filter-mix.js';

export function featherFilterMask(values, width, height, radius) {
  if (!(radius > 0)) return values;
  let lower = Math.max(1, Math.floor(Math.sqrt(4 * radius * radius + 1))); if (lower % 2 === 0) lower--;
  const split = Math.round((12 * radius * radius - 3 * lower * lower - 12 * lower - 9) / (-4 * lower - 4));
  let data = Uint8ClampedArray.from(values); const work = new Uint8ClampedArray(data.length);
  const scan = (source, target, length, lines, stride, offset, r) => {
    for (let line = 0; line < lines; line++) {
      const start = line * offset; let sum = 0;
      for (let x = -r; x <= r; x++) sum += source[start + Math.max(0, Math.min(length - 1, x)) * stride];
      for (let x = 0; x < length; x++) { target[start + x * stride] = sum / (2 * r + 1); sum += source[start + Math.min(length - 1, x + r + 1) * stride] - source[start + Math.max(0, x - r) * stride]; }
    }
  };
  // Extend border coverage instead of introducing transparent edges around an all-white mask.
  for (let pass = 0; pass < 3; pass++) { const r = ((pass < split ? lower : lower + 2) - 1) / 2; scan(data, work, width, height, 1, width, r); scan(work, data, height, width, width, 1, r); }
  return data;
}

export function paintFilterMask(width, height, mask, edits, scale = 1) {
  const values = new Uint8ClampedArray(width * height);
  if (!mask) values.fill(255);
  else for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) values[y * width + x] = maskSample(mask, x, y, width, height) * 255;
  for (const edit of edits) {
    if (edit.kind === 'fill') { values.fill(edit.value); continue; }
    if (edit.kind === 'invert') { for (let i = 0; i < values.length; i++) values[i] = 255 - values[i]; continue; }
    const radius = Math.max(.5, edit.size * scale / 2), hardness = edit.hardness, opacity = edit.opacity;
    const dab = (px, py) => {
      for (let y = Math.max(0, Math.floor(py - radius)); y < Math.min(height, Math.ceil(py + radius)); y++) for (let x = Math.max(0, Math.floor(px - radius)); x < Math.min(width, Math.ceil(px + radius)); x++) {
        const distance = Math.hypot(x + .5 - px, y + .5 - py) / radius; if (distance >= 1) continue;
        const amount = opacity * (distance <= hardness ? 1 : (1 - distance) / Math.max(.0001, 1 - hardness)), i = y * width + x; values[i] += (edit.value - values[i]) * amount;
      }
    };
    let previous;
    for (const point of edit.points) {
      const p = [point[0] * width, point[1] * height];
      if (!previous) dab(...p);
      else { const steps = Math.max(1, Math.ceil(Math.hypot(p[0] - previous[0], p[1] - previous[1]) / Math.max(.5, radius / 4))); for (let n = 1; n <= steps; n++) dab(previous[0] + (p[0] - previous[0]) * n / steps, previous[1] + (p[1] - previous[1]) * n / steps); }
      previous = p;
    }
  } return values;
}
