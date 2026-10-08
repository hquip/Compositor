import { PixelSurface } from './pixel-surface.js';

export function surface(width, height, contextOptions) {
  width = Math.max(1, Math.ceil(width)); height = Math.max(1, Math.ceil(height));
  const canvas = typeof document === 'undefined' ? typeof OffscreenCanvas === 'undefined' ? new PixelSurface(width, height) : new OffscreenCanvas(width, height) : document.createElement('canvas'); canvas.width = width; canvas.height = height;
  if (!canvas.getContext('2d', contextOptions)) throw new Error('Could not allocate image pixels. Try a smaller canvas.');
  return canvas;
}
export function copySurface(image) { const output = surface(image.width, image.height); output.getContext('2d').drawImage(image, 0, 0); return output; }
export function place(context, image, transform, scale = 1) {
  const [x, y] = transform.origin, [w, h] = transform.size;
  context.save(); context.translate((x + w / 2) * scale, (y + h / 2) * scale); context.rotate(transform.rotation * Math.PI / 180);
  context.scale(transform.flipX ? -1 : 1, transform.flipY ? -1 : 1);
  context.imageSmoothingEnabled = transform.sampling !== 'Nearest'; context.imageSmoothingQuality = transform.sampling === 'High quality' ? 'high' : 'low';
  context.drawImage(image, -w * scale / 2, -h * scale / 2, w * scale, h * scale); context.restore();
}
export const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
export function colorCSS(color, fallback = '#000000') { return color ? `rgb(${color.red * 255},${color.green * 255},${color.blue * 255})` : fallback; }
export function colorRecord(hex) { const parts = hex.match(/[\da-f]{2}/gi).map((x) => parseInt(x, 16) / 255); return { red: parts[0], green: parts[1], blue: parts[2] }; }
export function colorHex(color) { return '#' + ['red', 'green', 'blue'].map((key) => Math.round(clamp(color?.[key] ?? 0) * 255).toString(16).padStart(2, '0')).join(''); }

export function curveValue(points, x) {
  points ||= [{ x: 0, y: 0 }, { x: 255, y: 255 }];
  const i = Math.min(points.length - 2, Math.max(0, points.findLastIndex((point) => point.x <= x)));
  const slopes = points.slice(1).map((point, j) => (point.y - points[j].y) / (point.x - points[j].x));
  const slope = (j) => j === 0 ? slopes[0] : j === points.length - 1 ? slopes.at(-1) : slopes[j - 1] * slopes[j] <= 0 ? 0 : 2 / (1 / slopes[j - 1] + 1 / slopes[j]);
  const h = points[i + 1].x - points[i].x, t = clamp((x - points[i].x) / h);
  return clamp((2 * t ** 3 - 3 * t * t + 1) * points[i].y + (t ** 3 - 2 * t * t + t) * h * slope(i) +
    (-2 * t ** 3 + 3 * t * t) * points[i + 1].y + (t ** 3 - t * t) * h * slope(i + 1), 0, points.at(-1).x);
}

export function morphology(values, width, height, radius, maximum = true) {
  radius = Math.ceil(Math.max(0, radius)); if (!radius) return new Uint8ClampedArray(values);
  const temp = new Uint8ClampedArray(values.length), out = new Uint8ClampedArray(values.length);
  const scan = (source, target, length, lines, horizontal) => {
    const queue = new Int32Array(length + radius * 2 + 1);
    for (let line = 0; line < lines; line++) {
      let start = 0, end = 0;
      const at = (i) => i < 0 || i >= length ? 0 : source[horizontal ? line * width + i : i * width + line];
      for (let i = -radius; i < length + radius; i++) {
        const value = at(i);
        while (end > start && (maximum ? at(queue[end - 1]) <= value : at(queue[end - 1]) >= value)) end--;
        queue[end++] = i;
        while (end > start && queue[start] < i - radius * 2) start++;
        const j = i - radius;
        if (j >= 0 && j < length) target[horizontal ? line * width + j : j * width + line] = at(queue[start]);
      }
    }
  };
  scan(values, temp, width, height, true); scan(temp, out, height, width, false); return out;
}

export function alphaSurface(values, width, height) {
  const canvas = surface(width, height), context = canvas.getContext('2d'), pixels = context.createImageData(width, height);
  for (let i = 0; i < values.length; i++) { pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = 255; pixels.data[i * 4 + 3] = values[i]; }
  context.putImageData(pixels, 0, 0); return canvas;
}
