import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs/promises';
import store from '../lib/project.cjs';
import { decodePNG, encodePNG8 } from '../renderer/png-pixels.js';
import { surface } from '../renderer/raster.js';
import { applyAdjustment, adjustmentDefaults } from '../renderer/adjustments.js';

const root = await fs.realpath(path.resolve(process.argv[2] ?? '.'));
const tools = [
  { name: 'compositor_inspect', description: 'Read a .comp project and inspect document/layer metadata.', inputSchema: { type: 'object', properties: { project: { type: 'string' } }, required: ['project'], additionalProperties: false } },
  { name: 'compositor_update_layer', description: 'Update layer name, visibility, opacity, Fill or transform in a .comp project.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, layer: { type: 'string' }, changes: { type: 'object' } }, required: ['project', 'layer', 'changes'], additionalProperties: false } },
  { name: 'compositor_adjust', description: 'Apply an editable adjustment to an ordinary raster layer and retain the original source.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, layer: { type: 'string' }, adjustment: { type: 'object' } }, required: ['project', 'layer', 'adjustment'], additionalProperties: false } },
];
async function projectPath(name) {
  if (typeof name !== 'string' || !name.toLowerCase().endsWith('.comp')) throw new Error('Provide a .comp project path.');
  const resolved = await fs.realpath(path.resolve(root, name)), relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('The project is outside the configured workspace.');
  return resolved;
}
async function invokeTool(name, args) {
  const target = await projectPath(args.project), snapshot = await store.readProject(target);
  if (name === 'compositor_inspect') return { project: path.relative(root, target), manifest: snapshot.manifest };
  const layer = snapshot.manifest.layers.find((item) => item.id.toLowerCase() === String(args.layer).toLowerCase()); if (!layer) throw new Error('The requested layer does not exist.');
  if (name === 'compositor_update_layer') {
    if (!args.changes || Object.keys(args.changes).some((key) => !['name', 'isVisible', 'opacity', 'fillOpacity', 'transform'].includes(key))) throw new Error('Unsupported layer changes.');
    Object.assign(layer, args.changes); snapshot.manifest.version = store.FORMAT_VERSION;
  } else if (name === 'compositor_adjust') {
    if (!layer.imageFile || layer.workflow?.channelFile || layer.hdrSourceFile || layer.smartObject) throw new Error('This adjustment tool requires an ordinary raster layer.');
    const settings = { ...adjustmentDefaults(args.adjustment?.kind), ...args.adjustment }, source = layer.filterSourceFile ?? layer.imageFile, originalSource = snapshot.assets[source];
    const image = await decodePNG(Buffer.from(snapshot.assets[source], 'base64'), 16000000); if (image.bits === 16) throw new Error('Use the interactive high-precision editor for this source.');
    let canvas = surface(image.width, image.height), context = canvas.getContext('2d'), pixels = context.createImageData(image.width, image.height); pixels.data.set(Uint8ClampedArray.from(image.data, (v) => v / 257)); context.putImageData(pixels, 0, 0);
    const filters = [...(layer.filters ?? []), { id: crypto.randomUUID().toUpperCase(), enabled: true, adjustment: settings }];
    for (const filter of filters) if (filter.enabled) { if (filter.maskFile) throw new Error('This automation tool requires unmasked filters.'); canvas = applyAdjustment(canvas, filter.adjustment); }
    const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    snapshot.assets[layer.imageFile] = Buffer.from(await encodePNG8({ width: canvas.width, height: canvas.height, data: rgba })).toString('base64');
    layer.filterSourceFile ??= layer.id + '.source.png'; snapshot.assets[layer.filterSourceFile] ??= originalSource;
    layer.filters = filters; delete layer.text; delete layer.shape; delete layer.vectorPath; snapshot.manifest.version = store.FORMAT_VERSION;
  } else throw new Error('Unknown Compositor tool.');
  await store.writeProject(target, snapshot); return { saved: true, project: path.relative(root, target), layer: layer.id };
}
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue; let request;
  try {
    request = JSON.parse(line); if (request.id == null) continue;
    let result;
    if (request.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'compositor', version: '0.11.0' } };
    else if (request.method === 'ping') result = {};
    else if (request.method === 'tools/list') result = { tools };
    else if (request.method === 'tools/call') { try { const value = await invokeTool(request.params.name, request.params.arguments ?? {}); result = { content: [{ type: 'text', text: JSON.stringify(value) }] }; } catch (error) { result = { isError: true, content: [{ type: 'text', text: error.message }] }; } }
    else { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } }) + '\n'); continue; }
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
  } catch (error) { if (request?.id != null) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32602, message: error.message } }) + '\n'); }
}
