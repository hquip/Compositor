import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodeEXR, encodeEXR } from '../renderer/exr-codec.js';
import container from '../lib/exr-container.cjs';
import tiff from '../lib/float-tiff.cjs';
import store from '../lib/project.cjs';
import { project } from './fixtures.mjs';
import { encodeProject, decodeProject } from '../../mobile/src/archive.js';
import { displayPixels, extendedSRGB } from '../renderer/hdr-display.js';
import { adjustmentDefaults } from '../renderer/adjustments.js';

const fixture = async (name) => new Uint8Array(await fs.readFile(new URL('./fixtures/openexr/' + name, import.meta.url))), near = (values, expected) => values.forEach((n, i) => assert.ok(Math.abs(n - expected[i]) <= 1e-5));
test('official PIZ and partial tiles retain float samples and multipart part selection', async () => {
  const tiled = await fixture('tiled-piz.exr'); near((await decodeEXR(tiled)).data.slice(4, 8), [5, .125, -.125, .5]);
  const bytes = await fixture('multipart.exr'); assert.equal(container.inspectEXRContainer(bytes).parts.length, 2); near((await decodeEXR(bytes, { part: 1 })).data.slice(4, 8), [10, .125, -.125, .5]);
  await assert.rejects(decodeEXR(bytes, { part: 2 }), /part/); await assert.rejects(decodeEXR(tiled, { levelX: 12, levelY: 12 }), /level/);
});
for (const name of ['deep-scanline.exr', 'deep-tiled.exr']) test(`official ${name} sorts samples by depth, composites alpha and supports range previews`, async () => {
  const bytes = await fixture(name), result = await decodeEXR(bytes); assert.equal(result.sampleCount, 6); near(result.data.slice(0, 4), [0, 0, 0, 0]); near(result.data.slice(4, 8), [4, 8 / 3, 2 / 3, .75]);
  near((await decodeEXR(bytes, { depthRange: [1.5, 3] })).data.slice(4, 8), [8, 0, 2, .5]); await assert.rejects(decodeEXR(bytes, { sampleLimit: 1 }), /samples/);
});
test('PIZ scanline/tiled multipart delivery keeps each image and tags its working space', async () => {
  const source = { width: 2, height: 1, data: new Float32Array([4, 2, 1, 1, 8, 4, 2, .5]), linearSpace: 'ACEScg' };
  for (const layout of ['Scanline', 'Tiled']) {
    const encoded = await encodeEXR([{ source, name: 'Beauty' }, { source, name: 'Light' }], { layout, compression: 'PIZ', space: 'ACEScg' }), header = container.inspectEXRContainer(encoded); assert.equal(header.parts.length, 2); assert.equal(header.parts[1].colorInteropID, 'lin_ap1_scene');
    near((await decodeEXR(encoded, { part: 1, workingSpace: 'ACEScg' })).data, [...source.data]);
  }
});
test('wide HDR canonical sources and retained Deep bytes survive reference, native and phone project stores', async (t) => {
  const bytes = await fixture('deep-tiled.exr'), source = await decodeEXR(bytes, { workingSpace: 'ACEScg' }), snapshot = project(), layer = snapshot.manifest.layers[0];
  snapshot.manifest.hdrWorkingSpace = 'ACEScg'; snapshot.manifest.hdrView = { exposure: 0, toneMap: 'Reinhard', displayMode: 'Auto' }; layer.hdrSourceFile = `${layer.id}.hdr-source.tif`; layer.exrSourceFile = `${crypto.randomUUID().toUpperCase()}.exr-source.exr`; layer.exrView = { part: 0, group: '', levelX: 0, levelY: 0, encoding: 'File color metadata' }; layer.filters = [{ id: crypto.randomUUID().toUpperCase(), enabled: false, adjustment: adjustmentDefaults('Exposure') }];
  snapshot.assets[layer.hdrSourceFile] = Buffer.from(tiff.encodeFloatTIFF(source)).toString('base64'); snapshot.assets[layer.exrSourceFile] = Buffer.from(bytes).toString('base64'); assert.equal(tiff.decodeFloatTIFF(Buffer.from(snapshot.assets[layer.hdrSourceFile], 'base64'), 16000000, true).linearSpace, 'ACEScg');
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'compositor-deep-')); t.after(() => fs.rm(folder, { recursive: true, force: true })); const file = path.join(folder, 'Deep.comp'); await store.writeProject(file, snapshot); assert.deepEqual(await store.readProject(file), snapshot); assert.deepEqual(decodeProject(encodeProject(snapshot)), snapshot);
  const exe = process.env.COMPOSITOR_TEST_EXE || fileURLToPath(new URL('../windows/bin/Release/net48/Compositor.exe', import.meta.url)); const result = spawnSync(exe, ['--validate-project', file], { encoding: 'utf8', windowsHide: true }); assert.equal(result.status, 0, result.stderr);
  const old = structuredClone(snapshot); old.manifest.version = 15; assert.throws(() => store.validateManifest(old.manifest)); const bad = structuredClone(snapshot); bad.manifest.layers[0].exrSourceFile = '../outside.exr'; assert.throws(() => store.validateManifest(bad.manifest));
});
test('HDR display preparation preserves extended brightness and P3 chromaticity without modifying source', () => {
  const source = { width: 1, height: 1, data: new Float32Array([4, 2, 1, .5]), linearSpace: 'Linear P3-D65' }, displayed = displayPixels(source, 1); near(displayed.data, [8, 4, 2, .5]); near(source.data, [4, 2, 1, .5]); assert.ok(extendedSRGB(displayed.data[0]) > 1); assert.ok(extendedSRGB(-.5) < 0);
});
test('official native library accepts PIZ tiled multipart exports from the WASM codec', { skip: !process.env.COMPOSITOR_EXR_PYTHON }, async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'compositor-exr-reference-')); t.after(() => fs.rm(folder, { recursive: true, force: true })); const source = await decodeEXR(await fixture('tiled-piz.exr'));
  const file = path.join(folder, 'Tiled.exr'); await fs.writeFile(file, await encodeEXR([{ source, name: 'Beauty' }, { source, name: 'Light' }], { compression: 'PIZ', layout: 'Tiled' }));
  const result = spawnSync(process.env.COMPOSITOR_EXR_PYTHON, [fileURLToPath(new URL('./openexr-reference.py', import.meta.url)), 'inspect', file], { encoding: 'utf8', windowsHide: true }); assert.equal(result.status, 0, result.stderr); const decoded = JSON.parse(result.stdout); near(decoded.data.slice(4, 8), [2.5, .0625, -.0625, .5]);
});
