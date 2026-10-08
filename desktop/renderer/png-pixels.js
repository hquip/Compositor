const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => { let value = i; for (let j = 0; j < 8; j++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1; return value >>> 0; });
function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ value >>> 8; return (value ^ 0xffffffff) >>> 0; }
function concatenate(parts) { const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; } return bytes; }
async function codec(bytes, compress, maximum) {
  const stream = new Blob([bytes]).stream().pipeThrough(compress ? new CompressionStream('deflate') : new DecompressionStream('deflate')), reader = stream.getReader(), parts = []; let length = 0;
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > maximum) { await reader.cancel(); throw new Error('The PNG expands beyond its declared dimensions.'); } parts.push(value); } }
  finally { reader.releaseLock(); } return concatenate(parts);
}
function chunk(name, data) { const bytes = new Uint8Array(data.length + 12), view = new DataView(bytes.buffer); view.setUint32(0, data.length); bytes.set(new TextEncoder().encode(name), 4); bytes.set(data, 8); view.setUint32(data.length + 8, crc32(bytes.subarray(4, data.length + 8))); return bytes; }
const paeth = (a, b, c) => { const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c); return da <= db && da <= dc ? a : db <= dc ? b : c; };

export async function encodePNGGray(width, height, values) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 30000 || height > 30000 || width * height > 200000000 || values.length !== width * height) throw new Error('Invalid mask dimensions.');
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) raw.set(values.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  const header = new Uint8Array(13), view = new DataView(header.buffer); view.setUint32(0, width); view.setUint32(4, height); header[8] = 8;
  return concatenate([signature, chunk('IHDR', header), chunk('IDAT', await codec(raw, true, raw.length + 65536)), chunk('IEND', new Uint8Array())]);
}

export async function decodePNG(bytes, pixelLimit = 48000000) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 33 || !signature.every((value, i) => bytes[i] === value)) throw new Error('Invalid PNG source.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let width, height, bits, channels, type, profile, compressedProfile, ended = false; const data = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset), name = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)); if (length > bytes.length - offset - 12) throw new Error('Truncated PNG source.');
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== view.getUint32(offset + 8 + length)) throw new Error('Damaged PNG source.');
    if (name === 'IHDR') {
      if (offset !== 8 || length !== 13) throw new Error('Invalid PNG header.');
      width = view.getUint32(offset + 8); height = view.getUint32(offset + 12); bits = body[8]; type = body[9]; channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
      if (!width || !height || width > 30000 || height > 30000 || width * height > pixelLimit || ![8, 16].includes(bits) || !channels || body[10] || body[11] || body[12]) throw new Error('High-precision PNG import requires a non-interlaced 8-bit or 16-bit RGB or grayscale image.');
    } else if (name === 'IDAT') data.push(body);
    else if (name === 'iCCP') { const zero = body.indexOf(0); if (zero < 1 || zero > 79 || body[zero + 1] !== 0) throw new Error('Invalid PNG color profile.'); compressedProfile = body.subarray(zero + 2); }
    else if (name === 'IEND') { ended = true; break; }
    offset += length + 12;
  }
  if (!ended || !data.length || !channels) throw new Error('Incomplete PNG source.');
  const bpp = channels * bits / 8, stride = width * bpp, expected = (stride + 1) * height;
  if (expected + width * height * 8 > 512 * 1024 * 1024) throw new Error('The high-precision source exceeds the memory budget.');
  const rows = await codec(concatenate(data), false, expected); if (rows.length !== expected) throw new Error('Invalid PNG scanline length.');
  const rgba = new Uint16Array(width * height * 4), line = new Uint8Array(stride), previous = new Uint8Array(stride); let position = 0;
  for (let y = 0; y < height; y++) {
    const filter = rows[position++]; if (filter > 4) throw new Error('Invalid PNG scanline filter.');
    for (let x = 0; x < stride; x++) { const a = x >= bpp ? line[x - bpp] : 0, b = previous[x], c = x >= bpp ? previous[x - bpp] : 0; line[x] = rows[position++] + (filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : filter === 4 ? paeth(a, b, c) : 0); }
    const sample = (offset) => bits === 16 ? line[offset] * 256 + line[offset + 1] : line[offset] * 257;
    for (let x = 0; x < width; x++) { const from = x * bpp, to = (y * width + x) * 4; rgba[to] = sample(from); rgba[to + 1] = channels < 3 ? rgba[to] : sample(from + bits / 8); rgba[to + 2] = channels < 3 ? rgba[to] : sample(from + bits / 4); rgba[to + 3] = type === 4 || type === 6 ? sample(from + (channels - 1) * bits / 8) : 65535; }
    previous.set(line);
  }
  if (compressedProfile) profile = await codec(compressedProfile, false, 16 * 1024 * 1024);
  return { width, height, bits, data: rgba, profile };
}

export async function encodePNG16({ width, height, data, profile }) {
  if (!(data instanceof Uint16Array) || data.length !== width * height * 4 || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 48000000) throw new Error('Invalid high-precision pixels.');
  const gray = profile && String.fromCharCode(...profile.subarray(16, 20)) === 'GRAY', channels = gray ? 2 : 4;
  const header = new Uint8Array(13), view = new DataView(header.buffer); view.setUint32(0, width); view.setUint32(4, height); header[8] = 16; header[9] = gray ? 4 : 6;
  const stride = width * channels * 2 + 1, rows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const from = (y * width + x) * 4; if (gray && (data[from] !== data[from + 1] || data[from] !== data[from + 2])) throw new Error('A grayscale profile requires grayscale source pixels.');
    for (let c = 0; c < channels; c++) { const value = data[from + (gray && c === 1 ? 3 : c)], at = y * stride + 1 + (x * channels + c) * 2; rows[at] = value >>> 8; rows[at + 1] = value & 255; }
  }
  const parts = [signature, chunk('IHDR', header)];
  if (profile) { if (profile.length > 16 * 1024 * 1024) throw new Error('Invalid or oversized ICC profile.'); parts.push(chunk('iCCP', concatenate([new Uint8Array([73, 67, 67, 0, 0]), await codec(profile, true, 20 * 1024 * 1024)]))); }
  parts.push(chunk('IDAT', await codec(rows, true, 512 * 1024 * 1024)), chunk('IEND', new Uint8Array())); return concatenate(parts);
}
