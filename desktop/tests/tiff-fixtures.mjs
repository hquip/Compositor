function tiff(tags, image) {
  tags.sort((a, b) => a[0] - b[0]);
  const ifdSize = 2 + tags.length * 12 + 4; let cursor = 8 + ifdSize;
  const extras = [];
  const records = tags.map(([tag, type, count, value]) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.alloc(type === 3 ? 2 : 4);
    if (!Buffer.isBuffer(value)) type === 3 ? bytes.writeUInt16LE(value) : bytes.writeUInt32LE(value);
    let pointer = null;
    if (bytes.length > 4) { pointer = cursor; extras.push([cursor, bytes]); cursor += bytes.length; if (cursor % 2) cursor++; }
    return { tag, type, count, bytes, pointer };
  });
  const strip = cursor, result = Buffer.alloc(strip + image.length); result.write('II'); result.writeUInt16LE(42, 2); result.writeUInt32LE(8, 4); result.writeUInt16LE(records.length, 8);
  records.forEach((record, i) => { const offset = 10 + i * 12; result.writeUInt16LE(record.tag, offset); result.writeUInt16LE(record.type, offset + 2); result.writeUInt32LE(record.count, offset + 4);
    if (record.tag === 273) result.writeUInt32LE(strip, offset + 8); else if (record.pointer != null) result.writeUInt32LE(record.pointer, offset + 8); else record.bytes.copy(result, offset + 8);
  });
  for (const [offset, bytes] of extras) bytes.copy(result, offset); image.copy(result, strip); return result;
}
const shorts = (values) => { const bytes = Buffer.alloc(values.length * 2); values.forEach((v, i) => bytes.writeUInt16LE(v, i * 2)); return bytes; };
const longs = (values) => { const bytes = Buffer.alloc(values.length * 4); values.forEach((v, i) => bytes.writeUInt32LE(v, i * 4)); return bytes; };
const rational = (values) => { const bytes = Buffer.alloc(values.length * 8); values.forEach((v, i) => { bytes.writeInt32LE(v, i * 8); bytes.writeInt32LE(1, i * 8 + 4); }); return bytes; };
export function rgbTiff(width = 16, height = 12) {
  const image = Buffer.alloc(width * height * 3); for (let i = 0; i < image.length; i += 3) image.set([200, 80, 40], i);
  return tiff([[256, 4, 1, width], [257, 4, 1, height], [258, 3, 3, shorts([8, 8, 8])], [259, 3, 1, 1], [262, 3, 1, 2], [273, 4, 1, 0], [277, 3, 1, 3], [278, 4, 1, height], [279, 4, 1, image.length], [284, 3, 1, 1]], image);
}
export function cameraDng(width = 64, height = 64) {
  const image = Buffer.alloc(width * height * 2); for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) image.writeUInt16LE((x % 2 === 0 && y % 2 === 0) ? 40000 : (x % 2 === 1 && y % 2 === 1) ? 16000 : 28000, (y * width + x) * 2);
  const model = Buffer.from('Compositor Test Camera\0');
  return tiff([[254, 4, 1, 0], [256, 4, 1, width], [257, 4, 1, height], [258, 3, 1, 16], [259, 3, 1, 1], [262, 3, 1, 32803], [271, 2, 11, Buffer.from('Compositor\0')], [272, 2, model.length, model], [273, 4, 1, 0], [274, 3, 1, 1], [277, 3, 1, 1], [278, 4, 1, height], [279, 4, 1, image.length], [284, 3, 1, 1],
    [33421, 3, 2, shorts([2, 2])], [33422, 1, 4, Buffer.from([0, 1, 1, 2])], [50706, 1, 4, Buffer.from([1, 4, 0, 0])], [50707, 1, 4, Buffer.from([1, 1, 0, 0])], [50708, 2, model.length, model], [50710, 1, 3, Buffer.from([0, 1, 2])], [50711, 3, 1, 1], [50714, 5, 1, rational([0])], [50717, 3, 1, 65535], [50719, 3, 2, shorts([0, 0])], [50720, 3, 2, shorts([width, height])], [50721, 10, 9, rational([1, 0, 0, 0, 1, 0, 0, 0, 1])], [50728, 5, 3, rational([1, 1, 1])], [50778, 3, 1, 21], [50829, 4, 4, longs([0, 0, height, width])]], image);
}
