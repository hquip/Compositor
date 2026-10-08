import { decodePNG } from './png-pixels.js';
import { profileBytes, convertColors, validateProfile } from './color-engine.js';
import { applyPrecisionFilters } from './precision-filters.js';

export function encodedDepth(encoded) { return encoded ? atob(encoded.slice(0, 44)).charCodeAt(24) : 0; }
export function base64Bytes(encoded) { return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)); }
export async function decodePrecisionFile(bytes, name = '', limit = 16000000) {
  if (bytes[0] === 137 && bytes[1] === 80) return decodePNG(bytes, limit);
  const { UTIF } = await import('./vendor/tiff.js'), buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), images = UTIF.decode(buffer), image = images[0];
  const width = image?.t256?.[0], height = image?.t257?.[0], bits = image?.t258?.[0], channels = image?.t277?.[0] ?? image?.t258?.length, mode = image?.t262?.[0];
  if (!width || !height || width > 30000 || height > 30000 || width * height > limit || ![8, 16].includes(bits) || ![0, 1, 2, 5].includes(mode) || (image.t284?.[0] ?? 1) !== 1 || (image.t339?.[0] ?? 1) !== 1 || image.t258.some((value) => value !== bits)) throw new Error('High-precision TIFF import requires an unsigned, interleaved RGB, CMYK, or grayscale image.');
  const expectedChannels = mode === 5 ? [4] : mode === 2 ? [3, 4] : [1, 2]; if (!expectedChannels.includes(channels)) throw new Error('Unsupported TIFF channel count.');
  UTIF.decodeImage(buffer, image, images); if (image.data.length < width * height * channels * bits / 8) throw new Error('Truncated TIFF source.');
  const data = new Uint16Array(width * height * 4), view = new DataView(image.data.buffer, image.data.byteOffset, image.data.byteLength), read = (i) => bits === 16 ? view.getUint16(i * 2, true) : image.data[i] * 257;
  const hasAlpha = mode !== 5 && channels === (mode === 2 ? 4 : 2), associated = image.t338?.[0] === 1;
  for (let i = 0; i < width * height; i++) { const from = i * channels, to = i * 4, alpha = hasAlpha ? read(from + channels - 1) : 65535; data[to + 3] = alpha;
    for (let c = 0; c < 3; c++) { const value = read(from + (mode === 2 ? c : 0)), color = mode === 0 ? 65535 - value : value; data[to + c] = associated ? alpha ? Math.min(65535, Math.round(color * 65535 / alpha)) : 0 : color; }
  }
  let result = { width, height, data, bits, originalSpace: mode === 5 ? 'CMYK' : mode === 2 ? 'RGB' : 'GRAY', profile: image.t34675 ? new Uint8Array(image.t34675) : undefined };
  if (mode === 5) {
    if (!result.profile || validateProfile(result.profile) !== 'CMYK') throw new Error('CMYK TIFF import requires an embedded CMYK ICC profile.');
    const targetProfile = await profileBytes('ProPhoto RGB'), input = Uint16Array.from({ length: width * height * 4 }, (_, i) => read(i)), converted = await convertColors(input, result.profile, targetProfile);
    for (let i = 0; i < width * height; i++) { result.data.set(converted.samples.subarray(i * 3, i * 3 + 3), i * 4); result.data[i * 4 + 3] = 65535; } result.profile = targetProfile;
  }
  const orientation = image.t274?.[0] ?? 1;
  if (orientation > 1 && orientation <= 8) {
    const outWidth = orientation >= 5 ? height : width, outHeight = orientation >= 5 ? width : height, output = new Uint16Array(data.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const p = { 2: [width - 1 - x, y], 3: [width - 1 - x, height - 1 - y], 4: [x, height - 1 - y], 5: [y, x], 6: [height - 1 - y, x], 7: [height - 1 - y, width - 1 - x], 8: [y, width - 1 - x] }[orientation]; output.set(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4), (p[1] * outWidth + p[0]) * 4); }
    result = { ...result, width: outWidth, height: outHeight, data: output };
  } return result;
}
export function resizePrecision(source, width, height) {
  if (source.width === width && source.height === height) return source;
  const data = new Uint16Array(width * height * 4);
  const rx = source.width / width, ry = source.height / height;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const left = x * rx, top = y * ry, right = (x + 1) * rx, bottom = (y + 1) * ry, color = [0, 0, 0]; let alpha = 0;
    for (let sy = Math.floor(top); sy < Math.min(source.height, Math.ceil(bottom)); sy++) for (let sx = Math.floor(left); sx < Math.min(source.width, Math.ceil(right)); sx++) {
      const weight = (Math.min(sx + 1, right) - Math.max(sx, left)) * (Math.min(sy + 1, bottom) - Math.max(sy, top)), from = (sy * source.width + sx) * 4, a = source.data[from + 3] * weight;
      alpha += a; for (let c = 0; c < 3; c++) color[c] += source.data[from + c] * a;
    }
    const to = (y * width + x) * 4; data[to + 3] = Math.round(alpha / (rx * ry)); for (let c = 0; c < 3; c++) data[to + c] = alpha ? Math.round(color[c] / alpha) : 0;
  }
  return { ...source, data, width, height };
}
export async function convertPrecision(source, targetProfile) {
  const from = source.profile ?? await profileBytes('sRGB'), space = validateProfile(from), channels = space === 'GRAY' ? 1 : 3;
  if (space !== 'RGB' && space !== 'GRAY') throw new Error('The source image requires an RGB or grayscale ICC profile.');
  if (from.length === targetProfile.length && from.every((value, i) => value === targetProfile[i])) return { ...source, profile: targetProfile };
  const input = new Uint16Array(source.width * source.height * channels); for (let i = 0; i < source.data.length / 4; i++) for (let c = 0; c < channels; c++) input[i * channels + c] = source.data[i * 4 + c];
  const result = await convertColors(input, from, targetProfile); if (result.channels !== 3) throw new Error('The working profile must be RGB.');
  const data = new Uint16Array(source.data.length); for (let i = 0; i < source.data.length / 4; i++) { data.set(result.samples.subarray(i * 3, i * 3 + 3), i * 4); data[i * 4 + 3] = source.data[i * 4 + 3]; } return { ...source, data, profile: targetProfile };
}
export async function precisionLayer(source, filters, workingSpace = 'sRGB', scale = 1) {
  const working = await convertPrecision(source, await profileBytes(workingSpace)); return applyPrecisionFilters(working, filters, scale, workingSpace);
}
export async function precisionDisplay(source) {
  const result = await convertPrecision(source, await profileBytes('sRGB')); return { width: result.width, height: result.height, data: Uint8ClampedArray.from(result.data, (value) => Math.round(value / 257)) };
}
