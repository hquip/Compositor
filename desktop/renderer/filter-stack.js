import { surface } from './raster.js';
import { decodeImage } from './compose.js';
import { FilterTask } from './filter-task.js';
import { ADJUSTMENT_KINDS, adjustmentDefaults, editableAdjustment, savedAdjustment } from './adjustments.js';
import { adjustmentFields } from './adjustment-controls.js';
import { settingsDialog } from './settings-dialog.js';
import { encodedDepth, base64Bytes, decodePrecisionFile, resizePrecision } from './precision-raster.js';
import { documentPixels } from './core.js';
import { preparedFilters } from './filter-resources.js';
import { filterMaskName, filterAssetNames } from './filter-mix.js';
import { editFilterMask } from './filter-mask-editor.js';
import { mappedSelection } from './raster-space.js';
import { maskValues } from './masks.js';
import { encodePNGGray } from './png-pixels.js';
import { binaryBase64 } from './psd-export.js';
import { decodeFloatTIFF } from './vendor/float-tiff.js';
import { hdrCanvas } from './hdr-layer.js';
import { HDR_FILTERS, resizeHDR } from './hdr-pixels.js';

export async function sourceImage(editor, layer) {
  if (layer.hdrSourceFile) return hdrCanvas(editor.images.get(layer.id)?.compositorHDRSource ?? decodeFloatTIFF(base64Bytes(editor.assets[layer.hdrSourceFile]), 16000000, true), editor.manifest.hdrView);
  if (!layer.filterSourceFile) return editor.images.get(layer.id);
  const image = await decodeImage(`data:image/png;base64,${editor.assets[layer.filterSourceFile]}`), canvas = surface(image.naturalWidth, image.naturalHeight);
  canvas.getContext('2d').drawImage(image, 0, 0);
  if (encodedDepth(editor.assets[layer.filterSourceFile]) === 16) { canvas.compositorPrecision = await decodePrecisionFile(base64Bytes(editor.assets[layer.filterSourceFile])); canvas.compositorWorkingSpace = layer.filterWorkingSpace ?? 'sRGB'; }
  return canvas;
}
export async function renderFilterStack(source, filters, task, scale = 1, limits, assets = {}, current = () => true) {
  const prepared = await preparedFilters(filters, assets); if (!current()) throw new DOMException('Canceled', 'AbortError');
  if (source.compositorHDR) return task.run(source, 'hdr-filters', null, { source: source.compositorHDR, filters: prepared, view: source.compositorHDRView }, scale, limits);
  if (source.compositorPrecision) return task.run(source, 'precision-filters', null, { source: source.compositorPrecision, filters: prepared, workingSpace: source.compositorWorkingSpace ?? 'sRGB' }, scale, limits);
  return task.run(source, 'filter-stack', null, { filters: prepared }, scale, limits);
}

