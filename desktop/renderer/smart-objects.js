import { createLayer, createManifest, documentPixels, canvasSize, FORMAT_VERSION } from './core.js';
import { sourceImage, renderFilterStack } from './filter-stack.js';
import { FilterTask } from './filter-task.js';
import { adjustmentDefaults } from './adjustments.js';
import { surface } from './raster.js';
import { decodeImage } from './compose.js';
import { pickFile, colorJob } from './color-workflows.js';
import { binaryBase64 } from './psd-export.js';
import { encodeFloatTIFF } from './vendor/float-tiff.js';
import { hdrCanvas, composeHDRCanvas, assertHDRCompatible } from './hdr-layer.js';
import { encodePNG16 } from './png-pixels.js';
import { decodePrecisionFile, precisionDisplay } from './precision-raster.js';
import { filterAssetNames } from './filter-mix.js';
import { profileBytes } from './color-engine.js';
import { settingsDialog } from './settings-dialog.js';

const identityFilter = () => ({ id: crypto.randomUUID().toUpperCase(), enabled: false, adjustment: adjustmentDefaults('Exposure') });
export async function convertSmartObject(editor) {
  const layer = editor.active; if (!layer || layer.isGroup || layer.adjustment || layer.smartObject || !editor.images.has(layer.id)) return;
  const source = await sourceImage(editor, layer), encoded = editor.assets[layer.hdrSourceFile ?? layer.filterSourceFile ?? layer.imageFile];
  if (!layer.filterSourceFile && !layer.hdrSourceFile && documentPixels(editor) + source.width * source.height > editor.pixelBudget) throw new Error('The embedded source exceeds the document pixel budget.');
  editor.mutate('Convert to Smart Object', () => {
    editor.manifest.version = FORMAT_VERSION;
    editor.rasterize(layer); if (!layer.filterSourceFile && !layer.hdrSourceFile) { layer.filterSourceFile = `${layer.id}.source.png`; editor.assets[layer.filterSourceFile] = encoded; }
    layer.filters ??= [identityFilter()]; layer.smartObject = { id: crypto.randomUUID().toUpperCase(), width: source.width, height: source.height, baseTransform: structuredClone(layer.transform) };
  });
}
export async function replaceSmartSource(editor, objectID, source, encoded) {
  canvasSize(source.width, source.height);
  const layers = editor.manifest.layers.filter((layer) => layer.smartObject?.id === objectID); if (!layers.length) throw new Error('The embedded object no longer exists.');
  if (source.compositorHDR) assertHDRCompatible(editor.manifest);
  const task = new FilterTask(), prepared = [];
  try {
    for (const layer of layers) { const image = await renderFilterStack(source, layer.filters ?? [], task, 1, undefined, editor.assets); if (source.compositorHDR) image.compositorHDRSource = source.compositorHDR; prepared.push({ layer, image }); }
    let pixels = documentPixels(editor);
    for (const { layer, image } of prepared) { const old = editor.images.get(layer.id), oldSource = await sourceImage(editor, layer), oldWeight = layer.hdrSourceFile ? 4 : oldSource.compositorPrecision ? 2 : 1, weight = source.compositorHDR ? 4 : source.compositorPrecision ? 2 : 1; pixels += image.width * image.height + source.width * source.height * weight - old.width * old.height - oldSource.width * oldSource.height * oldWeight; }
    if (pixels > editor.pixelBudget) throw new Error('The replaced objects exceed the document pixel budget.');
    editor.mutate('Replace Smart Object Content', () => {
      editor.manifest.version = FORMAT_VERSION;
      for (const { layer, image } of prepared) {
        const filters = structuredClone(layer.filters), old = layer.hdrSourceFile ?? layer.filterSourceFile; editor.storePixels(layer, image, { filterCache: true }); if (old) delete editor.assets[old]; delete layer.hdrSourceFile; delete layer.filterSourceFile;
        if (!source.compositorHDR && layer.exrSourceFile) { const blob = layer.exrSourceFile; delete layer.exrSourceFile; delete layer.exrView; if (!editor.manifest.layers.some((other) => other.exrSourceFile === blob)) delete editor.assets[blob]; }
        const file = source.compositorHDR ? `${layer.id}.hdr-source.tif` : `${layer.id}.source.png`; layer[source.compositorHDR ? 'hdrSourceFile' : 'filterSourceFile'] = file; editor.assets[file] = encoded; layer.filters = filters?.length ? filters : [identityFilter()];
        layer.smartObject.width = source.width; layer.smartObject.height = source.height; if (source.compositorPrecision) layer.filterWorkingSpace = source.compositorWorkingSpace ?? 'sRGB'; if (source.compositorHDR) delete layer.filterWorkingSpace;
      }
      if (source.compositorHDR) editor.manifest.hdrView ??= { exposure: 0, toneMap: 'Reinhard' };
    });
  } finally { task.cancel(); }
}
export function installSmartObjects(editor, api) {
  const editing = new Map(), previous = editor.advancedCommand;
  const down = editor.pointerDown.bind(editor);
  editor.pointerDown = (event) => {
    if (!editor.editMask && (editor.active?.smartObject || editor.active?.hdrSourceFile) && ['brush', 'eraser', 'clone', 'heal', 'blur', 'gradient'].includes(editor.tool) && !editor.spaceDown && event.button === 0) { api.showError(new Error('Edit the embedded content or explicitly rasterize this protected source before painting.')); return; } down(event);
  };
  editor.advancedCommand = async (command) => {
    if (command === 'rasterize-filters' && editor.active?.smartObject) command = 'smart-rasterize';
    if (!editor.editMask && (editor.active?.smartObject || editor.active?.hdrSourceFile) && (command.startsWith('filter:') || command.startsWith('finishing:') || ['camera-raw', 'auto-levels', 'invert', 'grayscale', 'blur', 'content-fill', 'transform-selection', 'transform-selection-copy', 'move-selection-pixels', 'duplicate-selection-pixels'].includes(command))) throw new Error('Use editable filters, edit the embedded content, or rasterize the displayed source explicitly.');
    if (!['smart-convert', 'smart-edit', 'smart-apply-content', 'smart-replace', 'smart-reset', 'smart-independent', 'smart-rasterize'].includes(command)) return previous(command);
    const layer = editor.active;
    if (command === 'smart-convert') { await convertSmartObject(editor); return true; }
    if (command === 'smart-apply-content') {
      const link = editing.get(editor.workspace.id); if (!link) throw new Error('Open a smart object content tab first.');
      editor.projectSnapshot(); const parent = editor.workspace.entries().find((tab) => tab.id === link.parentID); if (!parent?.state) throw new Error('The parent project was closed.');
      const targets = parent.state.manifest.layers.filter((layer) => layer.smartObject?.id === link.objectID); if (!targets.length || targets.some((l) => parent.state.assets[l.hdrSourceFile ?? l.filterSourceFile] !== link.source)) throw new Error('The parent content changed. Reopen the embedded content before applying.');
      let source, encoded;
      if (editor.manifest.layers.some((l) => l.hdrSourceFile)) { const hdr = composeHDRCanvas(editor.manifest, editor.images, editor.masks, 1, true); source = hdrCanvas(hdr, parent.state.manifest.hdrView); encoded = binaryBase64(encodeFloatTIFF(hdr)); }
      else if (link.precision) { const profile = await profileBytes('sRGB'), output = await colorJob({ snapshot: editor.projectSnapshot(), profile, bits: 16, intent: 1, blackPoint: true, preview: false, workingSpace: 'sRGB' }), pixels = await decodePrecisionFile(output.bytes, 'Content.tiff'); source = editor.composite(true); source.compositorPrecision = pixels; source.compositorWorkingSpace = 'sRGB'; encoded = binaryBase64(await encodePNG16(pixels)); }
      else { source = editor.composite(true); encoded = source.toDataURL('image/png').split(',')[1]; }
      const state = parent.state, target = Object.create(editor); Object.assign(target, state, { busy: false, gesture: null, pathEditor: null, rasterPreview: null, preview: null, onChange: () => {}, draw: () => {}, update: () => {}, mutate: (name, action) => {
        const before = { manifest: { ...structuredClone(state.manifest), version: FORMAT_VERSION }, assets: { ...state.assets }, selection: state.selection };
        const images = new Map(state.images), masks = new Map(state.masks); try { action(); } catch (error) { state.manifest = before.manifest; state.assets = before.assets; state.images = images; state.masks = masks; throw error; }
        state.history.push(before, { manifest: structuredClone(state.manifest), assets: { ...state.assets }, selection: state.selection }, name);
      } });
      await replaceSmartSource(target, link.objectID, source, encoded); link.source = encoded; editor.update(false); return true;
    }
    if (!layer?.smartObject) return true;
    if (command === 'smart-edit') {
      const parentID = editor.workspace.id, objectID = layer.smartObject.id, source = await sourceImage(editor, layer), raw = editor.assets[layer.hdrSourceFile ?? layer.filterSourceFile], manifest = createManifest(source.width, source.height), copy = createLayer('Embedded content', source.width, source.height), assets = {};
      copy.imageFile = `${copy.id}.png`; assets[copy.imageFile] = source.toDataURL('image/png').split(',')[1];
      if (source.compositorHDR) { copy.hdrSourceFile = `${copy.id}.hdr-source.tif`; assets[copy.hdrSourceFile] = raw; copy.filters = [identityFilter()]; manifest.hdrWorkingSpace = source.compositorHDR.linearSpace ?? editor.manifest.hdrWorkingSpace ?? 'Linear sRGB'; manifest.hdrView = structuredClone(editor.manifest.hdrView ?? { exposure: 0, toneMap: 'Reinhard' }); }
      else if (source.compositorPrecision) { copy.filterSourceFile = `${copy.id}.source.png`; assets[copy.filterSourceFile] = raw; copy.filters = [identityFilter()]; copy.filterWorkingSpace = layer.filterWorkingSpace ?? 'sRGB'; }
      manifest.layers = [copy]; manifest.activeLayerID = copy.id; await editor.workspace.open({ snapshot: { manifest, assets }, path: `embedded:${parentID}:${objectID}`, name: 'Embedded content · ' + layer.name });
      editing.set(editor.workspace.id, { parentID, objectID, source: raw, precision: !!source.compositorPrecision }); return true;
    }
    if (command === 'smart-replace') {
      const file = await pickFile('.png,image/png'); if (!file) return true; if (file.size > 128 * 1024 * 1024) throw new Error('The replacement file is too large.'); const bytes = new Uint8Array(await file.arrayBuffer()), image = await decodeImage('data:image/png;base64,' + binaryBase64(bytes)); canvasSize(image.naturalWidth, image.naturalHeight); const source = surface(image.naturalWidth, image.naturalHeight); source.getContext('2d').drawImage(image, 0, 0);
      if (bytes[24] === 16) { const precision = await decodePrecisionFile(bytes), display = await precisionDisplay(precision); source.getContext('2d').putImageData(new ImageData(display.data, display.width, display.height), 0, 0); source.compositorPrecision = precision; source.compositorWorkingSpace = layer.filterWorkingSpace ?? 'sRGB'; }
      await replaceSmartSource(editor, layer.smartObject.id, source, bytes[24] === 16 ? binaryBase64(bytes) : source.toDataURL('image/png').split(',')[1]); return true;
    }
    if (command === 'smart-reset') { editor.mutate('Reset Smart Object Transform', () => { layer.transform = structuredClone(layer.smartObject.baseTransform); }); return true; }
    if (command === 'smart-independent') { editor.mutate('Make Smart Object Independent', () => { layer.smartObject.id = crypto.randomUUID().toUpperCase(); }); return true; }
    if (command === 'smart-rasterize') {
      const options = await settingsDialog('Rasterize smart object', [{ key: 'choice', label: 'Embedded source', options: ['Keep editable', 'Rasterize displayed pixels'], default: 'Keep editable' }], {}); if (options?.choice === 'Rasterize displayed pixels') {
        if (layer.hdrSourceFile) throw new Error('Rasterize the HDR display explicitly before removing its embedded source.');
        editor.mutate('Rasterize Smart Object', () => { for (const name of filterAssetNames(layer)) delete editor.assets[name]; delete editor.assets[layer.filterSourceFile]; for (const key of ['smartObject', 'filterSourceFile', 'filters', 'filterWorkingSpace']) delete layer[key]; });
      } return true;
    }
    return true;
  };
  const change = editor.onChange; editor.onChange = () => { change(); if (editor.active?.smartObject) document.querySelector('#layer-kind').textContent = 'Smart object'; };
}
