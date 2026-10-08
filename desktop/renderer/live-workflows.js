import { surface, copySurface } from './raster.js';
import { applyAdjustment, applyCameraRaw } from './adjustments.js';
import { finishingFilter } from './finishing.js';
import { parseCube, applyLookup } from './lut.js';
import { resourceText } from './workflow-assets.js';
import { warpImage } from './transforms.js';

const lookups = new Map();
export function applyLiveWorkflow(image, workflow, assets, scale = 1) {
  if (workflow.type === 'lut') {
    const text = assets[workflow.file]; let cached = lookups.get(text);
    if (!cached) { cached = parseCube(resourceText(assets, workflow.file)); if (lookups.size > 8) lookups.clear(); lookups.set(text, cached); }
    const result = copySurface(image), context = result.getContext('2d'), pixels = context.getImageData(0, 0, result.width, result.height);
    pixels.data.set(applyLookup(pixels.data, cached)); context.putImageData(pixels, 0, 0); return result;
  }
  if (workflow.type === 'live-filter') {
    if (workflow.cameraRaw) return applyCameraRaw(image, workflow.cameraRaw, scale);
    if (workflow.finishing) return finishingFilter(image, workflow.finishing.kind, workflow.finishing.settings);
    if (workflow.transform) {
      const points = workflow.transform.map(([x, y]) => ({ x: x * image.width, y: y * image.height })), warped = warpImage(image, points), result = surface(image.width, image.height);
      result.getContext('2d').drawImage(warped.image, ...warped.origin); return result;
    }
    return applyAdjustment(image, workflow.adjustment, scale);
  }
  throw new Error('Unsupported live workflow layer.');
}
