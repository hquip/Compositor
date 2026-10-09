import { canvasSize, documentPoint, localPoint, documentPixels } from './core.js';
import { surface, copySurface } from './raster.js';
import { affine, inverse, multiply } from './affine.js';
import { storeMask, selectionCanvas } from './masks.js';

export function mappedSelection(editor, layer, width, height) {
  const output = surface(width, height), context = output.getContext('2d'); context.setTransform(...inverse(pixelMatrix(layer.transform, width, height))); context.drawImage(selectionCanvas(editor), 0, 0); return output;
}
export function maskedChange(before, after, mask) {
  const result = copySurface(before), context = result.getContext('2d'); context.globalCompositeOperation = 'destination-out'; context.drawImage(mask, 0, 0);
  const replacement = copySurface(after), target = replacement.getContext('2d'); target.globalCompositeOperation = 'destination-in'; target.drawImage(mask, 0, 0); context.globalCompositeOperation = 'lighter'; context.drawImage(replacement, 0, 0); return result;
}
export function maskToPixels(mask) {
  const output = copySurface(mask), context = output.getContext('2d'), pixels = context.getImageData(0, 0, output.width, output.height);
  for (let i = 0; i < pixels.data.length; i += 4) { pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = pixels.data[i + 3]; pixels.data[i + 3] = 255; } context.putImageData(pixels, 0, 0); return output;
}
export function pixelsToMask(image) {
  const output = copySurface(image), context = output.getContext('2d'), pixels = context.getImageData(0, 0, output.width, output.height);
  for (let i = 0; i < pixels.data.length; i += 4) { pixels.data[i + 3] = Math.round((pixels.data[i] * .2126 + pixels.data[i + 1] * .7152 + pixels.data[i + 2] * .0722) * pixels.data[i + 3] / 255); pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255; } context.putImageData(pixels, 0, 0); return output;
}

export function pixelMatrix(transform, width, height) { return multiply(affine(transform), [1 / width, 0, 0, 1 / height, 0, 0]); }
export function resizedGrid(transform, oldWidth, oldHeight, x, y, width, height) {
  const center = documentPoint({ x: (x + width / 2) / oldWidth, y: (y + height / 2) / oldHeight }, transform);
  const size = [transform.size[0] * width / oldWidth, transform.size[1] * height / oldHeight];
  return { ...structuredClone(transform), origin: [center.x - size[0] / 2, center.y - size[1] / 2], size };
}
export function alphaBounds(image, threshold = 0) {
  const { width, height } = image, data = image.getContext('2d').getImageData(0, 0, width, height).data;
  let left = width, top = height, right = 0, bottom = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > threshold) {
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
  }
  return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}
