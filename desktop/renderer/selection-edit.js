import { canvasSize, localPoint } from './core.js';
import { surface, copySurface } from './raster.js';
import { selectionCanvas } from './masks.js';
import { inverse } from './affine.js';
import { alphaBounds, pixelMatrix, rasterTarget, resizedGrid, grownLayerMask, commitRaster } from './raster-space.js';

const selectionTools = ['marquee', 'ellipse', 'lasso', 'polygon', 'wand', 'object'];
export function shiftedSelection(selection, dx, dy) {
  const next = { ...selection, x: selection.x + dx, y: selection.y + dy };
  if (selection.coverage) { next.offsetX = (selection.offsetX ?? 0) + dx; next.offsetY = (selection.offsetY ?? 0) + dy; }
  if (selection.points) next.points = selection.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
  return next;
}
export function selectionContains(editor, point) {
  const selected = editor.selection; if (!selected || selected.width <= 0 || selected.height <= 0) return false;
  if (point.x < selected.x || point.y < selected.y || point.x >= selected.x + selected.width || point.y >= selected.y + selected.height) return false;
  const canvas = selected.coverage ?? selectionCanvas(editor), x = Math.floor(point.x - (selected.coverage ? selected.offsetX ?? 0 : 0)), y = Math.floor(point.y - (selected.coverage ? selected.offsetY ?? 0 : 0));
  return x >= 0 && y >= 0 && x < canvas.width && y < canvas.height && canvas.getContext('2d').getImageData(x, y, 1, 1).data[3] >= 128;
}
export function installSelectionEdits(editor, api) {
  let drag = null;
  const actionControl = document.createElement('select'); actionControl.id = 'selection-drag-mode'; actionControl.setAttribute('aria-label', 'Selection drag'); actionControl.hidden = true;
  for (const name of ['Auto', 'Outline', 'Move pixels', 'Duplicate pixels']) { const option = document.createElement('option'); option.value = name; option.textContent = name; actionControl.append(option); }
  actionControl.addEventListener('change', () => { editor.selectionDragMode = actionControl.value; }); document.querySelector('.tool-settings').before(actionControl);
  const begin = (point, action) => {
    const selection = editor.selection; if (!selection || !selection.width || !selection.height) return false;
    const before = editor.snapshot();
    if (action === 'Outline') drag = { before, point, action, dx: 0, dy: 0 };
    else {
      const layer = editor.active, source = layer && editor.images.get(layer.id); if (!source || editor.editMask || layer.isGroup || layer.adjustment) return false;
      const target = rasterTarget(editor, layer), clip = surface(source.width, source.height), context = clip.getContext('2d');
      context.setTransform(...inverse(pixelMatrix(layer.transform, source.width, source.height))); context.drawImage(selectionCanvas(editor), 0, 0);
      const lifted = copySurface(source), liftedContext = lifted.getContext('2d'); liftedContext.globalCompositeOperation = 'destination-in'; liftedContext.drawImage(clip, 0, 0);
      const bounds = alphaBounds(lifted); if (!bounds) return false;
      const pixels = surface(bounds.width, bounds.height); pixels.getContext('2d').drawImage(lifted, -bounds.x, -bounds.y);
      const base = copySurface(source); if (action !== 'Duplicate pixels') { const context = base.getContext('2d'); context.globalCompositeOperation = 'destination-out'; context.drawImage(clip, 0, 0); }
      drag = { before, point, action, target, pixels, base, bounds, layer, dx: 0, dy: 0 };
    }
    editor.gesture = { kind: 'selection-edit' }; return true;
  };
  function preview(dx, dy) {
    if (!drag) return;
    drag.dx = Math.round(dx); drag.dy = Math.round(dy); editor.selection = shiftedSelection(drag.before.selection, drag.dx, drag.dy);
    if (drag.target) {
      const target = drag.target, origin = localPoint({ x: 0, y: 0 }, target.original, target.originalWidth, target.originalHeight), shifted = localPoint({ x: drag.dx, y: drag.dy }, target.original, target.originalWidth, target.originalHeight);
      const x = drag.bounds.x + shifted.x - origin.x, y = drag.bounds.y + shifted.y - origin.y;
      const left = Math.floor(Math.min(0, x)), top = Math.floor(Math.min(0, y)), width = Math.ceil(Math.max(target.originalWidth, x + drag.bounds.width)) - left, height = Math.ceil(Math.max(target.originalHeight, y + drag.bounds.height)) - top;
      canvasSize(width, height);
      const image = surface(width, height), context = image.getContext('2d'); context.drawImage(drag.base, -left, -top); context.drawImage(drag.pixels, x - left, y - top);
      drag.result = { ...target, x: left, y: top, width, height, transform: resizedGrid(target.original, target.originalWidth, target.originalHeight, left, top, width, height), image };
      editor.rasterPreview = { ...drag.result, mask: grownLayerMask(editor, drag.layer, drag.result) };
    }
    editor.update();
  }
  function finish(commit) {
    if (!drag) return;
    const current = drag, moved = editor.selection; drag = null; editor.gesture = null; editor.rasterPreview = null; editor.selection = current.before.selection;
    if (commit && (current.dx || current.dy)) editor.mutate(current.action === 'Outline' ? 'Move Selection' : current.action === 'Duplicate pixels' ? 'Duplicate Pixels' : 'Move Pixels', () => {
      if (current.result) commitRaster(editor, current.result, current.result.image); editor.selection = moved;
    }, { followMasks: false });
    else editor.update();
  }
  editor.selectionEdits = { nudge(dx, dy, action = 'Outline') { editor.gradient?.finish(true); if (begin({ x: 0, y: 0 }, action)) { try { preview(dx, dy); finish(true); } catch (error) { finish(false); throw error; } } } };
  const down = editor.pointerDown.bind(editor), move = editor.pointerMove.bind(editor), up = editor.pointerUp.bind(editor), cancel = editor.cancelGesture.bind(editor);
  editor.pointerDown = (event) => {
    if (!editor.manifest || editor.busy || editor.gesture || editor.spaceDown || event.button !== 0 || editor.polygon || document.querySelector('dialog[open]') || (!selectionTools.includes(editor.tool) && editor.tool !== 'move')) return down(event);
    const point = editor.toDocument(editor.viewPoint(event)); if (!selectionContains(editor, point)) return down(event);
    const modifierMove = event.ctrlKey || event.metaKey;
    if (!modifierMove && (!editor.selectionDragMode || editor.selectionDragMode === 'Auto') && selectionTools.includes(editor.tool) && (event.shiftKey || event.altKey || editor.selectionMode && editor.selectionMode !== 'replace')) return down(event);
    let action = editor.selectionDragMode ?? 'Auto'; if (action === 'Auto') action = modifierMove || editor.tool === 'move' ? event.altKey ? 'Duplicate pixels' : 'Move pixels' : 'Outline';
    if (modifierMove) action = event.altKey ? 'Duplicate pixels' : 'Move pixels';
    if (begin(point, action)) { editor.viewport.focus(); editor.overlay.setPointerCapture(event.pointerId); }
  };
  editor.pointerMove = (event) => {
    if (!drag) return move(event);
    const point = editor.toDocument(editor.viewPoint(event)); let dx = point.x - drag.point.x, dy = point.y - drag.point.y;
    if (event.shiftKey) { if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0; }
    try { preview(dx, dy); } catch (error) { finish(false); api.showError(error); }
  };
  editor.pointerUp = (event) => { if (!drag) return up(event); editor.pointerMove(event); finish(true); if (editor.overlay.hasPointerCapture(event.pointerId)) editor.overlay.releasePointerCapture(event.pointerId); };
  editor.cancelGesture = () => { if (drag) finish(false); else cancel(); };
  const previous = editor.advancedCommand;
  editor.advancedCommand = async (command) => {
    const action = { 'move-selection-outline': 'Outline', 'move-selection-pixels': 'Move pixels', 'duplicate-selection-pixels': 'Duplicate pixels' }[command];
    if (action) { editor.gradient?.finish(true); editor.selectionDragMode = action; editor.selectionMode = 'replace'; api.setTool(action === 'Outline' ? 'marquee' : 'move'); return true; }
    return await previous(command);
  };
  document.addEventListener('keydown', (event) => {
    if (event.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || document.querySelector('dialog[open]')) return;
    if (event.key === 'Escape' && drag) { event.preventDefault(); event.stopImmediatePropagation(); finish(false); return; }
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!delta || !editor.selection || editor.gesture || editor.floatingDraft || (!selectionTools.includes(editor.tool) && editor.tool !== 'move')) return;
    event.preventDefault(); event.stopImmediatePropagation(); const step = event.shiftKey ? 10 : 1;
    let action = editor.selectionDragMode ?? 'Auto'; if (action === 'Auto') action = event.ctrlKey || event.metaKey || editor.tool === 'move' ? event.altKey ? 'Duplicate pixels' : 'Move pixels' : 'Outline';
    try { editor.selectionEdits.nudge(delta[0] * step, delta[1] * step, action); } catch (error) { api.showError(error); }
  }, true);
  const render = editor.render.bind(editor); editor.render = () => { actionControl.hidden = !editor.selection || (!selectionTools.includes(editor.tool) && editor.tool !== 'move'); actionControl.value = editor.selectionDragMode ?? 'Auto'; render(); };
}
