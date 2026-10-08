// The filter worker only needs pixel copies, resampling, and three compositing modes.
// This keeps background processing available in WebViews without OffscreenCanvas.
export class PixelSurface {
  constructor(width, height) { this.width = width; this.height = height; this.data = new Uint8ClampedArray(width * height * 4); this.context = new PixelContext(this); }
  getContext(kind) { return kind === '2d' ? this.context : null; }
}
class PixelContext {
  constructor(canvas) { this.canvas = canvas; this.globalAlpha = 1; this.globalCompositeOperation = 'source-over'; this.imageSmoothingEnabled = true; }
  createImageData(width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; }
  getImageData(x, y, width, height) {
    const output = this.createImageData(width, height), source = this.canvas;
    for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
      const px = x + column, py = y + row; if (px < 0 || py < 0 || px >= source.width || py >= source.height) continue;
      const from = (py * source.width + px) * 4, to = (row * width + column) * 4; output.data.set(source.data.subarray(from, from + 4), to);
    } return output;
  }
  putImageData(image, x, y) {
    const target = this.canvas;
    for (let row = 0; row < image.height; row++) for (let column = 0; column < image.width; column++) {
      const px = x + column, py = y + row; if (px < 0 || py < 0 || px >= target.width || py >= target.height) continue;
      const from = (row * image.width + column) * 4, to = (py * target.width + px) * 4, alpha = image.data[from + 3];
      for (let c = 0; c < 3; c++) target.data[to + c] = alpha ? Math.round(Math.round(image.data[from + c] * alpha / 255) * 255 / alpha) : 0;
      target.data[to + 3] = alpha;
    }
  }
  drawImage(source, x, y, width = source.width, height = source.height) {
    const target = this.canvas, pixels = source.data ?? source.getContext('2d').getImageData(0, 0, source.width, source.height).data;
    if (x === 0 && y === 0 && width === source.width && height === source.height && width === target.width && height === target.height && this.globalAlpha === 1 && this.globalCompositeOperation === 'source-over' && !target.data.some((value) => value)) { target.data.set(pixels); return; }
    const left = Math.max(0, Math.floor(x)), top = Math.max(0, Math.floor(y)), right = Math.min(target.width, Math.ceil(x + width)), bottom = Math.min(target.height, Math.ceil(y + height));
    const rgba = [0, 0, 0, 0];
    for (let dy = top; dy < bottom; dy++) for (let dx = left; dx < right; dx++) {
      rgba.fill(0);
      const sx = Math.max(0, Math.min(source.width - 1, (dx + .5 - x) / width * source.width - .5)), sy = Math.max(0, Math.min(source.height - 1, (dy + .5 - y) / height * source.height - .5));
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      const sample = (px, py, weight) => { const i = (py * source.width + px) * 4, a = pixels[i + 3] / 255 * weight; for (let c = 0; c < 3; c++) rgba[c] += pixels[i + c] / 255 * a; rgba[3] += a; };
      if (!this.imageSmoothingEnabled) sample(Math.round(sx), Math.round(sy), 1);
      else { sample(x0, y0, (1 - fx) * (1 - fy)); sample(Math.min(x0 + 1, source.width - 1), y0, fx * (1 - fy)); sample(x0, Math.min(y0 + 1, source.height - 1), (1 - fx) * fy); sample(Math.min(x0 + 1, source.width - 1), Math.min(y0 + 1, source.height - 1), fx * fy); }
      const coverage = Math.min(1, dx + 1 - x, x + width - dx) * Math.min(1, dy + 1 - y, y + height - dy) * this.globalAlpha;
      const index = (dy * target.width + dx) * 4, af = rgba[3] * coverage, ab = target.data[index + 3] / 255;
      const alpha = this.globalCompositeOperation === 'lighter' ? Math.min(1, af + ab) : af + ab * (1 - af), byteAlpha = Math.round(alpha * 255);
      for (let c = 0; c < 3; c++) {
        const front = rgba[c] * coverage, back = target.data[index + c] / 255 * ab;
        const value = this.globalCompositeOperation === 'lighter' ? Math.min(1, front + back) : this.globalCompositeOperation === 'screen' ? front + back - front * back : front + back * (1 - af);
        target.data[index + c] = byteAlpha ? Math.round(Math.min(byteAlpha, Math.round(value * 255)) * 255 / byteAlpha) : 0;
      } target.data[index + 3] = byteAlpha;
    }
  }
}

export function blurPixels(pixels, radius) {
  if (radius <= 0) return pixels;
  const { width, height } = pixels, count = width * height;
  const plane = new Float32Array(count), work = new Float32Array(count), output = new Uint8ClampedArray(count * 4);
  // Three box passes approximate a Gaussian, with transparent pixels outside the image.
  let lower = Math.floor(Math.sqrt(4 * radius * radius + 1)); if (lower % 2 === 0) lower--;
  lower = Math.max(1, lower); const upper = lower + 2, split = Math.round((12 * radius * radius - 3 * lower * lower - 12 * lower - 9) / (-4 * lower - 4));
  const radii = Array.from({ length: 3 }, (_, i) => ((i < split ? lower : upper) - 1) / 2);
  const scan = (source, target, length, lines, stride, lineStride, r) => {
    const divisor = 2 * r + 1;
    for (let line = 0; line < lines; line++) {
      const start = line * lineStride; let sum = 0;
      for (let i = 0; i <= Math.min(r, length - 1); i++) sum += source[start + i * stride];
      for (let i = 0; i < length; i++) { target[start + i * stride] = sum / divisor; if (i - r >= 0) sum -= source[start + (i - r) * stride]; if (i + r + 1 < length) sum += source[start + (i + r + 1) * stride]; }
    }
  };
  for (const channel of [3, 0, 1, 2]) {
    for (let i = 0; i < count; i++) plane[i] = channel === 3 ? pixels.data[i * 4 + 3] : pixels.data[i * 4 + channel] * pixels.data[i * 4 + 3] / 255;
    for (const r of radii) { scan(plane, work, width, height, 1, width, r); scan(work, plane, height, width, width, 1, r); }
    for (let i = 0; i < count; i++) output[i * 4 + channel] = channel === 3 ? plane[i] : output[i * 4 + 3] ? plane[i] * 255 / output[i * 4 + 3] : 0;
  } pixels.data.set(output); return pixels;
}
