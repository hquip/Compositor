import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { project } from './fixtures.mjs';
import store from '../lib/project.cjs';
import { encodeProject, decodeProject } from '../../mobile/src/archive.js';
import { filterMaskName, mixFilterPixels } from '../renderer/filter-mix.js';
import { paintFilterMask, featherFilterMask } from '../renderer/filter-mask-pixels.js';
import { applyPrecisionFilters } from '../renderer/precision-filters.js';
import { encodePNGGray, decodePNG } from '../renderer/png-pixels.js';
import { copyFilterResources, preparedFilters } from '../renderer/filter-resources.js';
import { adjustmentDefaults } from '../renderer/adjustments.js';

test('filter mixing respects grayscale coverage, opacity and premultiplied transparency', () => {
  const before = new Uint8ClampedArray([200, 50, 100, 128, 100, 50, 10, 255]), after = new Uint8ClampedArray([20, 180, 240, 0, 0, 150, 210, 255]);
  mixFilterPixels(before, after, 2, 1, { opacity: .5, mask: { width: 2, height: 1, values: new Uint8Array([255, 0]) } });
  assert.deepEqual([...after], [200, 50, 100, 64, 100, 50, 10, 255]);
  assert.deepEqual([...mixFilterPixels(before, after.slice(), 2, 1, { opacity: 0 })], [...before]);
});
test('high-precision masks retain least-significant source bits including masked blur alpha', () => {
  const source = { width: 2, height: 1, data: new Uint16Array([12345, 23456, 34567, 65535, 12346, 23457, 34568, 65535]), bits: 16 }, mask = { width: 2, height: 1, values: new Uint8Array([0, 255]) };
  const output = applyPrecisionFilters(source, [{ enabled: true, mask, adjustment: { kind: 'Invert' } }]);
  assert.deepEqual([...output.data], [12345, 23456, 34567, 65535, 53189, 42078, 30967, 65535]);
  assert.deepEqual([...applyPrecisionFilters(source, [{ enabled: true, mask: { width: 1, height: 1, values: new Uint8Array([0]) }, adjustment: { kind: 'Gaussian Blur', blurRadius: 3 } }]).data], [...source.data]);
});
test('mask strokes interpolate, preserve fractional coverage and support normalized mask grids', () => {
  const edits = [{ kind: 'fill', value: 0 }, { kind: 'stroke', value: 255, size: 4, hardness: 1, opacity: .5, points: [[.2, .5], [.8, .5]] }];
  const mask = paintFilterMask(20, 10, null, edits); assert.ok(mask[5 * 20 + 10] > 0 && mask[5 * 20 + 10] < 255); assert.equal(mask[0], 0);
  const scaled = paintFilterMask(4, 2, { width: 1, height: 1, values: new Uint8Array([128]) }, []); assert.ok([...scaled].every((value) => value === 128));
});
test('feathering extends coverage at borders and softens edges without fading constant masks', () => {
  for (const value of [0, 128, 255]) assert.deepEqual([...featherFilterMask(new Uint8Array(15).fill(value), 5, 3, 20)], new Array(15).fill(value));
  const edge = Uint8Array.from({ length: 21 }, (_, x) => x < 10 ? 0 : 255), feathered = featherFilterMask(edge, 21, 1, 2);
  assert.equal(feathered[0], 0); assert.equal(feathered[20], 255); assert.ok(feathered[9] > 0 && feathered[10] < 255);
});
test('compressed grayscale filter assets survive native and phone archives and reject malformed references', async (t) => {
  const snapshot = project(), layer = snapshot.manifest.layers[0], id = crypto.randomUUID().toUpperCase();
  layer.filterSourceFile = `${layer.id}.source.png`; snapshot.assets[layer.filterSourceFile] = snapshot.assets[layer.imageFile];
  layer.filters = [{ id, enabled: true, adjustment: adjustmentDefaults('Invert'), opacity: .75, maskEnabled: true, maskFile: filterMaskName(layer.id, id) }];
  const png = await encodePNGGray(4, 4, new Uint8Array(16).fill(128)); snapshot.assets[layer.filters[0].maskFile] = Buffer.from(png).toString('base64');
  const decoded = await decodePNG(png); assert.equal(decoded.bits, 8); assert.equal(decoded.data[0], 128 * 257);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'compositor-filter-mask-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'Masked.comp'); await store.writeProject(target, snapshot); assert.deepEqual(await store.readProject(target), snapshot); assert.deepEqual(decodeProject(encodeProject(snapshot)), snapshot);
  const executable = process.env.COMPOSITOR_TEST_EXE || fileURLToPath(new URL('../windows/bin/Release/net48/Compositor.exe', import.meta.url));
  const native = () => spawnSync(executable, ['--validate-project', target], { windowsHide: true, encoding: 'utf8' }).status; assert.equal(native(), 0);
  for (const edit of [(m) => { m.version = 13; }, (m) => { m.layers[0].filters[0].maskFile = '../mask.png'; }, (m) => { m.layers[0].filters[0].maskEnabled = 'false'; }, (m) => { m.layers[0].filters[0].opacity = 2; }]) { const invalid = structuredClone(snapshot); edit(invalid.manifest); assert.throws(() => store.validateManifest(invalid.manifest)); await fs.writeFile(path.join(target, 'manifest.json'), JSON.stringify(invalid.manifest)); assert.equal(native(), 1); }
  const missing = structuredClone(snapshot); delete missing.assets[layer.filters[0].maskFile]; assert.throws(() => encodeProject(missing));
  const copy = copyFilterResources(layer.filters, snapshot.assets, crypto.randomUUID().toUpperCase()); assert.notEqual(copy.filters[0].maskFile, layer.filters[0].maskFile); assert.equal(Object.values(copy.assets)[0], snapshot.assets[layer.filters[0].maskFile]);
  const prepared = await preparedFilters(copy.filters, copy.assets); assert.deepEqual([...prepared[0].mask.values], new Array(16).fill(128));
});
