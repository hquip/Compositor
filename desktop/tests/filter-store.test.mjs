import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { project, png } from './fixtures.mjs';
import store from '../lib/project.cjs';
import { encodeProject, decodeProject } from '../../mobile/src/archive.js';
import { encodePNG16 } from '../renderer/png-pixels.js';

test('version 12 filter source and ordered parameters survive native and mobile round trips', async (t) => {
  const snapshot = project(), layer = snapshot.manifest.layers[0]; layer.filterSourceFile = `${layer.id}.source.png`;
  layer.filters = [{ id: crypto.randomUUID().toUpperCase(), enabled: true, adjustment: { kind: 'Invert', hue: 0, saturation: 0, lightness: 0, colorize: false, levels: { ranges: Array.from({ length: 4 }, () => ({ black: 0, white: 255, gamma: 1, outputBlack: 0, outputWhite: 255 })) }, curves: { channels: Array.from({ length: 4 }, () => [{ x: 0, y: 0 }, { x: 255, y: 255 }]) } } }];
  snapshot.assets[layer.filterSourceFile] = snapshot.assets[layer.imageFile]; snapshot.assets[layer.imageFile] = png(4, 4, [0, 255, 255, 255]).toString('base64');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'compositor-filter-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'Filters.comp'); await store.writeProject(target, snapshot); assert.deepEqual(await store.readProject(target), snapshot);
  assert.deepEqual(decodeProject(encodeProject(snapshot)), snapshot);
  const executable = process.env.COMPOSITOR_TEST_EXE || fileURLToPath(new URL('../windows/bin/Release/net48/Compositor.exe', import.meta.url));
  const result = spawnSync(executable, ['--validate-project', target], { windowsHide: true, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  const invalid = structuredClone(snapshot); invalid.manifest.version = 11; assert.throws(() => store.validateManifest(invalid.manifest));
  invalid.manifest.version = 12; invalid.manifest.layers[0].filterSourceFile = '../original.png'; assert.throws(() => store.validateManifest(invalid.manifest));
  const missing = structuredClone(snapshot); delete missing.assets[layer.filterSourceFile]; await assert.rejects(store.writeProject(target, missing)); assert.deepEqual(await store.readProject(target), snapshot);
  const high = structuredClone(snapshot); high.assets[layer.filterSourceFile] = Buffer.from(await encodePNG16({ width: 4, height: 4, data: new Uint16Array(64).fill(12345) })).toString('base64'); high.manifest.layers[0].filterWorkingSpace = 'ProPhoto RGB';
  await store.writeProject(target, high); assert.equal(spawnSync(executable, ['--validate-project', target], { windowsHide: true, encoding: 'utf8' }).status, 0); assert.deepEqual(decodeProject(encodeProject(high)), high);
  const bad = structuredClone(high); bad.manifest.layers[0].filters[0].adjustment.blurRadius = -1; assert.throws(() => store.validateManifest(bad.manifest));
});
