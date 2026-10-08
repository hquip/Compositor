import { createLayer, documentPixels, canvasSize, FORMAT_VERSION } from './core.js';
import { encodeFloatTIFF } from './vendor/float-tiff.js';
import { hdrCanvas, composeHDRCanvas, assertHDRCompatible } from './hdr-layer.js';
import { pickFile } from './color-workflows.js';
import { binaryBase64 } from './psd-export.js';
import { settingsDialog, numberField as n } from './settings-dialog.js';
import { adjustmentDefaults } from './adjustments.js';
import { filterAssetNames } from './filter-mix.js';
import { HDR_FILTERS, HDR_BLENDS } from './hdr-pixels.js';
import { importEXRFile, exrCommand } from './exr-workflows.js';
import { HDRDisplay } from './hdr-display.js';

export async function importHDRSource(editor, source, name = 'HDR image', placement = null) {
  canvasSize(source.width, source.height); const mobile = document.body.classList.contains('mobile-app');
  if (placement) { canvasSize(placement.width, placement.height); if (![placement.x, placement.y].every((value) => Number.isFinite(value) && Math.abs(value) <= 1000000)) throw new Error('OpenEXR window offset exceeds the supported transform range.'); }
  if (source.width * source.height > (mobile ? 4000000 : 16000000)) throw new Error('HDR sources are limited to 4 MP on phones and 16 MP on desktop.');
  if (editor.manifest) { assertHDRCompatible(editor.manifest); if (editor.manifest.width * editor.manifest.height > 16000000) throw new Error('Use a document up to 16 MP for HDR compositing.'); }
  if (documentPixels(editor) + source.width * source.height * 5 > editor.pixelBudget) throw new Error('The HDR source exceeds the document pixel budget.');
  const bytes = encodeFloatTIFF(source), view = editor.manifest?.hdrView ?? { exposure: 0, toneMap: 'Reinhard' }, image = hdrCanvas(source, view), encoded = image.toDataURL('image/png').split(',')[1];
  if (mobile && Object.values(editor.assets).reduce((sum, value) => sum + value.length * .75, 0) + bytes.length + encoded.length * .75 + 4 * 1024 * 1024 > 128 * 1024 * 1024) throw new Error('This HDR import exceeds the phone archive budget.');
  if (!editor.manifest) editor.newCanvas(placement?.width ?? source.width, placement?.height ?? source.height);
  editor.mutate('Import Float32 HDR', () => {
    editor.manifest.version = FORMAT_VERSION; editor.manifest.hdrWorkingSpace ??= source.linearSpace ?? 'Linear sRGB';
    const layer = createLayer(name, source.width, source.height); layer.transform.origin = placement ? [placement.x, placement.y] : [(editor.manifest.width - source.width) / 2, (editor.manifest.height - source.height) / 2]; editor.storePixels(layer, image);
    layer.hdrSourceFile = `${layer.id}.hdr-source.tif`; editor.assets[layer.hdrSourceFile] = binaryBase64(bytes); layer.filters = [{ id: crypto.randomUUID().toUpperCase(), enabled: false, adjustment: adjustmentDefaults('Exposure') }]; editor.manifest.hdrView ??= view; editor.manifest.layers.push(layer); editor.manifest.activeLayerID = layer.id; editor.selectedIDs = new Set([layer.id]);
  }); editor.update();
}
export const importHDRFile = importEXRFile;
export function installHDR(editor, api) {
  const previous = editor.advancedCommand, display = new HDRDisplay(editor); editor.hdrDisplay = display;
  editor.advancedCommand = async (command) => {
    if (await exrCommand(editor, command)) return true;
    if (command === 'rasterize-filters' && editor.active?.hdrSourceFile) command = 'rasterize-hdr';
    const hdrDocument = editor.manifest?.layers.some((layer) => layer.hdrSourceFile);
    if (command === 'import-hdr' || command === 'import-exr') {
      const file = await pickFile(command === 'import-exr' ? '.exr,image/x-exr' : '.exr,.tif,.tiff,image/tiff'); if (!file) return true;
      if (file.size > 256 * 1024 * 1024) throw new Error('The HDR source file is too large.'); const bytes = new Uint8Array(await file.arrayBuffer());
      await importHDRFile(editor, bytes, file.name.replace(/\.[^.]+$/, ''), /\.exr$/i.test(file.name)); return true;
    }
    if (command === 'hdr-view') {
      if (!hdrDocument) return true; const initial = editor.manifest.hdrView ?? { exposure: 0, toneMap: 'Reinhard' }, before = editor.snapshot();
      const note = document.createElement('p'); note.textContent = display.description();
      const options = await settingsDialog('HDR display preview', [n('exposure', 'Preview exposure (stops)', -20, 20, 0, .1), { key: 'toneMap', label: 'Tone mapping', options: ['Reinhard', 'Clip'], default: 'Reinhard' }, { key: 'displayMode', label: 'Display output', options: ['Auto', 'HDR', 'SDR'], default: 'Auto' }], initial, (value) => { editor.manifest.hdrView = value; editor.update(); }, { previewElement: note });
      if (!options) { editor.manifest.hdrView = before.manifest.hdrView; editor.update(); }
      else { editor.manifest.hdrView = options; for (const layer of editor.manifest.layers) if (layer.hdrSourceFile) { const current = editor.images.get(layer.id), filters = structuredClone(layer.filters), image = hdrCanvas(current.compositorHDR, options, current.compositorHDRSource); editor.storePixels(layer, image, { filterCache: true }); layer.filters = filters; } editor.history.push(before, editor.snapshot(), 'HDR Display Preview'); editor.update(); } return true;
    }
    if (command === 'export-hdr') {
      if (!hdrDocument) throw new Error('Import or add HDR content before exporting float32 TIFF.'); editor.projectSnapshot(); const source = composeHDRCanvas(editor.manifest, editor.images, editor.masks, 1, true), bytes = encodeFloatTIFF(source, editor.manifest.resolution ?? 72);
      const result = await window.desktop.exportFile(binaryBase64(bytes), 'tiff', editor.name + '-HDR32'); if (!result.ok) throw new Error(result.error); return true;
    }
    if (command === 'rasterize-hdr') {
      const layer = editor.active; if (!layer?.hdrSourceFile) return true;
      const options = await settingsDialog('Rasterize HDR display', [{ key: 'choice', label: 'HDR source', options: ['Keep float32 source', 'Rasterize displayed pixels'], default: 'Keep float32 source' }], {}); if (options?.choice !== 'Rasterize displayed pixels') return true;
      editor.mutate('Rasterize HDR Display', () => { for (const file of filterAssetNames(layer)) delete editor.assets[file]; delete editor.assets[layer.hdrSourceFile]; delete layer.hdrSourceFile; if (layer.exrSourceFile && !editor.manifest.layers.some((other) => other.id !== layer.id && other.exrSourceFile === layer.exrSourceFile)) delete editor.assets[layer.exrSourceFile]; delete layer.exrSourceFile; delete layer.exrView; delete layer.filters; delete layer.smartObject; const image = editor.images.get(layer.id); delete image.compositorHDR; delete image.compositorHDRSource; }); return true;
    }
    if (hdrDocument) {
      if (['color-export', 'soft-proof'].includes(command)) throw new Error('Use float32 HDR export, or explicitly rasterize/tone-map HDR before an ICC print workflow.');
      if (command.startsWith('adjust:') && !HDR_FILTERS.includes(command.slice(7))) throw new Error('This adjustment layer requires an SDR document.');
      if (command.startsWith('effect:')) throw new Error('Use an SDR document for layer effects, or rasterize the displayed HDR content first.');
    }
    return previous(command);
  };
  const change = editor.onChange; editor.onChange = () => {
    change(); const hdr = editor.manifest?.layers.some((layer) => layer.hdrSourceFile);
    const select = document.querySelector('#blend-mode'); for (const option of select.options) option.disabled = !!hdr && !HDR_BLENDS.includes(option.value);
    if (editor.active?.hdrSourceFile) { document.querySelector('#layer-kind').textContent = editor.active.exrSourceFile ? 'Retained OpenEXR source' : 'Float32 HDR source'; document.querySelector('.color-profile').textContent = `32-bit ${editor.manifest.hdrWorkingSpace ?? 'Linear sRGB'} · ${display.active ? 'HDR display' : 'SDR preview'}`; }
  };
  const render = editor.render.bind(editor); editor.render = () => { const active = display.active; render(); display.update(editor.preview); if (active !== display.active) editor.update(false); };
}
