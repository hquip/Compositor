import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasSize, createLayer, History, localPoint, documentPoint, layerEntries, blendRGBA, blendChannel, unsupportedFeatures } from '../renderer/core.js';
import { project } from './fixtures.mjs';

test('transformed points round-trip through rotation, independent scaling, and flips', () => {
  for (const flipX of [false, true]) for (const flipY of [false, true]) {
    const transform = { origin: [13, -27], size: [80, 35], rotation: 67, flipX, flipY };
    const document = documentPoint({ x: 0.23, y: 0.71 }, transform), local = localPoint(document, transform, 120, 70);
    assert.ok(Math.abs(local.x - 0.23 * 120) < 1e-8); assert.ok(Math.abs(local.y - 0.71 * 70) < 1e-8);
  }
});

test('history tracks the saved revision while later edits and undo remain dirty correctly', () => {
  const history = new History(), a = project(), b = structuredClone(a), c = structuredClone(a);
  b.manifest.layers[0].name = 'B'; c.manifest.layers[0].name = 'C';
  history.push(a, b, 'B'); const saving = history.revision;
  history.push(b, c, 'C'); history.savedRevision = saving;
  assert.equal(history.dirty, true); assert.deepEqual(history.undo(), b); assert.equal(history.dirty, false);
  assert.deepEqual(history.redo(), c); assert.equal(history.dirty, true);
  history.undo(); history.push(b, a, 'Another edit'); assert.equal(history.redo(), null);
});

test('history enforces retention count and shared pixel budgets', () => {
  const history = new History(2, 500), a = project();
  for (let i = 0; i < 5; i++) { const b = structuredClone(a); b.manifest.width += i; history.push(a, b, 'Edit'); }
  assert.equal(history.past.length, 2);
  const large = structuredClone(a); large.assets.image = 'x'.repeat(300);
  history.push(large, a, 'Pixels'); assert.equal(history.past.length, 0);
});

test('folder visibility and opacity multiply into descendants without changing their flags', () => {
  const group = createLayer('Folder', 10, 10), child = createLayer('Image', 10, 10);
  group.isGroup = true; group.opacity = 0.5; child.parentID = group.id; child.opacity = 0.4;
  const entries = layerEntries([child, group]); assert.equal(entries[1].opacity, 0.2); assert.equal(entries[1].depth, 1);
  group.isVisible = false; assert.equal(layerEntries([child, group])[1].visible, false); assert.equal(child.isVisible, true);
});

test('extra blend modes preserve alpha and retain source color over transparent pixels', () => {
  for (const mode of ['Linear Burn', 'Linear Dodge (Add)', 'Vivid Light', 'Linear Light', 'Pin Light', 'Hard Mix', 'Subtract', 'Divide']) {
    assert.deepEqual(blendRGBA([0, 0, 0, 0], [100, 150, 200, 128], mode), [100, 150, 200, 128]);
    assert.deepEqual(blendRGBA([10, 20, 30, 255], [0, 0, 0, 0], mode), [10, 20, 30, 255]);
    assert.ok(Number.isFinite(blendChannel(0.4, 0, mode))); assert.ok(Number.isFinite(blendChannel(0.4, 1, mode)));
  }
  assert.deepEqual(blendRGBA([100, 80, 60, 255], [80, 120, 140, 255], 'Subtract'), [20, 0, 0, 255]);
});

test('known adjustments and effects are accepted and unknown adjustment kinds are reported', () => {
  const manifest = project().manifest;
  manifest.layers[0].effects = { shadow: { enabled: false } }; assert.deepEqual(unsupportedFeatures(manifest), []);
  manifest.layers[0].effects.shadow.enabled = true; assert.deepEqual(unsupportedFeatures(manifest), []);
  manifest.layers[0].adjustment = { kind: 'Curves' }; assert.deepEqual(unsupportedFeatures(manifest), []);
  manifest.layers[0].adjustment = { kind: 'Future' }; assert.deepEqual(unsupportedFeatures(manifest), ['unknown adjustment Future']);
});

test('canvas validation rejects fractional, empty, and excessive surfaces', () => {
  assert.deepEqual(canvasSize(1920, 1080), [1920, 1080]);
  for (const pair of [[0, 1], [1.5, 2], [30001, 1], [30000, 30000], [NaN, 100]]) assert.throws(() => canvasSize(...pair));
});
