import { settingsDialog, boolField } from './settings-dialog.js';

export function penResponse(point, settings = {}) {
  if (point.pointerType !== 'pen') return { size: 1, opacity: 1, aspect: 1, angle: 0 };
  const pressure = Math.max(.02, Math.min(1, Number.isFinite(point.pressure) ? point.pressure : 1)), tiltX = point.tiltX ?? 0, tiltY = point.tiltY ?? 0;
  return { size: settings.size !== false ? pressure : 1, opacity: settings.opacity ? pressure : 1,
    aspect: settings.tilt ? Math.max(.2, Math.cos(Math.min(80, Math.hypot(tiltX, tiltY)) * Math.PI / 180)) : 1, angle: settings.tilt ? Math.atan2(tiltY, tiltX) : 0 };
}
export function installPenInput(editor, api) {
  const defaults = { size: true, opacity: false, tilt: false, palmRejection: true }; let saved = {};
  try { saved = JSON.parse(localStorage.getItem('compositor.pen') ?? '{}'); } catch { }
  editor.penSettings = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, typeof saved[key] === 'boolean' ? saved[key] : value]));
  let activePen = null, lastPen = 0;
  const down = (event) => {
    if (event.pointerType === 'pen') { activePen = event.pointerId; lastPen = Date.now(); }
    else if (event.pointerType === 'touch' && editor.penSettings.palmRejection && (activePen != null || Date.now() - lastPen < 400)) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  editor.overlay.addEventListener('pointerdown', down, true);
  editor.overlay.addEventListener('pointermove', (event) => { if (event.pointerType === 'pen' && event.buttons) lastPen = Date.now(); }, true);
  const finish = (event) => { if (event.pointerId === activePen) { activePen = null; lastPen = Date.now(); } };
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) editor.overlay.addEventListener(event, finish, true);
  const previous = editor.advancedCommand;
  editor.advancedCommand = async (command) => {
    if (command !== 'pen-settings') return previous(command);
    const value = await settingsDialog('Pen and touch', [boolField('size', 'Pressure controls brush size', true), boolField('opacity', 'Pressure controls opacity'), boolField('tilt', 'Tilt controls brush shape'), boolField('palmRejection', 'Ignore palm touches while using a pen', true)], editor.penSettings);
    if (value) { editor.penSettings = value; localStorage.setItem('compositor.pen', JSON.stringify(value)); } return true;
  };
}
