import test from 'node:test';
import assert from 'node:assert/strict';
import { cropAspect, constrainedCrop } from '../renderer/crop-geometry.js';
import { strokeCoverage, paintStroke } from '../renderer/selection-stroke.js';
import { withResolution } from '../renderer/image-metadata.js';

test('crop ratios stay locked against canvas edges and backward drags', () => {
  for (const [start, end] of [[{ x: 10, y: 10 }, { x: 100, y: 60 }], [{ x: 99, y: 59 }, { x: 0, y: 0 }]]) {
    const result = constrainedCrop(start, end, 100, 60, cropAspect('Custom', 9, 20));
    assert.ok(Math.abs(result.width / result.height - 9 / 20) < 1e-10);
    assert.ok(result.x >= 0 && result.y >= 0 && result.x + result.width <= 100 && result.y + result.height <= 60);
  }
  assert.equal(cropAspect('9:20'), .45);
  assert.equal(cropAspect('Free'), null);
  assert.throws(() => cropAspect('Custom', 0, 20));
  assert.throws(() => cropAspect('Custom', 9, NaN));
});

test('selection stroke positions respect holes and the interior', () => {
  const values = new Uint8ClampedArray(15 * 15);
  for (let y = 3; y < 12; y++) for (let x = 3; x < 12; x++) values[y * 15 + x] = 255;
  assert.equal(strokeCoverage(values, 15, 15, 2, 'Inside')[5 * 15 + 5], 0);
  values[7 * 15 + 7] = 0;
  const inside = strokeCoverage(values, 15, 15, 2, 'Inside'), outside = strokeCoverage(values, 15, 15, 2, 'Outside');
  assert.equal(inside[3 * 15 + 7], 255); assert.equal(inside[2 * 15 + 7], 0);
  assert.equal(outside[2 * 15 + 7], 255); assert.equal(outside[3 * 15 + 7], 0);
  assert.equal(outside[7 * 15 + 7], 255); assert.equal(inside[7 * 15 + 7], 0);
  assert.throws(() => strokeCoverage(values, 15, 15, 0, 'Inside'));
});

test('stroke painting preserves alpha when requested and does not accumulate zero opacity', () => {
  const color = { red: 1, green: 0, blue: 0 }, pixels = new Uint8ClampedArray([0, 0, 255, 128, 0, 0, 0, 0]);
  assert.equal(paintStroke(pixels, new Uint8ClampedArray([255, 255]), color, .5, true, 'Normal'), true);
  assert.deepEqual([...pixels], [128, 0, 128, 128, 0, 0, 0, 0]);
  const original = pixels.slice(); assert.equal(paintStroke(pixels, new Uint8ClampedArray([255, 255]), color, 0, false, 'Normal'), false); assert.deepEqual(pixels, original);
  paintStroke(pixels, new Uint8ClampedArray([0, 255]), color, 1, false, 'Multiply');
  assert.deepEqual([...pixels.slice(4)], [255, 0, 0, 255]);
});

test('resolution tagging leaves WebP container bytes intact', () => {
  const bytes = new TextEncoder().encode('RIFF0000WEBPtest');
  assert.deepEqual(withResolution(bytes, 'webp', 300), bytes);
});