export function maskOutside(mask) {
  const { width, height } = mask, data = mask.getContext('2d').getImageData(0, 0, width, height).data;
  let sum = 0, count = 0;
  for (let x = 0; x < width; x++) { sum += data[x * 4 + 3]; count++; if (height > 1) { sum += data[((height - 1) * width + x) * 4 + 3]; count++; } }
  for (let y = 1; y < height - 1; y++) { sum += data[(y * width) * 4 + 3]; count++; if (width > 1) { sum += data[(y * width + width - 1) * 4 + 3]; count++; } }
  return width === 1 && height === 1 ? data[3] / 255 : sum * 2 >= count * 255 ? 1 : 0;
}
export function placedMask(mask, layer, transform, width, height) {
  const output = surface(width, height), context = output.getContext('2d');
  if ((mask.width === 1 && mask.height === 1) || layer.maskPlacement) { context.fillStyle = `rgba(255,255,255,${maskOutside(mask)})`; context.fillRect(0, 0, width, height); }
  if (mask.width === 1 && mask.height === 1) return output;
  context.setTransform(...multiply([width, 0, 0, height, 0, 0], multiply(inverse(affine(transform)), affine(layer.maskPlacement ?? layer.transform))));
  context.beginPath(); context.rect(0, 0, 1, 1); context.clip(); context.clearRect(0, 0, 1, 1); context.drawImage(mask, 0, 0, 1, 1); return output;
}
export function rasterTarget(editor, layer, isMask = false, region = null) {
  let source = (isMask ? editor.masks : editor.images).get(layer.id) ?? null;
  const original = structuredClone(isMask ? layer.maskPlacement ?? layer.transform : layer.transform);
  let width = source?.width ?? Math.ceil(original.size[0]), height = source?.height ?? Math.ceil(original.size[1]);
  if (isMask && source?.width === 1 && source?.height === 1) {
    width = editor.images.get(layer.id)?.width ?? Math.ceil(original.size[0]); height = editor.images.get(layer.id)?.height ?? Math.ceil(original.size[1]);
    canvasSize(width, height);
    if (documentPixels(editor) - 1 + width * height > editor.pixelBudget) throw new Error('The mask exceeds the document pixel budget.');
    const expanded = surface(width, height), context = expanded.getContext('2d'); context.fillStyle = `rgba(255,255,255,${maskOutside(source)})`; context.fillRect(0, 0, width, height); source = expanded;
  }
  let left = 0, top = 0, right = width, bottom = height;
  if (region) {
    const points = [[region.x, region.y], [region.x + region.width, region.y], [region.x + region.width, region.y + region.height], [region.x, region.y + region.height]].map(([x, y]) => localPoint({ x, y }, original, width, height));
    left = Math.floor(Math.min(0, ...points.map((p) => p.x))); top = Math.floor(Math.min(0, ...points.map((p) => p.y)));
    right = Math.ceil(Math.max(width, ...points.map((p) => p.x))); bottom = Math.ceil(Math.max(height, ...points.map((p) => p.y)));
  }
  canvasSize(right - left, bottom - top);
  return { layerID: layer.id, isMask, source, original, originalWidth: width, originalHeight: height, x: left, y: top,
    width: right - left, height: bottom - top, transform: resizedGrid(original, width, height, left, top, right - left, bottom - top) };
}
export function rasterBase(target, scale = 1) {
  const canvas = surface(Math.max(1, Math.round(target.width * scale)), Math.max(1, Math.round(target.height * scale))), context = canvas.getContext('2d');
  const sx = canvas.width / target.width, sy = canvas.height / target.height;
  if (target.isMask && target.source) { context.fillStyle = `rgba(255,255,255,${maskOutside(target.source)})`; context.fillRect(0, 0, canvas.width, canvas.height); context.clearRect(-target.x * sx, -target.y * sy, target.originalWidth * sx, target.originalHeight * sy); }
  if (target.source) context.drawImage(target.source, -target.x * sx, -target.y * sy, target.originalWidth * sx, target.originalHeight * sy);
  return canvas;
}
export function grownLayerMask(editor, layer, target) {
  const mask = editor.masks.get(layer.id);
  if (!mask || layer.maskPlacement || (target.x === 0 && target.y === 0 && target.width === target.originalWidth && target.height === target.originalHeight)) return null;
  const output = surface(target.width, target.height), context = output.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, output.width, output.height);
  context.clearRect(-target.x, -target.y, target.originalWidth, target.originalHeight);
  context.drawImage(mask, -target.x, -target.y, target.originalWidth, target.originalHeight); return output;
}
export function commitRaster(editor, target, image) {
  const layer = editor.manifest.layers.find((item) => item.id === target.layerID); if (!layer) throw new Error('The edited layer is no longer available.');
  if (target.isMask) { if (layer.isGroup) { layer.transform = structuredClone(target.transform); delete layer.maskPlacement; } else layer.maskPlacement = structuredClone(target.transform); storeMask(editor, layer, image); }
  else {
    const mask = grownLayerMask(editor, layer, target); if (mask) storeMask(editor, layer, mask);
    layer.transform = structuredClone(target.transform); editor.storePixels(layer, image); editor.rasterize(layer);
  }
}
