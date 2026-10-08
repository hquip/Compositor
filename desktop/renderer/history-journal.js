import { surface } from './raster.js';
import { decodeImage } from './compose.js';
import { layerAssetNames } from './filter-mix.js';

export function packHistory(history, current, limit = 16 * 1024 * 1024) {
  const assets = [], assetIDs = new Map(Object.entries(current.assets).map(([name, value]) => [value, name])), masks = [], maskIDs = new Map(), encodedMasks = new WeakMap();
  let bytes = 0;
  const maskPNG = (canvas) => { if (!encodedMasks.has(canvas)) encodedMasks.set(canvas, canvas.toDataURL('image/png')); return encodedMasks.get(canvas); };
  const pack = (snapshot) => {
    const refs = {}; for (const layer of snapshot.manifest.layers) for (const name of layerAssetNames(layer)) if (name) { const value = snapshot.assets[name]; if (!assetIDs.has(value)) { assetIDs.set(value, assets.length); assets.push(value); } refs[name] = assetIDs.get(value); }
    const selection = snapshot.selection ? { ...snapshot.selection } : null; if (selection?.coverage) { const png = maskPNG(selection.coverage); if (!maskIDs.has(png)) { maskIDs.set(png, masks.length); masks.push(png); } selection.coverage = maskIDs.get(png); }
    return { manifest: structuredClone(snapshot.manifest), assets: refs, selection };
  };
  const collect = (entries) => {
    const result = [];
    for (let i = entries.length - 1; i >= 0 && result.length < 20; i--) {
      const entry = entries[i], needed = new Set(), matte = new Map(); let cost = 0;
      for (const snapshot of [entry.before, entry.after]) {
        cost += JSON.stringify(snapshot.manifest).length * 2;
        for (const layer of snapshot.manifest.layers) for (const name of layerAssetNames(layer)) if (name && !assetIDs.has(snapshot.assets[name])) needed.add(snapshot.assets[name]);
        if (snapshot.selection?.coverage) { const mask = snapshot.selection.coverage, png = maskPNG(mask); if (!maskIDs.has(png)) matte.set(png, mask.width * mask.height * 4); }
      }
      for (const value of needed) cost += value.length * 2; for (const [value, memory] of matte) cost += value.length * 2 + memory;
      if (bytes + cost > limit) break; bytes += cost;
      result.unshift({ name: entry.name, beforeRevision: entry.beforeRevision, afterRevision: entry.afterRevision, before: pack(entry.before), after: pack(entry.after) });
    } return result;
  };
  const past = collect(history.past), future = collect(history.future);
  return { version: 1, revision: history.revision, assets, masks, past, future };
}
export async function unpackHistory(journal, current) {
  if (!journal || journal.version !== 1 || !Array.isArray(journal.past) || !Array.isArray(journal.future) || journal.past.length > 20 || journal.future.length > 20) return null;
  const masks = [];
  for (const png of journal.masks) { const image = await decodeImage(png), canvas = surface(image.naturalWidth, image.naturalHeight); canvas.getContext('2d').drawImage(image, 0, 0); masks.push(canvas); }
  const unpack = (snapshot) => {
    const assets = {}; for (const [name, ref] of Object.entries(snapshot.assets)) { const value = typeof ref === 'number' ? journal.assets[ref] : current.assets[ref]; if (typeof value !== 'string') throw new Error('The recovered history contains a missing image.'); assets[name] = value; }
    const selection = snapshot.selection ? { ...snapshot.selection } : null; if (selection && typeof selection.coverage === 'number') { selection.coverage = masks[selection.coverage]; if (!selection.coverage) throw new Error('The recovered history contains a missing selection.'); }
    return { manifest: snapshot.manifest, assets, selection };
  };
  const entries = (list) => list.map((entry) => ({ ...entry, before: unpack(entry.before), after: unpack(entry.after) }));
  return { past: entries(journal.past), future: entries(journal.future), revision: journal.revision, savedRevision: null };
}
