import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { curvePoint, segment, splitSegment, pathBounds } from '../renderer/vector-geometry.js';
import { project, png } from './fixtures.mjs';
import store from '../lib/project.cjs';
import { encodeProject, decodeProject } from '../../mobile/src/archive.js';

test('splitting a cubic preserves its entire curve and the closing segment', () => {
  for (const closing of [false, true]) {
    const contour = { closed: closing, nodes: [{ point: [0, 0], outgoing: [0, 1] }, { point: [1, 1], incoming: [1, 0], outgoing: [2, 1] }, { point: [2, 0], incoming: [2, 2], outgoing: [0, 2] }] };
    const index = closing ? 2 : 0, before = segment(contour, index), t = .37; splitSegment(contour, index, t);
    for (let i = 0; i <= 100; i++) { const u = i / 100, actual = curvePoint(segment(contour, u <= t ? index : index + 1), u <= t ? u / t : (u - t) / (1 - t)), expected = curvePoint(before, u); actual.forEach((v, c) => assert.ok(Math.abs(v - expected[c]) < 1e-12)); }
  }
});
test('path bounds enclose off-anchor curve extrema and stroke padding', () => {
  const contour = { closed: false, nodes: [{ point: [0, 0], outgoing: [-20, 50] }, { point: [10, 10], incoming: [40, -30] }] }, box = pathBounds([contour], 5);
  assert.deepEqual(box, { x: -25, y: -35, width: 70, height: 90 });
  for (let i = 0; i <= 100; i++) { const [x, y] = curvePoint(segment(contour, 0), i / 100); assert.ok(x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height); }
});
test('version 13 vectors survive native, reference and phone archives; invalid geometry is rejected', async (t) => {
  const snapshot = project(), layer = snapshot.manifest.layers[0]; delete layer.text; delete layer.shape;
  const style = { contours: [{ closed: true, nodes: [{ point: [0, 0], outgoing: [.4, 0] }, { point: [1, 0] }, { point: [1, 1] }, { point: [0, 1] }] }], fillRule: 'evenodd', fill: { red: 1, green: 1, blue: 1 }, stroke: null, strokeWidth: 0 };
  layer.vectorPath = structuredClone(style); layer.vectorMask = structuredClone(style); layer.maskFile = `${layer.id}.mask.png`; snapshot.assets[layer.maskFile] = png(4, 4, [255], true).toString('base64');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'compositor-vector-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'Vector.comp'); await store.writeProject(target, snapshot);
  assert.deepEqual(await store.readProject(target), snapshot); assert.deepEqual(decodeProject(encodeProject(snapshot)), snapshot);
  const executable = process.env.COMPOSITOR_TEST_EXE || fileURLToPath(new URL('../windows/bin/Release/net48/Compositor.exe', import.meta.url));
  assert.equal(spawnSync(executable, ['--validate-project', target], { windowsHide: true, encoding: 'utf8' }).status, 0);
  for (const edit of [(m) => { m.version = 12; }, (m) => { m.layers[0].vectorMask.contours[0].closed = false; }, (m) => { m.layers[0].vectorPath.contours[0].nodes[0].point = [5, 0]; }, (m) => { m.layers[0].vectorPath.contours[0].nodes = []; }, (m) => { m.layers[0].vectorPath.fill.red = -1; }, (m) => { delete m.layers[0].maskFile; }]) {
    const invalid = structuredClone(snapshot); edit(invalid.manifest); assert.throws(() => store.validateManifest(invalid.manifest));
    await fs.writeFile(path.join(target, 'manifest.json'), JSON.stringify(invalid.manifest)); assert.equal(spawnSync(executable, ['--validate-project', target], { windowsHide: true, encoding: 'utf8' }).status, 1);
  }
});
