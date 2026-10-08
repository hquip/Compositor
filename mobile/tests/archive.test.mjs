import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { encodeProject, decodeProject } from '../src/archive.js';
import { ProjectLibrary } from '../src/projects.js';
import { compatibilityFixture } from '../../desktop/tests/compatibility-fixture.mjs';

test('mobile archives preserve all Mac version 11 metadata and PNG bytes', () => {
  const snapshot = compatibilityFixture(), archive = encodeProject(snapshot, '中英文项目');
  assert.deepEqual(decodeProject(archive), snapshot);
  assert.ok(unzipSync(archive)['中英文项目.comp/manifest.json']);
});
test('archives reject traversal, future versions, and invalid resource references', () => {
  assert.throws(() => decodeProject(zipSync({ '../manifest.json': strToU8('{}') })), /invalid/);
  const snapshot = compatibilityFixture(); snapshot.manifest.version = 99;
  assert.throws(() => encodeProject(snapshot), /versions/);
  snapshot.manifest.version = 11; snapshot.manifest.layers[1].imageFile = '../secret.png';
  assert.throws(() => encodeProject(snapshot), /filename/);
});

test('mobile archives reject text run ranges that cannot be loaded by Mac or Windows', () => {
  const snapshot = compatibilityFixture(), text = snapshot.manifest.layers.find((layer) => layer.text).text;
  text.colorRuns = [{ location: text.content.length, length: 2, red: 1, green: 0, blue: 0 }];
  assert.throws(() => encodeProject(snapshot), /text run/);
});
test('an interrupted mobile save leaves the preceding project readable', async () => {
  const files = new Map(); let failMetadata = false;
  const filesystem = {
    async writeFile({ path, data }) { if (failMetadata && path.endsWith('.json')) throw new Error('Storage full'); files.set(path, data); },
    async readFile({ path }) { if (!files.has(path)) throw new Error('ENOENT'); return { data: files.get(path) }; },
    async readdir() { return { files: [...files.keys()].map((path) => ({ name: path.split('/').at(-1) })) }; },
    async deleteFile({ path }) { files.delete(path); },
  };
  const library = new ProjectLibrary(filesystem, 'DATA'), snapshot = compatibilityFixture();
  const saved = await library.save(snapshot, 'First'); failMetadata = true;
  const changed = structuredClone(snapshot); changed.manifest.layers[1].name = 'Unsaved edit';
  await assert.rejects(library.save(changed, 'Second', saved.id), /Storage full/);
  const projects = await library.list(); assert.equal(projects.length, 1); assert.equal(projects[0].name, 'First');
  assert.deepEqual(await library.read(projects[0]), snapshot);
});
