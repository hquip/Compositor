import { documentPoint, localPoint, canvasSize } from './core.js';
import { surface, copySurface } from './raster.js';
import { descendants, selected, boundsOf, selectionTransform } from './layer-operations.js';
import { following } from './affine.js';
import { storeMask } from './masks.js';

export function homography(corners) {
  const units = [[0, 0], [1, 0], [1, 1], [0, 1]], a = [];
  for (let i = 0; i < 4; i++) { const [u, v] = units[i], { x, y } = corners[i]; a.push([u, v, 1, 0, 0, 0, -x * u, -x * v, x], [0, 0, 0, u, v, 1, -y * u, -y * v, y]); }
  for (let c = 0; c < 8; c++) {
    let pivot = c; for (let r = c + 1; r < 8; r++) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
    if (Math.abs(a[pivot][c]) < 1e-10) throw new Error('The distortion corners overlap.'); [a[c], a[pivot]] = [a[pivot], a[c]];
    const divisor = a[c][c]; for (let j = c; j <= 8; j++) a[c][j] /= divisor;
    for (let r = 0; r < 8; r++) if (r !== c) { const factor = a[r][c]; for (let j = c; j <= 8; j++) a[r][j] -= factor * a[c][j]; }
  }
  return [...a.map((row) => row[8]), 1];
}
export function inverse3(m) {
  const [a, b, c, d, e, f, g, h, i] = m, determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(determinant) < 1e-12) throw new Error('The transform is not invertible.');
  return [(e * i - f * h), (c * h - b * i), (b * f - c * e), (f * g - d * i), (a * i - c * g), (c * d - a * f), (d * h - e * g), (b * g - a * h), (a * e - b * d)].map((v) => v / determinant);
}
export function warpImage(image, corners) {
  const left = Math.floor(Math.min(...corners.map((p) => p.x))), top = Math.floor(Math.min(...corners.map((p) => p.y)));
  const width = Math.max(1, Math.ceil(Math.max(...corners.map((p) => p.x))) - left), height = Math.max(1, Math.ceil(Math.max(...corners.map((p) => p.y))) - top);
  canvasSize(width, height);
  const inverse = inverse3(homography(corners.map((point) => ({ x: point.x - left, y: point.y - top }))));
  const output = surface(width, height), ctx = output.getContext('2d'), source = image.getContext('2d').getImageData(0, 0, image.width, image.height), target = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = x + .5, dy = y + .5, denominator = inverse[6] * dx + inverse[7] * dy + inverse[8];
    const u = (inverse[0] * dx + inverse[1] * dy + inverse[2]) / denominator, v = (inverse[3] * dx + inverse[4] * dy + inverse[5]) / denominator;
    if (u < 0 || v < 0 || u > 1 || v > 1) continue;
    const sx = Math.max(0, Math.min(image.width - 1, u * image.width - .5)), sy = Math.max(0, Math.min(image.height - 1, v * image.height - .5)), x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
    const offsets = [y0 * image.width + x0, y0 * image.width + Math.min(image.width - 1, x0 + 1), Math.min(image.height - 1, y0 + 1) * image.width + x0, Math.min(image.height - 1, y0 + 1) * image.width + Math.min(image.width - 1, x0 + 1)], weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
    let alpha = 0; const rgb = [0, 0, 0];
    for (let j = 0; j < 4; j++) { const index = offsets[j] * 4, a = source.data[index + 3] / 255 * weights[j]; alpha += a; for (let c = 0; c < 3; c++) rgb[c] += source.data[index + c] * a; }
    const index = (y * width + x) * 4; for (let c = 0; c < 3; c++) target.data[index + c] = alpha ? rgb[c] / alpha : 0; target.data[index + 3] = alpha * 255;
  }
  ctx.putImageData(target, 0, 0); return { image: output, origin: [left, top], size: [width, height] };
}

