import { zlibSync, unzlibSync } from './vendor/archive.js';
import { HDR_SPACES, convertHDRColor, exrColorMetadata } from './hdr-color.js';

const MAX_PIXELS = 16000000, MAX_FILE = 256 * 1024 * 1024;
const need = (value, message) => { if (!value) throw new Error(message); };
const text = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
function string(bytes, cursor, maximum = 255) {
  const start = cursor.at; while (cursor.at < bytes.length && bytes[cursor.at]) cursor.at++;
  need(cursor.at < bytes.length && cursor.at - start <= maximum, 'Invalid OpenEXR header string.'); const result = decoder.decode(bytes.subarray(start, cursor.at)); cursor.at++; return result;
}
function dimensions(box, limit) {
  const width = box[2] - box[0] + 1, height = box[3] - box[1] + 1;
  need(width > 0 && height > 0 && width <= 30000 && height <= 30000 && width * height <= limit, 'OpenEXR dimensions exceed the supported pixel budget.'); return { width, height };
}
export function inspectOpenEXR(bytes, limit = MAX_PIXELS) {
  need(bytes instanceof Uint8Array && bytes.length >= 16 && bytes.length <= MAX_FILE, 'Invalid OpenEXR source.'); const v = view(bytes), version = v.getUint32(4, true);
  need(v.getUint32(0, true) === 20000630, 'Invalid OpenEXR signature.');
  need((version & 255) === 2 && !(version & ~0x402), 'OpenEXR requires a single-part scanline image. Tiled, deep and multipart files are unsupported.');
  const cursor = { at: 8 }, attributes = new Map(), maximum = version & 0x400 ? 255 : 31;
  while (bytes[cursor.at]) {
    need(cursor.at < 1024 * 1024 && attributes.size < 256, 'OpenEXR header is too large.');
    const name = string(bytes, cursor, maximum), type = string(bytes, cursor, maximum); need(cursor.at + 4 <= bytes.length && type && !attributes.has(name), 'Invalid OpenEXR attribute.'); const size = v.getInt32(cursor.at, true); cursor.at += 4;
    need(size >= 0 && size <= 1024 * 1024 && cursor.at + size <= Math.min(bytes.length, 1024 * 1024), 'Invalid OpenEXR attribute size.'); attributes.set(name, { type, bytes: bytes.subarray(cursor.at, cursor.at + size) }); cursor.at += size;
  }
  need(cursor.at < bytes.length, 'Truncated OpenEXR header.'); cursor.at++;
  const attribute = (name, type, size) => { const value = attributes.get(name); need(value?.type === type && (size == null || value.bytes.length === size), 'Invalid OpenEXR ' + name + ' attribute.'); return value.bytes; };
  const box = (name) => { const data = view(attribute(name, 'box2i', 16)); return [0, 4, 8, 12].map((i) => data.getInt32(i, true)); };
  const dataWindow = box('dataWindow'), displayWindow = box('displayWindow'), size = dimensions(dataWindow, limit), display = dimensions(displayWindow, limit);
  const compression = attribute('compression', 'compression', 1)[0], lineOrder = attribute('lineOrder', 'lineOrder', 1)[0];
  need([0, 2, 3].includes(compression), 'OpenEXR supports uncompressed, ZIPS and ZIP compression. Convert other compression methods first.'); need(lineOrder <= 1, 'Unsupported OpenEXR scanline order.');
  const aspect = view(attribute('pixelAspectRatio', 'float', 4)).getFloat32(0, true); need(Math.abs(aspect - 1) < 1e-6, 'OpenEXR requires square pixels.');
  attribute('screenWindowCenter', 'v2f', 8); attribute('screenWindowWidth', 'float', 4);
  if (attributes.has('type')) need(decoder.decode(attribute('type', 'string')) === 'scanlineimage', 'Unsupported OpenEXR image type.');
  const channelBytes = attribute('channels', 'chlist'), channelView = view(channelBytes), position = { at: 0 }, channels = [], names = new Set();
  while (channelBytes[position.at]) {
    const name = string(channelBytes, position, maximum); need(channels.length < 64 && !names.has(name) && position.at + 16 <= channelBytes.length, 'Invalid OpenEXR channels.'); names.add(name);
    const at = position.at, type = channelView.getInt32(at, true), x = channelView.getInt32(at + 8, true), y = channelView.getInt32(at + 12, true);
    need([0, 1, 2].includes(type) && x === 1 && y === 1, 'OpenEXR subsampled channels are unsupported.'); channels.push({ name, type, size: type === 1 ? 2 : 4 }); position.at += 16;
  }
  need(channels.length && position.at + 1 === channelBytes.length, 'Invalid OpenEXR channel list.'); channels.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const groups = [...new Set(channels.map((c) => c.name.includes('.') ? c.name.slice(0, c.name.lastIndexOf('.')) : ''))].filter((group) => { const prefix = group ? group + '.' : ''; return ['R', 'G', 'B'].every((c) => names.has(prefix + c)) || names.has(prefix + 'Y') && !names.has(prefix + 'RY') && !names.has(prefix + 'BY'); });
  need(groups.length, 'OpenEXR requires RGB or grayscale Y channels.');
  const bytesPerLine = size.width * channels.reduce((sum, c) => sum + c.size, 0), lines = compression === 3 ? 16 : 1, count = Math.ceil(size.height / lines), table = cursor.at;
  need(bytesPerLine * size.height <= 512 * 1024 * 1024 && bytesPerLine * lines <= 32 * 1024 * 1024 && table + count * 8 <= bytes.length, 'OpenEXR channel data exceeds the supported memory budget.');
  const chromaticities = attributes.has('chromaticities') ? Array.from({ length: 8 }, (_, i) => view(attribute('chromaticities', 'chromaticities', 32)).getFloat32(i * 4, true)) : null;
  const colorInteropID = attributes.has('colorInteropID') ? decoder.decode(attribute('colorInteropID', 'string')) : null;
  return { ...size, displayWidth: display.width, displayHeight: display.height, dataWindow, displayWindow, channels, groups, compression, lineOrder, bytesPerLine, lines, count, table, chromaticities, colorInteropID };
}
export function halfToFloat(value) {
  const sign = value & 0x8000 ? -1 : 1, exponent = value >> 10 & 31, fraction = value & 1023;
  return exponent === 31 ? fraction ? NaN : sign * Infinity : sign * (exponent ? (1 + fraction / 1024) * 2 ** (exponent - 15) : fraction * 2 ** -24);
}
const floatBits = new DataView(new ArrayBuffer(4));
export function floatToHalf(value) {
  need(Number.isFinite(value) && Math.abs(value) <= 65504, 'Half-float EXR exceeds ±65504. Choose 32-bit float export.'); floatBits.setFloat32(0, value, true);
  const bits = floatBits.getUint32(0, true), sign = bits >>> 16 & 0x8000, exponent = (bits >>> 23 & 255) - 127, mantissa = bits & 0x7fffff;
  if (exponent < -25) return sign;
  const shift = exponent < -14 ? -exponent - 1 : 13, significant = exponent < -14 ? mantissa | 0x800000 : mantissa, unit = 2 ** shift, truncated = Math.floor(significant / unit), remainder = significant % unit;
  const rounded = truncated + (remainder > unit / 2 || remainder === unit / 2 && (truncated & 1) ? 1 : 0);
  return sign | (exponent < -14 ? rounded : (exponent + 15) * 1024 + rounded);
}
function adler32(bytes) {
  let a = 1, b = 0; for (let at = 0; at < bytes.length; at += 5552) { const end = Math.min(at + 5552, bytes.length); for (let i = at; i < end; i++) { a += bytes[i]; b += a; } a %= 65521; b %= 65521; } return (b << 16 | a) >>> 0;
}
function inflateZIP(packed, length) {
  need(packed.length >= 6 && !(packed[1] & 32), 'Invalid OpenEXR ZIP block.'); let predicted;
  try { predicted = unzlibSync(packed, { out: new Uint8Array(length + 1) }); } catch { throw new Error('Invalid OpenEXR ZIP block.'); }
  need(predicted.length === length && adler32(predicted) === view(packed).getUint32(packed.length - 4, false), 'Invalid OpenEXR ZIP length or checksum.');
  for (let i = 1; i < length; i++) predicted[i] = predicted[i - 1] + predicted[i] - 128;
  const raw = new Uint8Array(length), middle = Math.ceil(length / 2); for (let i = 0; i < length; i++) raw[i] = predicted[i % 2 ? middle + (i >> 1) : i >> 1]; return raw;
}
function deflateZIP(raw) {
  const predicted = new Uint8Array(raw.length), middle = Math.ceil(raw.length / 2); for (let i = 0; i < raw.length; i++) predicted[i % 2 ? middle + (i >> 1) : i >> 1] = raw[i];
  for (let i = predicted.length - 1; i > 0; i--) predicted[i] = predicted[i] - predicted[i - 1] + 128; const packed = zlibSync(predicted); return packed.length < raw.length ? packed : raw;
}
export function decodeOpenEXR(bytes, options = {}) {
  const header = inspectOpenEXR(bytes, options.limit ?? MAX_PIXELS), v = view(bytes), group = options.group ?? (header.groups.includes('') ? '' : header.groups[0]); need(header.groups.includes(group), 'Unknown OpenEXR channel group.');
  const prefix = group ? group + '.' : '', rgb = ['R', 'G', 'B'].every((c) => header.channels.some((ch) => ch.name === prefix + c)), selected = new Map((rgb ? ['R', 'G', 'B', 'A'] : ['Y', 'A']).map((c, i) => [prefix + c, c === 'A' ? 3 : rgb ? i : -1]));
  for (const channel of header.channels) if (selected.has(channel.name)) need(channel.type !== 0, 'OpenEXR color channels require HALF or FLOAT samples.');
  const data = new Float32Array(header.width * header.height * 4); for (let i = 3; i < data.length; i += 4) data[i] = 1;
  const ranges = []; for (let block = 0; block < header.count; block++) {
    const offset64 = v.getBigUint64(header.table + block * 8, true); need(offset64 <= BigInt(bytes.length - 8), 'Invalid OpenEXR chunk offset.'); const offset = Number(offset64), y = header.dataWindow[1] + block * header.lines, rows = Math.min(header.lines, header.height - block * header.lines), length = header.bytesPerLine * rows;
    need(offset >= header.table + header.count * 8 && v.getInt32(offset, true) === y, 'Invalid OpenEXR chunk coordinates.'); const packedLength = v.getInt32(offset + 4, true);
    need(packedLength > 0 && packedLength <= length && offset + 8 + packedLength <= bytes.length && (header.compression !== 0 || packedLength === length), 'Truncated OpenEXR chunk.'); ranges.push([offset, offset + 8 + packedLength]);
  }
  ranges.sort((a, b) => a[0] - b[0]); need(ranges.every((range, i) => !i || range[0] >= ranges[i - 1][1]), 'Overlapping OpenEXR chunks.');
  for (let block = 0; block < header.count; block++) {
    const offset = Number(v.getBigUint64(header.table + block * 8, true)), packedLength = v.getInt32(offset + 4, true), rows = Math.min(header.lines, header.height - block * header.lines), length = header.bytesPerLine * rows, packed = bytes.subarray(offset + 8, offset + 8 + packedLength), raw = packedLength === length ? packed : inflateZIP(packed, length), pixels = view(raw); let at = 0;
    for (let row = 0; row < rows; row++) for (const channel of header.channels) {
      const component = selected.get(channel.name); if (component != null) for (let x = 0; x < header.width; x++) {
        const value = channel.type === 1 ? halfToFloat(pixels.getUint16(at + x * channel.size, true)) : pixels.getFloat32(at + x * channel.size, true), to = ((block * header.lines + row) * header.width + x) * 4;
        need(Number.isFinite(value) && (component === 3 ? value >= 0 && value <= 1 : Math.abs(value) <= 1000000), 'Invalid OpenEXR sample range.');
        if (component === -1) data.fill(value, to, to + 3); else data[to + component] = value;
      } at += header.width * channel.size;
    }
  }
  const alpha = options.alpha ?? 'Premultiplied'; need(['Premultiplied', 'Straight'].includes(alpha), 'Invalid OpenEXR alpha interpretation.');
  if (alpha === 'Premultiplied') for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) {
    need(data[i + 3] !== 0 || data[i + c] === 0, 'OpenEXR zero-alpha emissive pixels require a premultiplied working pipeline. Convert this source before import.');
    data[i + c] = data[i + 3] ? data[i + c] / data[i + 3] : 0; need(Math.abs(data[i + c]) <= 1000000, 'HDR intensity exceeds the supported range.');
  }
  const encoding = options.encoding ?? 'File color metadata', color = encoding === 'File color metadata' ? exrColorMetadata(header) : encoding;
  need(color, 'OpenEXR color space is unknown. Choose an explicit input color space.');
  return convertHDRColor({ width: header.width, height: header.height, data, bits: 32, dataWindow: header.dataWindow, displayWindow: header.displayWindow }, color);
}
function floats(values, integer = false) { const bytes = new Uint8Array(values.length * 4), v = view(bytes); values.forEach((n, i) => integer ? v.setInt32(i * 4, n, true) : v.setFloat32(i * 4, n, true)); return bytes; }
const join = (parts) => { const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const part of parts) { result.set(part, at); at += part.length; } return result; };
const attr = (name, type, bytes) => join([text.encode(name + '\0' + type + '\0'), floats([bytes.length], true), bytes]);
export function encodeOpenEXR(source, options = {}) {
  const { width, height } = source, bits = options.bits ?? 32, compression = options.compression ?? 'ZIP', space = options.space ?? 'Linear sRGB';
  need(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= 30000 && height <= 30000 && width * height <= MAX_PIXELS && source.data instanceof Float32Array && source.data.length === width * height * 4, 'Invalid OpenEXR pixels.');
  need([16, 32].includes(bits) && ['None', 'ZIPS', 'ZIP'].includes(compression) && HDR_SPACES[space], 'Invalid OpenEXR export options.');
  const converted = convertHDRColor(source, source.linearSpace ?? 'Linear sRGB', space), data = converted.data;
  for (let i = 0; i < data.length; i++) need(Number.isFinite(data[i]) && (i % 4 === 3 ? data[i] >= 0 && data[i] <= 1 : Math.abs(data[i]) <= 1000000), 'Invalid HDR sample range.');
  const channels = join(['A', 'B', 'G', 'R'].map((name) => join([text.encode(name + '\0'), floats([bits === 16 ? 1 : 2], true), new Uint8Array(4), floats([1, 1], true)])).concat([new Uint8Array(1)]));
  const box = floats([0, 0, width - 1, height - 1], true), code = { None: 0, ZIPS: 2, ZIP: 3 }[compression], lines = code === 3 ? 16 : 1, count = Math.ceil(height / lines);
  const header = join([floats([20000630, 2], true), attr('channels', 'chlist', channels), attr('compression', 'compression', new Uint8Array([code])), attr('dataWindow', 'box2i', box), attr('displayWindow', 'box2i', box), attr('lineOrder', 'lineOrder', new Uint8Array([0])), attr('pixelAspectRatio', 'float', floats([1])), attr('screenWindowCenter', 'v2f', floats([0, 0])), attr('screenWindowWidth', 'float', floats([1])), attr('chromaticities', 'chromaticities', floats(HDR_SPACES[space].xy)), attr('colorInteropID', 'string', text.encode(HDR_SPACES[space].id)), new Uint8Array(1)]);
  const table = new Uint8Array(count * 8), offsets = view(table), blocks = []; let offset = header.length + table.length;
  for (let block = 0; block < count; block++) {
    const y = block * lines, rows = Math.min(lines, height - y), raw = new Uint8Array(width * rows * 4 * bits / 8), pixels = view(raw); let at = 0;
    for (let row = 0; row < rows; row++) for (const c of [3, 2, 1, 0]) for (let x = 0; x < width; x++) {
      const i = ((y + row) * width + x) * 4, value = c === 3 ? data[i + 3] : data[i + c] * data[i + 3];
      if (bits === 16) { const half = floatToHalf(value); if (c !== 3 && (half & 0x7fff)) need(floatToHalf(data[i + 3]) !== 0, 'Half-float alpha underflows with nonzero color. Choose 32-bit float export.'); pixels.setUint16(at, half, true); }
      else pixels.setFloat32(at, value, true); at += bits / 8;
    }
    const packed = code ? deflateZIP(raw) : raw, chunk = join([floats([y, packed.length], true), packed]); offsets.setBigUint64(block * 8, BigInt(offset), true); offset += chunk.length; need(offset <= MAX_FILE, 'OpenEXR export exceeds the supported file size.'); blocks.push(chunk);
  }
  return join([header, table, ...blocks]);
}
