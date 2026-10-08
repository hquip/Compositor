import { surface, place } from './raster.js';
import { selectionCanvas, maskValues, storeMask, combineSelection } from './masks.js';
import { placedMask } from './raster-space.js';
import { settingsDialog, numberField as n } from './settings-dialog.js';
import { FilterTask } from './filter-task.js';

export function installMaskRefinement(editor, api) {
  const previous = editor.advancedCommand;
  editor.advancedCommand = async (command) => {
    if (!['refine-selection', 'refine-mask'].includes(command)) return previous(command);
    if (!editor.manifest) return true;
    const layer = editor.active, mask = command === 'refine-mask'; if (mask && !layer?.maskFile || !mask && !editor.selection) return true;
    const { width, height } = editor.manifest, transform = { origin: [0, 0], size: [width, height], rotation: 0, flipX: false, flipY: false, sampling: 'High quality' };
    const original = mask ? placedMask(editor.masks.get(layer.id), layer, transform, width, height) : selectionCanvas(editor);
    const guide = surface(width, height); if (mask && editor.images.has(layer.id)) place(guide.getContext('2d'), editor.images.get(layer.id), layer.transform); else guide.getContext('2d').drawImage(editor.composite(true), 0, 0);
    const scale = Math.min(1, 900 / Math.max(width, height)), small = surface(Math.round(width * scale), Math.round(height * scale)), matte = surface(small.width, small.height);
    small.getContext('2d').drawImage(guide, 0, 0, small.width, small.height); matte.getContext('2d').drawImage(original, 0, 0, matte.width, matte.height);
    const canvas = surface(small.width, small.height); canvas.className = 'matte-preview'; canvas.setAttribute('aria-label', 'Mask refinement preview');
    const task = new FilterTask(), strokes = [], limits = document.body.classList.contains('mobile-app') ? { side: 8192, pixels: 16000000 } : { side: 30000, pixels: 200000000 };
    let settings = { radius: 5, smooth: 0, feather: 0, contrast: 0, shift: 0, view: 'On black', brush: 'Keep', brushSize: 20, output: mask ? 'Layer mask' : 'Selection' }, sequence = 0, closed = false, drawing, previewImage = matte, output;
    const paint = () => {
      const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (settings.view === 'Mask') { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(previewImage, 0, 0); return; }
      const image = surface(canvas.width, canvas.height), context = image.getContext('2d'); context.drawImage(small, 0, 0);
      if (settings.view !== 'Overlay') { context.globalCompositeOperation = 'destination-in'; context.drawImage(previewImage, 0, 0); }
      ctx.fillStyle = settings.view === 'On white' ? '#fff' : '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0);
      if (settings.view === 'Overlay') { context.globalCompositeOperation = 'source-over'; context.clearRect(0, 0, image.width, image.height); context.fillStyle = '#e6434377'; context.fillRect(0, 0, image.width, image.height); context.globalCompositeOperation = 'destination-out'; context.drawImage(previewImage, 0, 0); ctx.drawImage(image, 0, 0); }
    };
    const preview = async (value = settings) => {
      settings = { ...value }; const token = ++sequence; task.cancel();
      const result = await task.run(small, 'refine-mask', null, { ...settings, strokes, matte: maskValues(matte) }, scale, limits);
      if (!closed && token === sequence) { previewImage = result; paint(); }
    };
    const point = (event) => { const rect = canvas.getBoundingClientRect(), factor = Math.min(rect.width / canvas.width, rect.height / canvas.height), w = canvas.width * factor, h = canvas.height * factor; return { x: Math.max(0, Math.min(1, (event.clientX - rect.x - (rect.width - w) / 2) / w)), y: Math.max(0, Math.min(1, (event.clientY - rect.y - (rect.height - h) / 2) / h)) }; };
    canvas.addEventListener('pointerdown', (event) => { if (closed || event.button !== 0) return; drawing = { mode: settings.brush, radius: settings.brushSize / 2, points: [point(event)] }; strokes.push(drawing); canvas.setPointerCapture(event.pointerId); });
    canvas.addEventListener('pointermove', (event) => { if (drawing) drawing.points.push(point(event)); });
    const finish = () => { if (!drawing) return; drawing = null; preview().catch((error) => { if (error.name !== 'AbortError') api.showError(error); }); };
    canvas.addEventListener('pointerup', finish); canvas.addEventListener('pointercancel', () => { if (drawing) { strokes.pop(); drawing = null; } });
    const fields = [n('radius', 'Edge radius', 0, 100, 5), n('smooth', 'Smooth', 0, 20), n('feather', 'Feather', 0, 50), n('contrast', 'Contrast', 0, 100), n('shift', 'Shift edge', -50, 50),
      { key: 'view', label: 'Preview background', options: ['On black', 'On white', 'Overlay', 'Mask'] }, { key: 'brush', label: 'Refinement brush', options: ['Keep', 'Remove'] }, n('brushSize', 'Brush size', 1, 500, 20),
      { key: 'output', label: 'Output', options: layer ? ['Selection', 'Layer mask'] : ['Selection'] }];
    try {
      const result = await settingsDialog('Refine selection and mask', fields, settings, preview, { previewElement: canvas, initialPreview: true,
        apply: async (value, signal) => { sequence++; task.cancel(); const result = await task.run(guide, 'refine-mask', null, { ...value, strokes, matte: maskValues(original) }, 1, limits); if (!signal.aborted) output = result; },
        cancel: () => { closed = true; sequence++; task.cancel(); },
      });
      if (result && output) editor.mutate('Refine Mask', () => {
        if (result.output === 'Layer mask' && layer) { layer.maskPlacement = structuredClone(transform); layer.maskLinked = false; layer.maskEnabled = true; storeMask(editor, layer, output); editor.editMask = true; }
        else combineSelection(editor, output);
      });
    } finally { closed = true; task.cancel(); }
    return true;
  };
}
