import test from 'node:test';
import assert from 'node:assert/strict';
import { boxMean, guidedMatte, refineMatte } from '../renderer/refine-matte.js';

test('guided refinement preserves constant mattes and follows a hard image edge', () => {
  const width = 20, height = 10, guide = Float32Array.from({ length: width * height }, (_, i) => i % width < 10 ? 0 : 1), mask = Float32Array.from(guide, (value) => value ? .8 : .2);
  const result = guidedMatte(mask, guide, width, height, 3); assert.ok(result[5 * width + 9] < .21); assert.ok(result[5 * width + 10] > .79);
  assert.ok(boxMean(new Float32Array(width * height).fill(.5), width, height, 4).every((value) => Math.abs(value - .5) < 1e-6));
});
test('refinement changes mask coverage without changing the guide and honors keep/remove strokes', () => {
  const width = 8, height = 8, data = new Uint8ClampedArray(width * height * 4).fill(255), before = data.slice();
  const result = refineMatte({ width, height, data }, new Uint8Array(width * height), { radius: 0, strokes: [{ mode: 'Keep', radius: 2, points: [{ x: .5, y: .5 }] }] });
  assert.equal(result[3 * width + 3], 255); assert.equal(result[0], 0); assert.deepEqual(data, before);
  assert.throws(() => refineMatte({ width, height, data }, new Uint8Array(4), {}));
});
