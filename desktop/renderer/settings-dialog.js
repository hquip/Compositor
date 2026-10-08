import { colorHex, colorRecord, curveValue, clamp } from './raster.js';
import { rgbToHsl, hslToRgb } from './adjustments.js';

export function readSetting(object, path) { return path.split('.').reduce((value, key) => value?.[key], object); }
export function writeSetting(object, path, value) { const keys = path.split('.'); let target = object; for (const key of keys.slice(0, -1)) target = target[key] ??= /^\d+$/.test(keys[keys.indexOf(key) + 1]) ? [] : {}; target[keys.at(-1)] = value; }

export async function settingsDialog(title, fields, settings, onPreview, lifecycle = {}) {
  const value = structuredClone(settings), dialog = document.createElement('dialog'); dialog.className = 'settings-dialog';
  const controller = new AbortController(), progress = document.createElement('p'); progress.className = 'processing-status'; progress.setAttribute('role', 'status'); progress.hidden = true;
  let previewSequence = 0, applying = false;
  const preview = (next) => {
    if (!onPreview || applying || controller.signal.aborted) return;
    const sequence = ++previewSequence;
    const result = onPreview(next);
    if (!result?.then) return;
    progress.hidden = false; progress.textContent = 'Updating preview…';
    result.then(() => { if (sequence === previewSequence && !applying) { progress.textContent = 'Preview ready'; } }).catch((error) => { if (error.name !== 'AbortError' && sequence === previewSequence && !applying) progress.textContent = error.message; });
  };
  const heading = document.createElement('h2'); heading.textContent = title; dialog.append(heading);
  const form = document.createElement('form'), content = document.createElement('div'); content.className = 'settings-fields';
  let group;
  for (const field of fields) {
    if (field.section) { group = document.createElement('details'); group.open = field.open ?? !group; const summary = document.createElement('summary'); summary.textContent = field.section; group.append(summary); content.append(group); continue; }
    const row = document.createElement('label'); row.className = 'setting-row';
    const caption = document.createElement('span'); caption.textContent = field.label; row.append(caption);
    if (field.type === 'point-colors') {
      const points = structuredClone(readSetting(value, field.key) ?? []), list = document.createElement('div'); list.className = 'point-color-list';
      const notify = () => { writeSetting(value, field.key, structuredClone(points)); preview?.(structuredClone(value)); };
      function rebuild() {
        list.replaceChildren();
        points.forEach((point, index) => {
          const item = document.createElement('details'); item.open = true; const summary = document.createElement('summary'); summary.textContent = `Color ${index + 1}`; item.append(summary);
          const picker = document.createElement('input'); picker.type = 'color'; const rgb = hslToRgb(point.hue, point.saturation, point.luminance); picker.value = colorHex({ red: rgb[0], green: rgb[1], blue: rgb[2] }); picker.setAttribute('aria-label', `Sample color ${index + 1}`);
          picker.addEventListener('input', () => { const color = colorRecord(picker.value), hsl = rgbToHsl(color.red, color.green, color.blue); [point.hue, point.saturation, point.luminance] = hsl; notify(); }); item.append(picker);
          for (const [key, label, min, max, step] of [['hueShift', 'Hue shift', -100, 100, 1], ['saturationShift', 'Saturation shift', -100, 100, 1], ['luminanceShift', 'Luminance shift', -100, 100, 1], ['hueRange', 'Hue range', 1, 180, 1], ['saturationRange', 'Saturation range', .01, 1, .01], ['luminanceRange', 'Luminance range', .01, 1, .01]]) {
            const line = document.createElement('label'); line.className = 'setting-row'; const title = document.createElement('span'); title.textContent = label; const input = document.createElement('input'); input.type = 'number'; input.min = min; input.max = max; input.step = step; input.value = point[key] ?? 0; input.addEventListener('input', () => { point[key] = Number(input.value); notify(); }); line.append(title, input); item.append(line);
          }
          const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove color'; remove.addEventListener('click', () => { points.splice(index, 1); rebuild(); notify(); }); item.append(remove); list.append(item);
        });
        const add = document.createElement('button'); add.type = 'button'; add.textContent = 'Add sampled color'; add.addEventListener('click', () => { points.push({ hue: 0, saturation: .5, luminance: .5, hueShift: 0, saturationShift: 0, luminanceShift: 0, hueRange: 30, saturationRange: .4, luminanceRange: .4 }); rebuild(); notify(); }); list.append(add);
      }
      writeSetting(value, field.key, points); rebuild(); row.className += ' stacked-setting'; row.append(list); (group ?? content).append(row); continue;
    }
    if (field.type === 'guides') {
      let guides = structuredClone(readSetting(value, field.key) ?? []), drawing;
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 220; canvas.className = 'geometry-guides';
      const paint = () => { const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, 320, 220); if (field.image) ctx.drawImage(field.image, 0, 0, 320, 220); ctx.strokeStyle = '#55ccff'; ctx.lineWidth = 2;
        for (const g of [...guides, ...(drawing ? [drawing] : [])]) { ctx.beginPath(); ctx.moveTo(g.startX * 320, (1 - g.startY) * 220); ctx.lineTo(g.endX * 320, (1 - g.endY) * 220); ctx.stroke(); }
      };
      const position = (event) => { const r = canvas.getBoundingClientRect(); return { x: clamp((event.clientX - r.left) / r.width), y: 1 - clamp((event.clientY - r.top) / r.height) }; };
      canvas.addEventListener('pointerdown', (event) => { const p = position(event); drawing = { startX: p.x, startY: p.y, endX: p.x, endY: p.y }; canvas.setPointerCapture(event.pointerId); });
      canvas.addEventListener('pointermove', (event) => { if (drawing) { const p = position(event); drawing.endX = p.x; drawing.endY = p.y; paint(); } });
      canvas.addEventListener('pointerup', (event) => { if (!drawing) return; if (guides.length >= 4) guides.shift(); guides.push(drawing); drawing = null; canvas.releasePointerCapture(event.pointerId); writeSetting(value, field.key, structuredClone(guides)); writeSetting(value, 'geometry.upright', 'Guided'); const select = form.querySelector('[data-setting="geometry.upright"]'); if (select) select.value = 'Guided'; preview?.(structuredClone(value)); paint(); });
      const clear = document.createElement('button'); clear.type = 'button'; clear.textContent = 'Clear guides'; clear.addEventListener('click', () => { guides = []; writeSetting(value, field.key, []); preview?.(structuredClone(value)); paint(); });
      writeSetting(value, field.key, guides); row.className += ' stacked-setting'; row.append(canvas, clear); (group ?? content).append(row); paint(); continue;
    }
    if (field.type === 'curve') {
      let points = structuredClone(readSetting(value, field.key) ?? field.default), active = -1;
      const maximum = field.maximum ?? 255, canvas = document.createElement('canvas'); canvas.width = 245; canvas.height = 190; canvas.className = 'curve-control'; canvas.setAttribute('aria-label', field.label);
      function redraw() {
        const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, 245, 190); ctx.strokeStyle = '#45454c'; ctx.lineWidth = 1;
        for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(i * 245 / 4, 0); ctx.lineTo(i * 245 / 4, 190); ctx.moveTo(0, i * 190 / 4); ctx.lineTo(245, i * 190 / 4); ctx.stroke(); }
        ctx.strokeStyle = '#b6cfff'; ctx.beginPath(); for (let x = 0; x <= 245; x++) { const y = 190 * (1 - curveValue(points, x / 245 * maximum) / maximum); x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
        for (const point of points) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(point.x / maximum * 245, 190 * (1 - point.y / maximum), 4, 0, Math.PI * 2); ctx.fill(); }
      }
      const position = (event) => { const rect = canvas.getBoundingClientRect(); return { x: clamp((event.clientX - rect.left) / rect.width) * maximum, y: (1 - clamp((event.clientY - rect.top) / rect.height)) * maximum }; };
      const changed = () => { writeSetting(value, field.key, structuredClone(points)); preview?.(structuredClone(value)); redraw(); };
      canvas.addEventListener('pointerdown', (event) => { event.preventDefault(); const p = position(event); active = points.findIndex((point) => Math.hypot((point.x - p.x) / maximum * 245, (point.y - p.y) / maximum * 190) < 10);
        if (active < 0 && points.length < 32) { points.push(p); points.sort((a, b) => a.x - b.x); active = points.indexOf(p); changed(); } canvas.setPointerCapture(event.pointerId); });
      canvas.addEventListener('pointermove', (event) => { if (active < 0 || !canvas.hasPointerCapture(event.pointerId)) return; const p = position(event); points[active] = { x: active === 0 ? 0 : active === points.length - 1 ? maximum : clamp(p.x, points[active - 1].x + maximum / 10000, points[active + 1].x - maximum / 10000), y: p.y }; changed(); });
      canvas.addEventListener('pointerup', (event) => { active = -1; canvas.releasePointerCapture(event.pointerId); });
      canvas.addEventListener('contextmenu', (event) => { event.preventDefault(); const p = position(event), index = points.findIndex((point) => Math.hypot(point.x - p.x, point.y - p.y) < maximum * .06); if (index > 0 && index < points.length - 1) { points.splice(index, 1); changed(); } });
      writeSetting(value, field.key, points); redraw(); row.append(canvas); (group ?? content).append(row); continue;
    }
    let input;
    if (field.options) { input = document.createElement('select'); for (const option of field.options) { const item = document.createElement('option'); item.value = option; item.textContent = option; input.append(item); } }
    else if (field.type === 'textarea') { input = document.createElement('textarea'); input.rows = 4; }
    else { input = document.createElement('input'); input.type = field.type === 'hotkey' ? 'text' : field.type ?? 'number'; }
    const initial = readSetting(value, field.key) ?? field.default ?? (input.type === 'checkbox' ? false : input.type === 'color' ? { red: 0, green: 0, blue: 0 } : 0);
    if (input.type === 'checkbox') input.checked = !!initial;
    else input.value = input.type === 'color' ? colorHex(initial) : field.json ? JSON.stringify(initial) : initial;
    if (field.min != null) input.min = field.min; if (field.max != null) input.max = field.max; if (field.step != null) input.step = field.step;
    input.setAttribute('aria-label', field.label); input.dataset.setting = field.key;
    let slider;
    if (input.type === 'number' && field.min != null && field.max != null) {
      slider = document.createElement('input'); slider.type = 'range'; slider.min = input.min; slider.max = input.max; slider.step = input.step || '1'; slider.value = input.value; slider.tabIndex = -1;
      slider.addEventListener('input', () => { input.value = slider.value; change(); }); row.append(slider);
    }
    const change = () => {
      try {
        const next = field.json ? JSON.parse(input.value) : input.type === 'checkbox' ? input.checked : input.type === 'color' ? colorRecord(input.value) : input.type === 'number' ? Number(input.value) : input.value;
        if (input.type === 'number' && !Number.isFinite(next)) return;
        if (slider) slider.value = input.value;
        writeSetting(value, field.key, next); preview?.(structuredClone(value));
      } catch { /* Incomplete JSON is kept in the field until it can be parsed. */ }
    };
    writeSetting(value, field.key, initial); input.addEventListener('input', change); row.append(input); (group ?? content).append(row);
    if (field.type === 'hotkey') input.addEventListener('keydown', (event) => { event.preventDefault(); if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return; input.value = [event.ctrlKey || event.metaKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', event.key.length === 1 ? event.key.toUpperCase() : event.key].filter(Boolean).join('+'); change(); });
  }
  if (lifecycle.previewElement) form.append(lifecycle.previewElement);
  form.append(content);
  const actions = document.createElement('div'); actions.className = 'dialog-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.addEventListener('click', () => dialog.close('cancel'));
  const apply = document.createElement('button'); apply.type = 'submit'; apply.className = 'primary'; apply.textContent = 'Apply'; actions.append(cancel, apply); form.append(actions); dialog.append(form); document.body.append(dialog);
  form.insertBefore(progress, actions);
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); if (applying) return;
    if (!lifecycle.apply) { dialog.close('apply'); return; }
    applying = true; apply.disabled = true; content.inert = true; if (lifecycle.previewElement) lifecycle.previewElement.inert = true; progress.hidden = false; progress.textContent = 'Processing full-resolution image…';
    try { await lifecycle.apply(structuredClone(value), controller.signal); if (!controller.signal.aborted) dialog.close('apply'); }
    catch (error) { if (!controller.signal.aborted) { applying = false; apply.disabled = false; content.inert = false; if (lifecycle.previewElement) lifecycle.previewElement.inert = false; progress.textContent = error.message; } }
  });
  dialog.showModal();
  if (lifecycle.initialPreview) preview(structuredClone(value));
  return await new Promise((resolve) => dialog.addEventListener('close', async () => { controller.abort(); try { await lifecycle.cancel?.(); } finally { dialog.remove(); resolve(dialog.returnValue === 'apply' ? value : null); } }, { once: true }));
}

export const numberField = (key, label, min, max, defaultValue = 0, step = 1) => ({ key, label, min, max, default: defaultValue, step });
export const colorField = (key, label, defaultValue = { red: 0, green: 0, blue: 0 }) => ({ key, label, type: 'color', default: defaultValue });
export const boolField = (key, label, defaultValue = false) => ({ key, label, type: 'checkbox', default: defaultValue });
