import { createLayer, documentPixels, canvasSize, FORMAT_VERSION, layerEntries } from './core.js';
import { encodeFloatTIFF } from './vendor/float-tiff.js';
import { hdrCanvas, composeHDRCanvas, assertHDRCompatible } from './hdr-layer.js';
import { binaryBase64 } from './psd-export.js';
import { base64Bytes } from './precision-raster.js';
import { settingsDialog, numberField as n, boolField } from './settings-dialog.js';
import { adjustmentDefaults } from './adjustments.js';
import { preparedFilters } from './filter-resources.js';
import { applyHDRFilters } from './hdr-pixels.js';
import { inspectEXRContainer } from './vendor/exr-container.js';
import { HDR_SPACES, exrColorMetadata } from './hdr-color.js';
import { hdrIO } from './hdr-io.js';

const phone = () => document.body.classList.contains('mobile-app');
const limits = () => ({ limit: phone() ? 4000000 : 16000000, sampleLimit: phone() ? 1000000 : 8000000 });
function preferredSpace(metadata) { if (typeof metadata === 'string') return metadata; return Object.entries(HDR_SPACES).find(([, space]) => metadata?.every((n, i) => Math.abs(n - space.xy[i]) < .00001))?.[0] ?? 'Linear sRGB'; }
function metadataFor(container, part) { const header = container.parts[part]; return { chromaticities: header.chromaticities ?? container.chromaticities, colorInteropID: header.colorInteropID ?? container.colorInteropID }; }
export async function importEXRFile(editor, bytes, name, exr = true) {
  const container = exr ? inspectEXRContainer(bytes, limits().limit) : null, note = document.createElement('p'), selections = container?.parts.flatMap((header, part) => header.groups.map((group) => ({ header, part, group }))) ?? [];
  if (exr && !selections.length) throw new Error('OpenEXR requires RGB or grayscale Y channels.');
  let metadata = null, conflict = false; try { if (container) metadata = exrColorMetadata(metadataFor(container, selections[0].part)); } catch { conflict = true; }
  note.textContent = conflict ? 'OpenEXR color metadata conflicts. Choose an explicit input color space.' : exr ? 'OpenEXR parts, tiled levels and Deep samples are retained in the project. Preview pixels use the chosen linear working space. HDR display activates on supported devices.' : 'Assign the TIFF input linear color space. Embedded ICC profiles are not converted.';
  const fields = [{ key: 'encoding', label: 'Input color space', options: [...(metadata ? ['File color metadata'] : []), ...Object.keys(HDR_SPACES)], default: metadata ? 'File color metadata' : 'Linear sRGB' }, { key: 'workingSpace', label: 'HDR working space', options: Object.keys(HDR_SPACES), default: editor.manifest?.hdrWorkingSpace ?? preferredSpace(metadata) }];
  const labels = selections.map((selection, i) => `${i + 1} · ${container.multipart ? (selection.header.name || 'Part') + ' / ' : ''}${selection.group || 'Main image'}`);
  if (container) fields.push({ key: 'group', label: 'Channel group', options: labels, default: labels[0] }, { key: 'alpha', label: 'Input alpha', options: ['Premultiplied', 'Straight'], default: 'Premultiplied' }, { key: 'window', label: 'Image bounds', options: ['Display window', 'Data window'], default: 'Display window' });
  if (container?.multipart) fields.push({ key: 'parts', label: 'Parts', options: ['Selected pass', 'All image parts'], default: 'Selected pass' });
  if (container?.parts.some((part) => part.tiles)) fields.push(n('levelX', 'Tile level X', 0, 30, 0), n('levelY', 'Tile level Y', 0, 30, 0));
  if (container?.parts.some((part) => part.deep)) fields.push(boolField('clipDepth', 'Limit deep depth range', false), n('near', 'Near depth', -1e12, 1e12, 0, 'any'), n('far', 'Far depth', -1e12, 1e12, 1000000, 'any'));
  let frames;
  const options = await settingsDialog(exr ? 'Import OpenEXR' : 'Import float32 HDR', fields, {}, null, { previewElement: note, apply: async (value, signal) => {
    const chosen = exr ? value.parts === 'All image parts' ? selections.filter((selection) => selection.group === (selection.header.groups.includes('') ? '' : selection.header.groups[0])) : [selections[labels.indexOf(value.group)]] : [null];
    if (chosen.length > 64 || chosen.reduce((sum, selection) => sum + (selection ? selection.header.width * selection.header.height : 0), 0) * 5 + documentPixels(editor) > editor.pixelBudget) throw new Error('The HDR source exceeds the document pixel budget.');
    frames = [];
    for (const selection of chosen) {
      const exrView = selection ? { part: selection.part, group: selection.group, encoding: value.encoding, levelX: selection.header.tiles ? value.levelX ?? 0 : 0, levelY: selection.header.tiles ? value.levelY ?? 0 : 0, ...(selection.header.deep && value.clipDepth ? { depthRange: [value.near, value.far] } : {}) } : null;
      const source = await hdrIO({ action: exr ? 'decode-exr' : 'decode-tiff', bytes, options: { ...exrView, ...limits(), encoding: value.encoding, workingSpace: value.workingSpace, alpha: value.alpha } }, signal), header = selection?.header;
      const placement = header && value.window === 'Display window' ? { width: header.displayWidth, height: header.displayHeight, x: header.dataWindow[0] - header.displayWindow[0] + (editor.manifest ? (editor.manifest.width - header.displayWidth) / 2 : 0), y: header.dataWindow[1] - header.displayWindow[1] + (editor.manifest ? (editor.manifest.height - header.displayHeight) / 2 : 0), size: [header.width, header.height] } : null;
      frames.push({ source, placement, exrView, name: chosen.length > 1 ? `${name} · ${header.name || selection.part + 1}` : name });
    }
    if (editor.manifest) { assertHDRCompatible(editor.manifest); if (editor.manifest.width * editor.manifest.height > 16000000) throw new Error('Use a document up to 16 MP for HDR compositing.'); }
    if (documentPixels(editor) + frames.reduce((sum, frame) => sum + frame.source.width * frame.source.height * 5, 0) > editor.pixelBudget) throw new Error('The HDR source exceeds the document pixel budget.');
    const view = editor.manifest?.hdrView ?? { exposure: 0, toneMap: 'Reinhard', displayMode: 'Auto' };
    for (const frame of frames) { const { source, placement } = frame; canvasSize(source.width, source.height); if (placement) { canvasSize(placement.width, placement.height); if (![placement.x, placement.y].every((v) => Number.isFinite(v) && Math.abs(v) <= 1000000)) throw new Error('OpenEXR window offset exceeds the supported transform range.'); } frame.bytes = encodeFloatTIFF(source); frame.image = hdrCanvas(source, view); frame.encoded = frame.image.toDataURL('image/png').split(',')[1]; }
    if (phone() && Object.values(editor.assets).reduce((sum, asset) => sum + asset.length * .75, 0) + (exr ? bytes.length : 0) + frames.reduce((sum, frame) => sum + frame.bytes.length + frame.encoded.length * .75, 0) + 4 * 1024 * 1024 > 128 * 1024 * 1024) throw new Error('This HDR import exceeds the phone archive budget.');
  } });
  if (!options) return false;
  if (!editor.manifest) editor.newCanvas(frames[0].placement?.width ?? frames[0].source.width, frames[0].placement?.height ?? frames[0].source.height);
  const filename = exr ? `${crypto.randomUUID().toUpperCase()}.exr-source.exr` : null, busy = editor.busy; editor.busy = false;
  try { editor.mutate(exr ? 'Import OpenEXR' : 'Import Float32 HDR', () => {
    editor.manifest.version = FORMAT_VERSION; editor.manifest.hdrWorkingSpace = options.workingSpace; editor.manifest.hdrView ??= { exposure: 0, toneMap: 'Reinhard', displayMode: 'Auto' }; if (exr) editor.assets[filename] = binaryBase64(bytes);
    for (const frame of frames) { const { source, placement } = frame, layer = createLayer(frame.name, source.width, source.height); layer.transform.origin = placement ? [placement.x, placement.y] : [(editor.manifest.width - source.width) / 2, (editor.manifest.height - source.height) / 2]; if (placement?.size) layer.transform.size = placement.size; editor.storePixels(layer, frame.image); layer.hdrSourceFile = `${layer.id}.hdr-source.tif`; editor.assets[layer.hdrSourceFile] = binaryBase64(frame.bytes); layer.filters = [{ id: crypto.randomUUID().toUpperCase(), enabled: false, adjustment: adjustmentDefaults('Exposure') }]; if (exr) { layer.exrSourceFile = filename; layer.exrView = frame.exrView; } editor.manifest.layers.push(layer); editor.manifest.activeLayerID = layer.id; editor.selectedIDs = new Set([layer.id]); }
  }); } finally { editor.busy = busy; } editor.update(); return true;
}
async function deepPreview(editor) {
  const layer = editor.active; if (!layer?.exrSourceFile) return; const bytes = base64Bytes(editor.assets[layer.exrSourceFile]), container = inspectEXRContainer(bytes); if (!container.parts[layer.exrView.part].deep) throw new Error('Select a retained Deep EXR layer.');
  const initial = { clip: !!layer.exrView.depthRange, near: layer.exrView.depthRange?.[0] ?? 0, far: layer.exrView.depthRange?.[1] ?? 1000000 }; let source;
  const options = await settingsDialog('Deep EXR preview', [boolField('clip', 'Limit deep depth range'), n('near', 'Near depth', -1e12, 1e12, 0, 'any'), n('far', 'Far depth', -1e12, 1e12, 1000000, 'any')], initial, null, { apply: async (value, signal) => { source = await hdrIO({ action: 'decode-exr', bytes, options: { ...layer.exrView, ...limits(), depthRange: value.clip ? [value.near, value.far] : null, encoding: layer.exrView.encoding ?? 'File color metadata', workingSpace: editor.images.get(layer.id).compositorHDRSource.linearSpace } }, signal); } });
  if (!options) return; const targets = editor.manifest.layers.filter((item) => item.id === layer.id || layer.smartObject && item.smartObject?.id === layer.smartObject.id), prepared = [];
  for (const target of targets) prepared.push({ layer: target, image: hdrCanvas(applyHDRFilters(source, await preparedFilters(target.filters, editor.assets)), editor.manifest.hdrView, source) });
  const encoded = binaryBase64(encodeFloatTIFF(source)); editor.mutate('Deep EXR Preview', () => { for (const item of prepared) { const filters = item.layer.filters; editor.storePixels(item.layer, item.image, { filterCache: true }); item.layer.filters = filters; editor.assets[item.layer.hdrSourceFile] = encoded; item.layer.exrView = { ...item.layer.exrView }; if (options.clip) item.layer.exrView.depthRange = [options.near, options.far]; else delete item.layer.exrView.depthRange; } });
}
export async function exrCommand(editor, command) {
  if (command === 'hdr-working-space') { if (!editor.manifest?.layers.some((l) => l.hdrSourceFile)) return true; const options = await settingsDialog('HDR working space', [{ key: 'space', label: 'HDR working space', options: Object.keys(HDR_SPACES) }], { space: editor.manifest.hdrWorkingSpace ?? 'Linear sRGB' }); if (options) editor.mutate('HDR Working Space', () => { editor.manifest.hdrWorkingSpace = options.space; }); return true; }
  if (command === 'deep-exr-preview') { await deepPreview(editor); return true; }
  if (command === 'export-exr-original') { const layer = editor.active; if (!layer?.exrSourceFile) throw new Error('Select a layer with a retained OpenEXR source.'); const result = await window.desktop.exportFile(editor.assets[layer.exrSourceFile], 'exr', layer.name + '-original'); if (!result.ok) throw new Error(result.error); return true; }
  if (command !== 'export-exr') return false;
  if (!editor.manifest?.layers.some((l) => l.hdrSourceFile)) throw new Error('Import or add HDR content before exporting OpenEXR.'); let bytes;
  const options = await settingsDialog('Export OpenEXR', [{ key: 'bits', label: 'Pixel type', options: ['32-bit float', '16-bit half float'], default: '32-bit float' }, { key: 'space', label: 'Output color space', options: Object.keys(HDR_SPACES), default: editor.manifest.hdrWorkingSpace ?? 'Linear sRGB' }, { key: 'compression', label: 'Compression', options: ['PIZ', 'ZIP', 'ZIPS', 'None', 'RLE', 'PXR24', 'B44', 'B44A', 'DWAA', 'DWAB'], default: 'PIZ' }, { key: 'layout', label: 'Storage layout', options: ['Scanline', 'Tiled'], default: 'Scanline' }, { key: 'parts', label: 'Parts', options: ['Flattened composite', 'Visible layers as parts'], default: 'Flattened composite' }], {}, null, { apply: async (value, signal) => {
    editor.projectSnapshot(); const layers = value.parts === 'Visible layers as parts' ? layerEntries(editor.manifest.layers).filter((entry) => entry.visible && !entry.layer.isGroup && !entry.layer.adjustment && editor.images.has(entry.layer.id)).map((entry) => entry.layer) : null;
    if (layers && (!layers.length || layers.length * editor.manifest.width * editor.manifest.height > limits().limit)) throw new Error('Multipart export exceeds the pixel budget.');
    if (layers?.some((layer) => layer.maskSourceID)) throw new Error('Use flattened EXR export for clipping stacks.');
    const frames = layers ? layers.map((layer) => ({ name: layer.name, source: composeHDRCanvas({ ...editor.manifest, layers: editor.manifest.layers.map((item) => item.isGroup || item.id === layer.id ? item : { ...item, isVisible: false }) }, editor.images, editor.masks, 1, true) })) : [{ name: 'Composite', source: composeHDRCanvas(editor.manifest, editor.images, editor.masks, 1, true) }];
    bytes = await hdrIO({ action: 'encode-exr', frames, options: { ...value, bits: value.bits === '16-bit half float' ? 16 : 32, limit: limits().limit } }, signal);
  } }); if (options) { const result = await window.desktop.exportFile(binaryBase64(bytes), 'exr', editor.name + '-HDR'); if (!result.ok) throw new Error(result.error); } return true;
}
