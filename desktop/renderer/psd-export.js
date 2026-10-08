import { writePsd, initializeCanvas } from './vendor/psd.js';
import { surface, place } from './raster.js';
import { compose } from './compose.js';
import { documentPoint, canvasSize } from './core.js';
import { alphaBounds, placedMask, maskOutside, pixelMatrix } from './raster-space.js';
import { textSpans } from './text-style.js';
import { settingsDialog, boolField } from './settings-dialog.js';
import { renderVector } from './vector-render.js';

const rgb = (color) => ({ r: Math.round((color.red ?? 0) * 255), g: Math.round((color.green ?? 0) * 255), b: Math.round((color.blue ?? 0) * 255) });
const channels = ['rgb', 'red', 'green', 'blue'];
export function photoshopAdjustment(value) {
  switch (value.kind) {
    case 'Invert': return { type: 'invert' };
    case 'Exposure': return { type: 'exposure', exposure: value.exposureSettings?.exposure ?? 0, offset: value.exposureSettings?.offset ?? 0, gamma: value.exposureSettings?.gamma ?? 1 };
    case 'Levels': return { type: 'levels', ...Object.fromEntries(channels.map((name, i) => { const r = value.levels?.ranges?.[i] ?? {}; return [name, { shadowInput: r.black ?? 0, highlightInput: r.white ?? 255, shadowOutput: r.outputBlack ?? 0, highlightOutput: r.outputWhite ?? 255, midtoneInput: r.gamma ?? 1 }]; })) };
    case 'Curves': return { type: 'curves', ...Object.fromEntries(channels.map((name, i) => [name, (value.curves?.channels?.[i] ?? [{ x: 0, y: 0 }, { x: 255, y: 255 }]).map((p) => ({ input: p.x, output: p.y }))])) };
    case 'Hue/Saturation': if (value.hsvSettings || value.colorize) return null; return { type: 'hue/saturation', master: { hue: value.hue ?? 0, saturation: value.saturation ?? 0, lightness: value.lightness ?? 0 } };
    case 'Black & White': if (value.blackWhiteSettings?.tint) return null; return { type: 'black & white', ...value.blackWhiteSettings, useTint: false };
    case 'Color Balance': { const s = value.colorBalanceSettings ?? {}; return { type: 'color balance', preserveLuminosity: s.preserveLuminosity ?? true, ...Object.fromEntries(['shadows', 'midtones', 'highlights'].map((name, i) => [name, Object.fromEntries(['cyanRed', 'magentaGreen', 'yellowBlue'].map((c) => [c, s[['shadow', 'mid', 'highlight'][i] + c[0].toUpperCase() + c.slice(1)] ?? 0]))])) }; }
    default: return null;
  }
}
export function photoshopReport(editor) {
  const report = [], unsupported = [];
  for (const layer of editor.manifest.layers) {
    if (layer.hdrSourceFile) unsupported.push(layer.name + ': float32 HDR needs an explicitly flattened SDR Photoshop export.');
    if (layer.adjustment && !photoshopAdjustment(layer.adjustment)) unsupported.push(layer.name + ': ' + layer.adjustment.kind);
    if (layer.filters?.length) report.push(layer.name + ': editable filters are exported as rendered pixels.');
    if (layer.effects && Object.keys(layer.effects).length) report.push(layer.name + ': layer effects and its mask are baked into this layer.');
    if (layer.shape) report.push(layer.name + ': shape geometry is exported as pixels.');
    if (layer.vectorPath) report.push(layer.name + ': path geometry is exported as pixels.');
    if (layer.vectorMask) report.push(layer.name + ': vector mask is exported as a raster mask.');
    if (layer.smartObject) report.push(layer.name + ': embedded raster content is delivered as a Photoshop smart object; editable filter parameters are baked into its content.');
    if (layer.maskSourceID) {
      const siblings = editor.manifest.layers.filter((item) => item.parentID === layer.parentID), index = siblings.indexOf(layer); let base = index - 1;
      while (base >= 0 && siblings[base].maskSourceID) base--;
      if (base < 0 || siblings[base].id !== layer.maskSourceID) unsupported.push(layer.name + ': noncontiguous clipping source');
    }
  } return { report, unsupported };
}
export function buildPhotoshop(editor, { flatten = false, editableText = true } = {}) {
  const { manifest } = editor, diagnostics = photoshopReport(editor);
  if (!flatten && diagnostics.unsupported.length) throw new Error('This project needs a flattened Photoshop export for unsupported adjustments or clipping links.');
  initializeCanvas((w, h) => surface(w, h), (w, h) => new ImageData(w, h));
  const composite = editor.composite(true), imageData = composite.getContext('2d').getImageData(0, 0, manifest.width, manifest.height);
  const document = { width: manifest.width, height: manifest.height, imageData, children: [], linkedFiles: [], imageResources: { resolutionInfo: { horizontalResolution: manifest.resolution ?? 72, verticalResolution: manifest.resolution ?? 72, horizontalResolutionUnit: 'PPI', verticalResolutionUnit: 'PPI', widthUnit: 'Inches', heightUnit: 'Inches' } } };
  if (flatten) { document.children = [{ name: editor.name, imageData }]; return document; }
  let used = manifest.width * manifest.height;
  const allocate = (width, height) => { canvasSize(width, height); used += width * height; if (used > editor.pixelBudget) throw new Error('The Photoshop export exceeds the document pixel budget.'); return surface(width, height); };
  function writeLayer(layer) {
    const result = { name: layer.name, hidden: !layer.isVisible, opacity: layer.opacity ?? 1, blendMode: layer.isGroup ? 'pass through' : layer.blendMode === 'Linear Dodge (Add)' ? 'linear dodge' : (layer.blendMode ?? 'Normal').toLowerCase(), clipping: !!layer.maskSourceID };
    if (layer.isGroup) result.children = siblings(layer.id);
    else if (layer.adjustment) result.adjustment = photoshopAdjustment(layer.adjustment);
    else {
      let source = editor.images.get(layer.id);
      if (source && layer.vectorPath && !layer.effects) { const width = Math.ceil(layer.transform.size[0]), height = Math.ceil(layer.transform.size[1]); canvasSize(width, height); used += width * height; if (width * height > 16000000 || used > editor.pixelBudget) throw new Error('The vector rendering exceeds the export pixel budget.'); source = renderVector(layer.vectorPath, width, height); }
      if (!source) { result.left = 0; result.top = 0; result.imageData = allocate(1, 1).getContext('2d').getImageData(0, 0, 1, 1); return result; }
      let canvas, left, top, width, height;
      if (layer.effects && Object.keys(layer.effects).length) {
        const isolated = structuredClone(layer); delete isolated.parentID; delete isolated.maskSourceID; isolated.opacity = 1; isolated.blendMode = 'Normal'; isolated.isVisible = true;
        const rendered = compose({ ...manifest, layers: [isolated] }, editor.images, editor.masks), bounds = alphaBounds(rendered) ?? { x: 0, y: 0, width: 1, height: 1 };
        ({ x: left, y: top, width, height } = bounds); canvas = allocate(width, height); canvas.getContext('2d').drawImage(rendered, -left, -top);
      } else {
        const points = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }].map((p) => documentPoint(p, layer.transform));
        left = Math.floor(Math.min(...points.map((p) => p.x))); top = Math.floor(Math.min(...points.map((p) => p.y))); width = Math.max(1, Math.ceil(Math.max(...points.map((p) => p.x))) - left); height = Math.max(1, Math.ceil(Math.max(...points.map((p) => p.y))) - top);
        canvas = allocate(width, height); place(canvas.getContext('2d'), source, { ...layer.transform, origin: [layer.transform.origin[0] - left, layer.transform.origin[1] - top] });
      }
      Object.assign(result, { left, top, imageData: canvas.getContext('2d').getImageData(0, 0, width, height) });
      if (layer.smartObject && !layer.hdrSourceFile && !layer.effects) {
        const filtered = layer.filters?.some((filter) => filter.enabled), id = (filtered ? layer.id : layer.smartObject.id).toLowerCase(), encoded = editor.assets[filtered ? layer.imageFile : layer.filterSourceFile];
        if (!document.linkedFiles.some((item) => item.id === id)) document.linkedFiles.push({ id, name: layer.name + '.png', type: 'PNGf', data: Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)) });
        const corners = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }].map((p) => documentPoint(p, layer.transform));
        result.placedLayer = { id, type: 'raster', width: layer.smartObject.width, height: layer.smartObject.height, transform: corners.flatMap((p) => [p.x, p.y]) };
      }
      if (editableText && layer.text && !layer.effects && !layer.filters) {
        const t = layer.text;
        result.text = { text: t.content, transform: pixelMatrix(layer.transform, source.width, source.height), orientation: 'horizontal', shapeType: t.boxSize ? 'box' : 'point', pointBase: [12, 12], boxBounds: t.boxSize ? [12, 12, t.boxSize[0] - 12, t.boxSize[1] - 12] : undefined,
          style: { font: { name: t.fontName }, fontSize: t.fontSize, fillColor: rgb(t), tracking: (t.tracking ?? 0) / t.fontSize * 1000, leading: t.leading || t.fontSize * 1.2, autoLeading: !t.leading },
          styleRuns: textSpans(t).map((part) => ({ length: part.text.length, style: { font: { name: part.fontName }, fillColor: rgb(part) } })), paragraphStyle: { justification: t.alignment.toLowerCase() } };
      }
    }
    const mask = editor.masks.get(layer.id);
    if (mask && !(layer.effects && Object.keys(layer.effects).length)) {
      const left = result.left ?? 0, top = result.top ?? 0, width = result.imageData?.width ?? manifest.width, height = result.imageData?.height ?? manifest.height;
      used += width * height; if (used > editor.pixelBudget) throw new Error('The Photoshop export exceeds the document pixel budget.');
      const canvas = placedMask(mask, layer, { origin: [left, top], size: [width, height], rotation: 0, flipX: false, flipY: false, sampling: 'High quality' }, width, height), data = canvas.getContext('2d').getImageData(0, 0, width, height);
      for (let i = 0; i < data.data.length; i += 4) { data.data[i] = data.data[i + 1] = data.data[i + 2] = data.data[i + 3]; data.data[i + 3] = 255; }
      result.mask = { left, top, imageData: data, defaultColor: Math.round(maskOutside(mask) * 255), disabled: layer.maskEnabled === false, positionRelativeToLayer: false };
    }
    return result;
  }
  function siblings(parentID) { return manifest.layers.filter((layer) => (layer.parentID ?? null) === (parentID ?? null)).reverse().map(writeLayer); }
  document.children = siblings(null); return document;
}
export function binaryBase64(bytes) { let text = ''; for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(text); }
export function installPhotoshopExport(editor, api) {
  const previous = editor.advancedCommand;
  editor.advancedCommand = async (command) => {
    if (!['export-psd', 'export-psb'].includes(command)) return previous(command);
    if (!editor.manifest) return true; editor.projectSnapshot(); const info = photoshopReport(editor);
    const note = document.createElement('p'); note.className = 'export-conversions'; note.textContent = [...info.report, ...info.unsupported].join('\n') || 'Layers, groups, masks, blend modes, and compatible text and adjustments will be preserved.';
    const value = await settingsDialog('Export Photoshop document', [boolField('flatten', 'Flatten image', info.unsupported.length > 0), boolField('editableText', 'Keep text editable', true)], {}, null, { previewElement: note }); if (!value) return true;
    const data = new Uint8Array(writePsd(buildPhotoshop(editor, value), { psb: command === 'export-psb', generateThumbnail: false, invalidateTextLayers: false }));
    const result = await window.desktop.exportFile(binaryBase64(data), command === 'export-psb' ? 'psb' : 'psd', editor.name); if (!result.ok) throw new Error(result.error); return true;
  };
}
