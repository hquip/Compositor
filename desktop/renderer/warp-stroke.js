import { independentKernels } from './kernels.js';

export class WarpStroke {
  constructor(canvas, radiusX, radiusY, point, mode) {
    this.canvas = canvas; this.mode = mode; this.radiusX = radiusX; this.radiusY = radiusY; this.rx = Math.ceil(radiusX); this.ry = Math.ceil(radiusY); this.last = point;
    this.kernel = independentKernels(); const k = this.kernel; k.arena_reset(); const size = canvas.width * canvas.height * 4;
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < pixels.length; i += 4) for (let c = 0; c < 3; c++) pixels[i + c] = Math.round(pixels[i + c] * pixels[i + 3] / 255);
    this.original = k.malloc(size); this.pixels = k.malloc(size);
    if (mode === 'Liquify') { this.offsets = k.calloc(canvas.width * canvas.height * 2, 4); this.scratch = k.malloc(canvas.width * canvas.height * 2 * 4); }
    else this.carried = k.malloc((2 * this.rx + 1) * (2 * this.ry + 1) * 4 * 4);
    if (k.arena_failed()) throw new Error('This retouching operation exceeds the available memory.');
    new Uint8Array(k.memory.buffer, this.original, size).set(pixels); new Uint8Array(k.memory.buffer, this.pixels, size).set(pixels);
    if (this.carried) k.portable_pickup(this.pixels, this.carried, canvas.width, canvas.height, Math.round(point.x), Math.round(point.y), this.rx, this.ry);
  }
  append(point, hardness, strength) {
    const from = this.last, distance = Math.hypot(point.x - from.x, point.y - from.y), spacing = Math.max(1, this.radiusX * 2 * (this.mode === 'Smudge' ? .005 : .025));
    if (distance < spacing) return;
    const count = Math.ceil(distance / spacing), k = this.kernel, w = this.canvas.width, h = this.canvas.height;
    for (let i = 1; i <= count; i++) {
      const x = from.x + (point.x - from.x) * i / count, y = from.y + (point.y - from.y) * i / count;
      if (this.mode === 'Smudge') k.portable_smudge(this.pixels, this.carried, w, h, Math.round(x), Math.round(y), this.rx, this.ry, this.radiusX, this.radiusY, Math.min(.98, hardness), strength);
      else k.portable_liquify(this.original, this.pixels, this.offsets, this.scratch, w, h, Math.round(x), Math.round(y), this.radiusX, this.radiusY, Math.min(.98, hardness), strength, (point.x - from.x) / count, (point.y - from.y) / count);
    }
    const left = Math.max(0, Math.floor(Math.min(point.x, from.x) - this.rx - 1)), top = Math.max(0, Math.floor(Math.min(point.y, from.y) - this.ry - 1));
    const right = Math.min(w, Math.ceil(Math.max(point.x, from.x) + this.rx + 2)), bottom = Math.min(h, Math.ceil(Math.max(point.y, from.y) + this.ry + 2));
    if (right > left && bottom > top) {
      const ctx = this.canvas.getContext('2d'), region = ctx.createImageData(right - left, bottom - top), pixels = new Uint8Array(k.memory.buffer, this.pixels, w * h * 4);
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) { const src = (y * w + x) * 4, dst = ((y - top) * region.width + x - left) * 4, alpha = pixels[src + 3]; for (let c = 0; c < 3; c++) region.data[dst + c] = alpha ? Math.min(255, Math.round(pixels[src + c] * 255 / alpha)) : 0; region.data[dst + 3] = alpha; }
      ctx.putImageData(region, left, top);
    }
    this.last = point;
  }
}
