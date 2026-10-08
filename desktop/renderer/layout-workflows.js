import { createLayer, canvasSize, documentPixels } from './core.js';
import { surface, place } from './raster.js';
import { settingsDialog, numberField, colorField } from './settings-dialog.js';
import { homography } from './transforms.js';
import { addResource } from './workflow-assets.js';
import { storeMask } from './masks.js';

export function rectifyPixels(image, points, width, height) {
  canvasSize(width, height); if (width * height > 16000000) throw new Error('Perspective crop supports up to 16 megapixels.');
  if (points.length !== 4 || !points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) throw new Error('Invalid perspective crop corners.');
  const cross = points.map((p, i) => { const b = points[(i + 1) % 4], c = points[(i + 2) % 4]; return (b.x - p.x) * (c.y - b.y) - (b.y - p.y) * (c.x - b.x); });
  if (!cross.every((v) => v > .001) && !cross.every((v) => v < -.001)) throw new Error('Perspective crop requires a convex quadrilateral.');
  const matrix = homography(points), source = image.getContext('2d').getImageData(0, 0, image.width, image.height), result = surface(width, height), ctx = result.getContext('2d'), pixels = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = (x + .5) / width, v = (y + .5) / height, d = matrix[6] * u + matrix[7] * v + 1, sx = (matrix[0] * u + matrix[1] * v + matrix[2]) / d - .5, sy = (matrix[3] * u + matrix[4] * v + matrix[5]) / d - .5;
    if (sx < -.5 || sy < -.5 || sx >= image.width - .5 || sy >= image.height - .5) continue;
    const a = Math.max(0, Math.min(image.width - 1, sx)), b = Math.max(0, Math.min(image.height - 1, sy)), x0 = Math.floor(a), y0 = Math.floor(b), fx = a - x0, fy = b - y0; let alpha = 0; const rgb = [0, 0, 0];
    for (let iy = 0; iy < 2; iy++) for (let ix = 0; ix < 2; ix++) { const at = (Math.min(image.height - 1, y0 + iy) * image.width + Math.min(image.width - 1, x0 + ix)) * 4, weight = (ix ? fx : 1 - fx) * (iy ? fy : 1 - fy), amount = source.data[at + 3] / 255 * weight; alpha += amount; for (let c = 0; c < 3; c++) rgb[c] += source.data[at + c] * amount; }
    const at = (y * width + x) * 4; for (let c = 0; c < 3; c++) pixels.data[at + c] = alpha ? rgb[c] / alpha : 0; pixels.data[at + 3] = alpha * 255;
  }
  ctx.putImageData(pixels, 0, 0); return result;
}
export function collageRects(count, width, height, columns, gap, border) {
  if (!Number.isInteger(count) || count < 1 || count > 100 || !Number.isInteger(columns) || columns < 1 || columns > count || gap < 0 || border < 0) throw new Error('Invalid collage layout.');
  const rows = Math.ceil(count / columns), w = (width - 2 * border - (columns - 1) * gap) / columns, h = (height - 2 * border - (rows - 1) * gap) / rows;
  if (w < 1 || h < 1) throw new Error('Collage spacing leaves no room for images.');
  return Array.from({ length: count }, (_, i) => ({ x: border + i % columns * (w + gap), y: border + Math.floor(i / columns) * (h + gap), width: w, height: h }));
}
export function installLayoutWorkflows(editor, api) {
  const previous = editor.advancedCommand;
  editor.advancedCommand = async (command) => {
    if (command === 'collage') {
      const layers = editor.manifest?.layers.filter((l) => editor.images.has(l.id) && !l.isGroup); if (!layers?.length) throw new Error('Import images before creating a collage.');
      const initial = { width: editor.manifest.width, height: editor.manifest.height, columns: Math.ceil(Math.sqrt(layers.length)), gap: 20, border: 20, fit: 'Contain', background: { red: 1, green: 1, blue: 1 } };
      const fields = [numberField('width', 'Canvas width', 1, 30000, initial.width), numberField('height', 'Canvas height', 1, 30000, initial.height), numberField('columns', 'Columns', 1, layers.length, initial.columns), numberField('gap', 'Spacing', 0, 1000, 20), numberField('border', 'Border', 0, 1000, 20), { key: 'fit', label: 'Image fit', options: ['Contain', 'Cover'], default: 'Contain' }, colorField('background', 'Background', initial.background)];
      await settingsDialog('Collage', fields, initial, null, { apply: (value) => {
        canvasSize(value.width, value.height); const cells = collageRects(layers.length, value.width, value.height, value.columns, value.gap, value.border);
        if (documentPixels(editor) + value.width * value.height > editor.pixelBudget) throw new Error('The collage exceeds the document pixel budget.');
        editor.mutate('Collage', () => {
          editor.manifest.width = value.width; editor.manifest.height = value.height;
          const background = createLayer('Collage background', value.width, value.height), image = surface(value.width, value.height), ctx = image.getContext('2d'); ctx.fillStyle = `rgb(${value.background.red * 255},${value.background.green * 255},${value.background.blue * 255})`; ctx.fillRect(0, 0, value.width, value.height); editor.storePixels(background, image); editor.manifest.layers.unshift(background);
          layers.forEach((layer, i) => {
            const source = editor.images.get(layer.id), cell = cells[i], factor = (value.fit === 'Cover' ? Math.max : Math.min)(cell.width / source.width, cell.height / source.height);
            layer.transform.origin = [cell.x + (cell.width - source.width * factor) / 2, cell.y + (cell.height - source.height * factor) / 2]; layer.transform.size = [source.width * factor, source.height * factor]; layer.transform.rotation = 0;
            if (value.fit === 'Cover') { const group = createLayer('Collage cell ' + (i + 1), Math.ceil(cell.width), Math.ceil(cell.height)); group.isGroup = true; group.parentID = layer.parentID; group.transform.origin = [cell.x, cell.y]; const mask = surface(1, 1); mask.getContext('2d').fillStyle = '#fff'; mask.getContext('2d').fillRect(0, 0, 1, 1); const area = surface(Math.ceil(cell.width), Math.ceil(cell.height)); area.getContext('2d').fillStyle = '#fff'; area.getContext('2d').fillRect(0, 0, area.width, area.height); storeMask(editor, group, area); layer.parentID = group.id; editor.manifest.layers.push(group); }
          });
        }); editor.fit();
      } }); return true;
    }
    if (command === 'perspective-crop') {
      if (!editor.manifest) return true;
      const points = editor.selection?.points?.slice(0, 4) ?? [{ x: 0, y: 0 }, { x: editor.manifest.width, y: 0 }, { x: editor.manifest.width, y: editor.manifest.height }, { x: 0, y: editor.manifest.height }];
      if (points.length !== 4) throw new Error('Select four corners with the Polygonal Lasso.');
      const initial = { corners: points, width: editor.manifest.width, height: editor.manifest.height }, preview = document.createElement('canvas'); preview.className = 'matte-preview';
      const fields = [numberField('width', 'Output width', 1, 30000, initial.width), numberField('height', 'Output height', 1, 30000, initial.height), ...points.flatMap((p, i) => [numberField(`corners.${i}.x`, 'Corner ' + (i + 1) + ' X', 0, editor.manifest.width, p.x), numberField(`corners.${i}.y`, 'Corner ' + (i + 1) + ' Y', 0, editor.manifest.height, p.y)])];
      const input = editor.composite(true);
      await settingsDialog('Perspective crop', fields, initial, (value) => { const image = rectifyPixels(input, value.corners, Math.max(1, Math.round(value.width / Math.max(1, value.width / 500))), Math.max(1, Math.round(value.height / Math.max(1, value.width / 500)))); preview.width = image.width; preview.height = image.height; preview.getContext('2d').drawImage(image, 0, 0); }, { previewElement: preview, initialPreview: true,
        apply: (value) => {
          const image = rectifyPixels(input, value.corners, value.width, value.height);
          editor.mutate('Perspective crop', () => { const layer = createLayer('Perspective crop', image.width, image.height); editor.storePixels(layer, image); editor.manifest.layers = [layer]; editor.manifest.width = image.width; editor.manifest.height = image.height; editor.manifest.activeLayerID = layer.id; editor.selection = null; }); editor.fit();
        },
      }); return true;
    }
    return previous(command);
  };
}
