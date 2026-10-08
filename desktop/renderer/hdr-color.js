export const HDR_SPACES = {
  'Linear sRGB': { id: 'lin_rec709_scene', xy: [.64, .33, .3, .6, .15, .06, .3127, .329] },
  'Linear Rec.2020': { id: 'lin_rec2020_scene', xy: [.708, .292, .17, .797, .131, .046, .3127, .329] },
  'Linear P3-D65': { id: 'lin_p3d65_scene', xy: [.68, .32, .265, .69, .15, .06, .3127, .329] },
  ACEScg: { id: 'lin_ap1_scene', xy: [.713, .293, .165, .83, .128, .044, .32168, .33767] },
  'ACES2065-1': { id: 'lin_ap0_scene', xy: [.7347, .2653, 0, 1, .0001, -.077, .32168, .33767] },
};
const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const multiply = (a, b) => Array.from({ length: 9 }, (_, i) => a[Math.floor(i / 3) * 3] * b[i % 3] + a[Math.floor(i / 3) * 3 + 1] * b[i % 3 + 3] + a[Math.floor(i / 3) * 3 + 2] * b[i % 3 + 6]);
const vector = (a, b) => [0, 1, 2].map((i) => a[i * 3] * b[0] + a[i * 3 + 1] * b[1] + a[i * 3 + 2] * b[2]);
function inverse(a) {
  const [b, c, d, e, f, g, h, i, j] = a, result = [f * j - g * i, d * i - c * j, c * g - d * f, g * h - e * j, b * j - d * h, d * e - b * g, e * i - f * h, c * h - b * i, b * f - c * e], determinant = b * result[0] + c * result[3] + d * result[6];
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10) throw new Error('Invalid HDR color primaries.');
  return result.map((n) => n / determinant);
}
const xyz = (x, y) => [x / y, 1, (1 - x - y) / y];
function primaries(xy) {
  if (!Array.isArray(xy) || xy.length !== 8 || xy.some((n) => !Number.isFinite(n) || Math.abs(n) > 2) || [1, 3, 5, 7].some((i) => Math.abs(xy[i]) < 1e-8) || xy[7] <= 0) throw new Error('Invalid HDR color primaries.');
  const columns = [0, 2, 4].map((i) => xyz(xy[i], xy[i + 1])), matrix = Array.from({ length: 9 }, (_, i) => columns[i % 3][Math.floor(i / 3)]), white = xyz(xy[6], xy[7]), scale = vector(inverse(matrix), white);
  return { matrix: matrix.map((n, i) => n * scale[i % 3]), white };
}
export function hdrLuminance(space = 'Linear sRGB') { return primaries(HDR_SPACES[space]?.xy).matrix.slice(3, 6); }
export function hdrColorMatrix(from, to = 'Linear sRGB') {
  const source = typeof from === 'string' ? HDR_SPACES[from]?.xy : from, target = typeof to === 'string' ? HDR_SPACES[to]?.xy : to;
  const a = primaries(source), b = primaries(target); if (source.every((n, i) => Math.abs(n - target[i]) < 1e-7)) return identity.slice();
  let adaptation = identity;
  if (a.white.some((n, i) => Math.abs(n - b.white[i]) > 1e-7)) {
    const bradford = [.8951, .2664, -.1614, -.7502, 1.7135, .0367, .0389, -.0685, 1.0296], src = vector(bradford, a.white), dst = vector(bradford, b.white);
    adaptation = multiply(inverse(bradford), bradford.map((n, i) => n * dst[Math.floor(i / 3)] / src[Math.floor(i / 3)]));
  }
  const result = multiply(inverse(b.matrix), multiply(adaptation, a.matrix));
  if (result.some((n) => !Number.isFinite(n) || Math.abs(n) > 100)) throw new Error('Invalid HDR color primaries.'); return result;
}
export function convertHDRColor(source, from, to = 'Linear sRGB') {
  const matrix = hdrColorMatrix(from, to); if (matrix.every((n, i) => n === identity[i])) return { ...source, linearSpace: to };
  const data = new Float32Array(source.data.length);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) { const value = matrix[c * 3] * source.data[i] + matrix[c * 3 + 1] * source.data[i + 1] + matrix[c * 3 + 2] * source.data[i + 2]; if (!Number.isFinite(value) || Math.abs(value) > 1000000) throw new Error('HDR intensity exceeds the supported range.'); data[i + c] = value; }
    data[i + 3] = source.data[i + 3];
  }
  return { ...source, data, linearSpace: to };
}
export function exrColorMetadata(header) {
  if (header.chromaticities) hdrColorMatrix(header.chromaticities);
  const match = Object.entries(HDR_SPACES).find(([, value]) => value.id === header.colorInteropID);
  if (header.colorInteropID && header.colorInteropID !== 'unknown' && !match) return null;
  if (match) {
    if (header.chromaticities && header.chromaticities.some((n, i) => Math.abs(n - match[1].xy[i]) > .0001)) throw new Error('OpenEXR color metadata conflicts. Choose an explicit input color space.');
    return match[0];
  }
  if (header.chromaticities) { hdrColorMatrix(header.chromaticities); return header.chromaticities; } return null;
}
