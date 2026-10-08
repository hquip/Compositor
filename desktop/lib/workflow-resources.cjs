const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const NAME = new RegExp('^' + UUID + '\\.resource\\.bin$', 'i');
const KINDS = ['icc', 'channels', 'lookup', 'photoshop', 'plugin'];
const check = (value, message) => { if (!value) throw new Error(message); };
function validateWorkflow(value, depth = 0) {
  check(depth <= 64, 'Workflow metadata is nested too deeply.');
  if (value == null || typeof value === 'boolean') return;
  if (typeof value === 'number') { check(Number.isFinite(value), 'Workflow metadata contains a nonfinite number.'); return; }
  if (typeof value === 'string') { check(value.length <= 1000000, 'Workflow text is too large.'); return; }
  check(typeof value === 'object', 'Invalid workflow metadata.');
  const entries = Array.isArray(value) ? value.map((item, i) => [String(i), item]) : Object.entries(value);
  check(entries.length <= 10000, 'Workflow metadata contains too many entries.');
  for (const [key, item] of entries) { check(!['__proto__', 'constructor', 'prototype'].includes(key), 'Invalid workflow metadata key.'); validateWorkflow(item, depth + 1); }
}
function workflowResources(manifest) {
  const resources = manifest.resources ?? []; check(Array.isArray(resources) && resources.length <= 1024, 'Invalid workflow resource list.');
  if (resources.length || manifest.workflow || manifest.layers?.some((layer) => layer.workflow || layer.fillOpacity != null)) check(manifest.version >= 17, 'Professional workflow metadata requires project version 17.');
  const seen = new Set();
  for (const resource of resources) { check(resource && NAME.test(resource.file) && !seen.has(resource.file.toUpperCase()) && KINDS.includes(resource.kind), 'Invalid or duplicate workflow resource.'); seen.add(resource.file.toUpperCase()); }
  validateWorkflow(manifest.workflow);
  for (const layer of manifest.layers ?? []) { validateWorkflow(layer.workflow); if (layer.fillOpacity != null) check(Number.isFinite(layer.fillOpacity) && layer.fillOpacity >= 0 && layer.fillOpacity <= 1, 'Invalid layer Fill opacity.'); }
  return resources;
}
function inspectWorkflowResource(bytes, kind) {
  check(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= 512 * 1024 * 1024 && KINDS.includes(kind), 'Invalid workflow resource bytes.');
  if (kind === 'icc') check(bytes.length >= 132 && bytes.length <= 16 * 1024 * 1024 && String.fromCharCode(...bytes.subarray(36, 40)) === 'acsp', 'Invalid ICC resource.');
  else if (kind === 'photoshop') check(bytes.length >= 26 && String.fromCharCode(...bytes.subarray(0, 4)) === '8BPS', 'Invalid Photoshop source resource.');
  else if (kind === 'lookup') check(bytes.length <= 32 * 1024 * 1024, 'The lookup resource exceeds its size limit.');
  else if (kind === 'channels') {
    check(bytes.length >= 32 && String.fromCharCode(...bytes.subarray(0, 8)) === 'CCHN0001', 'Invalid channel source header.');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), width = view.getUint32(8, true), height = view.getUint32(12, true), mode = view.getUint32(16, true), bits = view.getUint32(20, true), channels = view.getUint32(24, true);
    check(width >= 1 && height >= 1 && width <= 30000 && height <= 30000 && width * height <= 16000000 && mode <= 2 && [8, 16, 32].includes(bits) && channels === (mode === 1 ? 5 : 4) && bytes.length === 32 + width * height * channels * bits / 8, 'Invalid channel source dimensions or samples.');
    if (bits === 32) for (let i = 0; i < width * height * channels; i++) { const value = view.getFloat32(32 + i * 4, true); check(Number.isFinite(value) && Math.abs(value) <= 1000000 && (i % channels !== channels - 1 || value >= 0 && value <= 1), 'Invalid floating channel sample.'); }
    return { pixels: width * height * channels * bits / 32, width, height };
  }
  return { pixels: 0 };
}
module.exports = { workflowResources, inspectWorkflowResource, validateWorkflow };