export function installFilterStack(editor, api) {
  const button = document.createElement('button'); button.className = 'filter-stack-button'; button.dataset.command = 'edit-filters'; button.textContent = 'Editable filters'; button.addEventListener('click', () => api.runCommand('edit-filters'));
  document.querySelector('.properties-panel').append(button);
  const previous = editor.advancedCommand;
  editor.advancedCommand = async (command) => {
    if (command !== 'edit-filters' && !command.startsWith('editable-filter:')) return previous(command);
    const layer = editor.active; if (!layer || layer.isGroup || layer.adjustment || editor.editMask || !editor.images.has(layer.id)) return true;
    editor.floatingSelection?.finish(true); editor.gradient?.finish(true); if (editor.inlineText?.finish(true) === false) return true;
    const source = await sourceImage(editor, layer), original = editor.assets[layer.hdrSourceFile ?? layer.filterSourceFile ?? layer.imageFile], filters = structuredClone(editor.pendingFilterPreset ?? layer.filters ?? []), task = new FilterTask(); delete editor.pendingFilterPreset;
    source.compositorHDRView = editor.manifest.hdrView;
    const maskAssets = { ...editor.assets, ...editor.pendingFilterAssets }; delete editor.pendingFilterAssets;
    const scale = Math.min(1, 1024 / Math.max(source.width, source.height)), thumbnail = surface(Math.max(1, Math.round(source.width * scale)), Math.max(1, Math.round(source.height * scale)));
    thumbnail.getContext('2d').drawImage(source, 0, 0, thumbnail.width, thumbnail.height);
    if (source.compositorPrecision) { thumbnail.compositorPrecision = resizePrecision(source.compositorPrecision, thumbnail.width, thumbnail.height); thumbnail.compositorWorkingSpace = source.compositorWorkingSpace; }
    if (source.compositorHDR) { thumbnail.compositorHDR = resizeHDR(source.compositorHDR, thumbnail.width, thumbnail.height); thumbnail.compositorHDRView = editor.manifest.hdrView; }
    const limits = document.body.classList.contains('mobile-app') ? { side: 8192, pixels: 16000000 } : { side: 30000, pixels: 200000000 };
    const dialog = document.createElement('dialog'); dialog.className = 'settings-dialog filter-stack-dialog';
    const title = document.createElement('h2'); title.textContent = 'Editable filters';
    const note = document.createElement('p'); note.textContent = 'Each filter can use its own mask and opacity. Original pixels and masks remain editable after reopening.';
    const list = document.createElement('div'); list.className = 'filter-stack-list';
    const kind = document.createElement('select'); kind.setAttribute('aria-label', 'Add editable filter');
    for (const name of source.compositorHDR ? HDR_FILTERS : ADJUSTMENT_KINDS) { const option = document.createElement('option'); option.value = name; option.textContent = name; kind.append(option); }
    const add = document.createElement('button'); add.textContent = 'Add filter';
    const progress = document.createElement('p'); progress.setAttribute('role', 'status');
    const actions = document.createElement('div'); actions.className = 'dialog-actions';
    const cancel = document.createElement('button'); cancel.textContent = 'Cancel'; const apply = document.createElement('button'); apply.textContent = 'Apply'; apply.className = 'primary';
    actions.append(cancel, apply); dialog.append(title, note, list, kind, add, progress, actions); document.body.append(dialog);
    let sequence = 0, closed = false, applying = false, editing = false;
    const preview = async (child = false) => {
      if (closed || applying || (editing && !child)) return;
      const token = ++sequence; task.cancel(); progress.textContent = 'Updating preview…';
      try {
        const image = await renderFilterStack(thumbnail, structuredClone(filters), task, scale, limits, maskAssets, () => !closed && token === sequence);
        if (closed || token !== sequence) return;
        editor.rasterPreview = { layerID: layer.id, isMask: false, transform: structuredClone(layer.transform), image }; editor.update(); progress.textContent = 'Preview ready';
      } catch (error) { if (!closed && token === sequence && error.name !== 'AbortError') progress.textContent = error.message; }
    };
    const editFilter = async (update) => {
      if (closed || applying || editing) return;
      editing = true; sequence++; task.cancel(); list.inert = true; add.disabled = apply.disabled = kind.disabled = true;
      try { await update(); }
      catch (error) { if (!closed) api.showError(error); }
      finally {
        editing = false;
        if (!closed) { list.inert = applying; apply.disabled = kind.disabled = applying; draw(); if (!applying) preview(); }
      }
    };
    const draw = () => {
      list.replaceChildren();
      filters.forEach((entry, index) => {
        const row = document.createElement('div'); row.className = 'filter-stack-row';
        const visible = document.createElement('input'); visible.type = 'checkbox'; visible.checked = entry.enabled; visible.setAttribute('aria-label', 'Enable filter'); visible.addEventListener('change', () => { entry.enabled = visible.checked; preview(); });
        const edit = document.createElement('button'); edit.textContent = entry.adjustment.kind; edit.addEventListener('click', () => editFilter(async () => {
          const initial = structuredClone(entry.adjustment);
          const result = await settingsDialog(entry.adjustment.kind, adjustmentFields(entry.adjustment.kind), editableAdjustment(entry.adjustment), (value) => { entry.adjustment = savedAdjustment(value); return preview(true); });
          if (!closed) entry.adjustment = result ? savedAdjustment(result) : initial;
        }));
        const up = document.createElement('button'); up.textContent = '↑'; up.setAttribute('aria-label', 'Move filter up'); up.disabled = index === 0; up.addEventListener('click', () => { [filters[index - 1], filters[index]] = [filters[index], filters[index - 1]]; draw(); preview(); });
        const down = document.createElement('button'); down.textContent = '↓'; down.setAttribute('aria-label', 'Move filter down'); down.disabled = index === filters.length - 1; down.addEventListener('click', () => { [filters[index + 1], filters[index]] = [filters[index], filters[index + 1]]; draw(); preview(); });
        const remove = document.createElement('button'); remove.textContent = 'Remove'; remove.addEventListener('click', () => { filters.splice(index, 1); draw(); preview(); });
        const main = document.createElement('div'); main.className = 'filter-stack-main'; main.append(visible, edit, up, down, remove);
        const mix = document.createElement('div'); mix.className = 'filter-stack-mix';
        const mask = document.createElement('button'); mask.textContent = entry.maskFile ? 'Edit filter mask…' : 'Add filter mask…'; mask.addEventListener('click', () => editFilter(async () => {
          const prepared = await preparedFilters([{ ...entry, enabled: true, maskEnabled: true, opacity: 1 }], maskAssets); if (closed) return;
          const result = await editFilterMask(source, prepared[0].mask, api, limits);
          if (result && !closed) { entry.maskFile = filterMaskName(layer.id, entry.id); entry.maskEnabled ??= true; maskAssets[entry.maskFile] = result; }
        }));
        const selection = document.createElement('button'); selection.textContent = 'Use selection as filter mask'; selection.disabled = !editor.selection; selection.addEventListener('click', () => editFilter(async () => {
          const canvas = mappedSelection(editor, layer, source.width, source.height), bytes = binaryBase64(await encodePNGGray(canvas.width, canvas.height, maskValues(canvas))); if (closed) return;
          entry.maskFile = filterMaskName(layer.id, entry.id); maskAssets[entry.maskFile] = bytes; entry.maskEnabled = true;
        }));
        const opacityLabel = document.createElement('label'); opacityLabel.textContent = 'Filter opacity'; const opacity = document.createElement('input'); opacity.type = 'number'; opacity.min = '0'; opacity.max = '100'; opacity.value = String((entry.opacity ?? 1) * 100); opacity.setAttribute('aria-label', 'Filter opacity'); opacity.addEventListener('change', () => { const value = Number(opacity.value); if (!Number.isFinite(value) || value < 0 || value > 100) { opacity.value = String((entry.opacity ?? 1) * 100); return; } entry.opacity = value / 100; preview(); }); opacityLabel.append(opacity);
        mix.append(mask, selection, opacityLabel);
        if (entry.maskFile) {
          const enabledLabel = document.createElement('label'); enabledLabel.textContent = 'Mask enabled'; const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.checked = entry.maskEnabled !== false; enabled.setAttribute('aria-label', 'Enable filter mask'); enabled.addEventListener('change', () => { entry.maskEnabled = enabled.checked; preview(); }); enabledLabel.append(enabled);
          const clear = document.createElement('button'); clear.textContent = 'Remove filter mask'; clear.addEventListener('click', () => { delete entry.maskFile; delete entry.maskEnabled; draw(); preview(); }); mix.append(enabledLabel, clear);
        }
        row.append(main, mix); list.append(row);
      }); add.disabled = filters.length >= 32;
    };
    const insert = (name) => { if (source.compositorHDR && !HDR_FILTERS.includes(name)) { progress.textContent = 'This filter needs an SDR layer or a rasterized HDR display.'; draw(); return; } if (filters.length < 32 && ADJUSTMENT_KINDS.includes(name)) filters.push({ id: crypto.randomUUID().toUpperCase(), enabled: true, adjustment: savedAdjustment(adjustmentDefaults(name)) }); draw(); preview(); };
    add.addEventListener('click', () => insert(kind.value)); cancel.addEventListener('click', () => dialog.close());
    apply.addEventListener('click', async () => {
      if (applying || editing || closed) return;
      if (JSON.stringify(filters) === JSON.stringify(layer.filters ?? []) && filters.every((entry) => !entry.maskFile || maskAssets[entry.maskFile] === editor.assets[entry.maskFile])) { dialog.close('apply'); return; }
      const appliedFilters = structuredClone(filters), appliedAssets = { ...maskAssets };
      applying = true; sequence++; task.cancel(); list.inert = true; add.disabled = apply.disabled = true; kind.disabled = true; progress.textContent = 'Processing full-resolution image…';
      try {
        const output = await renderFilterStack(source, appliedFilters, task, 1, limits, appliedAssets, () => !closed); if (closed) return;
        const used = documentPixels(editor);
        if (appliedFilters.length && !layer.filterSourceFile && !layer.hdrSourceFile && used + source.width * source.height > editor.pixelBudget) throw new Error('The editable filter source exceeds the document pixel budget.');
        const maskPixels = (entries, assets) => entries.reduce((sum, entry) => { if (!entry.maskFile) return sum; const bytes = base64Bytes(assets[entry.maskFile]), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); return sum + view.getUint32(16) * view.getUint32(20); }, 0);
        if (used - maskPixels(layer.filters ?? [], editor.assets) + maskPixels(appliedFilters, appliedAssets) + (!layer.filterSourceFile && !layer.hdrSourceFile && appliedFilters.length ? source.width * source.height : 0) > editor.pixelBudget) throw new Error('The filter masks exceed the document pixel budget.');
        editor.rasterPreview = null;
        editor.mutate('Editable Filters', () => {
          for (const name of filterAssetNames(layer)) delete editor.assets[name];
          editor.storePixels(layer, output, { filterCache: true }); editor.rasterize(layer);
          if (source.compositorHDR) { output.compositorHDRSource = source.compositorHDR; editor.assets[layer.hdrSourceFile] = original; layer.filters = appliedFilters.length ? appliedFilters : [{ id: crypto.randomUUID().toUpperCase(), enabled: false, adjustment: adjustmentDefaults('Exposure') }]; }
          else if (appliedFilters.length || source.compositorPrecision || layer.smartObject) { layer.filterSourceFile = `${layer.id}.source.png`; editor.assets[layer.filterSourceFile] = original; layer.filters = appliedFilters.length ? appliedFilters : [{ id: crypto.randomUUID().toUpperCase(), enabled: false, adjustment: adjustmentDefaults('Exposure') }]; if (source.compositorPrecision) layer.filterWorkingSpace = source.compositorWorkingSpace; }
          for (const name of filterAssetNames(layer)) editor.assets[name] = appliedAssets[name];
        }); editor.recordAction?.({ type: 'editable-filters', filters: structuredClone(layer.filters ?? []), maskAssets: Object.fromEntries(filterAssetNames(layer).map((name) => [name, editor.assets[name]])) }); dialog.close('apply');
      } catch (error) { if (!closed) { applying = false; list.inert = false; apply.disabled = false; kind.disabled = false; add.disabled = filters.length >= 32; progress.textContent = error.message; } }
    });
    dialog.showModal();
    if (command.startsWith('editable-filter:')) insert(command.slice('editable-filter:'.length)); else { draw(); preview(); }
    await new Promise((resolve) => dialog.addEventListener('close', () => { closed = true; sequence++; task.cancel(); editor.rasterPreview = null; dialog.remove(); editor.update(); resolve(); }, { once: true }));
    return true;
  };
}
