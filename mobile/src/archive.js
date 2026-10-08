import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import validation from '../../desktop/lib/validation.cjs';
import workflows from '../../desktop/lib/workflow-resources.cjs';
const { validateManifest, inspectAsset, validateSourceSize, MAX_METADATA, layerResources } = validation;
export const MOBILE_PIXELS = 48000000;
const MAX_ARCHIVE = 128 * 1024 * 1024;
export function base64(bytes) {
  let output = ''; for (let offset = 0; offset < bytes.length; offset += 32768) output += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(output);
}
export function unbase64(text) { return Uint8Array.from(atob(text), (character) => character.charCodeAt(0)); }
function resources(snapshot) {
  validateManifest(snapshot.manifest);
  if (snapshot.manifest.width > 8192 || snapshot.manifest.height > 8192 || snapshot.manifest.width * snapshot.manifest.height > 16000000) throw new Error('This project exceeds the mobile memory budget.');
  const metadata = strToU8(JSON.stringify(snapshot.manifest, null, 2));
  if (metadata.length > MAX_METADATA) throw new Error('The project manifest is too large.');
  const files = { 'manifest.json': metadata }, exrInfo = new Map(); let pixels = 0, bytes = metadata.length;
  for (const layer of snapshot.manifest.layers) for (const [name, mask, hdr] of layerResources(layer)) {
    if (!name) continue;
    if (files[`images/${name}`]) { if (hdr === 'exr') validateSourceSize(layer, name, exrInfo.get(name), snapshot.manifest.version); continue; }
    if (typeof snapshot.assets?.[name] !== 'string') throw new Error('A project image is missing or invalid.');
    const asset = unbase64(snapshot.assets[name]); const info = inspectAsset(asset, mask, name === layer.filterSourceFile, hdr); validateSourceSize(layer, name, info, snapshot.manifest.version); pixels += info.pixels; bytes += asset.length;
    if (hdr === 'exr') exrInfo.set(name, info);
    if (pixels > MOBILE_PIXELS || bytes > MAX_ARCHIVE) throw new Error('This project exceeds the mobile memory budget.');
    files[`images/${name}`] = asset;
  }
  for (const resource of workflows.workflowResources(snapshot.manifest)) {
    if (typeof snapshot.assets?.[resource.file] !== 'string') throw new Error('Missing workflow resource.');
    const asset = unbase64(snapshot.assets[resource.file]); pixels += workflows.inspectWorkflowResource(asset, resource.kind).pixels; bytes += asset.length;
    if (pixels > MOBILE_PIXELS || bytes > MAX_ARCHIVE) throw new Error('This project exceeds the mobile memory budget.');
    files['images/' + resource.file] = asset;
  }
  return files;
}
export function encodeProject(snapshot, name = 'Project') {
  const safeName = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '').slice(0, 100) || 'Project';
  return zipSync({ [`${safeName}.comp`]: resources(snapshot) }, { level: 0 });
}
export function decodeProject(bytes) {
  if (bytes.length > MAX_ARCHIVE) throw new Error('The project archive is too large.');
  let expanded = 0, entries = 0;
  const files = unzipSync(bytes, { filter(entry) {
    expanded += entry.originalSize; entries++;
    if (!Number.isFinite(expanded) || expanded > MAX_ARCHIVE || entries > 20010) throw new Error('The project archive is too large.');
    if (entry.name.includes('\\') || entry.name.startsWith('/') || entry.name.split('/').some((part) => part === '..' || part === '.') || /\x00/.test(entry.name)) throw new Error('The project archive is invalid.');
    return /(^|\/)manifest\.json$|\/images\/[0-9a-f-]+(?:(?:\.(?:mask|source)|\.[0-9a-f-]+\.filter-mask)?\.png|\.hdr-source\.tif|\.exr-source\.exr|\.resource\.bin)$/i.test('/' + entry.name);
  } });
  const manifests = Object.keys(files).filter((name) => /(^|\/)manifest\.json$/.test(name));
  if (manifests.length !== 1 || files[manifests[0]].length > MAX_METADATA) throw new Error('The project archive is invalid.');
  const root = manifests[0].slice(0, -'manifest.json'.length);
  const manifest = JSON.parse(strFromU8(files[manifests[0]])); validateManifest(manifest);
  manifest.documentID = manifest.documentID.toUpperCase(); if (manifest.activeLayerID) manifest.activeLayerID = manifest.activeLayerID.toUpperCase();
  const assets = {};
  for (const layer of manifest.layers) {
    layer.id = layer.id.toUpperCase(); if (layer.parentID) layer.parentID = layer.parentID.toUpperCase(); if (layer.maskSourceID) layer.maskSourceID = layer.maskSourceID.toUpperCase();
    for (const [name] of layerResources(layer)) if (name) {
      const asset = files[root + 'images/' + name]; if (!asset) throw new Error('A project image is missing or invalid.'); assets[name] = base64(asset);
    }
  }
  for (const resource of workflows.workflowResources(manifest)) {
    const asset = files[root + 'images/' + resource.file]; if (!asset) throw new Error('Missing workflow resource.'); assets[resource.file] = base64(asset);
  }
  const snapshot = { manifest, assets }; resources(snapshot); return snapshot;
}
