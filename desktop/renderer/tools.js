import { createLayer, localPoint, documentPoint, canvasSize, documentPixels } from './core.js';
import { surface, copySurface, place, colorRecord, colorCSS, alphaSurface, clamp } from './raster.js';
import { kernels, allocate, pixelKernel } from './kernels.js';
import { selectionCanvas, maskValues, combineSelection, storeMask } from './masks.js';
import { settingsDialog, numberField as n, colorField as c, boolField as b } from './settings-dialog.js';
import { blurSurface } from './adjustments.js';
import { icon } from './icons.js';
import { descendants, selected } from './layer-operations.js';
import { following, followLinkedMasks, affine, inverse, multiply } from './affine.js';
import { subjectMask } from './subject.js';
import { WarpStroke } from './warp-stroke.js';
import { renderText } from './text-layout.js';
import { replaceTextContent } from './text-style.js';
import { rasterTarget, mappedSelection, maskedChange, maskOutside } from './raster-space.js';
import { penResponse } from './pen-input.js';
import { cropAspect, constrainedCrop } from './crop-geometry.js';
export { renderText } from './text-layout.js';
export { mappedSelection, maskedChange } from './raster-space.js';
function drawShape(style, width, height) {
  const canvas = surface(width, height), context = canvas.getContext('2d'); context.fillStyle = context.strokeStyle = colorCSS(style);
  if (style.kind === 'Ellipse') { context.beginPath(); context.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2); context.fill(); }
  else if (style.kind === 'Line') { context.lineWidth = style.lineWidth ?? 4; context.lineCap = 'round'; context.beginPath(); context.moveTo((style.start?.[0] ?? 0) * width, (style.start?.[1] ?? 0) * height); context.lineTo((style.end?.[0] ?? 1) * width, (style.end?.[1] ?? 1) * height); context.stroke(); }
  else { context.beginPath(); context.roundRect(0, 0, width, height, Math.min(style.cornerRadius ?? 0, width / 2, height / 2)); context.fill(); }
  return canvas;
}
function pointInside(editor, point) { return point.x >= 0 && point.y >= 0 && point.x < editor.manifest.width && point.y < editor.manifest.height; }
function gridTransform(transform, oldWidth, oldHeight, x, y, width, height) {
  const center = documentPoint({ x: (x + width / 2) / oldWidth, y: (y + height / 2) / oldHeight }, transform), size = [transform.size[0] * width / oldWidth, transform.size[1] * height / oldHeight];
  return { ...transform, origin: [center.x - size[0] / 2, center.y - size[1] / 2], size };
}

