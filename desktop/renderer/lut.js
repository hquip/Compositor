export function parseCube(text) {
  if (typeof text !== 'string' || text.length > 32 * 1024 * 1024) throw new Error('The LUT exceeds the supported size.');
  let size = 0, dimension = 0, domainMin = [0, 0, 0], domainMax = [1, 1, 1], title = 'LUT'; const rows = [];
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim(); if (!line) continue;
    const titleMatch = line.match(/^TITLE\s+"(.*)"$/i); if (titleMatch) { title = titleMatch[1].slice(0, 200); continue; }
    const words = line.split(/\s+/), name = words[0].toUpperCase();
    if (name === 'LUT_3D_SIZE' || name === 'LUT_1D_SIZE') { if (size) throw new Error('Combined LUT tables are not supported.'); size = Number(words[1]); dimension = name === 'LUT_3D_SIZE' ? 3 : 1; if (words.length !== 2 || !Number.isInteger(size) || size < 2 || size > (dimension === 3 ? 65 : 65536)) throw new Error('Invalid LUT dimensions.'); }
    else if (name === 'DOMAIN_MIN' || name === 'DOMAIN_MAX') { const values = words.slice(1).map(Number); if (values.length !== 3 || !values.every(Number.isFinite)) throw new Error('Invalid LUT domain.'); if (name === 'DOMAIN_MIN') domainMin = values; else domainMax = values; }
    else { const values = words.map(Number); if (values.length !== 3 || !values.every((v) => Number.isFinite(v) && Math.abs(v) <= 1000000)) throw new Error('Invalid LUT sample.'); rows.push(...values); if (rows.length > 65 ** 3 * 3) throw new Error('The LUT exceeds the sample limit.'); }
  }
  if (!size || rows.length !== size ** dimension * 3 || domainMin.some((v, c) => v >= domainMax[c])) throw new Error('The LUT is incomplete or has an invalid domain.');
  return { size, dimension, domainMin, domainMax, title, values: new Float32Array(rows) };
}
export function lookupColor(table, color) {
  const coordinates = color.map((v, c) => Math.max(0, Math.min(1, (v - table.domainMin[c]) / (table.domainMax[c] - table.domainMin[c]))) * (table.size - 1));
  if (table.dimension === 1) return coordinates.map((v, c) => { const lo = Math.floor(v), hi = Math.min(table.size - 1, lo + 1); return table.values[lo * 3 + c] * (1 - v + lo) + table.values[hi * 3 + c] * (v - lo); });
  const result = [0, 0, 0], lo = coordinates.map(Math.floor), fraction = coordinates.map((v, c) => v - lo[c]);
  for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) {
    const at = ((Math.min(table.size - 1, lo[2] + b) * table.size + Math.min(table.size - 1, lo[1] + g)) * table.size + Math.min(table.size - 1, lo[0] + r)) * 3;
    const weight = (r ? fraction[0] : 1 - fraction[0]) * (g ? fraction[1] : 1 - fraction[1]) * (b ? fraction[2] : 1 - fraction[2]);
    for (let c = 0; c < 3; c++) result[c] += table.values[at + c] * weight;
  }
  return result;
}
export function applyLookup(pixels, table) {
  const result = new Uint8ClampedArray(pixels);
  for (let i = 0; i < pixels.length; i += 4) { if (!pixels[i + 3]) continue; const color = lookupColor(table, [pixels[i] / 255, pixels[i + 1] / 255, pixels[i + 2] / 255]); for (let c = 0; c < 3; c++) result[i + c] = color[c] * 255; }
  return result;
}
