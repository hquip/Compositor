import UTIF from 'utif';
export function decodeTiff(bytes) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), images = UTIF.decode(buffer), image = images[0];
  const width = image?.t256?.[0], height = image?.t257?.[0];
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 16000000) throw new Error('The TIFF image exceeds the mobile pixel limit.');
  UTIF.decodeImage(buffer, image);
  const rgba = UTIF.toRGBA8(image); if (rgba.length !== width * height * 4) throw new Error('TIFF decoding failed.');
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  const orientation = image.t274?.[0] ?? 1; if (orientation === 1) return canvas.toDataURL('image/png');
  const output = document.createElement('canvas'); output.width = orientation >= 5 ? height : width; output.height = orientation >= 5 ? width : height;
  const context = output.getContext('2d'), transforms = { 2: [-1, 0, 0, 1, width, 0], 3: [-1, 0, 0, -1, width, height], 4: [1, 0, 0, -1, 0, height], 5: [0, 1, 1, 0, 0, 0], 6: [0, 1, -1, 0, height, 0], 7: [0, -1, -1, 0, height, width], 8: [0, -1, 1, 0, 0, width] };
  if (transforms[orientation]) context.setTransform(...transforms[orientation]); context.drawImage(canvas, 0, 0); return output.toDataURL('image/png');
}
