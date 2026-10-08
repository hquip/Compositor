import test from 'node:test';
import assert from 'node:assert/strict';
import { kernels, allocate, pixelKernel } from '../renderer/kernels.js';
import { homography, inverse3 } from '../renderer/transforms.js';

test('the original C black-and-white kernel retains color-family weights', () => {
  const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
  pixelKernel(pixels, 3, 1, (p, w, h, stride) => kernels.adjust_black_white(p, w, h, stride, allocate(new Float32Array([.4, .6, .4, .6, .2, .8])), 0, 0, 0));
  assert.deepEqual([...pixels], [102, 102, 102, 255, 102, 102, 102, 255, 51, 51, 51, 255]);
});
test('original C Camera Raw defaults are an identity and exposure raises midtones', () => {
  const original = new Uint8ClampedArray([128, 96, 64, 255, 20, 200, 40, 255]), identity = original.slice(), exposed = original.slice();
  pixelKernel(identity, 2, 1, (p, w, h, stride) => kernels.adjust_camera_raw(p, w, h, stride, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0));
  assert.deepEqual(identity, original);
  pixelKernel(exposed, 2, 1, (p, w, h, stride) => kernels.adjust_camera_raw(p, w, h, stride, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0));
  assert.ok(exposed[0] > original[0]); assert.equal(exposed[3], 255);
});
test('the original C wand separates contiguous regions', () => {
  const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255]); let mask;
  const run = (contiguous) => pixelKernel(pixels, 3, 1, (p, w, h, stride) => { const output = allocate(3); const count = kernels.wand_mask(p, w, h, stride, 0, 0, 0, 0, contiguous, output); mask = [...new Uint8Array(kernels.memory.buffer, output, 3)]; return count; });
  run(1); assert.deepEqual(mask, [255, 0, 0]); run(0); assert.deepEqual(mask, [255, 0, 255]);
});
test('original C noise is reproducible and preserves transparency', () => {
  const source = new Uint8ClampedArray([128, 128, 128, 255, 0, 0, 0, 0]), a = source.slice(), b = source.slice();
  const run = (pixels) => pixelKernel(pixels, 2, 1, (p, w, h, stride) => kernels.noise_add(p, w, h, stride, 50, 1, 1, 123));
  run(a); run(b); assert.deepEqual(a, b); assert.deepEqual([...a.slice(4)], [0, 0, 0, 0]); assert.equal(a[0], a[1]);
});
test('content fill restores a small missing region from its surrounding pixels', () => {
  const pixels = new Uint8ClampedArray(15 * 15 * 4); for (let i = 0; i < pixels.length; i += 4) pixels.set([100, 150, 200, 255], i);
  pixels.set([0, 0, 0, 0], 112 * 4); const coverage = new Uint8Array(225); coverage[112] = 255;
  pixelKernel(pixels, 15, 15, (p, w, h, stride) => kernels.content_fill(p, stride, allocate(coverage), w, w, h));
  assert.deepEqual([...pixels.slice(448, 452)], [100, 150, 200, 255]);
});
test('perspective mapping preserves each specified corner', () => {
  const corners = [{ x: 4, y: 5 }, { x: 104, y: 12 }, { x: 87, y: 90 }, { x: 13, y: 102 }], matrix = homography(corners), inverse = inverse3(matrix);
  for (let i = 0; i < corners.length; i++) { const p = corners[i], denominator = inverse[6] * p.x + inverse[7] * p.y + inverse[8], x = (inverse[0] * p.x + inverse[1] * p.y + inverse[2]) / denominator, y = (inverse[3] * p.x + inverse[4] * p.y + inverse[5]) / denominator;
    assert.ok(Math.abs(x - [0, 1, 1, 0][i]) < 1e-7); assert.ok(Math.abs(y - [0, 0, 1, 1][i]) < 1e-7); }
});
