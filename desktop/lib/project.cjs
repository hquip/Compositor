const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { workflowResources, inspectWorkflowResource } = require('./workflow-resources.cjs');

const { FORMAT_VERSION, MAX_SIDE, MAX_SURFACE_PIXELS, MAX_METADATA, MAX_ASSET, BLEND_MODES, requireCondition, validateManifest, inspectPNG, inspectAsset, validateSourceSize, layerResources } = require('./validation.cjs');
const PIXEL_BUDGET = Math.min(800000000, Math.max(MAX_SURFACE_PIXELS, Math.floor(os.totalmem() / 16)));

async function safeRead(root, relative, maximum) {
  const filename = path.join(root, relative);
  const stat = await fs.lstat(filename);
  const real = await fs.realpath(filename);
  const within = path.relative(await fs.realpath(root), real);
  requireCondition(!stat.isSymbolicLink() && stat.isFile() && stat.size <= maximum &&
    within && !within.startsWith('..') && !path.isAbsolute(within), 'Unsafe or oversized project resource.');
  return fs.readFile(filename);
}

async function readProject(directory) {
  const metadata = await safeRead(directory, 'manifest.json', MAX_METADATA);
  let manifest;
  try { manifest = JSON.parse(metadata.toString('utf8')); } catch { throw new Error('The project manifest is damaged.'); }
  validateManifest(manifest);
  manifest.documentID = manifest.documentID.toUpperCase();
  if (manifest.activeLayerID) manifest.activeLayerID = manifest.activeLayerID.toUpperCase();
  for (const layer of manifest.layers) {
    layer.id = layer.id.toUpperCase();
    if (layer.parentID) layer.parentID = layer.parentID.toUpperCase();
    if (layer.maskSourceID) layer.maskSourceID = layer.maskSourceID.toUpperCase();
  }
  const assets = {};
  let usedPixels = 0;
  for (const layer of manifest.layers) {
    for (const [filename, isMask, isHDR] of layerResources(layer)) {
      if (!filename) continue;
      const bytes = await safeRead(directory, path.join('images', filename), MAX_ASSET);
      const info = inspectAsset(bytes, isMask, filename === layer.filterSourceFile, isHDR); validateSourceSize(layer, filename, info, manifest.version); usedPixels += info.pixels;
      requireCondition(usedPixels <= PIXEL_BUDGET, 'This project exceeds the document memory budget.');
      assets[filename] = bytes.toString('base64');
    }
  }
  for (const resource of workflowResources(manifest)) {
    const bytes = await safeRead(directory, path.join('images', resource.file), MAX_ASSET);
    usedPixels += inspectWorkflowResource(bytes, resource.kind).pixels;
    requireCondition(usedPixels <= PIXEL_BUDGET, 'This project exceeds the document memory budget.'); assets[resource.file] = bytes.toString('base64');
  }
  return { manifest, assets };
}

function decodeSnapshot(snapshot) {
  validateManifest(snapshot?.manifest);
  const metadata = Buffer.from(JSON.stringify(snapshot.manifest, null, 2));
  requireCondition(metadata.length <= MAX_METADATA, 'The project manifest is too large.');
  const assets = new Map();
  let usedPixels = 0;
  for (const layer of snapshot.manifest.layers) {
    for (const [filename, isMask, isHDR] of layerResources(layer)) {
      if (!filename) continue;
      const encoded = snapshot.assets?.[filename];
      requireCondition(typeof encoded === 'string' && encoded.length <= Math.ceil(MAX_ASSET / 3) * 4 &&
        /^[A-Za-z0-9+/]*={0,2}$/.test(encoded), 'A project image is missing or invalid.');
      const bytes = Buffer.from(encoded, 'base64');
      const info = inspectAsset(bytes, isMask, filename === layer.filterSourceFile, isHDR); validateSourceSize(layer, filename, info, snapshot.manifest.version); usedPixels += info.pixels;
      requireCondition(usedPixels <= PIXEL_BUDGET, 'This project exceeds the document memory budget.');
      assets.set(filename, bytes);
    }
  }
  for (const resource of workflowResources(snapshot.manifest)) {
    const encoded = snapshot.assets?.[resource.file]; requireCondition(typeof encoded === 'string' && encoded.length <= Math.ceil(MAX_ASSET / 3) * 4 && /^[A-Za-z0-9+/]*={0,2}$/.test(encoded), 'Missing or invalid workflow resource.');
    const bytes = Buffer.from(encoded, 'base64'); usedPixels += inspectWorkflowResource(bytes, resource.kind).pixels;
    requireCondition(usedPixels <= PIXEL_BUDGET, 'This project exceeds the document memory budget.'); assets.set(resource.file, bytes);
  }
  return { metadata, assets };
}

async function writeProject(directory, snapshot) {
  const { metadata, assets } = decodeSnapshot(snapshot);
  const target = path.resolve(directory);
  const parent = path.dirname(target);
  requireCondition(target !== parent && path.extname(target).toLowerCase() === '.comp', 'Save to a folder ending in .comp.');
  let existing = false;
  try {
    const stat = await fs.lstat(target);
    requireCondition(stat.isDirectory() && !stat.isSymbolicLink(), 'The destination must be a regular project folder.');
    await safeRead(target, 'manifest.json', MAX_METADATA);
    existing = true;
  } catch (error) { if (error.code !== 'ENOENT') throw error; else if (await fs.lstat(target).catch(() => null)) throw new Error('The destination is not a Compositor project.'); }
  await fs.mkdir(parent, { recursive: true });
  const staging = await fs.mkdtemp(path.join(parent, '.compositor-save-'));
  const backup = path.join(parent, `.compositor-backup-${randomUUID()}`);
  let moved = false, installed = false;
  try {
    await fs.mkdir(path.join(staging, 'images'));
    for (const [filename, bytes] of assets) await fs.writeFile(path.join(staging, 'images', filename), bytes, { flag: 'wx' });
    await fs.writeFile(path.join(staging, 'manifest.json'), metadata, { flag: 'wx' });
    if (existing) { await fs.rename(target, backup); moved = true; }
    await fs.rename(staging, target);
    installed = true;
  } catch (error) {
    if (moved && !installed) await fs.rename(backup, target);
    throw error;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
    if (installed && moved) await fs.rm(backup, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { FORMAT_VERSION, MAX_SIDE, MAX_SURFACE_PIXELS, PIXEL_BUDGET, BLEND_MODES,
  validateManifest, inspectPNG, readProject, writeProject };
