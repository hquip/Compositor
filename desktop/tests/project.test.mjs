import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import store from '../lib/project.cjs';
import { project, png } from './fixtures.mjs';
import { createLayer } from '../renderer/core.js';

async function workspace(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'compositor-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('project round-trip keeps pixels, transforms, optional metadata, and grayscale masks', async (t) => {
  const directory = path.join(await workspace(t), 'Roundtrip.comp'), snapshot = project(), layer = snapshot.manifest.layers[0];
  layer.transform.rotation = 27; layer.transform.flipX = true; layer.opacity = 0.35; layer.blendMode = 'Soft Light';
  layer.maskFile = `${layer.id}.mask.png`; layer.maskEnabled = true; layer.maskLinked = false;
  layer.maskPlacement = structuredClone(layer.transform); layer.maskPlacement.origin = [12, 15];
  snapshot.assets[layer.maskFile] = png(4, 4, [128], true).toString('base64');
  await store.writeProject(directory, snapshot);
  assert.deepEqual(await store.readProject(directory), snapshot);
  layer.name = 'Updated';
  await store.writeProject(directory, snapshot);
  assert.equal((await store.readProject(directory)).manifest.layers[0].name, 'Updated');
  assert.deepEqual((await fs.readdir(path.dirname(directory))).sort(), ['Roundtrip.comp']);
});

test('invalid replacement leaves the previous project intact', async (t) => {
  const directory = path.join(await workspace(t), 'Safe.comp'), original = project();
  await store.writeProject(directory, original);
  const broken = structuredClone(original); broken.assets = {};
  await assert.rejects(store.writeProject(directory, broken), /missing|invalid/);
  assert.deepEqual(await store.readProject(directory), original);
});

test('failed directory installation restores the previous package', async (t) => {
  const directory = path.join(await workspace(t), 'Rollback.comp'), original = project();
  await store.writeProject(directory, original);
  const replacement = structuredClone(original); replacement.manifest.layers[0].name = 'Replacement';
  const rename = fs.rename;
  fs.rename = async (from, to) => {
    if (path.basename(from).startsWith('.compositor-save-') && to === directory) throw new Error('Simulated file lock');
    return rename(from, to);
  };
  try { await assert.rejects(store.writeProject(directory, replacement), /file lock/); }
  finally { fs.rename = rename; }
  assert.deepEqual(await store.readProject(directory), original);
  assert.deepEqual(await fs.readdir(path.dirname(directory)), ['Rollback.comp']);
});

test('saving refuses an unrelated directory and does not remove its files', async (t) => {
  const directory = path.join(await workspace(t), 'Personal.comp');
  await fs.mkdir(directory); await fs.writeFile(path.join(directory, 'keep.txt'), 'Keep this');
  await assert.rejects(store.writeProject(directory, project()), /not a Compositor/);
  assert.equal(await fs.readFile(path.join(directory, 'keep.txt'), 'utf8'), 'Keep this');
});

test('rejects future formats, invalid dimensions, unsafe asset paths, and duplicate IDs', () => {
  const original = project().manifest;
  for (const edit of [(m) => { m.version = 999; }, (m) => { m.width = 30001; }, (m) => { m.width = 30000; m.height = 30000; },
    (m) => { m.layers[0].imageFile = '../secret.png'; }, (m) => { m.layers.push(structuredClone(m.layers[0])); },
    (m) => { m.layers[0].transform.rotation = Infinity; }, (m) => { m.layers[0].opacity = -1; }]) {
    const manifest = structuredClone(original); edit(manifest); assert.throws(() => store.validateManifest(manifest));
  }
});

test('rejects hierarchy and clipping cycles', () => {
  const snapshot = project(), group = createLayer('Group', 64, 48);
  group.isGroup = true; group.parentID = group.id; snapshot.manifest.layers.push(group);
  assert.throws(() => store.validateManifest(snapshot.manifest), /hierarchy/);
  delete group.parentID; snapshot.manifest.layers[0].maskSourceID = snapshot.manifest.layers[0].id;
  assert.throws(() => store.validateManifest(snapshot.manifest), /clipping/);
});

test('accepts old versions with default fields and validates version gates', () => {
  const manifest = project().manifest; manifest.version = 1;
  delete manifest.layers[0].opacity; delete manifest.layers[0].blendMode;
  store.validateManifest(manifest);
  manifest.layers[0].opacity = 0.5;
  assert.throws(() => store.validateManifest(manifest), /version 3/);
});

test('PNG limits reject oversized dimensions, non-PNGs, and RGBA masks', () => {
  const bytes = png(); assert.deepEqual(store.inspectPNG(bytes), { width: 4, height: 4, pixels: 16 });
  assert.throws(() => store.inspectPNG(bytes, true), /grayscale/);
  assert.throws(() => store.inspectPNG(Buffer.from('not an image')));
  const oversized = Buffer.from(bytes); oversized.writeUInt32BE(30001, 16);
  assert.throws(() => store.inspectPNG(oversized), /dimensions/);
});

test('missing or corrupt files fail before installation', async (t) => {
  const directory = path.join(await workspace(t), 'Broken.comp'), snapshot = project();
  await store.writeProject(directory, snapshot);
  await fs.writeFile(path.join(directory, 'images', snapshot.manifest.layers[0].imageFile), 'broken');
  await assert.rejects(store.readProject(directory), /PNG/);
  await fs.writeFile(path.join(directory, 'manifest.json'), '{');
  await assert.rejects(store.readProject(directory), /damaged/);
});
