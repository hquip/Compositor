import { deflateSync } from 'node:zlib';
import { createManifest, createLayer } from '../renderer/core.js';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, bytes) {
  const type = Buffer.from(name), result = Buffer.alloc(bytes.length + 12);
  result.writeUInt32BE(bytes.length); type.copy(result, 4); bytes.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([type, bytes])), result.length - 4);
  return result;
}
export function png(width = 4, height = 4, color = [255, 0, 0, 255], grayscale = false) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = grayscale ? 0 : 6;
  const channels = grayscale ? 1 : 4, rows = Buffer.alloc((1 + width * channels) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    for (let c = 0; c < channels; c++) rows[y * (1 + width * channels) + 1 + x * channels + c] = color[c];
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
export function project() {
  const manifest = createManifest(64, 48), layer = createLayer('Red image', 4, 4);
  layer.transform.origin = [2, 3]; layer.imageFile = `${layer.id}.png`;
  manifest.layers = [layer]; manifest.activeLayerID = layer.id;
  return { manifest, assets: { [layer.imageFile]: png().toString('base64') } };
}
