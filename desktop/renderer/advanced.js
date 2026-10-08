import { createLayer, canvasSize, documentPixels } from './core.js';
import { surface, copySurface, colorRecord } from './raster.js';
import { ADJUSTMENT_KINDS, adjustmentDefaults, applyAdjustment, applyCameraRaw, editableAdjustment, savedAdjustment, automaticLevels } from './adjustments.js';
import { effectDefaults } from './effects.js';
import { changeMask, modifySelection, storeMask, selectionCanvas } from './masks.js';
import { settingsDialog, numberField as n, boolField as b, colorField } from './settings-dialog.js';
import { adjustmentFields, effectFields, cameraRawFields } from './adjustment-controls.js';
import { groupLayers, ungroupLayers, duplicateLayers, mergeLayers, resizeDocument, trimDocument, flipCanvas } from './layer-operations.js';
import { installTools } from './tools.js';
import { installWorkspace } from './workspace.js';
import { installTransforms } from './transforms.js';
import { subjectMask } from './subject.js';
import { FINISHING, finishingFilter, finishingFields } from './finishing.js';
import { mappedSelection, maskedChange } from './tools.js';
import { installShortcuts } from './shortcuts.js';
import { installInlineText } from './inline-text.js';
import { installLayerDrag } from './layer-drag.js';
import { installLayerUI } from './layer-ui.js';
import { installGradient } from './gradient-edit.js';
import { installSelectionEdits } from './selection-edit.js';
import { createClipping, releaseClipping } from './clipping.js';
import { FilterTask } from './filter-task.js';
import { maskToPixels, pixelsToMask, rasterTarget, resizedGrid, grownLayerMask, commitRaster } from './raster-space.js';
import { installFloatingSelection } from './floating-selection.js';
import { installFilterStack } from './filter-stack.js';
import { installMaskRefinement } from './refine-mask.js';
import { installPhotoshopExport } from './psd-export.js';
import { installColorWorkflows } from './color-workflows.js';
import { installPenInput } from './pen-input.js';
import { installFontManager } from './font-manager.js';
import { installProductivity } from './productivity.js';
import { installActions } from './actions.js';
import { installPathEditor } from './path-editor.js';
import { installHDR } from './hdr-workflows.js';
import { installSmartObjects } from './smart-objects.js';
import { selectionStrokeDialog } from './selection-stroke.js';
import { installDodgeBurn } from './dodge-burn.js';
import { installProfessionalWorkflows } from './professional-workflows.js';
import { installChannelWorkflows } from './channel-workflows.js';
import { installLayoutWorkflows } from './layout-workflows.js';
import { installInterchangeWorkflows } from './interchange-workflows.js';
import { installExtensionWorkflows } from './extension-workflows.js';
import { installUpdateNotes } from './update-notes.js';

