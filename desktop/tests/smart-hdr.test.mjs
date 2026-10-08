import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import codec from '../lib/float-tiff.cjs';
import store from '../lib/project.cjs';
import { project } from './fixtures.mjs';
import { encodeProject, decodeProject } from '../../mobile/src/archive.js';
import { applyHDRFilters, toneMapHDR, resizeHDR } from '../renderer/hdr-pixels.js';
import { composeHDRPixels } from '../renderer/hdr-compose.js';
import { adjustmentDefaults } from '../renderer/adjustments.js';

test('float32 TIFF preserves highlights, negative colors and fractional alpha exactly', () => {
  const source = { width: 2, height: 1, data: new Float32Array([4, .25, -.125, 1, 65536, 1.000001, .03125, .5]) }, encoded = codec.encodeFloatTIFF(source), decoded = codec.decodeFloatTIFF(encoded, 16000000, true);
  assert.deepEqual(decoded.data, source.data); assert.equal(decoded.bits, 32); assert.ok(toneMapHDR(decoded).data[0] < 255); assert.deepEqual(decoded.data, source.data);
  const bad = { ...source, data: source.data.slice() }; bad.data[0] = NaN; assert.throws(() => codec.encodeFloatTIFF(bad)); assert.throws(() => codec.decodeFloatTIFF(encoded.slice(0, -1)));
});
test('HDR exposure and mask opacity keep values above one and preserve protected source samples', () => {
  const source = { width: 2, height: 1, data: new Float32Array([4, 2, .5, 1, 3, 1, 0, 1]) }, adjustment = adjustmentDefaults('Exposure'); adjustment.exposureSettings = { exposure: 1, offset: 0, gamma: 1 };
  const result = applyHDRFilters(source, [{ enabled: true, adjustment, mask: { width: 2, height: 1, values: new Uint8Array([255, 0]) } }]);
  assert.deepEqual([...result.data], [8, 4, 1, 1, 3, 1, 0, 1]); assert.equal(source.data[0], 4);
  const blur = applyHDRFilters(source, [{ enabled: true, adjustment: { kind: 'Gaussian Blur', blurRadius: .1 } }]); assert.ok(blur.data[0] > 1);
  const scaled = resizeHDR(source, 1, 1); assert.equal(scaled.data[0], 3.5);
});
test('HDR linear compositing preserves additive radiance and independent layer opacity', () => {
  const snapshot = project(), base = snapshot.manifest.layers[0]; base.transform.origin = [0, 0]; base.transform.size = [1, 1]; snapshot.manifest.width = snapshot.manifest.height = 1;
  const top = structuredClone(base); top.id = crypto.randomUUID().toUpperCase(); top.blendMode = 'Linear Dodge (Add)'; top.opacity = .5; snapshot.manifest.layers.push(top);
  const source = { width: 1, height: 1, data: new Float32Array([4, 2, .5, 1]) }, output = composeHDRPixels(snapshot.manifest, new Map([[base.id, source], [top.id, source]]), new Map());
  assert.deepEqual([...output.data], [6, 3, .75, 1]);
});
test('version 15 stores transport smart metadata and raw float sources without touching the bytes', async (t) => {
  const snapshot = project(), layer = snapshot.manifest.layers[0]; layer.hdrSourceFile = `${layer.id}.hdr-source.tif`; layer.filters = [{ id: crypto.randomUUID().toUpperCase(), enabled: false, adjustment: adjustmentDefaults('Exposure') }]; layer.smartObject = { id: crypto.randomUUID().toUpperCase(), width: 4, height: 4, baseTransform: structuredClone(layer.transform) }; snapshot.manifest.hdrView = { exposure: 0, toneMap: 'Reinhard' };
  const data = new Float32Array(64); for (let i = 0; i < 64; i += 4) { data[i] = 4; data[i + 1] = .5; data[i + 3] = 1; } snapshot.assets[layer.hdrSourceFile] = Buffer.from(codec.encodeFloatTIFF({ width: 4, height: 4, data })).toString('base64');
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'compositor-hdr-')); t.after(() => fs.rm(folder, { recursive: true, force: true })); const file = path.join(folder, 'HDR.comp'); await store.writeProject(file, snapshot); assert.deepEqual(await store.readProject(file), snapshot); assert.deepEqual(decodeProject(encodeProject(snapshot)), snapshot);
  const exe = process.env.COMPOSITOR_TEST_EXE || fileURLToPath(new URL('../windows/bin/Release/net48/Compositor.exe', import.meta.url)); assert.equal(spawnSync(exe, ['--validate-project', file], { windowsHide: true, encoding: 'utf8' }).status, 0);
  const old = structuredClone(snapshot); old.manifest.version = 14; assert.throws(() => store.validateManifest(old.manifest)); const broken = structuredClone(snapshot); broken.manifest.layers[0].hdrSourceFile = '../source.tif'; assert.throws(() => store.validateManifest(broken.manifest));
});
