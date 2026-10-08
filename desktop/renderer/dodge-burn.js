import { copySurface } from './raster.js';

const linear = (v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
const encoded = (v) => v <= .0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - .055;
export function dodgeBurnPixels(original, coverage, mode, range, exposure, opacity = 1) {
  if (original.length !== coverage.length * 4 || !['Dodge', 'Burn'].includes(mode) || !['Shadows', 'Midtones', 'Highlights'].includes(range) || !Number.isFinite(exposure) || exposure < 0 || exposure > 100 || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new Error('Invalid Dodge/Burn settings.');
  const result = new Uint8ClampedArray(original); if (!exposure || !opacity) return result;
  for (let i = 0; i < coverage.length; i++) {
    const at = i * 4; if (!original[at + 3] || !coverage[i]) continue;
    const light = (.2126 * original[at] + .7152 * original[at + 1] + .0722 * original[at + 2]) / 255;
    const weight = range === 'Shadows' ? (1 - light) ** 2 : range === 'Highlights' ? light ** 2 : 4 * light * (1 - light);
    const amount = coverage[i] / 255 * opacity * weight, gain = 2 ** ((mode === 'Dodge' ? 1 : -1) * exposure / 100 * 3);
    for (let c = 0; c < 3; c++) { const value = linear(original[at + c] / 255); result[at + c] = Math.round(Math.max(0, Math.min(1, encoded(value * (1 - amount) + Math.min(1, value * gain) * amount))) * 255); }
  }
  return result;
}

export function installDodgeBurn(editor, api) {
  const mode = document.createElement('select'); mode.id = 'brush-mode'; mode.setAttribute('aria-label', 'Brush mode');
  for (const name of ['Paint', 'Dodge', 'Burn']) { const option = document.createElement('option'); option.value = name; option.textContent = name; mode.append(option); }
  const range = document.createElement('select'); range.setAttribute('aria-label', 'Tonal range');
  for (const name of ['Shadows', 'Midtones', 'Highlights']) { const option = document.createElement('option'); option.value = name; option.textContent = name; range.append(option); } range.value = 'Midtones';
  const exposure = document.createElement('input'); exposure.type = 'number'; exposure.min = '0'; exposure.max = '100'; exposure.value = '50'; exposure.setAttribute('aria-label', 'Dodge/Burn exposure');
  const controls = document.createElement('span'); controls.className = 'dodge-burn-controls'; controls.hidden = true; controls.append(range, exposure); document.querySelector('#brush-options').append(mode, controls);
  editor.brushMode = 'Paint';
  mode.addEventListener('change', () => { editor.brushMode = mode.value; controls.hidden = mode.value === 'Paint'; if (mode.value !== 'Paint') api.setTool('brush'); });
  const down = editor.pointerDown.bind(editor), paint = editor.paintSegment.bind(editor), up = editor.pointerUp.bind(editor);
  editor.pointerDown = (event) => {
    if (editor.tool === 'brush' && editor.brushMode !== 'Paint' && !editor.spaceDown && event.button === 0) {
      if (editor.editMask) { api.showError(new Error('Dodge and Burn cannot paint a layer mask.')); return; }
      const value = Number(exposure.value); if (!Number.isFinite(value) || value < 0 || value > 100) { api.showError(new Error('Dodge/Burn exposure must be between 0 and 100.')); return; }
      if (!value || !editor.active || !editor.images.has(editor.active.id)) return;
    }
    down(event);
  };
  editor.paintSegment = (from, to) => {
    const g = editor.gesture;
    if (g?.kind !== 'paint' || g.tool !== 'brush' || g.isMask || editor.brushMode === 'Paint') return paint(from, to);
    g.dodgeBurn ??= { mode: editor.brushMode, range: range.value, exposure: Number(exposure.value), opacity: editor.brushOpacity };
    const color = editor.color; editor.color = '#ffffff'; try { paint(from, to); } finally { editor.color = color; }
    const before = g.source.getContext('2d').getImageData(0, 0, g.source.width, g.source.height), mask = g.paint.getContext('2d').getImageData(0, 0, g.paint.width, g.paint.height);
    const clip = g.clip?.getContext('2d').getImageData(0, 0, g.clip.width, g.clip.height).data;
    const coverage = Uint8Array.from({ length: g.source.width * g.source.height }, (_, i) => mask.data[i * 4 + 3] * (clip ? clip[i * 4 + 3] / 255 : 1));
    const values = dodgeBurnPixels(before.data, coverage, g.dodgeBurn.mode, g.dodgeBurn.range, g.dodgeBurn.exposure, g.dodgeBurn.opacity);
    g.dodgeChanged = values.some((value, i) => value !== before.data[i]);
    const output = copySurface(g.source); output.getContext('2d').putImageData(new ImageData(values, output.width, output.height), 0, 0); g.canvas = output; g.result = output;
    editor.images.set(g.layer.id, output); editor.preview = null; editor.draw();
  };
  editor.pointerUp = (event) => {
    if (editor.gesture?.dodgeBurn && !editor.gesture.dodgeChanged) { editor.cancelGesture(); if (editor.overlay.hasPointerCapture(event.pointerId)) editor.overlay.releasePointerCapture(event.pointerId); return; }
    return up(event);
  };
}