export function installAdvanced(editor, api) {
  const menu = document.createElement('div'); menu.className = 'editor-menus';
  const menus = {
    Layer: [['Group selected', 'group'], ['Ungroup', 'ungroup'], ['Merge selected / group', 'merge'], ['Merge down', 'merge-down'], ['Create clipping mask', 'clip'], ['Release clipping mask', 'unclip'], ['Add layer mask', 'mask:Add Mask'], ['Edit mask pixels', 'edit-mask'], ['Edit image pixels', 'edit-image'], ['Enable / disable mask', 'mask:Toggle Mask'], ['Link / unlink mask', 'mask:Link Mask'], ['Invert mask', 'mask:Invert Mask'], ['Fill mask white', 'mask:Fill Mask White'], ['Fill mask black', 'mask:Fill Mask Black'], ['Feather mask…', 'mask:Feather Mask'], ['Remove mask', 'mask:Remove Mask']],
    Adjust: [...ADJUSTMENT_KINDS.map((kind) => [`${kind}…`, `adjust:${kind}`]), ['Edit selected adjustment…', 'edit-adjustment']],
    Effects: [['Stroke…', 'effect:stroke'], ['Drop shadow…', 'effect:shadow'], ['Color overlay…', 'effect:colorOverlay'], ['Inner shadow…', 'effect:innerShadow'], ['Outer glow…', 'effect:outerGlow'], ['Inner glow…', 'effect:innerGlow'], ['Remove effects', 'remove-effects']],
    Image: [['Image size…', 'image-size'], ['Canvas size…', 'canvas-size'], ['Trim transparent edges', 'trim'], ['Flip canvas horizontally', 'flip-canvas-x'], ['Flip canvas vertically', 'flip-canvas-y'], ['Camera Raw Filter…', 'camera-raw'], ['Remove background', 'remove-background'], ['Auto levels', 'auto-levels'], ...ADJUSTMENT_KINDS.map((kind) => [`${kind}…`, `filter:${kind}`]), ...FINISHING.map((kind) => [`${kind}…`, `finishing:${kind}`])],
    Select: [['Select all', 'select:All'], ['Deselect', 'deselect'], ['Invert', 'select:Invert'], ['Expand…', 'select:Expand'], ['Contract…', 'select:Contract'], ['Feather…', 'select:Feather'], ['Move selection outline', 'move-selection-outline'], ['Move selected pixels', 'move-selection-pixels'], ['Duplicate selected pixels', 'duplicate-selection-pixels'], ['Select subject', 'select-subject'], ['Layer pixels', 'select-layer'], ['Layer mask', 'select-mask'], ['Color range…', 'color-range'], ['Content-aware fill', 'content-fill']],
    View: [['Rulers', 'rulers'], ['Grid', 'grid'], ['Grid settings…', 'grid-settings'], ['Pixel grid', 'pixel-grid'], ['Snap', 'snap'], ['Add guide…', 'add-guide'], ['Clear guides', 'clear-guides'], ['Keyboard shortcuts…', 'keyboard-shortcuts']],
  };
  menus.Select.splice(9, 0, ['Transform selected pixels', 'transform-selection'], ['Transform a copy of selected pixels', 'transform-selection-copy']);
  menus.View.push(['Recover unsaved projects', 'recover-projects']);
  menus.Layer.push(['Editable filters…', 'edit-filters']);
  menus.Filters = ADJUSTMENT_KINDS.map((kind) => [`${kind}…`, `editable-filter:${kind}`]);
  menus.Select.push(['Refine selection…', 'refine-selection']); menus.Layer.push(['Refine mask…', 'refine-mask']);
  menus.Image.push(['Export PSD…', 'export-psd'], ['Export PSB…', 'export-psb']);
  menus.Image.push(['Export WebP…', 'export-webp']);
  menus.Select.push(['Stroke selection…', 'stroke-selection']);
  menus.Layer.push(['Layer Fill…', 'layer-fill'], ['Edit live layer…', 'edit-live-layer']);
  menus.Filters.push(['Import LUT…', 'import-lut'], ['Save adjustment preset…', 'save-adjustment-preset'], ['Apply adjustment preset…', 'apply-adjustment-preset']);
  menus.Live = [...ADJUSTMENT_KINDS, 'Transform'].map((kind) => [kind + '…', 'live-filter:' + kind]);
  menus.Image.push(['Document color mode…', 'document-color-mode']); menus.Layer.push(['Channels…', 'channels']);
  menus.Image.push(['Perspective crop…', 'perspective-crop'], ['Collage…', 'collage']);
  menus.Image.push(['Import OpenRaster…', 'import-ora'], ['Export OpenRaster…', 'export-ora']);
  menus.Image.push(['Export original Photoshop…', 'export-photoshop-original']);
  menus.Extensions=[['Install image plugin…','install-image-plugin'],['Run image plugin…','run-image-plugin'],['Export to external filter…','external-filter-export'],['Import external filter result…','external-filter-import']];
  menus.View.push(['Check for updates…', 'check-updates']);
  menus.Image.push(['Import high-precision image…', 'import-precision'], ['Color management and TIFF export…', 'color-export'], ['Soft proof…', 'soft-proof'], ['Load ICC profile…', 'load-icc']); menus.Layer.push(['Rasterize editable filters…', 'rasterize-filters']);
  menus.View.push(['Pen and touch…', 'pen-settings']);
  menus.Layer.push(['Substitute missing fonts…', 'substitute-fonts']);
  menus.Filters.push(['Save filter preset…', 'save-filter-preset'], ['Apply filter preset…', 'apply-filter-preset']); menus.View.push(['History and snapshots…', 'history-panel'], ['Save snapshot…', 'save-snapshot']); menus.Image.push(['Batch export…', 'batch-export']);
  menus.View.push(['Record action…', 'record-action'], ['Stop recording', 'stop-action'], ['Run action…', 'play-action']);
  menus.Layer.push(['New gradient fill…', 'gradient-fill']);
  menus.Paths = [['New path', 'path-new'], ['New contour', 'path-contour'], ['Close / open path', 'path-close'], ['Smooth / corner point', 'path-smooth'], ['Delete point', 'path-delete'], ['Path style…', 'path-style'], ['Path to selection', 'path-selection'], ['Path to mask', 'path-mask'], ['Edit vector mask', 'edit-vector-mask'], ['Apply path', 'path-apply'], ['Cancel path', 'path-cancel']];
  menus.Image.push(['Import float32 HDR…', 'import-hdr'], ['Import OpenEXR…', 'import-exr'], ['HDR working space…', 'hdr-working-space'], ['Deep EXR preview…', 'deep-exr-preview'], ['Export original OpenEXR…', 'export-exr-original'], ['HDR display preview…', 'hdr-view'], ['Export float32 HDR TIFF…', 'export-hdr'], ['Export OpenEXR…', 'export-exr']); menus.Layer.push(['Rasterize HDR display…', 'rasterize-hdr']);
  menus.Objects = [['Convert to smart object', 'smart-convert'], ['Edit embedded content', 'smart-edit'], ['Apply content to parent', 'smart-apply-content'], ['Replace embedded PNG…', 'smart-replace'], ['Reset object transform', 'smart-reset'], ['Make object independent', 'smart-independent'], ['Rasterize smart object…', 'smart-rasterize']];
  for (const [name, entries] of Object.entries(menus)) {
    const details = document.createElement('details'), label = document.createElement('summary'); label.textContent = name; details.append(label);
    const dropdown = document.createElement('div'); dropdown.className = 'editor-menu-dropdown';
    for (const [title, command] of entries) { const button = document.createElement('button'); button.textContent = title; button.dataset.advanced = command; button.addEventListener('click', () => { details.open = false; api.runCommand(command); }); dropdown.append(button); }
    details.append(dropdown); menu.append(details);
    details.addEventListener('toggle', () => { if (details.open) menu.querySelectorAll('details').forEach((item) => { if (item !== details) item.open = false; }); });
  }
  document.querySelector('.tool-options').before(menu);
  document.addEventListener('pointerdown', (event) => { if (!menu.contains(event.target)) menu.querySelectorAll('details').forEach((details) => { details.open = false; }); });
  editor.editMask = false; editor.selectedIDs = new Set(); editor.grid = { spacing: 64, subdivisions: 8 }; editor.snapping = true;
  const select = editor.select.bind(editor);
  editor.select = (id, additive = false) => { if (!additive) editor.selectedIDs = new Set([id]); else { if (editor.selectedIDs.has(id)) editor.selectedIDs.delete(id); else editor.selectedIDs.add(id); } editor.editMask = false; select(id); };
  editor.duplicate = () => duplicateLayers(editor);
  installTools(editor, api);
  installDodgeBurn(editor, api);
  installTransforms(editor, api);
  editor.advancedCommand = async (command) => {
    if (!editor.manifest) return false;
    if (command === 'stroke-selection') { await selectionStrokeDialog(editor); return true; }
    const [action, kind] = command.split(':');
    if (action === 'adjust' || action === 'edit-adjustment') {
      const before = editor.snapshot();
      let layer = editor.active;
      if (action === 'edit-adjustment' && !layer?.adjustment) return true;
      if (action === 'adjust') { layer = createLayer(kind, editor.manifest.width, editor.manifest.height); layer.adjustment = adjustmentDefaults(kind); layer.parentID = editor.active?.parentID; editor.manifest.layers.push(layer); editor.manifest.activeLayerID = layer.id; }
      const result = await settingsDialog(layer.adjustment.kind, adjustmentFields(layer.adjustment.kind), editableAdjustment(layer.adjustment), (value) => { layer.adjustment = savedAdjustment(value); editor.update(); });
      if (!result) await editor.install(before);
      else { layer.adjustment = savedAdjustment(result); editor.history.push(before, editor.snapshot(), 'Adjustment Layer'); editor.update(); }
      return true;
    }
    if (action === 'effect') {
      const layer = editor.active; if (!layer || layer.isGroup) return true;
      const before = editor.snapshot(), initial = layer.effects?.[kind] ?? effectDefaults(kind); initial.color = { red: initial.red, green: initial.green, blue: initial.blue };
      const normalize = (value) => { const result = { ...value, ...value.color }; delete result.color; return result; };
      const result = await settingsDialog(kind, effectFields(kind), initial, (value) => { (layer.effects ??= {})[kind] = normalize(value); editor.update(); });
      if (!result) await editor.install(before); else { (layer.effects ??= {})[kind] = normalize(result); editor.history.push(before, editor.snapshot(), 'Layer Effects'); editor.update(); } return true;
    }
    if (action === 'filter' || action === 'finishing' || command === 'camera-raw') {
      const layer = editor.active, mask = editor.editMask, image = layer && (mask ? rasterTarget(editor, layer, true).source : editor.images.get(layer.id)); if (!image) return true;
      const before = editor.snapshot(), raw = command === 'camera-raw', initial = raw || action === 'finishing' ? {} : editableAdjustment(adjustmentDefaults(kind));
      const scale = Math.min(1, 1024 / Math.max(image.width, image.height)), source = mask ? maskToPixels(image) : image;
      const thumbnail = surface(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale))); thumbnail.getContext('2d').drawImage(source, 0, 0, thumbnail.width, thumbnail.height);
      const task = new FilterTask(), targetLayer = mask ? { ...layer, transform: layer.maskPlacement ?? layer.transform } : layer;
      let generation = 0, output, outputTarget, timer, resolveDelay;
      const cancelTask = () => { task.cancel(); clearTimeout(timer); resolveDelay?.(); resolveDelay = null; };
      const combine = (input, filtered) => editor.selection ? maskedChange(input, filtered, mappedSelection(editor, targetLayer, input.width, input.height)) : filtered;
      const limits = document.body.classList.contains('mobile-app') ? { side: 8192, pixels: 16000000 } : { side: 30000, pixels: 200000000 };
      const expandable = action === 'filter' && ['Gaussian Blur', 'Motion Blur'].includes(kind) && !mask && !editor.selection;
      const prepareInput = (value, full) => {
        if (!expandable || value.expandBounds === false) return { input: full ? source : thumbnail, scale: full ? 1 : scale, target: null };
        const angle = (value.motionAngle ?? 0) * Math.PI / 180, x = kind === 'Gaussian Blur' ? Math.ceil((value.blurRadius ?? 10) * 3) + 2 : Math.ceil(Math.abs(Math.cos(angle)) * (value.motionDistance ?? 10) / 2) + 2, y = kind === 'Gaussian Blur' ? x : Math.ceil(Math.abs(Math.sin(angle)) * (value.motionDistance ?? 10) / 2) + 2;
        const width = source.width + 2 * x, height = source.height + 2 * y; canvasSize(width, height);
        const used = documentPixels(editor); if (used - source.width * source.height + width * height > editor.pixelBudget) throw new Error('The filter exceeds the document pixel budget.');
        const factor = full ? 1 : Math.min(1, 1024 / Math.max(width, height)), input = surface(Math.max(1, Math.round(width * factor)), Math.max(1, Math.round(height * factor)));
        input.getContext('2d').drawImage(source, x * input.width / width, y * input.height / height, source.width * input.width / width, source.height * input.height / height);
        return { input, scale: factor, target: { ...rasterTarget(editor, layer), x: -x, y: -y, width, height, transform: resizedGrid(layer.transform, source.width, source.height, -x, -y, width, height) } };
      };
      const preview = async (value) => {
        const token = ++generation; cancelTask();
        await new Promise((resolve) => { resolveDelay = resolve; timer = setTimeout(resolve, 100); }); if (token !== generation) return;
        const prepared = prepareInput(value, false), filtered = await task.run(prepared.input, raw ? command : action, kind, value, prepared.scale, limits); if (token !== generation) return;
        const base = mask ? pixelsToMask(thumbnail) : thumbnail, pixels = mask ? pixelsToMask(filtered) : filtered;
        editor.rasterPreview = prepared.target ? { ...prepared.target, image: filtered, mask: grownLayerMask(editor, layer, prepared.target) } : { layerID: layer.id, isMask: mask, transform: structuredClone(targetLayer.transform), image: combine(base, pixels) }; editor.update();
      };
      try {
        const fields = raw ? cameraRawFields(image) : action === 'finishing' ? finishingFields(kind) : adjustmentFields(kind); if (expandable) fields.push(b('expandBounds', 'Expand filter bounds', true));
        const result = await settingsDialog(raw ? 'Camera Raw Filter' : kind, fields, initial, preview, {
          initialPreview: true,
          apply: async (value, signal) => {
            generation++; cancelTask();
            const prepared = prepareInput(value, true), filtered = await task.run(prepared.input, raw ? command : action, kind, value, 1, limits); if (signal.aborted) return;
            outputTarget = prepared.target; output = outputTarget ? filtered : combine(image, mask ? pixelsToMask(filtered) : filtered);
          },
          cancel: () => { generation++; cancelTask(); },
        });
        editor.rasterPreview = null;
        if (result && output) {
          try { if (mask) storeMask(editor, layer, output); else if (outputTarget) commitRaster(editor, outputTarget, output); else { editor.storePixels(layer, output); editor.rasterize(layer); } editor.history.push(before, editor.snapshot(), raw ? 'Camera Raw Filter' : kind); editor.recordAction?.({ type: 'filter', action: raw ? 'camera-raw' : action, kind, settings: result, mask }); }
          catch (error) { await editor.install(before); throw error; }
        }
      } finally { generation++; cancelTask(); editor.rasterPreview = null; editor.update(); }
      return true;
    }
    if (action === 'mask') { let amount = 5; if (kind.includes('Feather') || kind.includes('Blur')) { const result = await settingsDialog(kind, [n('amount', 'Radius', 0, 250, 5)], {}); if (!result) return true; amount = result.amount; } changeMask(editor, kind, amount); return true; }
    if (action === 'select') { let amount = 5; if (['Expand', 'Contract', 'Feather'].includes(kind)) { const result = await settingsDialog(kind, [n('amount', 'Radius', 0, 500, 5)], {}); if (!result) return true; amount = result.amount; } modifySelection(editor, kind, amount); return true; }
    switch (command) {
      case 'gradient-fill': {
        const value = await settingsDialog('Gradient fill with editable colors', [{ key: 'shape', label: 'Gradient shape', options: ['Linear', 'Radial'], default: 'Linear' }, colorField('start', 'Gradient start', colorRecord(editor.color)), colorField('end', 'Gradient end', { red: 1, green: 1, blue: 1 }), n('opacity', 'Opacity', 0, 100, 100)], {}); if (!value) return true;
        const source = surface(256, value.shape === 'Radial' ? 256 : 1), ctx = source.getContext('2d'), gradient = value.shape === 'Radial' ? ctx.createRadialGradient(128, 128, 0, 128, 128, 128) : ctx.createLinearGradient(0, 0, 256, 0); gradient.addColorStop(0, '#000'); gradient.addColorStop(1, '#fff'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, source.width, source.height);
        const adjustment = adjustmentDefaults('Gradient Map'); adjustment.gradientMapSettings = { shadows: value.start, highlights: value.end, reversed: false };
        const output = applyAdjustment(source, adjustment); if (documentPixels(editor) + source.width * source.height * 2 > editor.pixelBudget) throw new Error('The editable filter source exceeds the document pixel budget.');
        editor.mutate('Gradient Fill', () => { const layer = createLayer('Gradient Fill', editor.manifest.width, editor.manifest.height); layer.opacity = value.opacity / 100; editor.storePixels(layer, output); layer.filterSourceFile = `${layer.id}.source.png`; editor.assets[layer.filterSourceFile] = source.toDataURL('image/png').split(',')[1]; layer.filters = [{ id: crypto.randomUUID().toUpperCase(), enabled: true, adjustment }]; editor.manifest.layers.push(layer); editor.manifest.activeLayerID = layer.id; }); return true;
      }
      case 'auto-levels': { const layer = editor.active, image = layer && editor.images.get(layer.id); if (image) editor.mutate('Auto Levels', () => { editor.storePixels(layer, applyAdjustment(image, automaticLevels(image))); editor.rasterize(layer); }); return true; }
      case 'select-subject': case 'remove-background': {
        const layer = editor.active, image = command === 'select-subject' ? editor.composite(true) : layer && editor.images.get(layer.id); if (!image) return true;
        const mask = await subjectMask(image);
        if (command === 'select-subject') { const { combineSelection } = await import('./masks.js'); combineSelection(editor, mask); }
        else editor.mutate('Remove Background', () => { const output = copySurface(image), context = output.getContext('2d'); context.globalCompositeOperation = 'destination-in'; context.drawImage(mask, 0, 0); editor.storePixels(layer, output); editor.rasterize(layer); }); return true;
      }
      case 'edit-mask': editor.editMask = !!editor.active?.maskFile; editor.update(false); return true;
      case 'edit-image': editor.editMask = false; editor.update(false); return true;
      case 'group': groupLayers(editor); return true;
      case 'ungroup': ungroupLayers(editor); return true;
      case 'merge': mergeLayers(editor); return true;
      case 'merge-down': mergeLayers(editor, true); return true;
      case 'remove-effects': editor.mutate('Remove Effects', () => { if (editor.active) delete editor.active.effects; }); return true;
      case 'clip': editor.mutate('Clipping Mask', () => createClipping(editor)); return true;
      case 'unclip': editor.mutate('Release Clipping Mask', () => releaseClipping(editor)); return true;
      case 'image-size': case 'canvas-size': {
        const result = await settingsDialog(command === 'image-size' ? 'Image Size' : 'Canvas Size', [n('width', 'Width', 1, 30000, editor.manifest.width), n('height', 'Height', 1, 30000, editor.manifest.height), n('resolution', 'Resolution (ppi)', 1, 9600, editor.manifest.resolution ?? 72), { key: 'anchor', label: 'Anchor', options: ['Center', 'Top Left', 'Top Right', 'Bottom Left', 'Bottom Right'], default: 'Center' }], {});
        if (result) { canvasSize(result.width, result.height); resizeDocument(editor, result.width, result.height, command === 'image-size', result.anchor); editor.mutate('Resolution', () => { editor.manifest.resolution = result.resolution; }); editor.recordAction?.({ type: 'resize', kind: command, settings: result }); } return true;
      }
      case 'trim': trimDocument(editor); return true;
      case 'flip-canvas-x': case 'flip-canvas-y': flipCanvas(editor, command.endsWith('x')); editor.recordAction?.({ type: 'flip-canvas', axis: command.endsWith('x') ? 'x' : 'y' }); return true;
      case 'grid': editor.showsGrid = !editor.showsGrid; editor.draw(); return true;
      case 'pixel-grid': editor.showsPixelGrid = !editor.showsPixelGrid; editor.draw(); return true;
      case 'rulers': editor.showsRulers = !editor.showsRulers; editor.draw(); return true;
      case 'snap': editor.snapping = !editor.snapping; return true;
      case 'grid-settings': { const result = await settingsDialog('Grid Settings', [n('spacing', 'Spacing', 1, 10000, 64), n('subdivisions', 'Subdivisions', 1, 100, 8)], editor.grid); if (result) { editor.grid = result; editor.showsGrid = true; editor.draw(); } return true; }
      case 'add-guide': { const result = await settingsDialog('Add Guide', [{ key: 'axis', label: 'Direction', options: ['horizontal', 'vertical'], default: 'horizontal' }, n('position', 'Position', -1000000, 1000000, 0)], {}); if (result) editor.mutate('Add Guide', () => { (editor.manifest.guides ??= []).push({ id: crypto.randomUUID().toUpperCase(), ...result }); }); return true; }
      case 'clear-guides': editor.mutate('Clear Guides', () => { editor.manifest.guides = []; }); return true;
      default: return await editor.toolCommand?.(command) ?? false;
    }
  };
  installWorkspace(editor, api);
  installLayerDrag(editor, api);
  installLayerUI(editor, api);
  installInlineText(editor, api);
  installGradient(editor, api);
  installSelectionEdits(editor, api);
  installFloatingSelection(editor, api);
  installFilterStack(editor, api);
  installMaskRefinement(editor, api);
  installPhotoshopExport(editor, api);
  installColorWorkflows(editor, api);
  installPenInput(editor, api);
  installFontManager(editor, api);
  installProductivity(editor, api);
  installActions(editor, api);
  installPathEditor(editor, api);
  installHDR(editor, api);
  installSmartObjects(editor, api);
  installProfessionalWorkflows(editor, api);
  installChannelWorkflows(editor, api);
  installLayoutWorkflows(editor, api);
  installInterchangeWorkflows(editor, api);
  installExtensionWorkflows(editor, api);
  installUpdateNotes(editor, api);
  installShortcuts(editor, api);
}
