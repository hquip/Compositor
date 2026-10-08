const MAX_HDR_PIXELS = 16000000;
const HDR_SPACES = ['Linear sRGB', 'Linear Rec.2020', 'Linear P3-D65', 'ACEScg', 'ACES2065-1'];
const descriptionFor = (space) => `Compositor ${space === 'Linear sRGB' ? 'linear sRGB' : space} float32\0`;
function need(value, message) { if (!value) throw new Error(message); }
function decodeFloatTIFF(bytes, limit = MAX_HDR_PIXELS, canonical = false) {
  need(bytes instanceof Uint8Array && bytes.length >= 8 && bytes.length <= 512 * 1024 * 1024, 'Invalid HDR TIFF source.');
  const little = bytes[0] === 73 && bytes[1] === 73, big = bytes[0] === 77 && bytes[1] === 77;
  need(little || big, 'Invalid TIFF byte order.'); const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  need(v.getUint16(2, little) === 42, 'HDR import requires a classic TIFF.'); const at = v.getUint32(4, little);
  need(at >= 8 && at + 2 <= bytes.length, 'Invalid HDR TIFF directory.'); const count = v.getUint16(at, little), end = at + 2 + count * 12;
  need(count <= 1000 && end + 4 <= bytes.length && v.getUint32(end, little) === 0, 'HDR import requires a single image.');
  const tags = new Map();
  for (let n = 0; n < count; n++) {
    const p = at + 2 + n * 12, id = v.getUint16(p, little), type = v.getUint16(p + 2, little), length = v.getUint32(p + 4, little), size = ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 11: 4, 12: 8 })[type];
    need(size && length <= 16000000 && !tags.has(id), 'Invalid HDR TIFF tag.'); const start = length * size <= 4 ? p + 8 : v.getUint32(p + 8, little);
    need(start >= 0 && start + length * size <= bytes.length, 'HDR TIFF tag exceeds its file.');
    const values = type === 3 || type === 4 ? Array.from({ length }, (_, i) => type === 3 ? v.getUint16(start + i * 2, little) : v.getUint32(start + i * 4, little)) : null;
    tags.set(id, { type, values, bytes: bytes.subarray(start, start + length * size) });
  }
  const list = (id, fallback) => tags.get(id)?.values ?? fallback, one = (id, fallback) => list(id, [fallback])[0];
  const width = one(256), height = one(257), channels = one(277, 1), photo = one(262), depth = list(258, []), format = list(339, []), rows = one(278, height), offsets = list(273, []), sizes = list(279, []);
  need(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= 30000 && height <= 30000 && width * height <= limit, 'HDR dimensions exceed the supported pixel budget.');
  need(one(259, 1) === 1 && one(284, 1) === 1 && one(274, 1) === 1 && [1, 2].includes(photo), 'HDR TIFF requires uncompressed, interleaved RGB/gray pixels in top-left orientation.');
  need((photo === 2 ? [3, 4] : [1, 2]).includes(channels) && depth.length === channels && depth.every((n) => n === 32) && format.length === channels && format.every((n) => n === 3), 'HDR TIFF requires IEEE float32 samples.');
  need(rows > 0 && offsets.length === Math.ceil(height / rows) && sizes.length === offsets.length, 'Invalid HDR TIFF strips.');
  const hasAlpha = channels === (photo === 2 ? 4 : 2), associated = one(338, 2) === 1;
  if (hasAlpha) need([1, 2].includes(one(338, 2)), 'Invalid HDR alpha type.');
  const description = tags.get(270) ? new TextDecoder().decode(tags.get(270).bytes) : '', linearSpace = HDR_SPACES.find((space) => descriptionFor(space) === description) ?? 'Linear sRGB';
  if (canonical) need(little && photo === 2 && channels === 4 && !associated && offsets.length === 1 && HDR_SPACES.some((space) => descriptionFor(space) === description), 'Invalid embedded linear HDR source.');
  const data = new Float32Array(width * height * 4); let y = 0;
  for (let strip = 0; strip < offsets.length; strip++) {
    const lines = Math.min(rows, height - y), required = width * lines * channels * 4, start = offsets[strip];
    need(start >= end + 4 && sizes[strip] === required && start + required <= bytes.length, 'Truncated HDR TIFF pixels.');
    for (let i = 0; i < width * lines; i++) {
      const to = (y * width + i) * 4, from = start + i * channels * 4, alpha = hasAlpha ? v.getFloat32(from + (channels - 1) * 4, little) : 1;
      need(Number.isFinite(alpha) && alpha >= 0 && alpha <= 1, 'Invalid HDR transparency.'); data[to + 3] = alpha;
      for (let c = 0; c < 3; c++) { let value = v.getFloat32(from + (photo === 2 ? c : 0) * 4, little); need(Number.isFinite(value), 'Non-finite HDR samples are unsupported.'); if (associated) value = alpha ? value / alpha : 0; need(Math.abs(value) <= 1000000, 'HDR intensity exceeds the supported range.'); data[to + c] = value; }
    } y += lines;
  }
  return { width, height, data, bits: 32, linearSpace, embeddedProfile: tags.get(34675)?.bytes };
}
function encodeFloatTIFF(source, resolution = 72) {
  const space = source.linearSpace ?? 'Linear sRGB'; need(HDR_SPACES.includes(space), 'Invalid HDR working space.');
  const { width, height, data } = source; need(data instanceof Float32Array && data.length === width * height * 4 && width > 0 && height > 0 && width <= 30000 && height <= 30000 && width * height <= MAX_HDR_PIXELS && Number.isFinite(resolution) && resolution >= 1 && resolution <= 9600, 'Invalid float32 TIFF pixels.');
  for (let i = 0; i < data.length; i++) need(Number.isFinite(data[i]) && (i % 4 === 3 ? data[i] >= 0 && data[i] <= 1 : Math.abs(data[i]) <= 1000000), 'Invalid HDR sample range.');
  const short = (values) => { const b = new Uint8Array(values.length * 2), v = new DataView(b.buffer); values.forEach((n, i) => v.setUint16(i * 2, n, true)); return b; }, long = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
  const rational = () => { const b = new Uint8Array(8), v = new DataView(b.buffer); v.setUint32(0, Math.round(resolution * 10000), true); v.setUint32(4, 10000, true); return b; };
  const tags = [[256, 4, 1, long(width)], [257, 4, 1, long(height)], [258, 3, 4, short([32, 32, 32, 32])], [259, 3, 1, short([1])], [262, 3, 1, short([2])], [270, 2, 30, new TextEncoder().encode(descriptionFor(space))], [273, 4, 1, long(0)], [277, 3, 1, short([4])], [278, 4, 1, long(height)], [279, 4, 1, long(data.byteLength)], [282, 5, 1, rational()], [283, 5, 1, rational()], [284, 3, 1, short([1])], [296, 3, 1, short([2])], [338, 3, 1, short([2])], [339, 3, 4, short([3, 3, 3, 3])]];
  const count = tags.length; let cursor = 8 + 2 + count * 12 + 4; const records = tags.map(([id, type, length, bytes]) => { length = type === 2 ? bytes.length : length; const record = { id, type, length, bytes }; if (bytes.length > 4) { record.offset = cursor; cursor += bytes.length + bytes.length % 2; } return record; });
  records.find((t) => t.id === 273).bytes = long(cursor); const bytes = new Uint8Array(cursor + data.byteLength), view = new DataView(bytes.buffer); bytes.set([73, 73, 42, 0, 8, 0, 0, 0]); view.setUint16(8, count, true);
  records.forEach((tag, i) => { const p = 10 + i * 12; view.setUint16(p, tag.id, true); view.setUint16(p + 2, tag.type, true); view.setUint32(p + 4, tag.length, true); if (tag.offset != null) { view.setUint32(p + 8, tag.offset, true); bytes.set(tag.bytes, tag.offset); } else bytes.set(tag.bytes, p + 8); });
  for (let i = 0; i < data.length; i++) view.setFloat32(cursor + i * 4, data[i], true); return bytes;
}
module.exports = { MAX_HDR_PIXELS, decodeFloatTIFF, encodeFloatTIFF };
