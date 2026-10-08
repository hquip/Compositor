import { surface } from './raster.js';
import { createLayer, canvasSize, documentPixels } from './core.js';
import { decodePrecisionFile, encodedDepth, precisionDisplay } from './precision-raster.js';
import { encodePNG16 } from './png-pixels.js';
import { RGB_PROFILES, profileBytes, describeProfile, validateProfile } from './color-engine.js';
import { adjustmentDefaults } from './adjustments.js';
import { binaryBase64 } from './psd-export.js';
import { settingsDialog, boolField } from './settings-dialog.js';
import { compose } from './compose.js';
import { library } from './library-store.js';
import { filterAssetNames } from './filter-mix.js';

export function pickFile(accept) {
  return new Promise((resolve) => { const input = document.createElement('input'); input.type = 'file'; input.accept = accept; input.hidden = true; const finish = () => { const file = input.files[0]; input.remove(); resolve(file); }; input.addEventListener('change', finish, { once: true }); input.addEventListener('cancel', finish, { once: true }); document.body.append(input); input.click(); });
}
export function colorJob(payload, signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./color-worker.js', import.meta.url), { type: 'module' }); let done = false;
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate(); error ? reject(error) : resolve(value); };
    const abort = () => finish(new DOMException('Canceled', 'AbortError')), timer = setTimeout(() => finish(new Error('Could not start color processing.')), 15000);
    if (signal?.aborted) { abort(); return; } signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = (event) => { event.preventDefault(); finish(new Error(event.message || 'Color processing failed.')); };
    worker.onmessage = ({ data }) => { if (data.ready) { clearTimeout(timer); worker.postMessage(payload); } else if (data.error) finish(new Error(data.error)); else finish(null, data); };
  });
}
export function installColorWorkflows(editor, api) {
  const custom = new Map();
  const profilesReady = library.list('icc-profile').then((items) => { for (const item of [...items].reverse()) custom.set(item.name, { stored: item.id }); }).catch(() => {});
  const highPrecision = () => editor.active?.filterSourceFile && encodedDepth(editor.assets[editor.active.filterSourceFile]) === 16;
  const previous = editor.advancedCommand;
  editor.advancedCommand = async (command) => {
    if (command === 'import-precision') {
      const file = await pickFile('.png,.tif,.tiff,image/png,image/tiff'); if (!file) return true;
      if (file.size > 128 * 1024 * 1024) throw new Error('The high-precision source exceeds the memory budget.');
      const source = await decodePrecisionFile(new Uint8Array(await file.arrayBuffer()), file.name); canvasSize(source.width, source.height);
      const caption = document.createElement('p'); caption.textContent = source.originalSpace === 'CMYK' ? 'CMYK colors are converted through the embedded ICC profile to 16-bit ProPhoto RGB for editing.' : source.bits === 16 ? 'The 16-bit source is preserved. The canvas shows an 8-bit display preview.' : 'The source is 8-bit. Further processing uses 16-bit precision; converting does not restore missing source detail.';
      const options = await settingsDialog('Import high-precision image', [{ key: 'workingSpace', label: 'Working RGB profile', options: Object.keys(RGB_PROFILES), default: 'ProPhoto RGB' }, { key: 'inputProfile', label: 'Source profile', options: ['Embedded profile', ...Object.keys(RGB_PROFILES)], default: source.profile ? 'Embedded profile' : 'sRGB' }], {}, null, { previewElement: caption }); if (!options) return true;
      if (options.inputProfile !== 'Embedded profile') source.profile = await profileBytes(options.inputProfile); source.profile ??= await profileBytes('sRGB'); validateProfile(source.profile);
      const original = await encodePNG16(source), displayed = await precisionDisplay(source), image = surface(source.width, source.height); image.getContext('2d').putImageData(new ImageData(displayed.data, source.width, source.height), 0, 0);
      const used = documentPixels(editor); if (used + source.width * source.height * 3 > editor.pixelBudget) throw new Error('The high-precision source exceeds the document pixel budget.');
      if (!editor.manifest) editor.newCanvas(source.width, source.height);
      editor.mutate('Import High-Precision Image', () => {
        const layer = createLayer(file.name.replace(/\.[^.]+$/, '') || 'Image', source.width, source.height); layer.transform.origin = [(editor.manifest.width - source.width) / 2, (editor.manifest.height - source.height) / 2]; editor.storePixels(layer, image);
        layer.filterSourceFile = `${layer.id}.source.png`; editor.assets[layer.filterSourceFile] = binaryBase64(original); layer.filters = [{ id: crypto.randomUUID().toUpperCase(), enabled: false, adjustment: adjustmentDefaults('Exposure') }]; layer.filterWorkingSpace = options.workingSpace;
        editor.manifest.layers.push(layer); editor.manifest.activeLayerID = layer.id;
      }); return true;
    }
    if (command === 'rasterize-filters') {
      if (!editor.active?.filters) return true;
      const value = await settingsDialog('Rasterize editable filters', [{ key: 'choice', label: 'Original source', options: ['Keep editable', 'Rasterize displayed pixels'], default: 'Keep editable' }], {});
      if (value?.choice === 'Rasterize displayed pixels') editor.mutate('Rasterize Filters', () => { for (const name of filterAssetNames(editor.active)) delete editor.assets[name]; delete editor.assets[editor.active.filterSourceFile]; for (const key of ['filters', 'filterSourceFile', 'filterWorkingSpace']) delete editor.active[key]; }); return true;
    }
    if (!['color-export', 'soft-proof', 'load-icc'].includes(command)) return previous(command);
    if (command === 'load-icc') {
      const file = await pickFile('.icc,.icm,application/vnd.iccprofile'); if (!file) return true;
      if (file.size > 16 * 1024 * 1024) throw new Error('Invalid or oversized ICC profile.'); const bytes = new Uint8Array(await file.arrayBuffer()), profile = await describeProfile(bytes);
      const name = file.name + ' · ' + profile.space; await library.put({ id: 'icc:' + name, type: 'icc-profile', name }, bytes); custom.set(name, bytes); return true;
    }
    if (!editor.manifest) return true; await profilesReady; const snapshot = editor.projectSnapshot();
    const names = [...Object.keys(RGB_PROFILES), ...custom.keys()]; if (window.desktop.colorProfiles) { const response = await window.desktop.colorProfiles(); if (response.ok) for (const item of response.value) { const key = item.name + ' · Installed'; if (!custom.has(key)) { custom.set(key, item.id); names.push(key); } } }
    const readProfile = async (name) => { if (RGB_PROFILES[name]) return profileBytes(name); let bytes = custom.get(name); if (bytes?.stored) { bytes = await library.get(bytes.stored); custom.set(name, bytes); } if (typeof bytes === 'string') { const response = await window.desktop.readColorProfile(bytes); if (!response.ok) throw new Error(response.error); bytes = Uint8Array.from(atob(response.value), (c) => c.charCodeAt(0)); custom.set(name, bytes); } validateProfile(bytes); return bytes; };
    const preview = surface(1, 1); preview.className = 'matte-preview'; const note = document.createElement('div'); const caption = document.createElement('p'); caption.textContent = 'ICC conversion uses the selected output profile. CMYK output is composited onto white paper. High-precision sources retain their precision.'; note.append(preview, caption);
    let controller, output, sequence = 0, baked;
    const fields = [{ key: 'profile', label: 'Output ICC profile', options: names, default: 'sRGB' }, { key: 'intent', label: 'Rendering intent', options: ['Perceptual', 'Relative colorimetric', 'Saturation', 'Absolute colorimetric'], default: 'Relative colorimetric' }, boolField('blackPoint', 'Black point compensation', true), boolField('proof', 'Soft proof', command === 'soft-proof'), { key: 'bits', label: 'Export bit depth', options: ['16 bit', '8 bit'], default: '16 bit' }, boolField('rasterizedEffects', 'Allow 8-bit rendering of layer effects', false)];
    fields.splice(1, 0, { key: 'workingSpace', label: 'Composite RGB profile', options: Object.keys(RGB_PROFILES), default: 'sRGB' });
    const prepare = async (value, full, signal) => {
      const profile = await readProfile(value.profile); let prepared = snapshot;
      if (value.rasterizedEffects) {
        if (!baked) {
          baked = structuredClone(snapshot);
          for (const layer of baked.manifest.layers) if (layer.effects && Object.values(layer.effects).some((effect) => effect && effect.enabled !== false)) {
            const isolated = structuredClone(layer); delete isolated.parentID; delete isolated.maskSourceID; isolated.opacity = 1; isolated.blendMode = 'Normal'; isolated.isVisible = true;
            const image = compose({ ...editor.manifest, layers: [isolated] }, editor.images, editor.masks); layer.imageFile = `${layer.id}.png`; baked.assets[layer.imageFile] = image.toDataURL('image/png').split(',')[1];
            layer.transform = { origin: [0, 0], size: [editor.manifest.width, editor.manifest.height], rotation: 0, flipX: false, flipY: false, sampling: 'High quality' };
            for (const key of ['effects', 'maskFile', 'maskPlacement', 'maskEnabled', 'maskLinked', 'filterSourceFile', 'filterWorkingSpace', 'filters', 'text', 'shape']) delete layer[key];
          }
        } prepared = baked;
      }
      return colorJob({ snapshot: prepared, profile, workingSpace: value.workingSpace, intent: ['Perceptual', 'Relative colorimetric', 'Saturation', 'Absolute colorimetric'].indexOf(value.intent), blackPoint: value.blackPoint, proof: value.proof, bits: value.bits === '16 bit' ? 16 : 8, preview: !full }, signal);
    };
    const update = async (value) => { const token = ++sequence; controller?.abort(); controller = new AbortController(); const result = await prepare(value, false, controller.signal); if (token !== sequence) return; preview.width = result.width; preview.height = result.height; preview.getContext('2d').putImageData(new ImageData(result.pixels, result.width, result.height), 0, 0); };
    const result = await settingsDialog('Color management and TIFF export', fields, {}, update, { previewElement: note, initialPreview: true,
      apply: async (value, signal) => { sequence++; controller?.abort(); if (command !== 'soft-proof') output = await prepare(value, true, signal); }, cancel: () => { sequence++; controller?.abort(); },
    });
    if (result && output) { const response = await window.desktop.exportFile(binaryBase64(output.bytes), 'tiff', editor.name); if (!response.ok) throw new Error(response.error); } return true;
  };
  const down = editor.pointerDown.bind(editor); editor.pointerDown = (event) => { if (highPrecision() && !editor.editMask && !editor.spaceDown && event.button === 0 && !(editor.tool === 'clone' && event.altKey) && ['brush', 'eraser', 'clone', 'heal', 'blur', 'gradient'].includes(editor.tool)) { api.showError(new Error('Rasterize this high-precision layer before changing its pixels, or paint on a new layer.')); return; } return down(event); };
}
