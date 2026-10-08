export function withResolution(bytes, format, resolution = 72) {
  const dpi = Math.max(1, Math.min(9600, Math.round(Number(resolution) || 72)));
  if (format === 'png') {
    const chunk = new Uint8Array(21), view = new DataView(chunk.buffer); view.setUint32(0, 9); chunk.set([112, 72, 89, 115], 4);
    view.setUint32(8, Math.round(dpi / .0254)); view.setUint32(12, Math.round(dpi / .0254)); chunk[16] = 1;
    let crc = 0xffffffff;
    for (const byte of chunk.subarray(4, 17)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    view.setUint32(17, (crc ^ 0xffffffff) >>> 0);
    const parts = [bytes.subarray(0, 8)], input = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const size = input.getUint32(offset) + 12, name = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (offset + size > bytes.length) throw new Error('Invalid PNG export.');
      if (name !== 'pHYs') parts.push(bytes.subarray(offset, offset + size)); if (name === 'IHDR') parts.push(chunk); offset += size;
    }
    const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0;
    for (const part of parts) { output.set(part, offset); offset += part.length; } return output;
  }
  const output = bytes.slice();
  for (let offset = 2; offset + 4 < output.length && output[offset] === 255;) {
    const marker = output[offset + 1], size = (output[offset + 2] << 8) | output[offset + 3];
    if (marker === 218 || marker === 217 || size < 2 || offset + size + 2 > output.length) break;
    if (marker === 224 && size >= 16 && String.fromCharCode(...output.subarray(offset + 4, offset + 9)) === 'JFIF\0') {
      output[offset + 11] = 1; output[offset + 12] = output[offset + 14] = dpi >> 8; output[offset + 13] = output[offset + 15] = dpi & 255; return output;
    }
    offset += size + 2;
  }
  const header = new Uint8Array([255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 1, 1, dpi >> 8, dpi & 255, dpi >> 8, dpi & 255, 0, 0]);
  const tagged = new Uint8Array(bytes.length + header.length); tagged.set(bytes.subarray(0, 2)); tagged.set(header, 2); tagged.set(bytes.subarray(2), 2 + header.length); return tagged;
}
