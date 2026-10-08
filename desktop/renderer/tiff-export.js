export function encodeTIFF({ width, height, samples, channels = 3, bits = 16, profile, resolution = 72, cmyk = false, alpha = false }) {
  if (![8, 16].includes(bits) || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || samples.length !== width * height * channels || samples.BYTES_PER_ELEMENT !== bits / 8 || !Number.isFinite(resolution) || resolution < 1 || resolution > 9600 || channels !== (cmyk ? 4 : alpha ? 4 : 3)) throw new Error('Invalid TIFF pixels.');
  const tags = [], short = (values) => { const bytes = new Uint8Array(values.length * 2), view = new DataView(bytes.buffer); values.forEach((value, i) => view.setUint16(i * 2, value, true)); return bytes; };
  const long = (value) => { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value, true); return bytes; };
  const rational = () => { const bytes = new Uint8Array(8), view = new DataView(bytes.buffer); view.setUint32(0, Math.round(resolution * 10000), true); view.setUint32(4, 10000, true); return bytes; };
  const add = (id, type, count, bytes) => tags.push({ id, type, count, bytes });
  add(256, 4, 1, long(width)); add(257, 4, 1, long(height)); add(258, 3, channels, short(Array(channels).fill(bits))); add(259, 3, 1, short([1])); add(262, 3, 1, short([cmyk ? 5 : 2]));
  add(273, 4, 1, long(0)); add(277, 3, 1, short([channels])); add(278, 4, 1, long(height)); add(279, 4, 1, long(samples.byteLength)); add(282, 5, 1, rational()); add(283, 5, 1, rational()); add(284, 3, 1, short([1])); add(296, 3, 1, short([2]));
  if (cmyk) add(332, 3, 1, short([1])); if (alpha) add(338, 3, 1, short([2])); if (profile?.length) add(34675, 7, profile.length, profile);
  tags.sort((a, b) => a.id - b.id);
  let offset = 8 + 2 + tags.length * 12 + 4;
  for (const tag of tags) if (tag.bytes.length > 4) { tag.offset = offset; offset += tag.bytes.length + tag.bytes.length % 2; }
  tags.find((tag) => tag.id === 273).bytes = long(offset);
  if (offset + samples.byteLength > 512 * 1024 * 1024) throw new Error('The TIFF export exceeds the memory budget.');
  const bytes = new Uint8Array(offset + samples.byteLength), view = new DataView(bytes.buffer); bytes.set([73, 73, 42, 0, 8, 0, 0, 0]); view.setUint16(8, tags.length, true);
  tags.forEach((tag, i) => { const at = 10 + i * 12; view.setUint16(at, tag.id, true); view.setUint16(at + 2, tag.type, true); view.setUint32(at + 4, tag.count, true); if (tag.offset != null) { view.setUint32(at + 8, tag.offset, true); bytes.set(tag.bytes, tag.offset); } else bytes.set(tag.bytes, at + 8); });
  if (bits === 16) for (let i = 0; i < samples.length; i++) view.setUint16(offset + i * 2, samples[i], true); else bytes.set(samples, offset);
  return bytes;
}
