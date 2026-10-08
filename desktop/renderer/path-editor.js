import { createLayer, documentPoint, canvasSize, documentPixels } from './core.js';
import { surface, colorRecord } from './raster.js';
import { storeMask, combineSelection } from './masks.js';
import { mapContours, traceContours, pathBounds, nearestSegment, splitSegment } from './vector-geometry.js';
import { renderVector } from './vector-render.js';
import { settingsDialog, numberField, boolField, colorField } from './settings-dialog.js';

export function installPathEditor(editor, api) {
  let draft = null, baseline = '', selected = null, drag = null, independent = false;
  const mutate = editor.mutate.bind(editor), install = editor.install.bind(editor), newCanvas = editor.newCanvas.bind(editor), select = editor.select.bind(editor);
  const down = editor.pointerDown.bind(editor), move = editor.pointerMove.bind(editor), up = editor.pointerUp.bind(editor), cancel = editor.cancelGesture.bind(editor), render = editor.render.bind(editor);
  const controls = document.createElement('div'); controls.className = 'path-controls'; controls.hidden = true;
  for (const [title, command] of [['New path', 'path-new'], ['New contour', 'path-contour'], ['Close / open path', 'path-close'], ['Smooth / corner point', 'path-smooth'], ['Delete point', 'path-delete'], ['Path style…', 'path-style'], ['Path to selection', 'path-selection'], ['Path to mask', 'path-mask'], ['Apply path', 'path-apply'], ['Cancel path', 'path-cancel']]) {
    const button = document.createElement('button'); button.textContent = title; button.dataset.command = command; button.addEventListener('click', () => api.runCommand(command)); controls.append(button);
  }
  document.querySelector('.tool-options').after(controls);
  const handleMode = document.createElement('button'); handleMode.textContent = 'Independent handles'; handleMode.dataset.command = 'path-independent'; handleMode.setAttribute('aria-pressed', 'false'); handleMode.addEventListener('click', () => api.runCommand('path-independent')); controls.insertBefore(handleMode, controls.querySelector('[data-command="path-style"]'));
  const changed = () => draft && JSON.stringify(draft) !== baseline;
  function refresh() { editor.pathDraft = draft; editor.update(false); }
  function begin(fresh = false, mask = false) {
    if (draft) finish(true);
    const layer = editor.active, style = !fresh && layer?.[mask ? 'vectorMask' : 'vectorPath'];
    const transform = mask ? layer?.maskPlacement ?? layer?.transform : layer?.transform;
    draft = { contours: style ? mapContours(style.contours, (p) => { const d = documentPoint({ x: p[0], y: p[1] }, transform); return [d.x, d.y]; }) : [{ closed: false, nodes: [] }],
      fillRule: style?.fillRule ?? 'evenodd', fill: style?.fill ?? (mask ? { red: 1, green: 1, blue: 1 } : colorRecord(editor.color)), stroke: style?.stroke ?? null,
      strokeWidth: (style?.strokeWidth ?? 0) * Math.min(...(transform?.size ?? [1, 1])), layerID: style ? layer.id : null, mask: !!style && mask };
    baseline = JSON.stringify(draft); selected = null; refresh();
  }
  function checkContours(closed = false) {
    if (!draft || draft.contours.some((c) => c.nodes.length < (closed || c.closed ? 3 : 2) || closed && !c.closed)) throw new Error(closed ? 'Close every contour with at least three points first.' : 'Add at least two points to every contour first.');
  }
  function normalized(mask = false) {
    checkContours(mask);
    const box = pathBounds(draft.contours, mask ? 2 : draft.strokeWidth / 2 + 2); canvasSize(box.width, box.height);
    const style = { contours: mapContours(draft.contours, (p) => [(p[0] - box.x) / box.width, (p[1] - box.y) / box.height]), fillRule: draft.fillRule,
      fill: mask ? { red: 1, green: 1, blue: 1 } : draft.fill, stroke: mask ? null : draft.stroke, strokeWidth: mask ? 0 : draft.strokeWidth / Math.min(box.width, box.height) };
    if (style.strokeWidth > 1) throw new Error('Reduce the stroke width for this path.');
    const layer = editor.manifest.layers.find((l) => l.id === draft.layerID), image = (mask ? editor.masks : editor.images).get(layer?.id);
    const used = documentPixels(editor) - (image ? image.width * image.height : 0);
    if (used + box.width * box.height > editor.pixelBudget) throw new Error('This path exceeds the document pixel budget.');
    return { box, style, image: renderVector(style, box.width, box.height, mask) };
  }
  function clear() { draft = null; drag = null; selected = null; editor.pathDraft = null; editor.gesture = null; refresh(); }
  function finish(commit) {
    if (!draft) return;
    if (!commit || !changed() || draft.contours.every((c) => !c.nodes.length)) { clear(); return; }
    const result = normalized(draft.mask), current = draft;
    draft = null; editor.pathDraft = null; editor.gesture = null; drag = null;
    try {
      mutate(current.mask ? 'Edit Vector Mask' : 'Edit Vector Path', () => {
        let layer = editor.manifest.layers.find((l) => l.id === current.layerID);
        if (!layer) { layer = createLayer('Vector path', result.box.width, result.box.height); layer.parentID = editor.active?.parentID; editor.manifest.layers.push(layer); editor.manifest.activeLayerID = layer.id; editor.selectedIDs = new Set([layer.id]); }
        const transform = { origin: [result.box.x, result.box.y], size: [result.box.width, result.box.height], rotation: 0, flipX: false, flipY: false, sampling: 'High quality' };
        if (current.mask) { layer.maskPlacement = transform; storeMask(editor, layer, result.image, { vectorCache: true }); layer.vectorMask = result.style; }
        else { if (layer.maskFile && !layer.maskPlacement) layer.maskPlacement = structuredClone(layer.transform); layer.transform = transform; editor.storePixels(layer, result.image, { vectorCache: true }); layer.vectorPath = result.style; }
      }, { followMasks: false });
      selected = null; refresh();
    } catch (error) { draft = current; refresh(); throw error; }
  }
  function closedCoverage() {
    checkContours(true); const canvas = surface(editor.manifest.width, editor.manifest.height), ctx = canvas.getContext('2d');
    traceContours(ctx, draft.contours); ctx.fillStyle = '#fff'; ctx.fill(draft.fillRule); return canvas;
  }
  editor.pathEditor = { finish, begin, serialize: () => draft ? { draft: structuredClone(draft), baseline, selected } : null,
    restore: (state) => { draft = structuredClone(state.draft); baseline = state.baseline; selected = state.selected; refresh(); } };
  editor.install = async (...args) => { clear(); return install(...args); };
  editor.newCanvas = (...args) => { clear(); return newCanvas(...args); };
  editor.select = (...args) => { finish(true); return select(...args); };
  editor.mutate = (...args) => { finish(true); return mutate(...args); };
  const previous = editor.advancedCommand;
  editor.advancedCommand = async (command) => {
    if (!command.startsWith('path-') && command !== 'edit-vector-mask') { if (draft) finish(true); return previous(command); }
    if (command === 'path-new') { api.setTool('path'); begin(true); return true; }
    if (command === 'edit-vector-mask') { if (editor.active?.vectorMask) { api.setTool('path'); begin(false, true); } return true; }
    if (command === 'path-cancel') { finish(false); return true; }
    if (command === 'path-independent') { independent = !independent; handleMode.setAttribute('aria-pressed', String(independent)); return true; }
    if (!draft) begin();
    if (command === 'path-apply') { finish(true); return true; }
    if (command === 'path-contour') { checkContours(true); if (draft.contours.length >= 64) throw new Error('This path has reached its contour limit.'); draft.contours.push({ closed: false, nodes: [] }); selected = null; }
    if (command === 'path-close') { const c = draft.contours[selected?.contour ?? draft.contours.length - 1]; if (c.nodes.length < 3) throw new Error('Add at least three points before closing this path.'); c.closed = !c.closed; }
    if (command === 'path-delete' && selected) { const c = draft.contours[selected.contour]; c.nodes.splice(selected.index, 1); if (c.nodes.length < 3) c.closed = false; selected = null; }
    if (command === 'path-smooth' && selected) {
      const c = draft.contours[selected.contour], node = c.nodes[selected.index];
      if (node.incoming || node.outgoing) { delete node.incoming; delete node.outgoing; }
      else { const a = c.nodes[(selected.index + c.nodes.length - 1) % c.nodes.length].point, b = c.nodes[(selected.index + 1) % c.nodes.length].point, tangent = [(b[0] - a[0]) / 6, (b[1] - a[1]) / 6]; node.incoming = node.point.map((v, i) => v - tangent[i]); node.outgoing = node.point.map((v, i) => v + tangent[i]); }
    }
    if (command === 'path-style') {
      const value = await settingsDialog('Path style', [boolField('filled', 'Fill path', !!draft.fill), colorField('fill', 'Fill color', draft.fill ?? colorRecord(editor.color)), boolField('stroked', 'Stroke path', !!draft.stroke), colorField('stroke', 'Stroke color', draft.stroke ?? colorRecord(editor.color)), numberField('width', 'Stroke width', 0, 500, draft.strokeWidth || 3), { key: 'fillRule', label: 'Fill rule', options: ['evenodd', 'nonzero'], default: draft.fillRule }], { filled: !!draft.fill, fill: draft.fill ?? colorRecord(editor.color), stroked: !!draft.stroke, stroke: draft.stroke ?? colorRecord(editor.color), width: draft.strokeWidth || 3, fillRule: draft.fillRule });
      if (value) { if (!value.filled && !value.stroked) throw new Error('Enable a fill or stroke for this path.'); draft.fill = value.filled ? value.fill : null; draft.stroke = value.stroked ? value.stroke : null; draft.strokeWidth = value.width; draft.fillRule = value.fillRule; }
    }
    if (command === 'path-selection') { const coverage = closedCoverage(); mutate('Path to Selection', () => combineSelection(editor, coverage)); }
    if (command === 'path-mask') {
      const layer = editor.active; if (!layer) return true;
      const result = normalized(true), current = draft; draft = null; editor.pathDraft = null;
      try { mutate('Path to Vector Mask', () => { const { box } = result; layer.maskPlacement = { origin: [box.x, box.y], size: [box.width, box.height], rotation: 0, flipX: false, flipY: false, sampling: 'High quality' }; layer.maskLinked = false; layer.maskEnabled = true; storeMask(editor, layer, result.image, { vectorCache: true }); layer.vectorMask = result.style; }); }
      catch (error) { draft = current; throw error; } selected = null;
    }
    refresh(); return true;
  };
  editor.pointerDown = (event) => {
    if (editor.tool !== 'path' || !editor.manifest || editor.busy || editor.gesture || editor.spaceDown || event.button !== 0 || document.querySelector('dialog[open]')) return down(event);
    editor.viewport.focus(); if (!draft) begin();
    const p = editor.toDocument(editor.viewPoint(event)), point = [p.x, p.y], radius = (event.pointerType === 'touch' ? 20 : 8) / editor.zoom;
    let hit;
    draft.contours.forEach((c, ci) => c.nodes.forEach((node, i) => { for (const key of ['incoming', 'outgoing', 'point']) if (node[key] && Math.hypot(node[key][0] - point[0], node[key][1] - point[1]) <= radius) hit = { contour: ci, index: i, key }; }));
    const before = structuredClone(draft);
    if (hit) {
      const c = draft.contours[hit.contour];
      if (hit.key === 'point' && hit.index === 0 && !c.closed && c.nodes.length >= 3 && !draft.layerID && !event.altKey) { c.closed = true; selected = hit; refresh(); return; }
      selected = hit;
    } else {
      const c = draft.contours.at(-1);
      if (!c.closed) { if (draft.contours.reduce((sum, item) => sum + item.nodes.length, 0) >= 4096) throw new Error('This path has reached its point limit.'); c.nodes.push({ point }); selected = { contour: draft.contours.length - 1, index: c.nodes.length - 1, key: 'new' }; }
      else { const near = nearestSegment(draft.contours, point); if (!near || near.distance > radius) return; selected = { contour: near.contour, index: splitSegment(draft.contours[near.contour], near.index, near.t), key: 'point' }; }
    }
    drag = { before, start: point, original: structuredClone(draft.contours[selected.contour].nodes[selected.index]), selected: { ...selected } };
    editor.gesture = { kind: 'path', pointerID: event.pointerId }; editor.overlay.setPointerCapture(event.pointerId); refresh();
  };
  editor.pointerMove = (event) => {
    if (!drag || editor.gesture?.kind !== 'path') return move(event);
    const p = editor.toDocument(editor.viewPoint(event)), point = [p.x, p.y], { original, start } = drag, { contour, index, key } = drag.selected, node = draft.contours[contour].nodes[index];
    if (key === 'new') { if (Math.hypot(point[0] - start[0], point[1] - start[1]) * editor.zoom > 3) { node.outgoing = point; node.incoming = original.point.map((v, i) => v * 2 - point[i]); } }
    else if (key === 'point') { for (const k of Object.keys(original)) node[k] = original[k].map((v, i) => v + point[i] - start[i]); }
    else { node[key] = point; const other = key === 'incoming' ? 'outgoing' : 'incoming'; if (!event.altKey && !independent && original[other]) { const length = Math.hypot(...original[other].map((v, i) => v - original.point[i])), delta = point.map((v, i) => v - node.point[i]), size = Math.hypot(...delta); if (size) node[other] = node.point.map((v, i) => v - delta[i] / size * length); } }
    refresh();
  };
  editor.pointerUp = (event) => {
    if (!drag || editor.gesture?.kind !== 'path') return up(event);
    editor.pointerMove(event); drag = null; editor.gesture = null; if (editor.overlay.hasPointerCapture(event.pointerId)) editor.overlay.releasePointerCapture(event.pointerId); refresh();
  };
  editor.cancelGesture = () => { if (drag) { draft = drag.before; drag = null; editor.gesture = null; refresh(); return; } cancel(); };
  editor.render = () => {
    render(); controls.hidden = editor.tool !== 'path' || !editor.manifest;
    if (!draft || editor.tool !== 'path') return;
    const ctx = editor.overlay.getContext('2d'); ctx.save(); ctx.translate(editor.pan.x, editor.pan.y); ctx.scale(editor.zoom, editor.zoom);
    ctx.lineWidth = 1.5 / editor.zoom; ctx.strokeStyle = '#78a9ff'; traceContours(ctx, draft.contours); ctx.stroke();
    draft.contours.forEach((c, ci) => c.nodes.forEach((node, i) => {
      for (const key of ['incoming', 'outgoing']) if (node[key]) { ctx.beginPath(); ctx.moveTo(...node.point); ctx.lineTo(...node[key]); ctx.stroke(); ctx.fillStyle = '#dce9ff'; ctx.beginPath(); ctx.arc(...node[key], 3 / editor.zoom, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = selected?.contour === ci && selected?.index === i ? '#78a9ff' : '#fff'; ctx.fillRect(node.point[0] - 4 / editor.zoom, node.point[1] - 4 / editor.zoom, 8 / editor.zoom, 8 / editor.zoom);
    })); ctx.restore();
  };
  document.addEventListener('keydown', (event) => {
    if (!draft || event.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || document.querySelector('dialog[open]')) return;
    if (['Enter', 'Escape', 'Delete', 'Backspace'].includes(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation();
      try { if (event.key === 'Enter' || event.key === 'Escape') finish(event.key === 'Enter'); else api.runCommand('path-delete'); } catch (error) { api.showError(error); }
    }
  }, true);
}
