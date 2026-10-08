const EXR_LIMIT = 256 * 1024 * 1024;
const requireEXR = (value, message) => { if (!value) throw new Error(message); };
function inspectEXRContainer(bytes, limit = 16000000) {
  requireEXR(bytes instanceof Uint8Array && bytes.length >= 16 && bytes.length <= EXR_LIMIT, 'Invalid OpenEXR source.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), flags = view.getUint32(4, true), multipart = !!(flags & 0x1000), maximum = flags & 0x400 ? 255 : 31;
  requireEXR(view.getUint32(0, true) === 20000630 && (flags & 255) === 2 && !(flags & ~0x1e02), 'Invalid OpenEXR signature or version.');
  let at = 8; const decoder = new TextDecoder('utf-8', { fatal: true }), parts = [];
  const string = () => { const start = at; while (at < bytes.length && bytes[at]) at++; requireEXR(at < bytes.length && at - start <= maximum, 'Invalid OpenEXR header string.'); return decoder.decode(bytes.subarray(start, at++)); };
  do {
    const attrs = new Map();
    while (bytes[at]) {
      requireEXR(at < 4 * 1024 * 1024 && attrs.size < 256, 'OpenEXR header is too large.'); const name = string(), type = string(); requireEXR(type && !attrs.has(name) && at + 4 <= bytes.length, 'Invalid OpenEXR attribute.'); const length = view.getInt32(at, true); at += 4;
      requireEXR(length >= 0 && length <= 1024 * 1024 && at + length <= Math.min(bytes.length, 4 * 1024 * 1024), 'Invalid OpenEXR attribute size.'); attrs.set(name, { type, bytes: bytes.subarray(at, at + length), at }); at += length;
    }
    requireEXR(at < bytes.length && attrs.size && parts.length < 64, 'Invalid OpenEXR header.'); at++;
    const attr = (name, type, size) => { const value = attrs.get(name); requireEXR(value?.type === type && (size == null || value.bytes.length === size), `Invalid OpenEXR ${name} attribute.`); return value; };
    const box = (name) => { const value = attr(name, 'box2i', 16); return [0, 4, 8, 12].map((i) => view.getInt32(value.at + i, true)); };
    const dataWindow = box('dataWindow'), displayWindow = box('displayWindow'), size = (bounds) => { const width = bounds[2] - bounds[0] + 1, height = bounds[3] - bounds[1] + 1; requireEXR(width > 0 && height > 0 && width <= 30000 && height <= 30000 && width * height <= limit, 'OpenEXR dimensions exceed the supported pixel budget.'); return { width, height }; };
    const dimensions = size(dataWindow), display = size(displayWindow), compression = attr('compression', 'compression', 1).bytes[0]; requireEXR(compression <= 9, 'Unsupported OpenEXR compression.');
    const type = attrs.has('type') ? decoder.decode(attr('type', 'string').bytes) : flags & 0x200 ? 'tiledimage' : 'scanlineimage';
    requireEXR(['scanlineimage', 'tiledimage', 'deepscanline', 'deeptile'].includes(type) && (multipart || !(flags & 0x800) === !type.startsWith('deep')), 'Invalid OpenEXR part type.');
    requireEXR(attr('lineOrder', 'lineOrder', 1).bytes[0] <= 2 && Math.abs(view.getFloat32(attr('pixelAspectRatio', 'float', 4).at, true) - 1) < 1e-6, 'OpenEXR requires square pixels.'); attr('screenWindowCenter', 'v2f', 8); attr('screenWindowWidth', 'float', 4);
    const channels = [], channelBytes = attr('channels', 'chlist').bytes, channelView = new DataView(channelBytes.buffer, channelBytes.byteOffset, channelBytes.byteLength); let position = 0;
    while (channelBytes[position]) { const start = position; while (position < channelBytes.length && channelBytes[position]) position++; requireEXR(position < channelBytes.length && position - start <= maximum && channels.length < 64, 'Invalid OpenEXR channels.'); const name = decoder.decode(channelBytes.subarray(start, position++)); requireEXR(position + 16 <= channelBytes.length && !channels.some((c) => c.name === name), 'Invalid OpenEXR channels.'); const pixelType = channelView.getInt32(position, true), xSampling = channelView.getInt32(position + 8, true), ySampling = channelView.getInt32(position + 12, true); requireEXR([0, 1, 2].includes(pixelType) && xSampling > 0 && ySampling > 0, 'Invalid OpenEXR channels.'); channels.push({ name, type: pixelType, size: pixelType === 1 ? 2 : 4, xSampling, ySampling }); position += 16; }
    requireEXR(channels.length && position + 1 === channelBytes.length, 'Invalid OpenEXR channel list.');
    const names = new Set(channels.map((c) => c.name)), groups = [...new Set(channels.map((c) => c.name.includes('.') ? c.name.slice(0, c.name.lastIndexOf('.')) : ''))].filter((group) => { const prefix = group ? group + '.' : ''; return ['R', 'G', 'B'].every((name) => names.has(prefix + name)) || names.has(prefix + 'Y') && !names.has(prefix + 'RY') && !names.has(prefix + 'BY'); });
    let tiles = null; if (type.includes('tile')) { const tile = attr('tiles', 'tiledesc', 9), width = view.getUint32(tile.at, true), height = view.getUint32(tile.at + 4, true), mode = tile.bytes[8] & 15, rounding = tile.bytes[8] >> 4; requireEXR(width > 0 && height > 0 && width <= 1024 && height <= 1024 && mode <= 2 && rounding <= 1, 'OpenEXR tile dimensions exceed the supported limits.'); tiles = { width, height, mode, rounding }; }
    if (multipart || type.startsWith('deep')) { const count = view.getInt32(attr('chunkCount', 'int', 4).at, true); requireEXR(count > 0 && count <= 1000000, 'Invalid OpenEXR chunk count.'); }
    const chromaticities = attrs.has('chromaticities') ? Array.from({ length: 8 }, (_, i) => view.getFloat32(attr('chromaticities', 'chromaticities', 32).at + i * 4, true)) : null, colorInteropID = attrs.has('colorInteropID') ? decoder.decode(attr('colorInteropID', 'string').bytes) : null;
    parts.push({ ...dimensions, displayWidth: display.width, displayHeight: display.height, dataWindow, displayWindow, channels, groups, compression, tiles, type, deep: type.startsWith('deep'), name: attrs.has('name') ? decoder.decode(attr('name', 'string').bytes) : '', chromaticities, colorInteropID });
  } while (multipart && bytes[at]);
  if (multipart) { requireEXR(at < bytes.length && bytes[at] === 0, 'Truncated OpenEXR multipart header.'); at++; }
  requireEXR(at + 8 <= bytes.length, 'Truncated OpenEXR chunk table.');
  return { ...parts[0], parts, multipart, flags, headerSize: at };
}
module.exports = { inspectEXRContainer, EXR_LIMIT };
