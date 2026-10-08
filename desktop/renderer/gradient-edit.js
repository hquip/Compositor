import { surface, colorCSS } from './raster.js';
import { selectionCanvas } from './masks.js';
import { rasterTarget, rasterBase, pixelMatrix, commitRaster, grownLayerMask } from './raster-space.js';
import { inverse } from './affine.js';
import { settingsDialog, numberField, boolField, colorField } from './settings-dialog.js';

export function installGradient(editor, api) {
  let draft = null, drag = null;
  const settings = { shape: 'Linear', style: 'Foreground to Transparent', reversed: false, opacity: 100, background: { red: 1, green: 1, blue: 1 } };
  const bar = document.createElement('div'); bar.className = 'gradient-controls'; bar.hidden = true;
  const shape = document.createElement('select'); shape.setAttribute('aria-label', 'Gradient shape');
  for (const name of ['Linear', 'Radial']) { const option = document.createElement('option'); option.value = name; option.textContent = name; shape.append(option); }
  const style = document.createElement('select'); style.setAttribute('aria-label', 'Gradient style');
  for (const name of ['Foreground to Transparent', 'Foreground to Background']) { const option = document.createElement('option'); option.value = name; option.textContent = name; style.append(option); }
  const apply = document.createElement('button'); apply.textContent = 'Apply gradient'; apply.addEventListener('click', () => { try { finish(true); } catch (error) { api.showError(error); } });
  const cancel = document.createElement('button'); cancel.textContent = 'Cancel gradient'; cancel.addEventListener('click', () => finish(false));
  bar.append(shape, style, apply, cancel); document.querySelector('.tool-options').after(bar);
  const paint = (scale = 1) => {
    const { target, start, end, clip } = draft, canvas = rasterBase(target, scale), fill = surface(canvas.width, canvas.height), ctx = fill.getContext('2d');
    ctx.setTransform(...inverse(pixelMatrix(target.transform, canvas.width, canvas.height)));
    const gradient = settings.shape === 'Radial' ? ctx.createRadialGradient(start.x, start.y, 0, start.x, start.y, Math.max(.001, Math.hypot(end.x - start.x, end.y - start.y))) : ctx.createLinearGradient(start.x, start.y, end.x, end.y);
    let foreground = editor.color, background = settings.style === 'Foreground to Transparent' ? foreground + '00' : colorCSS(settings.background);
    if (target.isMask) { const gray = parseInt(foreground.slice(1, 3), 16); foreground = `rgb(${gray},${gray},${gray})`; const value = Math.round(settings.background.red * 255); background = settings.style === 'Foreground to Transparent' ? `rgba(${gray},${gray},${gray},0)` : `rgb(${value},${value},${value})`; }
    const colors = settings.reversed ? [background, foreground] : [foreground, background]; gradient.addColorStop(0, colors[0]); gradient.addColorStop(1, colors[1]); ctx.fillStyle = gradient; ctx.globalAlpha = settings.opacity / 100;
    ctx.fillRect(0, 0, editor.manifest.width, editor.manifest.height);
    if (clip) { ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(clip, 0, 0); }
    const context = canvas.getContext('2d');
    if (target.isMask) {
      const original = context.getImageData(0, 0, canvas.width, canvas.height), changed = fill.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < original.data.length; i += 4) { const amount = changed.data[i + 3] / 255; original.data[i] = original.data[i + 1] = original.data[i + 2] = 255; original.data[i + 3] = Math.round(original.data[i + 3] * (1 - amount) + changed.data[i] * amount); }
      context.putImageData(original, 0, 0);
    } else context.drawImage(fill, 0, 0);
    return canvas;
  };
  function refresh() {
    if (!draft || Math.hypot(draft.end.x - draft.start.x, draft.end.y - draft.start.y) < .5) { editor.rasterPreview = null; editor.update(); return; }
    const scale = Math.min(1, 1536 / Math.max(draft.target.width, draft.target.height)), layer = editor.manifest.layers.find((item) => item.id === draft.target.layerID);
    editor.rasterPreview = { ...draft.target, image: paint(scale), mask: draft.target.isMask ? null : grownLayerMask(editor, layer, draft.target) }; editor.update();
  }
  const mutate = editor.mutate.bind(editor);
  function finish(commit) {
    if (!draft) return;
    if (drag) { editor.gesture = null; drag = null; }
    if (!commit || Math.hypot(draft.end.x - draft.start.x, draft.end.y - draft.start.y) < .5) { draft = null; editor.gradientDraft = null; editor.rasterPreview = null; editor.update(); return; }
    const current = draft, image = paint(); draft = null; editor.gradientDraft = null; editor.rasterPreview = null;
    try { mutate(current.target.isMask ? 'Gradient Mask' : 'Gradient', () => commitRaster(editor, current.target, image), { followMasks: false }); }
    catch (error) { draft = current; editor.gradientDraft = draft; refresh(); throw error; }
  }
  editor.gradient = {
    get pending() { return !!draft; }, settings, refresh, finish,
    capture() { return draft ? { start: draft.start, end: draft.end, layerID: draft.target.layerID, isMask: draft.target.isMask, color: editor.color, settings: structuredClone(settings) } : null; },
    restore(value) {
      const layer = editor.manifest.layers.find((item) => item.id === value.layerID); if (!layer) throw new Error('This recovery draft could not be opened.');
      Object.assign(settings, value.settings); editor.color = value.color; editor.editMask = value.isMask; editor.manifest.activeLayerID = layer.id;
      const selection = editor.selection, region = selection ? { x: Math.max(0, selection.x), y: Math.max(0, selection.y), width: Math.max(0, Math.min(editor.manifest.width, selection.x + selection.width) - Math.max(0, selection.x)), height: Math.max(0, Math.min(editor.manifest.height, selection.y + selection.height) - Math.max(0, selection.y)) } : { x: 0, y: 0, width: editor.manifest.width, height: editor.manifest.height };
      draft = { target: rasterTarget(editor, layer, value.isMask, region), clip: selection ? selectionCanvas(editor) : null, start: value.start, end: value.end }; editor.gradientDraft = draft;
      shape.value = settings.shape; style.value = settings.style; refresh();
    },
  };
  editor.mutate = (...args) => { finish(true); return mutate(...args); };
  const select = editor.select.bind(editor); editor.select = (...args) => { finish(true); return select(...args); };
  const down = editor.pointerDown.bind(editor), move = editor.pointerMove.bind(editor), up = editor.pointerUp.bind(editor), cancelGesture = editor.cancelGesture.bind(editor);
  editor.pointerDown = (event) => {
    if (editor.spaceDown || event.button !== 0) return down(event);
    if (editor.tool !== 'gradient') { finish(true); return down(event); }
    if (!editor.manifest || editor.busy || editor.gesture || document.querySelector('dialog[open]')) return;
    const layer = editor.active; if (!layer || (layer.isGroup && !editor.editMask) || layer.adjustment && !editor.editMask || editor.selection?.width === 0 || editor.selection?.height === 0) return;
    if (editor.editMask && (!editor.masks.has(layer.id) || layer.maskEnabled === false)) return;
    editor.viewport.focus();
    const point = editor.toDocument(editor.viewPoint(event));
    if (!draft || draft.target.layerID !== layer.id || draft.target.isMask !== editor.editMask) {
      finish(true); const selection = editor.selection, region = selection ? { x: Math.max(0, selection.x), y: Math.max(0, selection.y), width: Math.max(0, Math.min(editor.manifest.width, selection.x + selection.width) - Math.max(0, selection.x)), height: Math.max(0, Math.min(editor.manifest.height, selection.y + selection.height) - Math.max(0, selection.y)) } : { x: 0, y: 0, width: editor.manifest.width, height: editor.manifest.height };
      draft = { target: rasterTarget(editor, layer, editor.editMask, region), clip: selection ? selectionCanvas(editor) : null, start: point, end: point };
      drag = { endpoint: 'end', before: null };
    } else {
      const threshold = (event.pointerType === 'touch' ? 24 : 10) / editor.zoom, before = { start: { ...draft.start }, end: { ...draft.end } };
      const endpoint = Math.hypot(point.x - draft.start.x, point.y - draft.start.y) <= threshold ? 'start' : 'end';
      if (endpoint === 'end' && Math.hypot(point.x - draft.end.x, point.y - draft.end.y) > threshold) draft.start = draft.end = point;
      drag = { endpoint, before };
    }
    editor.gradientDraft = draft; editor.gesture = { kind: 'gradient-edit' }; editor.overlay.setPointerCapture(event.pointerId); refresh();
  };
  editor.pointerMove = (event) => {
    if (!drag) return move(event);
    const point = editor.toDocument(editor.viewPoint(event));
    if (event.shiftKey) { const anchor = draft[drag.endpoint === 'start' ? 'end' : 'start'], radius = Math.hypot(point.x - anchor.x, point.y - anchor.y), angle = Math.round(Math.atan2(point.y - anchor.y, point.x - anchor.x) / (Math.PI / 4)) * Math.PI / 4; point.x = anchor.x + radius * Math.cos(angle); point.y = anchor.y + radius * Math.sin(angle); }
    draft[drag.endpoint] = point; refresh();
  };
  editor.pointerUp = (event) => { if (!drag) return up(event); editor.pointerMove(event); drag = null; editor.gesture = null; if (Math.hypot(draft.end.x - draft.start.x, draft.end.y - draft.start.y) < .5) finish(false); if (editor.overlay.hasPointerCapture(event.pointerId)) editor.overlay.releasePointerCapture(event.pointerId); editor.draw(); };
  editor.cancelGesture = () => { if (!drag) return cancelGesture(); if (drag.before) Object.assign(draft, drag.before); else { draft = null; editor.gradientDraft = null; } drag = null; editor.gesture = null; refresh(); };
  const render = editor.render.bind(editor);
  editor.render = () => {
    bar.hidden = editor.tool !== 'gradient' || !editor.manifest; apply.disabled = cancel.disabled = !draft; render();
    if (!draft) return;
    const ctx = editor.overlay.getContext('2d'); ctx.save(); ctx.translate(editor.pan.x, editor.pan.y); ctx.scale(editor.zoom, editor.zoom);
    ctx.lineWidth = 2 / editor.zoom; ctx.strokeStyle = '#fff'; ctx.shadowColor = '#000'; ctx.shadowBlur = 2; ctx.beginPath(); ctx.moveTo(draft.start.x, draft.start.y); ctx.lineTo(draft.end.x, draft.end.y); ctx.stroke();
    for (const p of [draft.start, draft.end]) { ctx.beginPath(); ctx.arc(p.x, p.y, 5 / editor.zoom, 0, Math.PI * 2); ctx.fillStyle = '#303034'; ctx.fill(); ctx.stroke(); } ctx.restore();
  };
  const previous = editor.advancedCommand;
  editor.advancedCommand = async (command) => {
    if (command === 'gradient-apply') { finish(true); return true; } if (command === 'gradient-cancel') { finish(false); return true; }
    if (command === 'tool-settings' && editor.tool === 'gradient') {
      const before = structuredClone(settings), fields = [{ key: 'shape', label: 'Gradient shape', options: ['Linear', 'Radial'] }, { key: 'style', label: 'Gradient style', options: ['Foreground to Transparent', 'Foreground to Background'] }, colorField('background', 'Gradient end'), numberField('opacity', 'Gradient opacity', 0, 100, 100), boolField('reversed', 'Reverse')];
      const changed = await settingsDialog('Gradient', fields, settings, (value) => { Object.assign(settings, value); refresh(); }); Object.assign(settings, changed ?? before); shape.value = settings.shape; style.value = settings.style; refresh(); return true;
    }
    if (draft && command === 'undo') { finish(false); return true; }
    if (!['zoom-in', 'zoom-out', 'fit', 'actual'].includes(command)) finish(true);
    return await previous(command);
  };
  shape.addEventListener('change', () => { settings.shape = shape.value; refresh(); }); style.addEventListener('change', () => { settings.style = style.value; refresh(); });
  document.querySelector('#paint-color').addEventListener('input', refresh);
  document.addEventListener('keydown', (event) => {
    if (!draft || event.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || document.querySelector('dialog[open]')) return;
    if (event.key === 'Escape' || event.key === 'Enter') { event.preventDefault(); event.stopImmediatePropagation(); try { finish(event.key === 'Enter'); } catch (error) { api.showError(error); } }
  }, true);
}