export function distortLayer(editor, layer, corners) {
  const source = editor.images.get(layer.id); if (!source) return;
  const original = structuredClone(layer.transform), image = warpImage(source, corners), mask = editor.masks.get(layer.id);
  let warpedMask;
  if (mask && layer.maskLinked !== false && (mask.width !== 1 || mask.height !== 1)) {
    const projection = homography(corners), placement = layer.maskPlacement ?? original;
    const mapped = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }].map((point) => {
      const p = localPoint(documentPoint(point, placement), original, 1, 1), d = projection[6] * p.x + projection[7] * p.y + projection[8];
      if (Math.abs(d) < 1e-8) throw new Error('The mask crosses the perspective horizon.');
      return { x: (projection[0] * p.x + projection[1] * p.y + projection[2]) / d, y: (projection[3] * p.x + projection[4] * p.y + projection[5]) / d };
    });
    warpedMask = warpImage(mask, mapped);
  }
  const transform = { ...original, origin: image.origin, size: image.size, rotation: 0, flipX: false, flipY: false };
  if (warpedMask) { layer.maskPlacement = { ...transform, origin: warpedMask.origin, size: warpedMask.size }; storeMask(editor, layer, warpedMask.image); }
  else if (mask && layer.maskLinked === false && !layer.maskPlacement) layer.maskPlacement = original;
  layer.transform = transform; editor.storePixels(layer, image.image); editor.rasterize(layer);
}

