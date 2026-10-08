import { surface, alphaSurface, morphology } from './raster.js';
import { blurSurface } from './adjustments.js';

function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let b = 0; b < 8; b++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function chunk(name, data) {
  const result = new Uint8Array(data.length + 12), view = new DataView(result.buffer); view.setUint32(0, data.length);
  result.set(new TextEncoder().encode(name), 4); result.set(data, 8); view.setUint32(data.length + 8, crc32(result.subarray(4, data.length + 8))); return result;
}
export function encodeGray(canvas) {
  const { width, height } = canvas, rgba = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const bytes = new Uint8Array((width + 1) * height); let a = 1, b = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) bytes[y * (width + 1) + 1 + x] = rgba[(y * width + x) * 4 + 3];
  for (const value of bytes) { a = (a + value) % 65521; b = (b + a) % 65521; }
  const blocks = Math.ceil(bytes.length / 65535), compressed = new Uint8Array(2 + bytes.length + blocks * 5 + 4); compressed.set([0x78, 0x01]);
  let offset = 2;
  for (let start = 0; start < bytes.length; start += 65535) {
    const count = Math.min(65535, bytes.length - start); compressed[offset++] = start + count === bytes.length ? 1 : 0;
    compressed[offset++] = count & 255; compressed[offset++] = count >>> 8; compressed[offset++] = (~count) & 255; compressed[offset++] = (~count >>> 8) & 255;
    compressed.set(bytes.subarray(start, start + count), offset); offset += count;
  }
  new DataView(compressed.buffer).setUint32(offset, ((b << 16) | a) >>> 0);
  const header = new Uint8Array(13), view = new DataView(header.buffer); view.setUint32(0, width); view.setUint32(4, height); header[8] = 8;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', compressed), chunk('IEND', new Uint8Array())];
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; }
  let binary = ''; for (let i = 0; i < result.length; i += 8192) binary += String.fromCharCode(...result.subarray(i, i + 8192));
  return btoa(binary);
}

export function storeMask(editor, layer, canvas, { vectorCache = false } = {}) {
  if (!vectorCache) delete layer.vectorMask;
  canvas.compositorRevision = (canvas.compositorRevision ?? 0) + 1;
  layer.maskFile = `${layer.id}.mask.png`; layer.maskEnabled ??= true;
  editor.assets[layer.maskFile] = encodeGray(canvas); editor.masks.set(layer.id, canvas);
}
export function maskValues(canvas) { const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; return Uint8ClampedArray.from({ length: canvas.width * canvas.height }, (_, i) => rgba[i * 4 + 3]); }
export function changeMask(editor, operation, amount = 5) {
  const layer = editor.active; if (!layer) return;
  editor.mutate(operation, () => {
    const existing = editor.masks.get(layer.id);
    if (operation === 'Remove Mask') { if (layer.maskFile) delete editor.assets[layer.maskFile]; for (const key of ['maskFile', 'maskEnabled', 'maskPlacement', 'maskLinked', 'vectorMask']) delete layer[key]; editor.masks.delete(layer.id); editor.editMask = false; return; }
    if (operation === 'Add Mask') {
      const canvas = surface(editor.manifest.width, editor.manifest.height), ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff';
      if (editor.selection) ctx.drawImage(selectionCanvas(editor), 0, 0); else ctx.fillRect(0, 0, canvas.width, canvas.height);
      layer.maskPlacement = { origin: [0, 0], size: [canvas.width, canvas.height], rotation: 0, flipX: false, flipY: false, sampling: 'High quality' }; layer.maskLinked = false;
      storeMask(editor, layer, canvas); editor.editMask = true; return;
    }
    if (!existing) return;
    if (operation === 'Toggle Mask') { layer.maskEnabled = layer.maskEnabled === false; return; }
    if (operation === 'Link Mask') { layer.maskLinked = layer.maskLinked === false; return; }
    if ((operation === 'Feather Mask' || operation === 'Blur Mask') && existing.width === 1 && existing.height === 1) return;
    const values = maskValues(existing);
    if (operation === 'Invert Mask') for (let i = 0; i < values.length; i++) values[i] = 255 - values[i];
    if (operation === 'Fill Mask White' || operation === 'Fill Mask Black') values.fill(operation === 'Fill Mask White' ? 255 : 0);
    let canvas = alphaSurface(values, existing.width, existing.height);
    if (operation === 'Feather Mask' || operation === 'Blur Mask') canvas = blurSurface(canvas, amount);
    storeMask(editor, layer, canvas);
  });
}

export function selectionCanvas(editor) {
  const result = surface(editor.manifest.width, editor.manifest.height), context = result.getContext('2d'), selection = editor.selection;
  if (!selection) { context.fillStyle = '#fff'; context.fillRect(0, 0, result.width, result.height); return result; }
  if (selection.coverage) { context.drawImage(selection.coverage, selection.offsetX ?? 0, selection.offsetY ?? 0); return result; }
  context.fillStyle = '#fff'; context.beginPath();
  if (selection.points) { selection.points.forEach((point, i) => i ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.closePath(); }
  else if (selection.kind === 'ellipse') context.ellipse(selection.x + selection.width / 2, selection.y + selection.height / 2, selection.width / 2, selection.height / 2, 0, 0, Math.PI * 2);
  else context.rect(selection.x, selection.y, selection.width, selection.height);
  context.fill(); return result;
}
export function combineSelection(editor, next, mode = 'replace') {
  const canvas = mode === 'replace' || !editor.selection ? surface(editor.manifest.width, editor.manifest.height) : selectionCanvas(editor);
  const context = canvas.getContext('2d'); context.globalCompositeOperation = mode === 'subtract' ? 'destination-out' : mode === 'intersect' ? 'destination-in' : 'source-over'; context.drawImage(next, 0, 0);
  const values = maskValues(canvas); let x0 = canvas.width, y0 = canvas.height, x1 = 0, y1 = 0;
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (values[y * canvas.width + x]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
  editor.selection = { x: x1 ? x0 : 0, y: y1 ? y0 : 0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0), coverage: canvas };
  editor.update(false);
}
export function modifySelection(editor, kind, amount = 5) {
  if (!editor.manifest) return;
  let canvas = selectionCanvas(editor);
  if (kind === 'All') { canvas.getContext('2d').fillStyle = '#fff'; canvas.getContext('2d').fillRect(0, 0, canvas.width, canvas.height); }
  else if (kind === 'Feather') canvas = blurSurface(canvas, amount);
  else {
    let values = maskValues(canvas);
    if (kind === 'Invert') for (let i = 0; i < values.length; i++) values[i] = 255 - values[i];
    else values = morphology(values, canvas.width, canvas.height, amount, kind === 'Expand');
    canvas = alphaSurface(values, canvas.width, canvas.height);
  }
  combineSelection(editor, canvas);
}