export function installTools(editor, api) {
  const tools = [['ellipse', 'Ellipse selection', 'ellipse'], ['lasso', 'Lasso', 'lasso'], ['polygon', 'Polygonal lasso', 'polygon'], ['wand', 'Magic wand', 'wand'], ['object', 'Object selection', 'object'], ['clone', 'Clone stamp', 'clone'], ['heal', 'Spot healing', 'heal'], ['blur', 'Blur / Smudge / Liquify', 'blur'], ['gradient', 'Gradient', 'gradient'], ['crop', 'Crop', 'crop']];
  const rail = document.querySelector('.tool-rail'), beforeHand = rail.querySelector('.rail-divider');
  for (const [name, label, glyph] of tools) { const button = document.createElement('button'); button.className = 'tool'; button.dataset.tool = name; button.title = label; button.setAttribute('aria-label', label + ' tool'); button.append(icon(glyph)); button.addEventListener('click', () => { api.setTool(name); document.querySelector('#tool-name').textContent = label; }); rail.insertBefore(button, beforeHand); }
  rail.style.overflowY = 'auto';
  const shapeSelect = document.querySelector('#shape-kind'); for (const kind of ['Rounded Rectangle', 'Line']) { const option = document.createElement('option'); option.textContent = kind; shapeSelect.append(option); }
  const settingsButton = document.createElement('button'); settingsButton.textContent = 'Tool settings…'; settingsButton.className = 'tool-settings'; settingsButton.addEventListener('click', () => api.runCommand('tool-settings')); document.querySelector('.history-actions').before(settingsButton);
  editor.toolSettings = { tolerance: 32, contiguous: true, sampleAll: true, aligned: true, mode: 'Blur', smoothing: 0, feather: 0, cornerRadius: 16, lineWidth: 4, cropRatio: 'Free' };
  const originalDown = editor.pointerDown.bind(editor), originalMove = editor.pointerMove.bind(editor), originalUp = editor.pointerUp.bind(editor), originalRender = editor.render.bind(editor), originalPaint = editor.paintSegment.bind(editor);
  const originalNew = editor.newCanvas.bind(editor); editor.newCanvas = (...args) => { editor.editMask = false; editor.selectedIDs = new Set(); originalNew(...args); };
  editor.lastStrokePoint = null; editor.polygon = null;
  const pointOf = (event) => editor.toDocument(editor.viewPoint(event));
  const modeOf = (event) => event.altKey ? 'subtract' : event.shiftKey ? 'add' : editor.selectionMode ?? 'replace';
  const sourceFor = (layer) => editor.editMask ? editor.masks.get(layer.id) : editor.images.get(layer.id);
  function shapeSelection(rect, kind, points) {
    const canvas = surface(editor.manifest.width, editor.manifest.height), context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.beginPath();
    if (points) { points.forEach((p, i) => i ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y)); context.closePath(); }
    else if (kind === 'ellipse') context.ellipse(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width / 2, rect.height / 2, 0, 0, Math.PI * 2);
    else context.rect(rect.x, rect.y, rect.width, rect.height);
    context.fill(); return editor.toolSettings.feather ? blurSurface(canvas, editor.toolSettings.feather) : canvas;
  }
  function finishPolygon() { if (editor.polygon?.points.length >= 3) combineSelection(editor, shapeSelection(null, null, editor.polygon.points), editor.polygon.mode); editor.polygon = null; editor.draw(); }
  editor.finishPolygonSelection = finishPolygon;
  editor.overlay.addEventListener('dblclick', () => { if (editor.tool === 'polygon') finishPolygon(); });
  function wand(point, event) {
    const source = editor.composite(true), context = source.getContext('2d'), data = context.getImageData(0, 0, source.width, source.height); let mask;
    pixelKernel(data.data, source.width, source.height, (p, w, h, stride) => { const target = allocate(w * h); const result = kernels.wand_mask(p, w, h, stride, Math.floor(point.x), Math.floor(point.y), 0, editor.toolSettings.tolerance, editor.toolSettings.contiguous ? 1 : 0, target); mask = new Uint8ClampedArray(kernels.memory.buffer, target, w * h).slice(); return result; });
    combineSelection(editor, alphaSurface(mask, source.width, source.height), modeOf(event));
  }
  editor.pointerDown = (event) => {
    if (!editor.manifest || editor.busy || editor.gesture || event.button > 1 || document.querySelector('dialog[open]')) return;
    const point = pointOf(event), layer = editor.active, tool = editor.tool;
    if (editor.spaceDown || event.button === 1 || tool === 'hand') return originalDown(event);
    if (tool === 'polygon') { editor.polygon ??= { points: [], mode: modeOf(event) }; editor.polygon.points.push(point); editor.draw(); return; }
    if (tool === 'wand' && pointInside(editor, point)) { wand(point, event); return; }
    if (tool === 'object' && pointInside(editor, point)) {
      editor.busy = true; const source = editor.composite(true);
      subjectMask(source).then((mask) => {
        const alpha = maskValues(mask), width = mask.width, height = mask.height, selected = new Uint8ClampedArray(alpha.length), queue = new Int32Array(alpha.length); let head = 0, end = 0;
        const seed = Math.floor(point.y) * width + Math.floor(point.x);
        if (alpha[seed] < 64) { combineSelection(editor, mask, modeOf(event)); return; }
        queue[end++] = seed; selected[seed] = alpha[seed];
        while (head < end) { const i = queue[head++], x = i % width, y = Math.floor(i / width); for (const j of [x > 0 ? i - 1 : -1, x + 1 < width ? i + 1 : -1, y > 0 ? i - width : -1, y + 1 < height ? i + width : -1]) if (j >= 0 && !selected[j] && alpha[j] >= 32) { selected[j] = alpha[j]; queue[end++] = j; } }
        combineSelection(editor, alphaSurface(selected, width, height), modeOf(event));
      }).catch(api.showError).finally(() => { editor.busy = false; editor.update(); }); return;
    }
    if (tool === 'clone' && event.altKey) { editor.cloneSource = point; editor.cloneOffset = null; return; }
    if (tool === 'lasso' || tool === 'ellipse' || tool === 'crop') {
      editor.gesture = { kind: tool, point, points: [point], before: editor.snapshot(), mode: modeOf(event), oldSelection: editor.selection }; editor.overlay.setPointerCapture(event.pointerId); return;
    }
    if (['clone', 'heal', 'blur'].includes(tool)) {
      if (!layer || layer.isGroup && !editor.editMask || !sourceFor(layer) && !(tool === 'clone' && editor.toolSettings.sampleAll)) return;
      if (tool === 'clone' && !editor.cloneSource) { api.showError(new Error('Alt-click the source area before using Clone Stamp.')); return; }
      const initialSource = sourceFor(layer), target = rasterTarget(editor, layer, editor.editMask), source = target.source ?? surface(target.width, target.height), canvas = copySurface(source), mask = surface(source.width, source.height);
      const paintLayer = editor.editMask ? { ...layer, transform: layer.maskPlacement ?? layer.transform } : layer;
      if (tool === 'clone' && (!editor.toolSettings.aligned || !editor.cloneOffset)) editor.cloneOffset = { x: editor.cloneSource.x - point.x, y: editor.cloneSource.y - point.y };
      editor.gesture = { kind: 'retouch', tool, layer, paintLayer, before: editor.snapshot(), initialSource, source, canvas, mask, previous: point, isMask: editor.editMask };
      if (tool === 'blur' && editor.toolSettings.mode !== 'Blur') editor.gesture.warp = new WarpStroke(canvas, editor.brushSize / 2 * canvas.width / paintLayer.transform.size[0], editor.brushSize / 2 * canvas.height / paintLayer.transform.size[1], localPoint(point, paintLayer.transform, canvas.width, canvas.height), editor.toolSettings.mode);
      if (tool === 'clone' && editor.toolSettings.sampleAll && !editor.editMask) { editor.gesture.mergedSample = editor.composite(true); updateCloneSample(editor.gesture); }
      editor.overlay.setPointerCapture(event.pointerId); retouch(point); return;
    }
    if (tool === 'move' && editor.editMask && layer?.maskLinked === false && layer.maskPlacement) { editor.gesture = { kind: 'mask-move', target: layer, point, original: structuredClone(layer.maskPlacement), before: editor.snapshot() }; editor.overlay.setPointerCapture(event.pointerId); return; }
    if (tool === 'move' && (layer?.isGroup || selected(editor).size > 1)) {
      const ids = descendants(editor, selected(editor)); editor.gesture = { kind: 'group-move', point, before: editor.snapshot(), originals: editor.manifest.layers.filter((item) => ids.has(item.id)).map((item) => [item, structuredClone(item.transform), item.maskPlacement && structuredClone(item.maskPlacement)]) }; editor.overlay.setPointerCapture(event.pointerId); return;
    }
    if (editor.editMask && ['brush', 'eraser'].includes(tool) && layer?.maskFile) {
      let target;
      try { target = rasterTarget(editor, layer, true); } catch (error) { api.showError(error); return; }
      const source = target.source, canvas = copySurface(source), paint = surface(source.width, source.height);
      const virtual = { ...layer, transform: layer.maskPlacement ?? layer.transform };
      editor.gesture = { kind: 'paint', before: editor.snapshot(), layer: virtual, target: layer, canvas, paint, source, previous: point, tool, isMask: true };
      editor.paintSegment(point, point); editor.overlay.setPointerCapture(event.pointerId); return;
    }
    if (tool === 'move' && event.altKey && layer) editor.duplicate();
    originalDown(event);
    if (editor.gesture?.kind === 'paint') { editor.gesture.clip = editor.selection ? mappedSelection(editor, editor.gesture.layer, editor.gesture.canvas.width, editor.gesture.canvas.height) : null; if (event.shiftKey && editor.lastStrokePoint) editor.paintSegment(editor.lastStrokePoint, point); }
    if (editor.gesture?.kind === 'marquee') { editor.gesture.mode = modeOf(event); editor.gesture.oldSelection = editor.selection; }
  };
  function updateCloneSample(g) {
    const sample = surface(g.canvas.width, g.canvas.height), ctx = sample.getContext('2d'); ctx.setTransform(...multiply([sample.width, 0, 0, sample.height, 0, 0], inverse(affine(g.paintLayer.transform)))); ctx.drawImage(g.mergedSample, 0, 0); g.sample = sample;
  }
  function growRetouch(g, point) {
    if (!['clone', 'heal'].includes(g.tool)) return;
    const w = g.canvas.width, h = g.canvas.height, t = g.paintLayer.transform, a = localPoint(g.previous, t, w, h), b = localPoint(point, t, w, h), rx = editor.brushSize / 2 * w / t.size[0] + 2, ry = editor.brushSize / 2 * h / t.size[1] + 2;
    const left = Math.min(0, Math.floor(Math.min(a.x, b.x) - rx)), top = Math.min(0, Math.floor(Math.min(a.y, b.y) - ry)), right = Math.max(w, Math.ceil(Math.max(a.x, b.x) + rx)), bottom = Math.max(h, Math.ceil(Math.max(a.y, b.y) + ry));
    if (!left && !top && right === w && bottom === h) return; const width = right - left, height = bottom - top; canvasSize(width, height);
    const used = documentPixels(editor); if (used - w * h + width * height > editor.pixelBudget) throw new Error('The brush exceeds the document pixel budget.');
    const expand = (image, fillMask = false) => { const canvas = surface(width, height), ctx = canvas.getContext('2d'); if (fillMask) { ctx.fillStyle = `rgba(255,255,255,${maskOutside(image)})`; ctx.fillRect(0, 0, width, height); ctx.clearRect(-left, -top, w, h); } ctx.drawImage(image, -left, -top); return canvas; };
    g.source = expand(g.source, g.isMask); g.canvas = expand(g.canvas, g.isMask); g.mask = expand(g.mask);
    if (!g.isMask && g.layer.maskFile && !g.layer.maskPlacement) g.layer.maskPlacement = structuredClone(t);
    g.paintLayer.transform = gridTransform(t, w, h, left, top, width, height); if (g.isMask) g.layer.maskPlacement = structuredClone(g.paintLayer.transform);
    if (g.mergedSample) updateCloneSample(g);
  }
  function restoreRetouch(g) {
    editor.manifest = g.before.manifest; editor.assets = g.before.assets; editor.selection = g.before.selection;
    const map = g.isMask ? editor.masks : editor.images; if (g.initialSource) map.set(g.layer.id, g.initialSource); else map.delete(g.layer.id); editor.gesture = null; editor.update();
  }
  function retouch(point) {
    try { growRetouch(editor.gesture, point); } catch (error) { restoreRetouch(editor.gesture); api.showError(error); return; }
    const g = editor.gesture, { canvas, paintLayer: layer } = g, previous = localPoint(g.previous, layer.transform, canvas.width, canvas.height), target = localPoint(point, layer.transform, canvas.width, canvas.height);
    if (g.warp) { g.warp.append(target, editor.brushHardness, editor.brushOpacity); g.previous = point; canvas.compositorRevision = (canvas.compositorRevision ?? 0) + 1; (g.isMask ? editor.masks : editor.images).set(g.layer.id, canvas); editor.preview = null; editor.draw(); return; }
    const pen = penResponse(point, editor.penSettings), radius = editor.brushSize / 2 * canvas.width / layer.transform.size[0] * pen.size, distance = Math.hypot(target.x - previous.x, target.y - previous.y), steps = Math.max(1, Math.ceil(distance / Math.max(1, radius / 4)));
    const context = canvas.getContext('2d');
    for (let i = 1; i <= steps; i++) {
      const x = previous.x + (target.x - previous.x) * i / steps, y = previous.y + (target.y - previous.y) * i / steps;
      const maskContext = g.mask.getContext('2d'); maskContext.globalAlpha = pen.opacity; maskContext.fillStyle = '#fff'; maskContext.beginPath(); maskContext.arc(x, y, radius, 0, Math.PI * 2); maskContext.fill();
      if (g.tool === 'heal') continue;
      context.save(); context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.clip(); context.globalAlpha = editor.brushOpacity * pen.opacity;
      if (g.tool === 'clone') {
        const offset = localPoint({ x: point.x + editor.cloneOffset.x, y: point.y + editor.cloneOffset.y }, layer.transform, canvas.width, canvas.height);
        context.drawImage(g.sample ?? g.source, target.x - offset.x, target.y - offset.y);
      } else if (editor.toolSettings.mode === 'Blur') { const copy = copySurface(canvas); context.filter = `blur(${Math.max(1, radius / 8)}px)`; context.drawImage(copy, 0, 0); }
      else {
        const copy = copySurface(canvas), dx = (target.x - previous.x) / steps, dy = (target.y - previous.y) / steps;
        context.drawImage(copy, dx * (editor.toolSettings.mode === 'Liquify' ? 1 : .5), dy * (editor.toolSettings.mode === 'Liquify' ? 1 : .5));
      }
      context.restore();
    }
    canvas.compositorRevision = (canvas.compositorRevision ?? 0) + 1; g.previous = point; (g.isMask ? editor.masks : editor.images).set(g.layer.id, canvas); editor.preview = null; editor.draw();
  }
  editor.pointerMove = (event) => {
    const point = pointOf(event), g = editor.gesture;
    editor.pointerPosition = point;
    if (editor.polygon) { editor.polygon.pointer = point; editor.draw(); }
    if (!g) { editor.draw(); return originalMove(event); }
    if (g.kind === 'retouch') { retouch(point); return; }
    if (g.kind === 'mask-move') { g.target.maskPlacement.origin = [g.original.origin[0] + point.x - g.point.x, g.original.origin[1] + point.y - g.point.y]; editor.preview = null; editor.draw(); return; }
    if (g.kind === 'group-move') {
      const dx = point.x - g.point.x, dy = point.y - g.point.y;
      for (const [layer, original, mask] of g.originals) { layer.transform.origin = [original.origin[0] + dx, original.origin[1] + dy]; if (mask && layer.maskLinked !== false) layer.maskPlacement.origin = [mask.origin[0] + dx, mask.origin[1] + dy]; }
      editor.preview = null; editor.draw(); return;
    }
    if (['lasso', 'ellipse', 'crop'].includes(g.kind)) {
      g.end = point; g.points.push(point); const x = Math.max(0, Math.min(g.point.x, point.x)), y = Math.max(0, Math.min(g.point.y, point.y));
      g.rect = { x, y, width: Math.max(1, Math.min(editor.manifest.width, Math.max(g.point.x, point.x)) - x), height: Math.max(1, Math.min(editor.manifest.height, Math.max(g.point.y, point.y)) - y) };
      if (g.kind === 'crop') g.rect = constrainedCrop(g.point, point, editor.manifest.width, editor.manifest.height, cropAspect(editor.toolSettings.cropRatio, editor.toolSettings.cropWidth, editor.toolSettings.cropHeight));
      editor.draw(); return;
    }
    originalMove(event);
    if (g.kind === 'move' && editor.active.maskPlacement && editor.active.maskLinked !== false) { const old = g.before.manifest.layers.find((item) => item.id === editor.active.id); if (old.maskPlacement) editor.active.maskPlacement = following(old.maskPlacement, old.transform, editor.active.transform); }
    if (g.kind === 'move' && editor.snapping) {
      const layer = editor.active, targetsX = [0, editor.manifest.width / 2, editor.manifest.width], targetsY = [0, editor.manifest.height / 2, editor.manifest.height];
      for (const guide of editor.manifest.guides ?? []) (guide.axis === 'vertical' ? targetsX : targetsY).push(guide.position);
      for (const item of editor.manifest.layers) if (item.id !== layer.id) { targetsX.push(item.transform.origin[0], item.transform.origin[0] + item.transform.size[0]); targetsY.push(item.transform.origin[1], item.transform.origin[1] + item.transform.size[1]); }
      for (const [axis, targets] of [[0, targetsX], [1, targetsY]]) for (const edge of [0, .5, 1]) {
        const current = layer.transform.origin[axis] + layer.transform.size[axis] * edge, found = targets.find((target) => Math.abs(target - current) <= 5 / editor.zoom);
        if (found != null) { layer.transform.origin[axis] += found - current; break; }
      }
    }
  };
  editor.paintSegment = (from, to) => {
    const g = editor.gesture;
    if (editor.toolSettings.smoothing > 0 && !editor.flushBrush) { const amount = Math.max(.03, 1 - editor.toolSettings.smoothing / 100), previous = g.smoothed ?? from; from = previous; to = { ...to, x: previous.x + (to.x - previous.x) * amount, y: previous.y + (to.y - previous.y) * amount }; g.smoothed = to; }
    const w = g.canvas.width, h = g.canvas.height, t = g.layer.transform, a = localPoint(from, t, w, h), z = localPoint(to, t, w, h), rx = editor.brushSize / 2 * w / t.size[0] + 2, ry = editor.brushSize / 2 * h / t.size[1] + 2;
    const x0 = Math.floor(Math.min(0, a.x - rx, z.x - rx) / 64) * 64, y0 = Math.floor(Math.min(0, a.y - ry, z.y - ry) / 64) * 64;
    const needX = Math.max(a.x + rx, z.x + rx), needY = Math.max(a.y + ry, z.y + ry);
    const x1 = needX > w ? Math.ceil(needX / 64) * 64 : w, y1 = needY > h ? Math.ceil(needY / 64) * 64 : h;
    if (!g.dodgeBurn && !g.channelPaint && (x0 < 0 || y0 < 0 || x1 > w || y1 > h)) {
      const width = x1 - x0, height = y1 - y0;
      if (width <= 30000 && height <= 30000 && width * height <= 200000000) {
        if (!g.grown) { g.originalSource = g.source; g.originalTransform = structuredClone(t); g.originalMaskPlacement = g.layer.maskPlacement && structuredClone(g.layer.maskPlacement); } g.grown = true;
        const source = surface(width, height), paint = surface(width, height);
        if (g.isMask && g.source) { const edge = maskValues(g.source); let sum = 0, count = 0; for (let x = 0; x < w; x++) { sum += edge[x] + edge[(h - 1) * w + x]; count += 2; } for (let y = 1; y < h - 1; y++) { sum += edge[y * w] + edge[y * w + w - 1]; count += 2; } if (sum * 2 >= count * 255) { source.getContext('2d').fillStyle = '#fff'; source.getContext('2d').fillRect(0, 0, width, height); source.getContext('2d').clearRect(-x0, -y0, w, h); } }
        if (g.source) source.getContext('2d').drawImage(g.source, -x0, -y0); paint.getContext('2d').drawImage(g.paint, -x0, -y0);
        if (g.layer.maskFile && !g.layer.maskPlacement && !g.isMask) g.layer.maskPlacement = structuredClone(t);
        g.layer.transform = gridTransform(t, w, h, x0, y0, width, height); if (g.isMask) g.target.maskPlacement = structuredClone(g.layer.transform);
        g.source = source; g.paint = paint; g.canvas = copySurface(source); g.clip = editor.selection ? mappedSelection(editor, g.layer, width, height) : null;
      }
    }
    if (!g.isMask) {
      originalPaint(from, to);
      if (g.clip) { const base = g.source ?? surface(g.canvas.width, g.canvas.height), clipped = maskedChange(base, g.canvas, g.clip); editor.images.set(g.layer.id, clipped); g.result = clipped; }
      return;
    }
    const color = editor.color, image = editor.images.get(g.layer.id); editor.color = '#ffffff';
    originalPaint(from, to); editor.color = color; if (image) editor.images.set(g.layer.id, image); else editor.images.delete(g.layer.id);
    const context = g.canvas.getContext('2d'); context.clearRect(0, 0, g.canvas.width, g.canvas.height); context.drawImage(g.source, 0, 0);
    context.globalCompositeOperation = 'destination-out'; context.globalAlpha = editor.brushOpacity; context.drawImage(g.paint, 0, 0);
    const rgb = colorRecord(color), gray = g.tool === 'eraser' ? 0 : .2126 * rgb.red + .7152 * rgb.green + .0722 * rgb.blue;
    context.globalCompositeOperation = 'lighter'; context.globalAlpha = editor.brushOpacity * gray; context.drawImage(g.paint, 0, 0); context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
    editor.masks.set(g.target.id, g.canvas); editor.preview = null;
  };
  editor.prepareStroke = (g) => {
    let image = g.result ?? g.canvas;
    if (!g.grown) return image;
    kernels.arena_reset(); const data = image.getContext('2d').getImageData(0, 0, image.width, image.height).data, bounds = allocate(16);
    kernels.brush_alpha_bounds(allocate(data), image.width, image.height, image.width * 4, bounds);
    const [x, y, x1, y1] = new Uint32Array(kernels.memory.buffer, bounds, 4);
    if (x1 > x && y1 > y && (x || y || x1 !== image.width || y1 !== image.height)) {
      const cropped = surface(x1 - x, y1 - y); cropped.getContext('2d').drawImage(image, -x, -y);
      g.layer.transform = gridTransform(g.layer.transform, image.width, image.height, x, y, cropped.width, cropped.height); image = cropped;
    }
    return image;
  };
  editor.pointerUp = (event) => {
    const g = editor.gesture; if (!g) return;
    if (['retouch', 'group-move', 'mask-move', 'lasso', 'ellipse', 'crop'].includes(g.kind) || g.isMask) {
      editor.pointerMove(event); if (!editor.gesture) return; editor.gesture = null;
      try {
        if (g.kind === 'lasso' || g.kind === 'ellipse') combineSelection(editor, shapeSelection(g.rect, g.kind, g.kind === 'lasso' ? g.points : null), g.mode);
        else if (g.kind === 'crop') { editor.selection = { ...g.rect, x: Math.round(g.rect.x), y: Math.round(g.rect.y), width: Math.round(g.rect.width), height: Math.round(g.rect.height) }; editor.update(false); }
        else if (g.kind === 'retouch') {
          let output = g.canvas;
          if (g.tool === 'heal') {
            const data = output.getContext('2d').getImageData(0, 0, output.width, output.height), coverage = maskValues(g.mask);
            pixelKernel(data.data, output.width, output.height, (p, w, h, stride) => kernels.spot_heal(p, allocate(coverage), w, h, stride, editor.brushOpacity, 0, 0)); output.getContext('2d').putImageData(data, 0, 0);
          }
          if (editor.selection) output = maskedChange(g.source, output, mappedSelection(editor, g.paintLayer, output.width, output.height));
          if (g.isMask) storeMask(editor, g.layer, output); else { editor.storePixels(g.layer, output); editor.rasterize(g.layer); }
          editor.history.push(g.before, editor.snapshot(), g.tool); editor.update();
        } else if (g.isMask) { storeMask(editor, g.target, g.canvas); editor.history.push(g.before, editor.snapshot(), 'Paint Mask'); editor.update(); }
        else { editor.history.push(g.before, editor.snapshot(), 'Move Group'); editor.update(); }
      } catch (error) { if (g.kind === 'retouch') restoreRetouch(g); api.showError(error); }
      if (editor.overlay.hasPointerCapture(event.pointerId)) editor.overlay.releasePointerCapture(event.pointerId); return;
    }
    if (g.kind === 'paint' && g.result) g.canvas = g.result;
    const shape = g.kind === 'shape', originalKind = editor.shapeKind;
    if (shape && ['Rounded Rectangle', 'Line'].includes(originalKind)) editor.shapeKind = 'Rectangle';
    editor.flushBrush = true;
    if (g.kind === 'paint' && g.smoothed) editor.paintSegment(g.smoothed, pointOf(event));
    originalUp(event); editor.flushBrush = false; editor.shapeKind = originalKind;
    if (shape && editor.active?.shape && g.rect?.width && g.rect?.height && originalKind !== 'Ellipse') {
      const layer = editor.active; layer.shape.kind = originalKind === 'Line' ? 'Line' : 'Rectangle'; layer.shape.cornerRadius = originalKind === 'Rounded Rectangle' ? editor.toolSettings.cornerRadius : 0;
      if (originalKind === 'Line') { const end = pointOf(event); layer.shape.lineWidth = editor.toolSettings.lineWidth; layer.shape.start = [g.point.x <= end.x ? 0 : 1, g.point.y <= end.y ? 0 : 1]; layer.shape.end = layer.shape.start.map((value) => 1 - value); }
      editor.storePixels(layer, drawShape(layer.shape, ...layer.transform.size));
      if (editor.history.past.length) editor.history.past.at(-1).after = editor.snapshot(); editor.update();
    }
    if (g.kind === 'paint') editor.lastStrokePoint = pointOf(event);
    if (g.kind === 'marquee' && editor.selection) {
      const rect = editor.selection; editor.selection = g.oldSelection; combineSelection(editor, shapeSelection(rect, 'rectangle'), g.mode);
    }
  };
  const cancel = editor.cancelGesture.bind(editor);
  editor.cancelGesture = () => { const g = editor.gesture;
    if (g?.kind === 'retouch') { restoreRetouch(g); editor.polygon = null; return; }
    if (g?.grown) { const target = g.target ?? g.layer, original = g.before.manifest.layers.find((layer) => layer.id === target.id); target.transform = structuredClone(original.transform); if (original.maskPlacement) target.maskPlacement = structuredClone(original.maskPlacement); else delete target.maskPlacement; const map = g.isMask ? editor.masks : editor.images; if (g.originalSource) map.set(target.id, g.originalSource); else map.delete(target.id); editor.gesture = null; editor.update(); }
    else if (g?.kind === 'mask-move') { g.target.maskPlacement = g.original; editor.gesture = null; editor.update(); } else if (g?.kind === 'group-move') { for (const [layer, transform, mask] of g.originals) { layer.transform = transform; if (mask) layer.maskPlacement = mask; } editor.gesture = null; editor.update(); } else if (g?.isMask) { editor.masks.set((g.target ?? g.layer).id, g.source); editor.gesture = null; editor.update(); } else if (g?.kind === 'retouch') { editor.images.set(g.layer.id, g.source); editor.gesture = null; editor.update(); } else cancel(); editor.polygon = null; };
  editor.render = () => {
    originalRender(); if (!editor.manifest) return;
    const context = editor.overlay.getContext('2d'); context.save(); context.translate(editor.pan.x, editor.pan.y); context.scale(editor.zoom, editor.zoom); context.lineWidth = 1 / editor.zoom;
    if (editor.showsGrid || (editor.showsPixelGrid && editor.zoom >= 8)) {
      const step = editor.showsPixelGrid && editor.zoom >= 8 ? 1 : editor.grid.spacing / editor.grid.subdivisions;
      if (step * editor.zoom >= 3) { context.strokeStyle = '#8b9eac44'; context.beginPath();
        const x0 = Math.max(0, Math.floor(-editor.pan.x / editor.zoom / step) * step), y0 = Math.max(0, Math.floor(-editor.pan.y / editor.zoom / step) * step);
        const x1 = Math.min(editor.manifest.width, (editor.viewport.clientWidth - editor.pan.x) / editor.zoom), y1 = Math.min(editor.manifest.height, (editor.viewport.clientHeight - editor.pan.y) / editor.zoom);
        for (let x = x0; x <= x1; x += step) { context.moveTo(x, y0); context.lineTo(x, y1); } for (let y = y0; y <= y1; y += step) { context.moveTo(x0, y); context.lineTo(x1, y); } context.stroke(); }
    }
    const g = editor.gesture, points = editor.polygon ? [...editor.polygon.points, editor.polygon.pointer ?? editor.polygon.points.at(-1)] : g?.kind === 'lasso' ? g.points : null;
    context.strokeStyle = '#ddd'; context.setLineDash([4 / editor.zoom, 4 / editor.zoom]);
    if (points?.length) { context.beginPath(); points.forEach((p, i) => i ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y)); context.stroke(); }
    if (g?.rect && ['ellipse', 'crop'].includes(g.kind)) { const r = g.rect; context.beginPath(); if (g.kind === 'ellipse') context.ellipse(r.x + r.width / 2, r.y + r.height / 2, r.width / 2, r.height / 2, 0, 0, Math.PI * 2); else context.rect(r.x, r.y, r.width, r.height); context.stroke(); }
    if (editor.pointerPosition && ['brush', 'eraser', 'clone', 'heal', 'blur'].includes(editor.tool)) { const p = editor.pointerPosition; context.setLineDash([]); context.beginPath(); context.arc(p.x, p.y, editor.brushSize / 2, 0, Math.PI * 2); context.strokeStyle = '#000b'; context.lineWidth = 2 / editor.zoom; context.stroke(); context.strokeStyle = '#fffb'; context.lineWidth = 1 / editor.zoom; context.stroke(); }
    context.restore();
    if (editor.showsRulers) {
      const ctx = editor.overlay.getContext('2d'), width = editor.viewport.clientWidth, height = editor.viewport.clientHeight; ctx.save(); ctx.fillStyle = '#303034'; ctx.fillRect(0, 0, width, 20); ctx.fillRect(0, 0, 20, height); ctx.fillStyle = '#aaa'; ctx.font = '9px Segoe UI';
      const step = 10 ** Math.ceil(Math.log10(60 / editor.zoom));
      for (let x = Math.max(0, Math.floor(-editor.pan.x / editor.zoom / step) * step); editor.pan.x + x * editor.zoom < width; x += step) ctx.fillText(String(x), editor.pan.x + x * editor.zoom + 3, 13);
      for (let y = Math.max(0, Math.floor(-editor.pan.y / editor.zoom / step) * step); editor.pan.y + y * editor.zoom < height; y += step) { ctx.save(); ctx.translate(13, editor.pan.y + y * editor.zoom + 3); ctx.rotate(-Math.PI / 2); ctx.fillText(String(y), 0, 0); ctx.restore(); } ctx.restore();
    }
  };
  document.addEventListener('keydown', (event) => {
    if (event.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || document.querySelector('dialog[open]')) return;
    if (event.key === 'Enter' && editor.polygon) finishPolygon();
    if (event.key === 'Escape') editor.polygon = null;
    const mapping = { w: 'wand', j: 'heal', s: 'clone', r: 'blur', g: 'gradient', l: 'lasso', c: 'crop' };
    if (!event.ctrlKey && !event.metaKey && !event.altKey && mapping[event.key.toLowerCase()]) api.setTool(mapping[event.key.toLowerCase()]);
  });
  editor.overlay.addEventListener('pointerleave', () => { editor.pointerPosition = null; editor.draw(); });
  editor.toolCommand = async (command) => {
    if (command === 'delete' && editor.selection && editor.active && sourceFor(editor.active)) {
      editor.mutate('Clear Selection', () => { const layer = editor.active, source = editor.editMask ? rasterTarget(editor, layer, true).source : sourceFor(layer), image = copySurface(source), context = image.getContext('2d'), target = editor.editMask ? { ...layer, transform: layer.maskPlacement ?? layer.transform } : layer; context.globalCompositeOperation = editor.editMask ? 'source-over' : 'destination-out'; context.drawImage(mappedSelection(editor, target, image.width, image.height), 0, 0); if (editor.editMask) storeMask(editor, layer, image); else { editor.storePixels(layer, image); editor.rasterize(layer); } }); return true;
    }
    if (command === 'tool-settings') {
      const fields = [n('tolerance', 'Wand tolerance', 0, 255, 32), b('contiguous', 'Contiguous', true), b('sampleAll', 'Sample all layers', true), b('aligned', 'Aligned clone', true), { key: 'mode', label: 'Retouch mode', options: ['Blur', 'Smudge', 'Liquify'], default: 'Blur' }, n('smoothing', 'Brush smoothing', 0, 100), n('feather', 'Selection feather', 0, 250), n('cornerRadius', 'Corner radius', 0, 500, 16), n('lineWidth', 'Line width', 1, 500, 4), { key: 'cropRatio', label: 'Crop ratio', options: ['Free', '1:1', '3:4', '4:3', '9:16', '16:9', '9:20', 'Custom'], default: 'Free' }, n('cropWidth', 'Custom ratio width', 1, 10000, 9), n('cropHeight', 'Custom ratio height', 1, 10000, 20)];
      const value = await settingsDialog('Tool Settings', fields, editor.toolSettings, null, { apply: (value) => { cropAspect(value.cropRatio, value.cropWidth, value.cropHeight); } }); if (value) editor.toolSettings = value; return true;
    }
    if (command === 'text' || command === 'edit-text') {
      const layer = command === 'edit-text' && editor.active?.text ? editor.active : null;
      const initial = layer?.text ?? { content: 'Text', fontName: 'Arial', fontSize: 72, alignment: 'Left', tracking: 0, leading: 0, ...colorRecord(editor.color) };
      const value = await settingsDialog(layer ? 'Edit Text' : 'Add Text', [{ key: 'content', label: 'Text', type: 'textarea' }, { key: 'fontName', label: 'Font family', type: 'text' }, n('fontSize', 'Font size', 1, 2000, 72), c('color', 'Color', initial), { key: 'alignment', label: 'Alignment', options: ['Left', 'Center', 'Right'], default: 'Left' }, n('tracking', 'Tracking', -100, 1000), n('leading', 'Line spacing (0 = auto)', 0, 5000), n('boxWidth', 'Paragraph width (0 = auto)', 0, 30000), n('boxHeight', 'Paragraph height (0 = auto)', 0, 30000)], initial);
      if (value) editor.mutate('Type', () => { if (layer && value.content !== initial.content) { const adjusted = replaceTextContent(initial, value.content); value.colorRuns = adjusted.colorRuns; value.fontRuns = adjusted.fontRuns; value.sizeRuns = adjusted.sizeRuns; } Object.assign(value, value.color); delete value.color; if (value.boxWidth && value.boxHeight) value.boxSize = [value.boxWidth, value.boxHeight]; delete value.boxWidth; delete value.boxHeight;
        const image = renderText(value); let target = layer;
        if (!target) { target = createLayer(value.content.split('\n')[0].slice(0, 30) || 'Text', image.width, image.height); target.transform.origin = [(editor.manifest.width - image.width) / 2, (editor.manifest.height - image.height) / 2]; editor.manifest.layers.push(target); editor.manifest.activeLayerID = target.id; }
        else target.transform.size = [image.width, image.height]; target.text = value; editor.storePixels(target, image);
      }); return true;
    }
    if (command === 'edit-shape') {
      const layer = editor.active; if (!layer?.shape) return true;
      const result = await settingsDialog('Shape', [{ key: 'kind', label: 'Kind', options: ['Rectangle', 'Ellipse', 'Line'] }, c('color', 'Color', layer.shape), n('cornerRadius', 'Corner radius', 0, 500), n('lineWidth', 'Line width', 1, 500, 4)], layer.shape);
      if (result) editor.mutate('Shape Style', () => { Object.assign(result, result.color); delete result.color; layer.shape = result; editor.storePixels(layer, drawShape(result, ...layer.transform.size)); }); return true;
    }
    if (command === 'select-layer' || command === 'select-mask') {
      const layer = editor.active, source = layer && (command === 'select-mask' ? editor.masks : editor.images).get(layer.id);
      if (source) { const canvas = surface(editor.manifest.width, editor.manifest.height); place(canvas.getContext('2d'), source, command === 'select-mask' ? layer.maskPlacement ?? layer.transform : layer.transform); combineSelection(editor, canvas); } return true;
    }
    if (command === 'content-fill') {
      const layer = editor.active, source = layer && editor.images.get(layer.id); if (!source || !editor.selection) return true;
      editor.mutate('Content-Aware Fill', () => { const canvas = copySurface(source), context = canvas.getContext('2d'), data = context.getImageData(0, 0, canvas.width, canvas.height), mask = maskValues(mappedSelection(editor, layer, canvas.width, canvas.height));
        pixelKernel(data.data, canvas.width, canvas.height, (p, w, h, stride) => kernels.content_fill(p, stride, allocate(mask), w, w, h)); context.putImageData(data, 0, 0); editor.storePixels(layer, canvas); editor.rasterize(layer); }); return true;
    }
    if (command === 'color-range') {
      const result = await settingsDialog('Color Range', [c('color', 'Sample color', colorRecord(editor.color)), n('fuzziness', 'Fuzziness', 0, 255, 40), b('invert', 'Invert')], {});
      if (result) { const canvas = editor.composite(true), data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height), rgb = new Uint8Array([result.color.red, result.color.green, result.color.blue].map((x) => Math.round(x * 255))); let mask;
        pixelKernel(data.data, canvas.width, canvas.height, (p, w, h, stride) => { const out = allocate(w * h); kernels.color_range_mask(p, w, h, stride, allocate(rgb), 1, 0, 0, result.fuzziness, result.invert ? 1 : 0, out); mask = new Uint8ClampedArray(kernels.memory.buffer, out, w * h).slice(); }); combineSelection(editor, alphaSurface(mask, canvas.width, canvas.height)); } return true;
    }
    return false;
  };
}
