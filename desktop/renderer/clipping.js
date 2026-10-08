import { surface, copySurface, place } from './raster.js';
import { placedMask, pixelMatrix } from './raster-space.js';
import { inverse } from './affine.js';
import { layerAssetNames } from './filter-mix.js';

export function clippingCoverage(editor, sourceID, transform, width, height) {
  const layers = new Map(editor.manifest.layers.map((layer) => [layer.id, layer])), cache = new Map(), visiting = new Set();
  const opacity = (layer) => { let value = layer.opacity ?? 1, parent = layer.parentID; const seen = new Set(); while (parent && !seen.has(parent)) { seen.add(parent); const folder = layers.get(parent); if (!folder) break; value *= folder.opacity ?? 1; parent = folder.parentID; } return value; };
  const coverage = (id) => {
    if (cache.has(id)) return cache.get(id);
    if (visiting.has(id) || visiting.size >= 256) throw new Error('Invalid clipping mask chain.');
    visiting.add(id);
    const result = surface(width, height), context = result.getContext('2d'), layer = layers.get(id), image = editor.images.get(id);
    if (layer && image) {
      context.setTransform(...inverse(pixelMatrix(transform, width, height))); context.globalAlpha = opacity(layer); place(context, image, layer.transform); context.resetTransform(); context.globalAlpha = 1;
      const mask = layer.maskEnabled !== false ? editor.masks.get(id) : null;
      if (mask) { context.globalCompositeOperation = 'destination-in'; context.drawImage(placedMask(mask, layer, transform, width, height), 0, 0); }
      if (layer.maskSourceID) { context.globalCompositeOperation = 'destination-in'; context.drawImage(coverage(layer.maskSourceID), 0, 0); }
    }
    visiting.delete(id); cache.set(id, result); return result;
  };
  return coverage(sourceID);
}
export function bakeClipping(editor, layer) {
  const image = editor.images.get(layer.id); if (!image || !layer.maskSourceID) return null;
  const baked = copySurface(image), context = baked.getContext('2d'); context.globalCompositeOperation = 'destination-in';
  context.drawImage(clippingCoverage(editor, layer.maskSourceID, layer.transform, image.width, image.height), 0, 0); return baked;
}
async function deletionChoice() {
  const dialog = document.createElement('dialog'), heading = document.createElement('h2'), description = document.createElement('p'), actions = document.createElement('div'); dialog.className = 'clipping-delete-dialog';
  heading.textContent = 'These layers supply live masks'; description.className = 'dialog-description'; description.textContent = 'Bake keeps the clipping coverage in the dependent pixels. Remove Links reveals those pixels. Either choice can be undone.'; actions.className = 'dialog-actions';
  for (const [label, value] of [['Cancel', 'cancel'], ['Remove Links and Delete', 'unlink'], ['Bake and Delete', 'bake']]) { const button = document.createElement('button'); button.textContent = label; if (value === 'bake') button.className = 'primary'; button.addEventListener('click', () => dialog.close(value)); actions.append(button); }
  dialog.append(heading, description, actions); document.body.append(dialog); dialog.showModal();
  return await new Promise((resolve) => dialog.addEventListener('close', () => { const value = dialog.returnValue; dialog.remove(); resolve(value); }, { once: true }));
}
export async function deleteLayers(editor) {
  if (!editor.active) return;
  editor.gradient?.finish(true);
  const removed = new Set(editor.selectedIDs?.has(editor.active.id) ? editor.selectedIDs : [editor.active.id]);
  if (editor.editMask && removed.size <= 1 && editor.active.maskFile) {
    editor.mutate('Delete Mask', () => { const layer = editor.active; delete editor.assets[layer.maskFile]; editor.masks.delete(layer.id); for (const key of ['maskFile', 'maskEnabled', 'maskLinked', 'maskPlacement', 'vectorMask']) delete layer[key]; editor.editMask = false; }); return;
  }
  let changed;
  do { changed = false; for (const layer of editor.manifest.layers) if (removed.has(layer.parentID) && !removed.has(layer.id)) { removed.add(layer.id); changed = true; } } while (changed);
  const dependents = editor.manifest.layers.filter((layer) => !removed.has(layer.id) && removed.has(layer.maskSourceID)), baked = new Map();
  if (dependents.length) {
    const choice = await deletionChoice(); if (!['bake', 'unlink'].includes(choice)) return;
    if (choice === 'bake') for (const layer of dependents) { const image = bakeClipping(editor, layer); if (image) baked.set(layer.id, image); }
  }
  editor.mutate(removed.size > 1 ? 'Delete Layers' : 'Delete Layer', () => {
    const anchor = editor.manifest.layers.findIndex((layer) => layer.id === editor.manifest.activeLayerID);
    const retained = new Set(editor.manifest.layers.filter((layer) => !removed.has(layer.id)).flatMap(layerAssetNames));
    for (const layer of editor.manifest.layers) if (removed.has(layer.id)) { for (const name of layerAssetNames(layer)) if (!retained.has(name)) delete editor.assets[name]; editor.images.delete(layer.id); editor.masks.delete(layer.id); editor.collapsedGroups?.delete(layer.id); }
    editor.manifest.layers = editor.manifest.layers.filter((layer) => !removed.has(layer.id));
    for (const layer of dependents) { delete layer.maskSourceID; if (baked.has(layer.id)) { editor.storePixels(layer, baked.get(layer.id)); editor.rasterize(layer); } }
    editor.manifest.activeLayerID = editor.manifest.layers[Math.min(anchor, editor.manifest.layers.length - 1)]?.id ?? null;
    editor.selectedIDs = new Set(editor.manifest.activeLayerID ? [editor.manifest.activeLayerID] : []); editor.editMask = false;
  });
}
export function createClipping(editor) {
  const layer = editor.active; if (!layer || layer.isGroup) return;
  const siblings = editor.manifest.layers.filter((item) => item.parentID === layer.parentID), below = siblings[siblings.indexOf(layer) - 1];
  if (!below || below.isGroup) return;
  const id = below.maskSourceID ?? below.id, source = editor.manifest.layers.find((item) => item.id === id);
  if (!source || source.adjustment || source.isGroup || id === layer.id) return;
  const visited = new Set([layer.id]); let next = source;
  while (next) { if (visited.has(next.id)) throw new Error('Invalid clipping mask chain.'); visited.add(next.id); next = editor.manifest.layers.find((item) => item.id === next.maskSourceID); }
  layer.maskSourceID = id;
}
export function releaseClipping(editor) {
  const target = editor.active, source = target?.maskSourceID; if (!source) return;
  const siblings = editor.manifest.layers.filter((layer) => layer.parentID === target.parentID), start = siblings.indexOf(target);
  for (let i = start; i < siblings.length; i++) { const layer = siblings[i]; if (i !== start && layer.maskSourceID !== source) break; delete layer.maskSourceID; }
}
export function adoptClipping(id, layers) {
  const layer = layers.find((item) => item.id === id); if (!layer || layer.isGroup) return;
  const siblings = layers.filter((item) => item.parentID === layer.parentID), index = siblings.indexOf(layer), above = siblings[index + 1], below = siblings[index - 1];
  const source = above?.maskSourceID;
  if (source && source !== id && below && (below.id === source || below.maskSourceID === source)) layer.maskSourceID = source;
}
export function releaseDetachedClipping(layers) {
  const groups = new Map();
  for (const layer of layers) { const siblings = groups.get(layer.parentID ?? null) ?? []; siblings.push(layer); groups.set(layer.parentID ?? null, siblings); }
  for (const siblings of groups.values()) { let base = null; for (const layer of siblings) {
    if (layer.maskSourceID) { if (layer.maskSourceID !== base) { delete layer.maskSourceID; base = layer.id; } }
    else base = layer.isGroup ? null : layer.id;
  } }
}

export function reorderLayer(editor, direction) {
  const active = editor.active; if (!active) return;
  const layers = editor.manifest.layers, siblings = layers.filter((layer) => layer.parentID === active.parentID), next = siblings[siblings.indexOf(active) + direction]; if (!next) return;
  const subtree = (id) => { const ids = new Set([id]); let changed; do { changed = false; for (const layer of layers) if (ids.has(layer.parentID) && !ids.has(layer.id)) { ids.add(layer.id); changed = true; } } while (changed); return ids; };
  editor.mutate('Reorder Layer', () => {
    const movedIDs = subtree(active.id), targetIDs = subtree(next.id), moved = layers.filter((layer) => movedIDs.has(layer.id)), remaining = layers.filter((layer) => !movedIDs.has(layer.id));
    const indices = remaining.map((layer, index) => targetIDs.has(layer.id) ? index : -1).filter((index) => index >= 0), index = direction > 0 ? Math.max(...indices) + 1 : Math.min(...indices);
    remaining.splice(index, 0, ...moved); editor.manifest.layers = remaining; adoptClipping(active.id, remaining); releaseDetachedClipping(remaining);
  });
}
