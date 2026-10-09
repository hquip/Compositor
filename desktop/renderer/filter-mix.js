export function filterMaskName(layerID, filterID) { return `${layerID.toUpperCase()}.${filterID.toUpperCase()}.filter-mask.png`; }
export function filterAssetNames(layer) { return (layer.filters ?? []).map((entry) => entry.maskFile).filter(Boolean); }
export function layerAssetNames(layer) { return [layer.imageFile, layer.maskFile, layer.filterSourceFile, layer.hdrSourceFile, layer.exrSourceFile, ...filterAssetNames(layer)].filter(Boolean); }
export function snapshotAssetNames(snapshot) {
  return [...new Set([...snapshot.manifest.layers.flatMap(layerAssetNames), ...(snapshot.manifest.resources ?? []).map((resource) => resource.file)])];
}
export function filterMaskPixels(filters, assets) {
  return filters.reduce((sum, entry) => { if (!entry.maskFile) return sum; const bytes = Uint8Array.from(atob(assets[entry.maskFile].slice(0, 44)), (c) => c.charCodeAt(0)), view = new DataView(bytes.buffer); return sum + view.getUint32(16) * view.getUint32(20); }, 0);
}
export function maskSample(mask, x, y, width, height) {
  if (mask.width === 1 && mask.height === 1) return mask.values[0] / 255;
  const sx = Math.max(0, Math.min(mask.width - 1, (x + .5) * mask.width / width - .5)), sy = Math.max(0, Math.min(mask.height - 1, (y + .5) * mask.height / height - .5));
  const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(mask.width - 1, x0 + 1), y1 = Math.min(mask.height - 1, y0 + 1), fx = sx - x0, fy = sy - y0, v = mask.values;
  return ((v[y0 * mask.width + x0] * (1 - fx) + v[y0 * mask.width + x1] * fx) * (1 - fy) + (v[y1 * mask.width + x0] * (1 - fx) + v[y1 * mask.width + x1] * fx) * fy) / 255;
}
export function mixFilterPixels(before, after, width, height, entry, maximum = 255) {
  const opacity = entry.opacity ?? 1, mask = entry.maskEnabled !== false ? entry.mask : null;
  for (let i = 0; i < after.length; i += 4) {
    const amount = opacity * (mask ? maskSample(mask, i / 4 % width, Math.floor(i / 4 / width), width, height) : 1);
    if (amount >= 1) continue;
    if (amount <= 0) { for (let c = 0; c < 4; c++) after[i + c] = before[i + c]; continue; }
    const a = before[i + 3] / maximum * (1 - amount), b = after[i + 3] / maximum * amount, alpha = a + b;
    for (let c = 0; c < 3; c++) after[i + c] = alpha ? (before[i + c] * a + after[i + c] * b) / alpha : 0;
    after[i + 3] = alpha * maximum;
  } return after;
}
