import { surface, alphaSurface, morphology } from './raster.js';
import { documentPixels } from './core.js';
import { selectionCanvas, maskValues } from './masks.js';
import { inverse } from './affine.js';
import { rasterTarget, rasterBase, pixelMatrix, commitRaster } from './raster-space.js';
import { settingsDialog, numberField, colorField, boolField } from './settings-dialog.js';

export function strokeCoverage(values, width, height, size, position) {
  if (values.length !== width * height || !Number.isInteger(size) || size < 1 || size > 500 || !['Inside', 'Center', 'Outside'].includes(position)) throw new Error('Invalid selection stroke settings.');
  const outside = position === 'Inside' ? 0 : position === 'Outside' ? size : Math.ceil(size / 2);
  const inside = position === 'Outside' ? 0 : position === 'Inside' ? size : Math.floor(size / 2);
  const outer = morphology(values, width, height, outside, true), inner = morphology(values, width, height, inside, false);
  return Uint8ClampedArray.from(outer, (value, i) => Math.max(0, value - inner[i]));
}

export function paintStroke(pixels, coverage, color, opacity, preserveTransparency, mode) {
  if (pixels.length !== coverage.length * 4 || !Number.isFinite(opacity) || opacity < 0 || opacity > 1 || !['Normal', 'Multiply', 'Screen', 'Overlay', 'Darken', 'Lighten'].includes(mode) || !['red', 'green', 'blue'].every((key) => Number.isFinite(color[key]) && color[key] >= 0 && color[key] <= 1)) throw new Error('Invalid selection stroke settings.');
  const front = [color.red, color.green, color.blue]; let changed = false;
  for (let i = 0; i < coverage.length; i++) {
    const offset = i * 4, amount = coverage[i] / 255 * opacity, alpha = pixels[offset + 3] / 255;
    if (!amount || (preserveTransparency && !alpha)) continue;
    const resultAlpha = preserveTransparency ? alpha : amount + alpha * (1 - amount);
    for (let c = 0; c < 3; c++) {
      const back = pixels[offset + c] / 255, f = front[c];
      const blended = mode === 'Multiply' ? back * f : mode === 'Screen' ? back + f - back * f : mode === 'Overlay' ? back <= .5 ? 2 * back * f : 1 - 2 * (1 - back) * (1 - f) : mode === 'Darken' ? Math.min(back, f) : mode === 'Lighten' ? Math.max(back, f) : f;
      const value = preserveTransparency ? back * (1 - amount) + blended * amount : ((1 - amount) * alpha * back + (1 - alpha) * amount * f + amount * alpha * blended) / resultAlpha;
      const next = Math.round(Math.max(0, Math.min(1, value)) * 255); changed ||= next !== pixels[offset + c]; pixels[offset + c] = next;
    }
    const nextAlpha = Math.round(resultAlpha * 255); changed ||= nextAlpha !== pixels[offset + 3]; pixels[offset + 3] = nextAlpha;
  }
  return changed;
}

export function applySelectionStroke(editor, value) {
  const layer = editor.active, selection = editor.selection;
  if (!selection || !layer || layer.isGroup || layer.adjustment || !layer.isVisible || editor.editMask || editor.selectedIDs?.size > 1) throw new Error('Select one visible image layer and a selection to stroke.');
  if (layer.filterSourceFile || layer.hdrSourceFile || layer.smartObject) throw new Error('Rasterize the protected layer before applying a selection stroke.');
  const mask = selectionCanvas(editor), coverage = strokeCoverage(maskValues(mask), mask.width, mask.height, value.width, value.position);
  if (!value.opacity || !coverage.some((alpha) => alpha > 0)) return;
  const region = { x: Math.max(0, selection.x - value.width), y: Math.max(0, selection.y - value.width) };
  region.width = Math.min(editor.manifest.width, selection.x + selection.width + value.width) - region.x;
  region.height = Math.min(editor.manifest.height, selection.y + selection.height + value.width) - region.y;
  const target = rasterTarget(editor, layer, false, value.preserveTransparency ? null : region);
  const growth = target.width * target.height - (target.source?.width ?? 0) * (target.source?.height ?? 0);
  const maskGrowth = editor.masks.has(layer.id) && !layer.maskPlacement ? Math.max(0, target.width * target.height - editor.masks.get(layer.id).width * editor.masks.get(layer.id).height) : 0;
  if (documentPixels(editor) + growth + maskGrowth > editor.pixelBudget) throw new Error('The selection stroke exceeds the document pixel budget.');
  const mapped = surface(target.width, target.height), context = mapped.getContext('2d'); context.setTransform(...inverse(pixelMatrix(target.transform, target.width, target.height))); context.drawImage(alphaSurface(coverage, mask.width, mask.height), 0, 0);
  const image = rasterBase(target), imageContext = image.getContext('2d'), pixels = imageContext.getImageData(0, 0, image.width, image.height);
  if (!paintStroke(pixels.data, maskValues(mapped), value.color, value.opacity / 100, value.preserveTransparency, value.blendMode)) return;
  imageContext.putImageData(pixels, 0, 0); editor.mutate('Stroke Selection', () => commitRaster(editor, target, image));
}

export async function selectionStrokeDialog(editor) {
  if (!editor.selection) throw new Error('Create a selection before applying a stroke.');
  const color = { red: 0, green: 0, blue: 0 };
  const fields = [numberField('width', 'Stroke width', 1, 500, 5), colorField('color', 'Stroke color', color), { key: 'position', label: 'Stroke position', options: ['Inside', 'Center', 'Outside'], default: 'Center' }, numberField('opacity', 'Stroke opacity', 0, 100, 100), { key: 'blendMode', label: 'Stroke blend mode', options: ['Normal', 'Multiply', 'Screen', 'Overlay', 'Darken', 'Lighten'], default: 'Normal' }, boolField('preserveTransparency', 'Preserve transparency', false)];
  await settingsDialog('Stroke selection', fields, {}, null, { apply: (value) => applySelectionStroke(editor, value) });
}
