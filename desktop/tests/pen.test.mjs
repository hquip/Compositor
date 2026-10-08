import test from 'node:test';
import assert from 'node:assert/strict';
import { penResponse } from '../renderer/pen-input.js';
test('pen size, opacity, and tilt are independent and do not alter mouse or touch input', () => {
  assert.deepEqual(penResponse({ pointerType: 'mouse', pressure: .1 }, { size: true, opacity: true, tilt: true }), { size: 1, opacity: 1, aspect: 1, angle: 0 });
  const pen = penResponse({ pointerType: 'pen', pressure: .25, tiltX: 60, tiltY: 0 }, { size: true, opacity: false, tilt: true }); assert.equal(pen.size, .25); assert.equal(pen.opacity, 1); assert.ok(Math.abs(pen.aspect - .5) < 1e-9);
  assert.equal(penResponse({ pointerType: 'pen', pressure: .25 }, { size: false, opacity: true }).size, 1);
});
