import { canvasSize, documentPoint, localPoint, documentPixels } from './core.js';
import { surface, copySurface } from './raster.js';
import { selectionCanvas } from './masks.js';
import { inverse } from './affine.js';
import { warpImage } from './transforms.js';
import { alphaBounds, pixelMatrix, rasterTarget, resizedGrid, grownLayerMask, commitRaster } from './raster-space.js';

const units = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
function validCorners(corners) {
  if (corners.length !== 4 || corners.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) throw new Error('The distortion corners overlap.');
  const turns = corners.map((p, i) => { const q = corners[(i + 1) % 4], r = corners[(i + 2) % 4]; return (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x); });
  if (turns.some((turn) => Math.abs(turn) < .01 || Math.sign(turn) !== Math.sign(turns[0]))) throw new Error('The distortion corners overlap.');
}

export function installFloatingSelection(editor, api) {
  let draft = null, drag = null;
  const bar = document.createElement('div'); bar.className = 'selection-transform-controls'; bar.hidden = true;
  const mode = document.createElement('select'); mode.setAttribute('aria-label', 'Selection transform mode');
  for (const name of ['Scale', 'Rotate', 'Free Distort']) { const option = document.createElement('option'); option.value = name; option.textContent = name; mode.append(option); }
  const apply = document.createElement('button'); apply.textContent = 'Apply transform';
  const cancel = document.createElement('button'); cancel.textContent = 'Cancel transform';
  apply.addEventListener('click', () => { try { finish(true); } catch (error) { api.showError(error); } }); cancel.addEventListener('click', () => finish(false));
  bar.append(mode, apply, cancel); document.querySelector('.tool-options').after(bar);
  function begin(duplicate = false) {
    if (draft || editor.busy || editor.gesture || !editor.selection) return false;
    editor.gradient?.finish(true); if (editor.inlineText?.finish(true) === false) return false;
    const layer = editor.active, source = layer && editor.images.get(layer.id);
    if (!source || editor.editMask || layer.isGroup || layer.adjustment) return false;
    const target = rasterTarget(editor, layer), coverage = surface(source.width, source.height), context = coverage.getContext('2d');
    context.setTransform(...inverse(pixelMatrix(layer.transform, source.width, source.height))); context.drawImage(selectionCanvas(editor), 0, 0);
    const bounds = alphaBounds(coverage); if (!bounds) return false;
    const lifted = copySurface(source); lifted.getContext('2d').globalCompositeOperation = 'destination-in'; lifted.getContext('2d').drawImage(coverage, 0, 0);
    if (!alphaBounds(lifted)) return false;
    const pixels = surface(bounds.width, bounds.height), clip = surface(bounds.width, bounds.height);
    pixels.getContext('2d').drawImage(lifted, -bounds.x, -bounds.y); clip.getContext('2d').drawImage(coverage, -bounds.x, -bounds.y);
    const base = copySurface(source); if (!duplicate) { const ctx = base.getContext('2d'); ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(coverage, 0, 0); }
    const transform = resizedGrid(target.original, source.width, source.height, bounds.x, bounds.y, bounds.width, bounds.height), corners = units.map((point) => documentPoint(point, transform));
    api.setTool('move'); draft = { target, before: editor.snapshot(), layer, pixels, clip, base, duplicate, corners, original: structuredClone(corners) };
    editor.floatingDraft = draft; bar.hidden = false; editor.update(); return true;
  }
  const changed = () => draft.corners.some((p, i) => Math.hypot(p.x - draft.original[i].x, p.y - draft.original[i].y) > 1e-7);
  function renderPixels(full) {
    const target = draft.target, corners = draft.corners.map((p) => localPoint(p, target.original, target.originalWidth, target.originalHeight)); validCorners(corners);
    const left = Math.floor(Math.min(0, ...corners.map((p) => p.x))), top = Math.floor(Math.min(0, ...corners.map((p) => p.y)));
    const width = Math.ceil(Math.max(target.originalWidth, ...corners.map((p) => p.x))) - left, height = Math.ceil(Math.max(target.originalHeight, ...corners.map((p) => p.y))) - top;
    canvasSize(width, height);
    const used = documentPixels(editor);
    const mask = editor.masks.get(draft.layer.id), maskGrowth = mask && !draft.layer.maskPlacement ? width * height - mask.width * mask.height : 0;
    if (used - target.originalWidth * target.originalHeight + width * height + Math.max(0, maskGrowth) > editor.pixelBudget) throw new Error('The transformed selection exceeds the document pixel budget.');
    const scale = full ? 1 : Math.min(1, 1024 / Math.max(width, height)), image = surface(Math.ceil(width * scale), Math.ceil(height * scale)), ctx = image.getContext('2d');
    const sx = image.width / width, sy = image.height / height;
    const warped = warpImage(draft.pixels, corners.map((p) => ({ x: (p.x - left) * sx, y: (p.y - top) * sy })));
    ctx.drawImage(draft.base, -left * sx, -top * sy, target.originalWidth * sx, target.originalHeight * sy); ctx.drawImage(warped.image, ...warped.origin);
    return { ...target, x: left, y: top, width, height, transform: resizedGrid(target.original, target.originalWidth, target.originalHeight, left, top, width, height), image };
  }
  function refresh() {
    if (!draft) return;
    if (!changed()) editor.rasterPreview = null;
    else { const result = renderPixels(false); editor.rasterPreview = { ...result, mask: grownLayerMask(editor, draft.layer, result) }; }
    editor.update();
  }
  function setCorners(corners) {
    if (!draft) return;
    validCorners(corners); const before = draft.corners; draft.corners = structuredClone(corners);
    try { refresh(); } catch (error) { draft.corners = before; throw error; }
  }
  const mutate = editor.mutate.bind(editor);
  function finish(commit) {
    if (!draft) return;
    if (commit && changed()) {
      const result = renderPixels(true), moved = warpImage(draft.clip, draft.corners), current = draft;
      draft = null; editor.floatingDraft = null; editor.rasterPreview = null; editor.gesture = null; drag = null;
      try { mutate(current.duplicate ? 'Transform Duplicated Pixels' : 'Transform Selected Pixels', () => {
        commitRaster(editor, result, result.image);
        editor.selection = { x: moved.origin[0], y: moved.origin[1], width: moved.size[0], height: moved.size[1], coverage: moved.image, offsetX: moved.origin[0], offsetY: moved.origin[1] };
      }, { followMasks: false }); }
      catch (error) { draft = current; editor.floatingDraft = draft; refresh(); throw error; }
    } else { draft = null; editor.floatingDraft = null; editor.rasterPreview = null; if (drag) editor.gesture = null; drag = null; editor.update(); }
    bar.hidden = true;
  }
  editor.floatingSelection = {
    begin, finish, setCorners,
    capture() { return draft ? { layerID: draft.layer.id, duplicate: draft.duplicate, corners: structuredClone(draft.corners) } : null; },
    restore(value) { editor.manifest.activeLayerID = value.layerID; if (!begin(value.duplicate)) throw new Error('This recovery draft could not be opened.'); setCorners(value.corners); },
  };
  editor.mutate = (...args) => { finish(true); return mutate(...args); };
  const select = editor.select.bind(editor), create = editor.newCanvas.bind(editor);
  editor.select = (...args) => { finish(true); return select(...args); };
  editor.newCanvas = (...args) => { finish(true); return create(...args); };
  const previous = editor.advancedCommand;
  editor.advancedCommand = async (command) => {
    if (command === 'transform-selection' || command === 'transform-selection-copy') { begin(command.endsWith('-copy')); return true; }
    if (draft && command === 'undo') { finish(false); return true; }
    if (!['zoom-in', 'zoom-out', 'fit', 'actual'].includes(command)) finish(true);
    return previous(command);
  };
  const down = editor.pointerDown.bind(editor), move = editor.pointerMove.bind(editor), up = editor.pointerUp.bind(editor), cancelGesture = editor.cancelGesture.bind(editor), render = editor.render.bind(editor);
  const center = (corners) => ({ x: corners.reduce((sum, p) => sum + p.x, 0) / 4, y: corners.reduce((sum, p) => sum + p.y, 0) / 4 });
  function rotationHandle() {
    const c = center(draft.corners), a = draft.corners[0], b = draft.corners[1], x = (a.x + b.x) / 2, y = (a.y + b.y) / 2, distance = Math.hypot(x - c.x, y - c.y) || 1;
    return { x: x + (x - c.x) / distance * 28 / editor.zoom, y: y + (y - c.y) / distance * 28 / editor.zoom };
  }
  editor.pointerDown = (event) => {
    if (!draft || editor.spaceDown || event.button !== 0) return down(event);
    if (editor.busy || editor.gesture || document.querySelector('dialog[open]')) return;
    const point = editor.toDocument(editor.viewPoint(event)), threshold = (event.pointerType === 'touch' ? 22 : 9) / editor.zoom;
    const index = draft.corners.findIndex((p) => Math.hypot(p.x - point.x, p.y - point.y) < threshold), handle = rotationHandle();
    const rotating = Math.hypot(handle.x - point.x, handle.y - point.y) < threshold;
    drag = { point, index, corners: structuredClone(draft.corners), mode: rotating || mode.value === 'Rotate' ? 'Rotate' : event.ctrlKey || event.metaKey ? 'Free Distort' : mode.value };
    editor.viewport.focus(); editor.gesture = { kind: 'floating-selection' }; editor.overlay.setPointerCapture(event.pointerId); event.preventDefault();
  };
  editor.pointerMove = (event) => {
    if (!drag) return move(event);
    const point = editor.toDocument(editor.viewPoint(event)), start = drag.corners, c = center(start); let next;
    if (drag.mode === 'Rotate') {
      let angle = Math.atan2(point.y - c.y, point.x - c.x) - Math.atan2(drag.point.y - c.y, drag.point.x - c.x); if (event.shiftKey) angle = Math.round(angle / (Math.PI / 12)) * Math.PI / 12;
      next = start.map((p) => ({ x: c.x + (p.x - c.x) * Math.cos(angle) - (p.y - c.y) * Math.sin(angle), y: c.y + (p.x - c.x) * Math.sin(angle) + (p.y - c.y) * Math.cos(angle) }));
    } else if (drag.index < 0) next = start.map((p) => ({ x: p.x + point.x - drag.point.x, y: p.y + point.y - drag.point.y }));
    else if (drag.mode === 'Free Distort') { next = structuredClone(start); next[drag.index] = point; }
    else {
      const anchor = start[(drag.index + 2) % 4], picked = start[drag.index], angle = Math.atan2(start[1].y - start[0].y, start[1].x - start[0].x), cos = Math.cos(angle), sin = Math.sin(angle);
      const local = (p) => ({ x: (p.x - anchor.x) * cos + (p.y - anchor.y) * sin, y: -(p.x - anchor.x) * sin + (p.y - anchor.y) * cos });
      const from = local(picked), to = local(point); let sx = Math.abs(from.x) > .001 ? to.x / from.x : 1, sy = Math.abs(from.y) > .001 ? to.y / from.y : 1;
      if (event.shiftKey || editor.lockTransformAspect) sy = Math.sign(sy || 1) * Math.abs(sx);
      if (Math.abs(sx) < .001 || Math.abs(sy) < .001) return;
      next = start.map((p) => { const q = local(p); return { x: anchor.x + q.x * sx * cos - q.y * sy * sin, y: anchor.y + q.x * sx * sin + q.y * sy * cos }; });
    }
    try { setCorners(next); } catch { /* Keep the last valid preview while handles cross or exceed the pixel budget. */ }
  };
  editor.pointerUp = (event) => { if (!drag) return up(event); editor.pointerMove(event); drag = null; editor.gesture = null; if (editor.overlay.hasPointerCapture(event.pointerId)) editor.overlay.releasePointerCapture(event.pointerId); editor.update(false); };
  editor.cancelGesture = () => { if (!drag) return cancelGesture(); const corners = drag.corners; drag = null; editor.gesture = null; setCorners(corners); };
  editor.render = () => {
    render(); if (!draft) return;
    const ctx = editor.overlay.getContext('2d'), handle = rotationHandle(); ctx.save(); ctx.translate(editor.pan.x, editor.pan.y); ctx.scale(editor.zoom, editor.zoom); ctx.lineWidth = 1 / editor.zoom; ctx.strokeStyle = '#d8d8dc'; ctx.fillStyle = '#303034';
    ctx.beginPath(); draft.corners.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke();
    for (const p of [...draft.corners, handle]) { ctx.beginPath(); ctx.arc(p.x, p.y, 5 / editor.zoom, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); } ctx.restore();
  };
  document.addEventListener('keydown', (event) => {
    if (!draft || event.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || document.querySelector('dialog[open]')) return;
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!delta && !['Enter', 'Escape'].includes(event.key)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    try { if (delta) { const step = event.shiftKey ? 10 : 1; setCorners(draft.corners.map((p) => ({ x: p.x + delta[0] * step, y: p.y + delta[1] * step }))); } else finish(event.key === 'Enter'); } catch (error) { api.showError(error); }
  }, true);
}
