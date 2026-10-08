export function decodeCroppedChannel(channel, width, height, crop, large = false) {
  const output = new Uint8Array(crop.width * crop.height), data = channel.data;
  if (!data) return output;
  if (channel.compression === 0) {
    if (data.length < width * height) throw new Error('The Photoshop channel is truncated.');
    for (let y = 0; y < crop.height; y++) output.set(data.subarray((crop.y + y) * width + crop.x, (crop.y + y) * width + crop.x + crop.width), y * crop.width);
    return output;
  }
  if (channel.compression !== 1) throw new Error('Oversized ZIP-compressed Photoshop layers must be cropped before importing.');
  const size = large ? 4 : 2, view = new DataView(data.buffer, data.byteOffset, data.byteLength); let offset = height * size;
  if (offset > data.length) throw new Error('The Photoshop RLE table is truncated.');
  for (let y = 0; y < height; y++) {
    const length = large ? view.getUint32(y * size) : view.getUint16(y * size), end = offset + length;
    if (end > data.length) throw new Error('The Photoshop RLE row is truncated.');
    if (y >= crop.y && y < crop.y + crop.height) {
      let x = 0, position = offset;
      while (position < end && x < width) {
        const header = view.getInt8(position++);
        if (header === -128) continue;
        const count = header >= 0 ? header + 1 : 1 - header;
        if (x + count > width || position + (header >= 0 ? count : 1) > end) throw new Error('The Photoshop RLE data is invalid.');
        const from = Math.max(x, crop.x), to = Math.min(x + count, crop.x + crop.width), target = (y - crop.y) * crop.width + from - crop.x;
        if (to > from) { if (header >= 0) output.set(data.subarray(position + from - x, position + to - x), target); else output.fill(data[position], target, target + to - from); }
        position += header >= 0 ? count : 1; x += count;
      }
      if (x !== width) throw new Error('The Photoshop channel row is incomplete.');
    }
    offset = end;
  }
  return output;
}
export function cropBox(left, top, right, bottom, width, height) {
  const x0 = Math.max(0, left), y0 = Math.max(0, top), x1 = Math.min(width, right), y1 = Math.min(height, bottom);
  return { x: Math.max(0, x0 - left), y: Math.max(0, y0 - top), width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0), left: x0, top: y0 };
}
export function croppedLayerData(layer, canvasWidth, canvasHeight, mask = false) {
  const box = mask ? layer.mask : layer, width = Math.max(0, (box.right ?? 0) - (box.left ?? 0)), height = Math.max(0, (box.bottom ?? 0) - (box.top ?? 0));
  const crop = cropBox(box.left ?? 0, box.top ?? 0, box.right ?? 0, box.bottom ?? 0, canvasWidth, canvasHeight);
  if (!crop.width || !crop.height || !layer.rawData) return { crop, imageData: null };
  const result = new Uint8ClampedArray(crop.width * crop.height * 4); for (let i = 3; i < result.length; i += 4) result[i] = 255;
  for (const channel of layer.rawData.channels) {
    if (mask ? channel.id !== -2 : channel.id < -1 || channel.id > 2) continue;
    const pixels = decodeCroppedChannel(channel, width, height, crop, layer.rawData.large);
    if (mask) for (let i = 0; i < pixels.length; i++) result[i * 4] = result[i * 4 + 1] = result[i * 4 + 2] = pixels[i];
    else for (let i = 0; i < pixels.length; i++) result[i * 4 + (channel.id === -1 ? 3 : channel.id)] = pixels[i];
  }
  return { crop, imageData: { width: crop.width, height: crop.height, data: result } };
}
