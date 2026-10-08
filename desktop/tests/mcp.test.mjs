import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import store from '../lib/project.cjs';
import { compatibilityFixture } from './compatibility-fixture.mjs';

test('MCP tools inspect and atomically update projects inside the configured workspace', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'compositor-mcp-'));
  try {
    const snapshot = compatibilityFixture(), project = path.join(root, 'Test.comp'); await store.writeProject(project, snapshot);
    const lines = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'compositor_update_layer', arguments: { project: 'Test.comp', layer: snapshot.manifest.layers[0].id, changes: { name: 'Agent edited', opacity: .5 } } } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'compositor_inspect', arguments: { project: 'Test.comp' } } },
    ];
    const output = execFileSync(process.execPath, ['mcp/server.mjs', root], { cwd: new URL('../', import.meta.url), input: lines.map((line) => JSON.stringify(line)).join('\n') + '\n', encoding: 'utf8', timeout: 30000, windowsHide: true }).trim().split('\n').map(JSON.parse);
    assert.equal(output[0].result.serverInfo.name, 'compositor'); assert.equal(output[1].result.tools.length, 3); assert.equal(output[2].result.isError, undefined);
    const inspected = JSON.parse(output[3].result.content[0].text); assert.equal(inspected.manifest.layers[0].name, 'Agent edited');
    const saved = await store.readProject(project); assert.equal(saved.manifest.layers[0].opacity, .5);
  } finally { await rm(root, { recursive: true, force: true }); }
});