export function installTransforms(editor, api) {
  const down = editor.pointerDown.bind(editor), move = editor.pointerMove.bind(editor), up = editor.pointerUp.bind(editor), cancel = editor.cancelGesture.bind(editor), render = editor.render.bind(editor);
  const corners = (t) => [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }].map((point) => documentPoint(point, t));
  editor.pointerDown = (event) => {
    if (editor.busy || editor.gesture || document.querySelector('dialog[open]') || editor.spaceDown || event.button !== 0) return down(event);
    if (editor.showsRulers) {
      const view = editor.viewPoint(event);
      if (view.x < 20 || view.y < 20) { editor.gesture = { kind: 'guide', axis: view.x < 20 ? 'vertical' : 'horizontal', point: editor.toDocument(view) }; editor.overlay.setPointerCapture(event.pointerId); return; }
    }
    if (editor.tool !== 'move' || !editor.active || editor.editMask) return down(event);
    const point = editor.toDocument(editor.viewPoint(event)), grouped = editor.active.isGroup || selected(editor).size > 1;
    const layer = grouped ? { ...editor.active, transform: { ...selectionTransform(editor), rotation: 0 } } : editor.active, positions = corners(layer.transform);
    const touch = event.pointerType === 'touch';
    let index = positions.findIndex((p) => Math.hypot(p.x - point.x, p.y - point.y) < (touch ? 22 : 8) / editor.zoom), rotation = false;
    if (index < 0) { index = positions.findIndex((p) => Math.hypot(p.x - point.x, p.y - point.y) < (touch ? 36 : 21) / editor.zoom); rotation = index >= 0; }
    if (index < 0) return down(event);
    const kind = (event.ctrlKey || editor.transformHandleMode === 'Free Distort') && !grouped ? 'distort-handle' : rotation || editor.transformHandleMode === 'Rotate' ? 'rotate-handle' : 'resize-handle';
    editor.gesture = { kind, index, point, before: editor.snapshot(), original: structuredClone(layer.transform), originalMaskPlacement: layer.maskPlacement && structuredClone(layer.maskPlacement), positions, layer, source: editor.images.get(layer.id), angle: Math.atan2(point.y - (layer.transform.origin[1] + layer.transform.size[1] / 2), point.x - (layer.transform.origin[0] + layer.transform.size[0] / 2)) };
    if (grouped) { const ids = descendants(editor, selected(editor)); editor.gesture.members = editor.manifest.layers.filter((item) => ids.has(item.id)).map((item) => [item, structuredClone(item.transform), item.maskPlacement && structuredClone(item.maskPlacement)]); }
    editor.overlay.setPointerCapture(event.pointerId);
  };
  editor.pointerMove = (event) => {
    const g = editor.gesture, point = editor.toDocument(editor.viewPoint(event));
    if (!g) return move(event);
    if (g.kind === 'guide') { g.point = point; editor.draw(); return; }
    if (!g.kind.endsWith('-handle')) return move(event);
    if (g.kind === 'distort-handle') { g.positions[g.index] = point; editor.draw(); return; }
    if (g.kind === 'rotate-handle') {
      const t = g.original, cx = t.origin[0] + t.size[0] / 2, cy = t.origin[1] + t.size[1] / 2;
      let rotation = t.rotation + (Math.atan2(point.y - cy, point.x - cx) - g.angle) * 180 / Math.PI; if (event.shiftKey) rotation = Math.round(rotation / 15) * 15; g.layer.transform.rotation = rotation;
    } else {
      const anchor = g.positions[(g.index + 2) % 4], angle = g.original.rotation * Math.PI / 180, dx = point.x - anchor.x, dy = point.y - anchor.y;
      let width = Math.max(1, Math.abs(dx * Math.cos(angle) + dy * Math.sin(angle))), height = Math.max(1, Math.abs(-dx * Math.sin(angle) + dy * Math.cos(angle)));
      if (event.shiftKey || editor.lockTransformAspect) height = width * g.original.size[1] / g.original.size[0];
      g.layer.transform.size = [width, height]; g.layer.transform.origin = [(anchor.x + point.x - width) / 2, (anchor.y + point.y - height) / 2];
    }
    if (g.members) for (const [member, original, mask] of g.members) { member.transform = following(original, g.original, g.layer.transform); if (mask && member.maskLinked !== false) member.maskPlacement = following(mask, g.original, g.layer.transform); }
    else if (g.originalMaskPlacement && g.layer.maskLinked !== false) g.layer.maskPlacement = following(g.originalMaskPlacement, g.original, g.layer.transform);
    editor.preview = null; editor.draw();
  };
  editor.pointerUp = (event) => {
    const g = editor.gesture; if (!g || (!g.kind.endsWith('-handle') && g.kind !== 'guide')) return up(event);
    editor.pointerMove(event); editor.gesture = null;
    try {
      if (g.kind === 'guide') editor.mutate('Add Guide', () => { (editor.manifest.guides ??= []).push({ id: crypto.randomUUID().toUpperCase(), axis: g.axis, position: g.axis === 'vertical' ? g.point.x : g.point.y }); });
      else {
        if (g.kind === 'distort-handle' && g.source) distortLayer(editor, g.layer, g.positions);
        editor.history.push(g.before, editor.snapshot(), g.kind === 'distort-handle' ? 'Free Distort' : 'Transform'); editor.update();
      }
    } catch (error) { editor.install(g.before); api.showError(error); }
    if (editor.overlay.hasPointerCapture(event.pointerId)) editor.overlay.releasePointerCapture(event.pointerId);
  };
  editor.cancelGesture = () => { const g = editor.gesture; if (g?.kind.endsWith('-handle')) { g.layer.transform = g.original; if (g.originalMaskPlacement) g.layer.maskPlacement = g.originalMaskPlacement; if (g.members) for (const [member, original, mask] of g.members) { member.transform = original; if (mask) member.maskPlacement = mask; } editor.gesture = null; editor.update(); } else if (g?.kind === 'guide') { editor.gesture = null; editor.draw(); } else cancel(); };
  editor.render = () => {
    render();
    if (editor.active && editor.tool === 'move' && (editor.active.isGroup || selected(editor).size > 1)) {
      const t = selectionTransform(editor), ctx = editor.overlay.getContext('2d'); ctx.save(); ctx.translate(editor.pan.x, editor.pan.y); ctx.scale(editor.zoom, editor.zoom); ctx.lineWidth = 1 / editor.zoom; ctx.strokeStyle = '#78a9ff'; ctx.strokeRect(...t.origin, ...t.size); ctx.fillStyle = '#ddd'; for (const point of corners({ ...t, rotation: 0 })) ctx.fillRect(point.x - 3 / editor.zoom, point.y - 3 / editor.zoom, 6 / editor.zoom, 6 / editor.zoom); ctx.restore();
    }
    const g = editor.gesture; if (!g || (g.kind !== 'guide' && g.kind !== 'distort-handle')) return;
    const ctx = editor.overlay.getContext('2d'); ctx.save(); ctx.translate(editor.pan.x, editor.pan.y); ctx.scale(editor.zoom, editor.zoom); ctx.lineWidth = 1 / editor.zoom; ctx.strokeStyle = '#63cbeb'; ctx.beginPath();
    if (g.kind === 'guide') { if (g.axis === 'vertical') { ctx.moveTo(g.point.x, 0); ctx.lineTo(g.point.x, editor.manifest.height); } else { ctx.moveTo(0, g.point.y); ctx.lineTo(editor.manifest.width, g.point.y); } }
    else { g.positions.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); } ctx.stroke(); ctx.restore();
  };
}
