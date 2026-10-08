import { library } from './library-store.js';
import { settingsDialog } from './settings-dialog.js';
import { FilterTask } from './filter-task.js';
import { sourceImage, renderFilterStack } from './filter-stack.js';
import { surface } from './raster.js';
import { rasterTarget, resizedGrid, commitRaster, maskToPixels, pixelsToMask, mappedSelection, maskedChange } from './raster-space.js';
import { storeMask } from './masks.js';
import { canvasSize, documentPixels } from './core.js';
import { resizeDocument, flipCanvas } from './layer-operations.js';
import { adjustmentDefaults } from './adjustments.js';
import { copyFilterResources } from './filter-resources.js';
import { filterAssetNames, filterMaskPixels } from './filter-mix.js';

export async function applyActionStep(editor, step, signal) {
  if (step.type === 'basic-filter') { if (step.mask && !editor.active?.maskFile) throw new Error('This action requires a layer mask.'); const mask = editor.editMask; editor.editMask = !!step.mask; try { editor.applyFilter(step.name); } finally { editor.editMask = mask; } return; }
  if (step.type === 'flip-layer') { if (!editor.active || editor.active.isGroup) throw new Error('This action requires an active image layer.'); editor.mutate('Flip Layer', () => { const key = step.axis === 'x' ? 'flipX' : 'flipY'; editor.active.transform[key] = !editor.active.transform[key]; }); return; }
  if (step.type === 'flip-canvas') { flipCanvas(editor, step.axis === 'x'); return; }
  if (step.type === 'resize') { const value = step.settings; canvasSize(value.width, value.height); resizeDocument(editor, value.width, value.height, step.kind === 'image-size', value.anchor); editor.mutate('Resolution', () => { editor.manifest.resolution = value.resolution; }); return; }
  const layer = editor.active; if (!layer || layer.isGroup || layer.adjustment) throw new Error('This action requires an active image layer.');
  const task = new FilterTask(), cancel = () => task.cancel(); signal?.addEventListener('abort', cancel, { once: true });
  try {
    if (step.type === 'editable-filters') {
      const source = await sourceImage(editor, layer), original = editor.assets[layer.hdrSourceFile ?? layer.filterSourceFile ?? layer.imageFile], copy = copyFilterResources(step.filters, step.maskAssets, layer.id), filters = copy.filters;
      if (!source) throw new Error('This action requires image pixels.');
      if (documentPixels(editor) - filterMaskPixels(layer.filters ?? [], editor.assets) + filterMaskPixels(filters, copy.assets) + (!layer.filterSourceFile && !layer.hdrSourceFile && filters.length ? source.width * source.height : 0) > editor.pixelBudget) throw new Error('The filter action exceeds the document pixel budget.');
      const output = await renderFilterStack(source, filters, task, 1, undefined, copy.assets, () => !signal?.aborted); if (signal?.aborted) throw new DOMException('Canceled', 'AbortError');
      editor.mutate('Editable Filters', () => { for (const name of filterAssetNames(layer)) delete editor.assets[name]; editor.storePixels(layer, output, { filterCache: true }); editor.rasterize(layer); if (source.compositorHDR) { output.compositorHDRSource = source.compositorHDR; layer.filters = filters.length ? filters : [{ id: crypto.randomUUID().toUpperCase(), enabled: false, adjustment: adjustmentDefaults('Exposure') }]; editor.assets[layer.hdrSourceFile] = original; Object.assign(editor.assets, copy.assets); } else if (filters.length || source.compositorPrecision || layer.smartObject) { layer.filters = filters.length ? filters : [{ id: crypto.randomUUID().toUpperCase(), enabled: false, adjustment: adjustmentDefaults('Exposure') }]; layer.filterSourceFile = `${layer.id}.source.png`; editor.assets[layer.filterSourceFile] = original; Object.assign(editor.assets, copy.assets); if (source.compositorWorkingSpace) layer.filterWorkingSpace = source.compositorWorkingSpace; } }); return;
    }
    if (step.type !== 'filter') throw new Error('Unsupported action step.');
    const image = (step.mask ? editor.masks : editor.images).get(layer.id); if (!image) throw new Error('This action requires image pixels or a layer mask.');
    let input = step.mask ? maskToPixels(image) : image, target;
    const s = step.settings;
    if (!step.mask && !editor.selection && step.action === 'filter' && ['Gaussian Blur', 'Motion Blur'].includes(step.kind) && s.expandBounds !== false) {
      const angle = (s.motionAngle ?? 0) * Math.PI / 180, x = step.kind === 'Gaussian Blur' ? Math.ceil((s.blurRadius ?? 10) * 3) + 2 : Math.ceil(Math.abs(Math.cos(angle)) * (s.motionDistance ?? 10) / 2) + 2, y = step.kind === 'Gaussian Blur' ? x : Math.ceil(Math.abs(Math.sin(angle)) * (s.motionDistance ?? 10) / 2) + 2;
      const width = image.width + 2 * x, height = image.height + 2 * y; canvasSize(width, height); if (documentPixels(editor) - image.width * image.height + width * height > editor.pixelBudget) throw new Error('The filter exceeds the document pixel budget.');
      input = surface(width, height); input.getContext('2d').drawImage(image, x, y); target = { ...rasterTarget(editor, layer), x: -x, y: -y, width, height, transform: resizedGrid(layer.transform, image.width, image.height, -x, -y, width, height) };
    }
    let output = await task.run(input, step.action, step.kind, s); if (signal?.aborted) throw new DOMException('Canceled', 'AbortError'); if (step.mask) output = pixelsToMask(output);
    if (editor.selection) output = maskedChange(image, output, mappedSelection(editor, step.mask ? { ...layer, transform: layer.maskPlacement ?? layer.transform } : layer, image.width, image.height));
    editor.mutate(step.kind ?? 'Camera Raw Filter', () => { if (step.mask) storeMask(editor, layer, output); else if (target) commitRaster(editor, target, output); else { editor.storePixels(layer, output); editor.rasterize(layer); } });
  } finally { signal?.removeEventListener('abort', cancel); task.cancel(); }
}
export function installActions(editor, api) {
  let recording = null, playing = false;
  const indicator = document.createElement('button'); indicator.className = 'action-recording'; indicator.hidden = true; indicator.addEventListener('click', () => api.runCommand('stop-action')); document.querySelector('.tool-options').append(indicator);
  const draw = () => { indicator.hidden = !recording; indicator.textContent = 'Recording · ' + (recording?.steps.length ?? 0); indicator.title = 'Records filters, editable filter stacks, resizing, and flips.'; };
  editor.recordAction = (step) => { if (recording && !playing && recording.steps.length < 100) { recording.steps.push(structuredClone(step)); draw(); } };
  const previous = editor.advancedCommand;
  editor.advancedCommand = async (command) => {
    if (command === 'record-action') {
      if (recording) return true; const name = await api.askInput('Record action', 'Name', 'My action'); if (name?.trim()) { recording = { name: name.trim(), steps: [] }; draw(); } return true;
    }
    if (command === 'stop-action') {
      if (recording?.steps.length) await library.put({ id: 'action:' + recording.name, type: 'action', name: recording.name }, { steps: recording.steps }); recording = null; draw(); return true;
    }
    if (command !== 'play-action') return previous(command);
    if (!editor.manifest) return true; const list = await library.list('action'); if (!list.length) throw new Error('No actions have been recorded.');
    const options = await settingsDialog('Run action', [{ key: 'name', label: 'Action', options: list.map((item) => item.name), default: list[0].name }], {}); if (!options) return true;
    const action = await library.get(list.find((item) => item.name === options.name).id); if (!Array.isArray(action?.steps) || action.steps.length > 100) throw new Error('Invalid action.');
    editor.projectSnapshot(); const before = editor.snapshot(), history = { past: [...editor.history.past], future: [...editor.history.future], revision: editor.history.revision, savedRevision: editor.history.savedRevision };
    const progress = document.createElement('p'); let complete = false, pending, restored = false; playing = true;
    const resetHistory = () => Object.assign(editor.history, { ...history, past: [...history.past], future: [...history.future] });
    const restore = async () => { editor.busy = true; try { await editor.install(before); resetHistory(); restored = true; } finally { editor.busy = false; } };
    const run = async (signal) => {
      complete = false; await restore(); restored = false;
      try {
        for (let i = 0; i < action.steps.length; i++) { if (signal.aborted) throw new DOMException('Canceled', 'AbortError'); progress.textContent = `${i + 1} / ${action.steps.length}`; await applyActionStep(editor, action.steps[i], signal); }
        if (signal.aborted) throw new DOMException('Canceled', 'AbortError'); complete = true;
      } catch (error) { await restore(); throw error; }
    };
    try {
      const result = await settingsDialog('Run action', [], {}, null, { previewElement: progress, apply: (_, signal) => { pending = run(signal); return pending; }, cancel: () => pending?.catch(() => {}) });
      if ((!result || !complete) && !restored) await restore(); const after = editor.snapshot(); resetHistory();
      if (result && complete) editor.history.push(before, after, 'Run Action');
    } catch (error) { editor.busy = true; await editor.install(before); resetHistory(); throw error; }
    finally { playing = false; editor.busy = false; editor.update(); }
    return true;
  };
}
