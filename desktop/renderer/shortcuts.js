import { settingsDialog } from './settings-dialog.js';

const defaults = { new: 'Ctrl+N', open: 'Ctrl+O', import: 'Ctrl+I', save: 'Ctrl+S', 'save-as': 'Ctrl+Shift+S', 'export-png': 'Ctrl+Shift+E', undo: 'Ctrl+Z', redo: 'Ctrl+Shift+Z',
  'add-layer': 'Ctrl+Shift+N', duplicate: 'Ctrl+J', 'copy': 'Ctrl+C', 'copy-merged': 'Ctrl+Shift+C', paste: 'Ctrl+V', cut: 'Ctrl+X', 'close-tab': 'Ctrl+W', group: 'Ctrl+G', ungroup: 'Ctrl+Shift+G', 'merge-down': 'Ctrl+E',
  'select:All': 'Ctrl+A', deselect: 'Ctrl+D', fit: 'Ctrl+0', actual: 'Ctrl+1', 'zoom-in': 'Ctrl+=', 'zoom-out': 'Ctrl+-', 'tool:move': 'V', 'tool:brush': 'B', 'tool:eraser': 'E', 'tool:marquee': 'M', 'tool:lasso': 'L', 'tool:wand': 'W', 'tool:clone': 'S', 'tool:heal': 'J', 'tool:blur': 'R', 'tool:gradient': 'G', 'tool:shape': 'U', 'tool:text': 'T', 'tool:eyedropper': 'I', 'tool:hand': 'H', 'tool:crop': 'C' };
function chord(event) { return [event.ctrlKey || event.metaKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', event.key.length === 1 ? event.key.toUpperCase() : event.key].filter(Boolean).join('+'); }
defaults['transform-selection'] = 'Ctrl+T';
defaults['tool:path'] = 'P';
export function installShortcuts(editor, api) {
  let bindings = { ...defaults };
  try { bindings = { ...defaults, ...JSON.parse(localStorage.getItem('compositor.shortcuts') ?? '{}') }; } catch { }
  const previous = editor.advancedCommand;
  editor.advancedCommand = async (command) => {
    if (command === 'keyboard-shortcuts') {
      const result = await settingsDialog('Keyboard Shortcuts', Object.keys(defaults).map((key) => ({ key, label: key.replace(/[-:]/g, ' '), type: 'hotkey' })), bindings);
      if (result) { const values = Object.values(result).filter(Boolean); if (new Set(values).size !== values.length) throw new Error('Two commands cannot use the same shortcut.'); bindings = result; localStorage.setItem('compositor.shortcuts', JSON.stringify(bindings)); } return true;
    }
    return await previous(command);
  };
  document.addEventListener('keydown', (event) => {
    if (event.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || document.querySelector('dialog[open]') || ['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
    const pressed = chord(event), binding = Object.entries(bindings).find(([, value]) => value === pressed);
    if (binding) { event.preventDefault(); event.stopImmediatePropagation(); if (binding[0].startsWith('tool:')) api.setTool(binding[0].slice(5)); else api.runCommand(binding[0]); }
    else if (Object.values(defaults).includes(pressed)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  document.querySelectorAll('.transform-grid label').forEach((label) => {
    let gesture;
    label.addEventListener('pointerdown', (event) => { if (event.target.tagName === 'INPUT' || !editor.active || editor.busy) return; const input = label.querySelector('input'); if (!input || input.disabled) return;
      gesture = { x: event.clientX, value: Number(input.value), before: editor.snapshot(), input }; label.setPointerCapture(event.pointerId); event.preventDefault(); });
    label.addEventListener('pointermove', (event) => { if (!gesture) return; const factor = event.shiftKey ? 10 : event.altKey ? .1 : 1; const value = gesture.value + (event.clientX - gesture.x) * factor;
      gesture.input.value = Math.min(Number(gesture.input.max) || Infinity, Math.max(Number(gesture.input.min) || -Infinity, value)); });
    label.addEventListener('pointerup', (event) => { if (!gesture) return; gesture.input.dispatchEvent(new Event('change', { bubbles: true })); gesture = null; label.releasePointerCapture(event.pointerId); });
  });
}
