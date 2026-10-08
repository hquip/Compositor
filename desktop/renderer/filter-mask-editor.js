import { surface } from './raster.js';
import { maskValues } from './masks.js';
import { FilterTask } from './filter-task.js';
import { settingsDialog, numberField as n } from './settings-dialog.js';
import { encodePNGGray } from './png-pixels.js';
import { binaryBase64 } from './psd-export.js';

export async function editFilterMask(source, mask, api, limits) {
  const factor = Math.min(1, 768 / Math.max(source.width, source.height)), small = surface(Math.max(1, Math.round(source.width * factor)), Math.max(1, Math.round(source.height * factor)));
  small.getContext('2d').drawImage(source, 0, 0, small.width, small.height);
  const canvas = surface(small.width, small.height); canvas.className = 'filter-mask-preview'; canvas.setAttribute('aria-label', 'Paint filter mask');
  const toolbar = document.createElement('div'); toolbar.className = 'filter-mask-toolbar';
  const panel = document.createElement('div'); panel.className = 'filter-mask-panel'; panel.append(canvas, toolbar);
  const task = new FilterTask(), edits = []; let drawing = null, settings = { brush: 'Reveal', brushSize: 40, hardness: 80, brushOpacity: 100, feather: 0, view: 'Overlay' }, matte, closed = false, sequence = 0, output;
  const paint = () => {
    const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!matte) return;
    if (settings.view === 'Mask') { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(matte, 0, 0); return; }
    ctx.fillStyle = '#242425'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(small, 0, 0);
    const tint = surface(canvas.width, canvas.height), t = tint.getContext('2d'); t.fillStyle = '#e6434388'; t.fillRect(0, 0, tint.width, tint.height); t.globalCompositeOperation = 'destination-out'; t.drawImage(matte, 0, 0); ctx.drawImage(tint, 0, 0);
  };
  const preview = async (value = settings) => {
    settings = { ...value }; const token = ++sequence;
    const image = await task.run(small, 'filter-mask', null, { mask, edits: structuredClone(edits), feather: settings.feather }, factor, limits);
    if (!closed && !drawing && token === sequence) { matte = image; paint(); }
  };
  for (const [label, edit] of [['Reveal all', { kind: 'fill', value: 255 }], ['Hide all', { kind: 'fill', value: 0 }], ['Invert mask', { kind: 'invert' }]]) { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.addEventListener('click', () => { if (drawing) return; edits.push(edit); preview().catch((error) => { if (error.name !== 'AbortError') api.showError(error); }); }); toolbar.append(button); }
  const point = (event) => { const rect = canvas.getBoundingClientRect(), f = Math.min(rect.width / canvas.width, rect.height / canvas.height), w = canvas.width * f, h = canvas.height * f; return [(event.clientX - rect.x - (rect.width - w) / 2) / w, (event.clientY - rect.y - (rect.height - h) / 2) / h]; };
  const feedback = (p, previous) => {
    if (!matte || !drawing) return;
    const ctx = matte.getContext('2d'), radius = Math.max(.5, drawing.size * factor / 2), current = [p[0] * small.width, p[1] * small.height], first = previous ? [previous[0] * small.width, previous[1] * small.height] : current, steps = Math.max(1, Math.ceil(Math.hypot(current[0] - first[0], current[1] - first[1]) / Math.max(.5, radius / 4)));
    ctx.save(); ctx.globalCompositeOperation = drawing.value ? 'source-over' : 'destination-out'; ctx.globalAlpha = drawing.opacity;
    for (let i = 1; i <= steps; i++) { const x = first[0] + (current[0] - first[0]) * i / steps, y = first[1] + (current[1] - first[1]) * i / steps, gradient = ctx.createRadialGradient(x, y, radius * Math.min(.9999, drawing.hardness), x, y, radius); gradient.addColorStop(0, '#fff'); gradient.addColorStop(1, '#fff0'); ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2); }
    ctx.restore(); paint();
  };
  canvas.addEventListener('pointerdown', (event) => { if (closed || drawing || event.button !== 0 || edits.length >= 1000) return; event.preventDefault(); drawing = { kind: 'stroke', value: settings.brush === 'Reveal' ? 255 : 0, size: settings.brushSize, hardness: settings.hardness / 100, opacity: settings.brushOpacity / 100, points: [point(event)] }; edits.push(drawing); canvas.setPointerCapture(event.pointerId); feedback(drawing.points[0]); });
  canvas.addEventListener('pointermove', (event) => { if (drawing && drawing.points.length < 10000) { const p = point(event), previous = drawing.points.at(-1); drawing.points.push(p); feedback(p, previous); } });
  const finish = () => { if (!drawing) return; drawing = null; if (!closed) preview().catch((error) => { if (error.name !== 'AbortError') api.showError(error); }); };
  const cancelStroke = () => { if (drawing) { edits.pop(); drawing = null; if (!closed) preview().catch((error) => { if (error.name !== 'AbortError') api.showError(error); }); } };
  canvas.addEventListener('pointerup', finish); canvas.addEventListener('pointercancel', cancelStroke); canvas.addEventListener('lostpointercapture', cancelStroke);
  try {
    const result = await settingsDialog('Filter mask', [{ key: 'brush', label: 'Mask brush', options: ['Reveal', 'Hide'] }, n('brushSize', 'Brush size', 1, 2000, 40), n('hardness', 'Hardness', 0, 100, 80), n('brushOpacity', 'Brush opacity', 1, 100, 100), n('feather', 'Feather', 0, 250), { key: 'view', label: 'Mask view', options: ['Overlay', 'Mask'] }], settings, preview, { previewElement: panel, initialPreview: true,
      apply: async (value, signal) => { drawing = null; sequence++; const image = await task.run(source, 'filter-mask', null, { mask, edits, feather: value.feather }, 1, limits); if (!signal.aborted) { const values = maskValues(image), solid = values.every((value) => value === values[0]); output = binaryBase64(await encodePNGGray(solid ? 1 : image.width, solid ? 1 : image.height, solid ? new Uint8Array([values[0]]) : values)); } },
      cancel: () => { closed = true; sequence++; task.cancel(); },
    });
    return result ? output : null;
  } finally { closed = true; task.cancel(); }
}
