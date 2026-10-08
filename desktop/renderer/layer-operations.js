import { createLayer, documentPoint } from './core.js';
import { compose } from './compose.js';
import { surface, copySurface } from './raster.js';
import { storeMask } from './masks.js';
import { following } from './affine.js';
import { alphaBounds } from './raster-space.js';
import { filterMaskName } from './filter-mix.js';

export function descendants(editor, ids) {
  const result = new Set(ids); let changed;
  do { changed = false; for (const layer of editor.manifest.layers) if (result.has(layer.parentID) && !result.has(layer.id)) { result.add(layer.id); changed = true; } } while (changed);
  return result;
}
export function selected(editor) { return editor.active && editor.selectedIDs?.has(editor.active.id) ? editor.selectedIDs : new Set(editor.active ? [editor.active.id] : []); }
export function boundsOf(layers) {
  const points = layers.flatMap((layer) => [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }].map((point) => documentPoint(point, layer.transform)));
  if (!points.length) return { x: 0, y: 0, width: 1, height: 1 };
  const x = Math.min(...points.map((p) => p.x)), y = Math.min(...points.map((p) => p.y));
  return { x, y, width: Math.max(1, Math.max(...points.map((p) => p.x)) - x), height: Math.max(1, Math.max(...points.map((p) => p.y)) - y) };
}
export function selectionTransform(editor) {
  const ids = descendants(editor, selected(editor)), layers = editor.manifest.layers.filter((layer) => ids.has(layer.id) && !layer.isGroup);
  const box = boundsOf(layers); return { origin: [box.x, box.y], size: [box.width, box.height], rotation: editor.active?.transform.rotation ?? 0, flipX: false, flipY: false, sampling: 'High quality' };
}
export function transformSelection(editor, property, index, value) {
  const ids = descendants(editor, selected(editor)), displayed = selectionTransform(editor);
  const before = { ...displayed, rotation: 0 }, after = structuredClone(before);
  if (index == null) after[property] = property === 'rotation' ? value - displayed.rotation : value; else after[property][index] = value;
  if (property === 'size') { const center = [before.origin[0] + before.size[0] / 2, before.origin[1] + before.size[1] / 2]; after.origin = [center[0] - after.size[0] / 2, center[1] - after.size[1] / 2]; }
  for (const layer of editor.manifest.layers) if (ids.has(layer.id)) layer.transform = following(layer.transform, before, after);
}
export function groupLayers(editor) {
  const ids = selected(editor); if (!ids.size) return;
  editor.mutate('Group Layers', () => {
    const layers = editor.manifest.layers.filter((layer) => ids.has(layer.id)), parent = layers.every((layer) => layer.parentID === layers[0].parentID) ? layers[0].parentID : undefined;
    const group = createLayer('Group', editor.manifest.width, editor.manifest.height); group.isGroup = true; group.parentID = parent;
    for (const layer of layers) if (!ids.has(layer.parentID)) layer.parentID = group.id;
    const position = Math.max(...layers.map((layer) => editor.manifest.layers.indexOf(layer)));
    editor.manifest.layers.splice(position + 1, 0, group); editor.manifest.activeLayerID = group.id; editor.selectedIDs = new Set([group.id]);
  });
}
export function ungroupLayers(editor) {
  const group = editor.active; if (!group?.isGroup) return;
  editor.mutate('Ungroup Layers', () => {
    const children = editor.manifest.layers.filter((layer) => layer.parentID === group.id), ids = new Set(children.map((layer) => layer.id));
    for (const layer of children) layer.parentID = group.parentID;
    // Match Mac Ungroup: insert children at the folder's position and discard the folder's own appearance.
    editor.manifest.layers = editor.manifest.layers.flatMap((layer) => layer === group ? children : ids.has(layer.id) ? [] : [layer]);
    for (const layer of editor.manifest.layers) if (layer.maskSourceID) {
      const base = editor.manifest.layers.find((item) => item.id === layer.maskSourceID);
      if (!base || base.parentID !== layer.parentID) delete layer.maskSourceID;
    }
    editor.manifest.activeLayerID = children[0]?.id ?? editor.manifest.layers.at(-1)?.id ?? null; editor.selectedIDs = ids; editor.collapsedGroups?.delete(group.id);
  });
}
export function cloneLayers(editor, ids = selected(editor), source = editor) {
  const all = descendants(source, ids), original = source.manifest.layers.filter((layer) => all.has(layer.id));
  const mapping = new Map(original.map((layer) => [layer.id, crypto.randomUUID().toUpperCase()]));
  const copies = original.map((item) => {
    const layer = structuredClone(item); layer.id = mapping.get(item.id);
    if (mapping.has(layer.parentID)) layer.parentID = mapping.get(layer.parentID); else if (source !== editor) delete layer.parentID;
    if (mapping.has(layer.maskSourceID)) layer.maskSourceID = mapping.get(layer.maskSourceID); else if (source !== editor) delete layer.maskSourceID;
    if (item.imageFile) { layer.imageFile = `${layer.id}.png`; editor.assets[layer.imageFile] = source.assets[item.imageFile]; editor.images.set(layer.id, source.images.get(item.id)); }
    if (item.maskFile) { layer.maskFile = `${layer.id}.mask.png`; editor.assets[layer.maskFile] = source.assets[item.maskFile]; editor.masks.set(layer.id, source.masks.get(item.id)); }
    if (item.filterSourceFile) { layer.filterSourceFile = `${layer.id}.source.png`; editor.assets[layer.filterSourceFile] = source.assets[item.filterSourceFile]; }
    if (item.hdrSourceFile) { layer.hdrSourceFile = `${layer.id}.hdr-source.tif`; editor.assets[layer.hdrSourceFile] = source.assets[item.hdrSourceFile]; }
    if (item.exrSourceFile) editor.assets[item.exrSourceFile] = source.assets[item.exrSourceFile];
    for (const entry of layer.filters ?? []) if (entry.maskFile) { const name = entry.maskFile; entry.maskFile = filterMaskName(layer.id, entry.id); editor.assets[entry.maskFile] = source.assets[name]; }
    return layer;
  });
  const newIDs = new Set(mapping.values()); editor.manifest.layers.push(...copies); editor.manifest.activeLayerID = mapping.get(source.manifest.activeLayerID) ?? copies.at(-1)?.id; editor.selectedIDs = new Set(copies.filter((layer) => !newIDs.has(layer.parentID)).map((layer) => layer.id));
  return copies;
}
export function duplicateLayers(editor) { if (editor.active) editor.mutate('Duplicate Layers', () => cloneLayers(editor)); }
export function mergeLayers(editor, down = false) {
  const active = editor.active; if (!active) return;
  const picked = selected(editor), all = editor.manifest.layers; let ids = descendants(editor, picked), anchor = all.findLast((layer) => picked.has(layer.id)) ?? active, name = anchor.name;
  if ((down || picked.size === 1) && !active.isGroup) {
    const siblings = all.filter((layer) => layer.parentID === active.parentID), below = siblings[siblings.indexOf(active) - 1];
    if (!below || below.isGroup) return; ids = new Set([below.id, active.id]); anchor = active; name = below.name;
  }
  if (!all.some((layer) => ids.has(layer.id) && !layer.isGroup)) return;
  editor.mutate('Merge Layers', () => {
    // Mac merges detach external parent and clipping references before rendering the subset.
    const layers = all.filter((layer) => ids.has(layer.id)).map((item) => { const layer = structuredClone(item); if (!ids.has(layer.parentID)) delete layer.parentID; if (!ids.has(layer.maskSourceID)) delete layer.maskSourceID; return layer; });
    const output = compose({ ...editor.manifest, layers }, editor.images, editor.masks);
    const bounds = alphaBounds(output) ?? { x: 0, y: 0, width: 1, height: 1 }, trimmed = surface(bounds.width, bounds.height); trimmed.getContext('2d').drawImage(output, -bounds.x, -bounds.y);
    const layer = createLayer(name, trimmed.width, trimmed.height); layer.transform.origin = [bounds.x, bounds.y]; layer.parentID = anchor.parentID;
    while (ids.has(layer.parentID)) layer.parentID = all.find((item) => item.id === layer.parentID)?.parentID;
    const position = all.indexOf(anchor), insertion = all.slice(0, position).filter((item) => !ids.has(item.id)).length;
    editor.storePixels(layer, trimmed); editor.manifest.layers = all.filter((item) => !ids.has(item.id)); editor.manifest.layers.splice(insertion, 0, layer);
    for (const item of editor.manifest.layers) if (ids.has(item.maskSourceID)) item.maskSourceID = layer.id;
    editor.manifest.activeLayerID = layer.id; editor.selectedIDs = new Set([layer.id]);
  });
}
export function resizeDocument(editor, width, height, resample, anchor = 'Center') {
  editor.mutate(resample ? 'Image Size' : 'Canvas Size', () => {
    const old = editor.manifest, sx = width / old.width, sy = height / old.height;
    const dx = anchor.includes('Left') ? 0 : anchor.includes('Right') ? width - old.width : (width - old.width) / 2;
    const dy = anchor.includes('Top') ? 0 : anchor.includes('Bottom') ? height - old.height : (height - old.height) / 2;
    const transform = (t) => { t.origin = resample ? [t.origin[0] * sx, t.origin[1] * sy] : [t.origin[0] + dx, t.origin[1] + dy]; if (resample) t.size = [Math.max(1, t.size[0] * sx), Math.max(1, t.size[1] * sy)]; };
    for (const layer of old.layers) {
      transform(layer.transform); if (layer.smartObject) transform(layer.smartObject.baseTransform); if (layer.maskPlacement) transform(layer.maskPlacement);
      if (resample && !layer.filterSourceFile && !layer.hdrSourceFile && editor.images.has(layer.id)) { const image = editor.images.get(layer.id), canvas = surface(Math.max(1, Math.round(image.width * sx)), Math.max(1, Math.round(image.height * sy))); canvas.getContext('2d').imageSmoothingQuality = 'high'; canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height); editor.storePixels(layer, canvas, { vectorCache: !!layer.vectorPath }); }
      if (resample && editor.masks.has(layer.id)) { const image = editor.masks.get(layer.id), canvas = surface(Math.max(1, Math.round(image.width * sx)), Math.max(1, Math.round(image.height * sy))); canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height); storeMask(editor, layer, canvas, { vectorCache: !!layer.vectorMask }); }
    }
    for (const guide of old.guides ?? []) guide.position = resample ? guide.position * (guide.axis === 'vertical' ? sx : sy) : guide.position + (guide.axis === 'vertical' ? dx : dy);
    old.width = width; old.height = height; editor.selection = null;
  }); editor.fit();
}
export function trimDocument(editor) {
  const image = editor.composite(true), pixels = image.getContext('2d').getImageData(0, 0, image.width, image.height).data;
  let x0 = image.width, y0 = image.height, x1 = 0, y1 = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (pixels[(y * image.width + x) * 4 + 3]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
  if (x1 > x0 && y1 > y0) { editor.selection = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }; editor.crop(); }
}
export function flipCanvas(editor, horizontal) {
  editor.mutate('Flip Canvas', () => {
    const dimension = horizontal ? editor.manifest.width : editor.manifest.height, index = horizontal ? 0 : 1;
    const flip = (t) => { t.origin[index] = dimension - t.origin[index] - t.size[index]; t.rotation = -t.rotation; t[horizontal ? 'flipX' : 'flipY'] = !t[horizontal ? 'flipX' : 'flipY']; };
    for (const layer of editor.manifest.layers) { flip(layer.transform); if (layer.maskPlacement) flip(layer.maskPlacement); }
    for (const guide of editor.manifest.guides ?? []) if (guide.axis === (horizontal ? 'vertical' : 'horizontal')) guide.position = dimension - guide.position;
  });
}
