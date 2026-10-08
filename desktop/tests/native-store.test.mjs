import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { project } from './fixtures.mjs';
import store from '../lib/project.cjs';

const executable = process.env.COMPOSITOR_TEST_EXE || fileURLToPath(new URL('../windows/bin/Release/net48/Compositor.exe', import.meta.url));
async function workspace(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'compositor-native-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true })); return directory;
}
function validate(directory) {
  const result = spawnSync(executable, ['--validate-project', directory], { windowsHide: true, encoding: 'utf8', timeout: 10000 });
  if (result.error) throw result.error; return result.status;
}

test('native Windows reader accepts a project written by the reference codec', async (t) => {
  const directory = path.join(await workspace(t), 'Reference.comp');
  await store.writeProject(directory, project()); assert.equal(validate(directory), 0);
});

test('native reader rejects future formats, unsafe filenames, and folder cycles', async (t) => {
  const directory = path.join(await workspace(t), 'Invalid.comp'), original = project();
  await store.writeProject(directory, original);
  for (const edit of [
    (m) => { m.version = 17; },
    (m) => { m.layers[0].imageFile = '../outside.png'; },
    (m) => { m.layers[0].parentID = m.layers[0].id; m.layers[0].isGroup = true; delete m.layers[0].imageFile; },
    (m) => { m.layers[0].maskSourceID = m.layers[0].id; },
    (m) => { m.width = 30000; m.height = 30000; },
  ]) {
    const manifest = structuredClone(original.manifest); edit(manifest);
    await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
    assert.equal(validate(directory), 1);
  }
});

test('native reader rejects corrupt pixels and truncated metadata', async (t) => {
  const directory = path.join(await workspace(t), 'Broken.comp'), snapshot = project();
  await store.writeProject(directory, snapshot);
  await fs.writeFile(path.join(directory, 'images', snapshot.manifest.layers[0].imageFile), 'invalid');
  assert.equal(validate(directory), 1);
  await fs.writeFile(path.join(directory, 'manifest.json'), '{'); assert.equal(validate(directory), 1);
});
