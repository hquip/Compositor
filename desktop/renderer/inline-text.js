import { createLayer, localPoint, documentPoint, layerEntries } from './core.js';
import { surface, colorHex, colorRecord } from './raster.js';
import { renderText, layoutText } from './text-layout.js';
import { fontFamily, fontDescriptor, canonicalFontName, canonicalRuns, textSpans, normalizedTextStyle } from './text-style.js';
import { affine } from './affine.js';
import { resizedGrid } from './raster-space.js';
import { icon } from './icons.js';

export function readTextDOM(node, base) {
  let content = ''; const colors = [], fonts = [], sizes = [];
  function append(text, element) {
    if (!text) return;
    const css = getComputedStyle(element), channels = css.color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
    let color = { red: channels[0] / 255, green: channels[1] / 255, blue: channels[2] / 255 };
    const record = element.closest('[data-text-color]')?.dataset.textColor;
    if (record) { const original = JSON.parse(record); if (['red', 'green', 'blue'].every((key, i) => Math.round(original[key] * 255) === channels[i])) color = original; }
    const family = css.fontFamily.split(',')[0].replace(/^['"]|['"]$/g, '').trim(), source = element.closest('[data-text-font]')?.dataset.textFont;
    const font = { fontName: source && fontFamily(source) === family ? source : family || base.fontName };
    const size = { fontSize: Number.parseFloat(css.fontSize) || base.fontSize };
    content += text; for (let i = 0; i < text.length; i++) { colors.push(color); fonts.push(font); sizes.push(size); }
  }
  function children(parent) {
    let previousBlock = false, previousEmpty = false;
    for (const item of parent.childNodes) {
      if (item.nodeType === Node.ELEMENT_NODE && item.matches('[data-editor-handle], script, style')) continue;
      const block = item.nodeType === Node.ELEMENT_NODE && /^(DIV|P|LI|PRE|H[1-6])$/.test(item.nodeName);
      if ((block || previousBlock) && (content || previousBlock) && (!content.endsWith('\n') || previousEmpty)) append('\n', item.parentElement);
      const before = content.length;
      if (item.nodeType === Node.TEXT_NODE) append(item.textContent, parent);
      else if (item.nodeName === 'BR') { const block = parent.closest('div,p,li,pre'); if (!(block && !block.textContent && block.querySelectorAll('br').length === 1)) append('\n', parent); }
      else if (item.nodeType === Node.ELEMENT_NODE) children(item);
      previousBlock = block; previousEmpty = block && before === content.length;
    }
  }
  children(node);
  const style = { ...base, content };
  if (fonts.length && fonts.every((font) => font.fontName === fonts[0].fontName)) style.fontName = fonts[0].fontName;
  if (colors.length && colors.every((color) => ['red', 'green', 'blue'].every((key) => color[key] === colors[0][key]))) Object.assign(style, colors[0]);
  style.colorRuns = canonicalRuns(colors, style, 'colorRuns'); style.fontRuns = canonicalRuns(fonts, style, 'fontRuns'); style.sizeRuns = canonicalRuns(sizes, style, 'sizeRuns'); return normalizedTextStyle(style);
}

export function installInlineText(editor, api) {
  const bar = document.createElement('div'); bar.className = 'inline-type-controls'; bar.hidden = true;
  const font = document.createElement('input'); font.setAttribute('aria-label', 'Text font'); font.title = 'Font family'; font.maxLength = 200;
  const number = (label, min, max) => { const input = document.createElement('input'); input.type = 'number'; input.min = min; input.max = max; input.setAttribute('aria-label', label); input.title = label; return input; };
  const size = number('Text font size', 1, 2000), tracking = number('Tracking', -100, 1000), leading = number('Line spacing (0 = auto)', 0, 5000);
  const color = document.createElement('input'); color.type = 'color'; color.setAttribute('aria-label', 'Text color');
  const alignment = document.createElement('select'); alignment.setAttribute('aria-label', 'Text alignment'); for (const name of ['Left', 'Center', 'Right']) { const option = document.createElement('option'); option.value = name; option.textContent = name; alignment.append(option); }
  const mode = document.createElement('select'); mode.setAttribute('aria-label', 'Text layout'); for (const name of ['Point text', 'Paragraph text']) { const option = document.createElement('option'); option.value = name; option.textContent = name; mode.append(option); }
  const apply = document.createElement('button'); apply.textContent = 'Apply text'; const cancel = document.createElement('button'); cancel.textContent = 'Cancel text';
  bar.append(font, size, color, alignment, tracking, leading, mode, apply, cancel); document.querySelector('.tool-options').after(bar);
  let draft = null, range = null, boxGesture = null;
  const applyFont = (node, name) => { const face = fontDescriptor(name); node.style.fontFamily = JSON.stringify(face.family); node.style.fontWeight = face.weight; node.style.fontStyle = face.style; node.dataset.textFont = name; };
  const inputStyle = (current) => ({ ...readTextDOM(current.node, current.style), boxSize: current.fixed ? [current.node.offsetWidth, current.node.offsetHeight] : undefined });
  function position() {
    if (!draft) return;
    const m = affine(draft.layer.transform), w = draft.width, h = draft.height;
    draft.node.style.transform = `matrix(${m[0] * editor.zoom / w},${m[1] * editor.zoom / w},${m[2] * editor.zoom / h},${m[3] * editor.zoom / h},${editor.pan.x + m[4] * editor.zoom},${editor.pan.y + m[5] * editor.zoom})`;
    const transform = resizedGrid(draft.layer.transform, w, h, 0, 0, draft.node.offsetWidth, draft.node.offsetHeight);
    for (let i = 0; i < draft.handles.length; i++) { const unit = i === 4 ? { x: .5, y: 0 } : [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }][i], p = documentPoint(unit, transform); draft.handles[i].style.left = `${editor.pan.x + p.x * editor.zoom - 12}px`; draft.handles[i].style.top = `${editor.pan.y + p.y * editor.zoom - (i === 4 ? 28 : 12)}px`; }
  }
  function resizePointText() {
    if (!draft || draft.fixed) return;
    const layout = layoutText(inputStyle(draft)); draft.node.style.width = `${layout.width}px`; draft.node.style.height = `${layout.height}px`; position();
  }
  function stop(commit) {
    if (!draft) return true;
    const current = draft;
    try {
      if (commit && (!current.original || current.modified)) {
        const style = inputStyle(current);
        if (!current.original && !style.content.trim()) commit = false;
        else {
          const image = renderText(style), anchor = documentPoint({ x: 0, y: 0 }, current.layer.transform), transform = structuredClone(current.layer.transform);
          transform.size = [transform.size[0] * image.width / current.width, transform.size[1] * image.height / current.height];
          const after = documentPoint({ x: 0, y: 0 }, transform); transform.origin[0] += anchor.x - after.x; transform.origin[1] += anchor.y - after.y;
          if (current.layer.maskFile && !current.layer.maskPlacement) current.layer.maskPlacement = structuredClone(current.before.manifest.layers.find((layer) => layer.id === current.layer.id)?.transform ?? current.layer.transform);
          current.layer.text = style; current.layer.transform = transform; editor.storePixels(current.layer, image);
          editor.textDefaults = { fontName: style.fontName, fontSize: style.fontSize, alignment: style.alignment, tracking: style.tracking, leading: style.leading };
          if (!current.original) current.layer.name = style.content.trim().replace(/\s+/g, ' ').slice(0, 40) || 'Text';
          editor.history.push(current.before, editor.snapshot(), current.original ? 'Edit Text' : 'Type');
        }
      } else if (current.original) editor.images.set(current.layer.id, current.original);
      if (!commit) { editor.manifest = current.before.manifest; editor.assets = current.before.assets; editor.selectedIDs = current.selected; if (current.original) editor.images.set(current.layer.id, current.original); else editor.images.delete(current.layer.id); }
      current.node.remove(); current.handles.forEach((handle) => handle.remove()); draft = null; editor.textDraft = null; bar.hidden = true; editor.update(); return true;
    } catch (error) { api.showError(error); return false; }
  }
  function start(layer, point, box = null) {
    if (!stop(true)) return;
    editor.gradient?.finish(true); const before = editor.snapshot(), selected = new Set(layer ? [layer.id] : editor.selectedIDs);
    if (layer) before.manifest.activeLayerID = layer.id;
    if (!layer) {
      const style = { content: '', fontName: 'Arial', fontSize: 48, alignment: 'Left', tracking: 0, leading: 0, ...editor.textDefaults, ...colorRecord(editor.color) };
      if (box) style.boxSize = [Math.max(16, box.width), Math.max(16, box.height)]; const layout = layoutText(style);
      layer = createLayer('Text', layout.width, layout.height); layer.parentID = editor.active?.isGroup ? editor.active.id : editor.active?.parentID;
      layer.transform.origin = box ? [box.x, box.y] : [point.x - 12, point.y - (layout.lines[0]?.baseline ?? 48)]; layer.text = style; editor.manifest.layers.push(layer);
    }
    const style = structuredClone(layer.text), original = editor.images.get(layer.id), measured = style.boxSize ? null : layoutText(style), width = style.boxSize?.[0] ?? original?.width ?? measured.width, height = style.boxSize?.[1] ?? original?.height ?? measured.height;
    const node = document.createElement('div'); node.className = 'inline-text-editor'; node.contentEditable = 'true'; node.spellcheck = false; node.setAttribute('role', 'textbox'); node.setAttribute('aria-multiline', 'true'); node.setAttribute('aria-label', 'Edit text on canvas'); node.dir = 'auto'; node.dataset.textFont = style.fontName; node.dataset.textColor = JSON.stringify({ red: style.red, green: style.green, blue: style.blue });
    Object.assign(node.style, { width: `${width}px`, height: `${height}px`, fontFamily: JSON.stringify(fontFamily(style.fontName)), fontSize: `${style.fontSize}px`, color: colorHex(style), textAlign: style.alignment.toLowerCase(), letterSpacing: `${style.tracking ?? 0}px`, lineHeight: `${style.leading || style.fontSize * 1.2}px`, whiteSpace: style.boxSize ? 'pre-wrap' : 'pre', overflowWrap: 'anywhere', fontKerning: 'normal', unicodeBidi: 'plaintext' });
    applyFont(node, style.fontName);
    for (const part of textSpans(style)) { const span = document.createElement('span'); span.textContent = part.text; applyFont(span, part.fontName); span.style.fontSize = `${part.fontSize}px`; span.style.color = colorHex(part); span.dataset.textColor = JSON.stringify({ red: part.red, green: part.green, blue: part.blue }); node.append(span); }
    editor.images.set(layer.id, surface(1, 1)); editor.manifest.activeLayerID = layer.id; editor.selectedIDs = new Set([layer.id]);
    draft = { layer, style, before, selected, original, node, width, height, fixed: !!style.boxSize, modified: false, handles: [] }; editor.textDraft = draft;
    editor.viewport.append(node);
    for (let index = 0; index < 5; index++) {
      const handle = document.createElement('button'); handle.className = 'text-box-handle'; handle.setAttribute('aria-label', index === 4 ? 'Move text box' : ['Resize text top left', 'Resize text top right', 'Resize text bottom right', 'Resize text bottom left'][index]); if (index === 4) handle.append(icon('move', 14));
      handle.addEventListener('pointerdown', (event) => {
        event.preventDefault(); event.stopPropagation(); if (!draft) return;
        const startPoint = editor.toDocument(editor.viewPoint(event)), transform = resizedGrid(draft.layer.transform, draft.width, draft.height, 0, 0, node.offsetWidth, node.offsetHeight), w = node.offsetWidth, h = node.offsetHeight;
        handle.setPointerCapture(event.pointerId);
        const move = (event) => {
          const p = editor.toDocument(editor.viewPoint(event)); draft.modified = true;
          if (index === 4) { draft.layer.transform = { ...structuredClone(transform), origin: [transform.origin[0] + p.x - startPoint.x, transform.origin[1] + p.y - startPoint.y] }; draft.width = w; draft.height = h; }
          else {
            const q = localPoint(p, transform, w, h), left = index === 0 || index === 3 ? Math.min(w - 16, q.x) : 0, top = index < 2 ? Math.min(h - 16, q.y) : 0;
            const width = Math.max(16, Math.min(30000, index === 1 || index === 2 ? q.x : w - left)), height = Math.max(16, Math.min(30000, index >= 2 ? q.y : h - top));
            draft.layer.transform = resizedGrid(transform, w, h, left, top, width, height); draft.width = width; draft.height = height; draft.fixed = true; mode.value = 'Paragraph text'; node.style.whiteSpace = 'pre-wrap'; node.style.width = `${width}px`; node.style.height = `${height}px`;
          }
          position();
        };
        const done = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', done); handle.removeEventListener('pointercancel', done); };
        handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', done); handle.addEventListener('pointercancel', done);
      }); draft.handles.push(handle); editor.viewport.append(handle);
    }
    font.value = style.fontName; size.value = style.fontSize; color.value = colorHex(style); alignment.value = style.alignment; tracking.value = style.tracking ?? 0; leading.value = style.leading ?? 0; mode.value = draft.fixed ? 'Paragraph text' : 'Point text'; bar.hidden = false; editor.update(); position(); node.focus();
    const selection = getSelection(); selection.selectAllChildren(node); range = selection.getRangeAt(0).cloneRange();
    node.addEventListener('input', () => { if (!draft) return; draft.modified = true; try { resizePointText(); } catch { /* Keep oversized drafts editable so they can be corrected before applying. */ } });
    node.addEventListener('paste', (event) => { event.preventDefault(); document.execCommand('insertText', false, event.clipboardData.getData('text/plain')); });
    node.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); stop(false); } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); stop(true); } });
  }
  document.addEventListener('selectionchange', () => { const selection = getSelection(); if (draft && selection.rangeCount && draft.node.contains(selection.anchorNode)) range = selection.getRangeAt(0).cloneRange(); });
  function format(command, value) {
    if (command === 'fontName') { value = canonicalFontName(value); if (!value) return; }
    if (!draft) return; draft.node.focus(); if (range) { getSelection().removeAllRanges(); getSelection().addRange(range); }
    if (!range || range.collapsed) getSelection().selectAllChildren(draft.node);
    const selection = getSelection(), target = selection.getRangeAt(0), fragment = target.extractContents(), span = document.createElement('span');
    for (const node of fragment.querySelectorAll('*')) {
      if (command === 'fontName') { node.style.fontFamily = ''; node.style.fontWeight = ''; node.style.fontStyle = ''; node.removeAttribute('face'); delete node.dataset.textFont; }
      else if (command === 'fontSize') node.style.fontSize = '';
      else { node.style.color = ''; node.removeAttribute('color'); delete node.dataset.textColor; }
    }
    if (command === 'fontName') applyFont(span, value); else if (command === 'fontSize') span.style.fontSize = `${value}px`; else { span.style.color = value; span.dataset.textColor = JSON.stringify(colorRecord(value)); }
    span.append(fragment); target.insertNode(span); target.selectNodeContents(span); selection.removeAllRanges(); selection.addRange(target); range = target.cloneRange();
    draft.modified = true; try { resizePointText(); } catch (error) { api.showError(error); }
  }
  font.addEventListener('change', () => format('fontName', font.value)); color.addEventListener('input', () => format('foreColor', color.value));
  for (const [control, key] of [[size, 'fontSize'], [tracking, 'tracking'], [leading, 'leading']]) control.addEventListener('change', () => {
    if (key === 'fontSize') { const value = Math.max(1, Math.min(2000, Number(control.value) || 1)); control.value = value; format('fontSize', value); return; }
    if (!draft) return; draft.modified = true; draft.style[key] = Math.max(Number(control.min), Math.min(Number(control.max), Number(control.value) || 0)); control.value = draft.style[key];
    draft.node.style.fontSize = `${draft.style.fontSize}px`; draft.node.style.lineHeight = `${draft.style.leading || draft.style.fontSize * 1.2}px`; draft.node.style.letterSpacing = `${draft.style.tracking}px`; try { resizePointText(); } catch (error) { api.showError(error); }
  });
  alignment.addEventListener('change', () => { if (draft) { draft.modified = true; draft.style.alignment = alignment.value; draft.node.style.textAlign = alignment.value.toLowerCase(); } });
  mode.addEventListener('change', () => { if (draft) { draft.modified = true; draft.fixed = mode.value === 'Paragraph text'; draft.node.style.whiteSpace = draft.fixed ? 'pre-wrap' : 'pre'; resizePointText(); } });
  apply.addEventListener('click', () => stop(true)); cancel.addEventListener('click', () => stop(false));
  const down = editor.pointerDown.bind(editor), move = editor.pointerMove.bind(editor), up = editor.pointerUp.bind(editor), cancelGesture = editor.cancelGesture.bind(editor), render = editor.render.bind(editor);
  editor.pointerDown = (event) => {
    if (editor.tool !== 'text' || !editor.manifest || editor.busy || editor.gesture || document.querySelector('dialog[open]')) { if (draft && !stop(true)) return; return down(event); }
    if (!stop(true)) return;
    editor.viewport.focus();
    const point = editor.toDocument(editor.viewPoint(event)), visible = new Set(layerEntries(editor.manifest.layers).filter((entry) => entry.visible).map((entry) => entry.layer.id));
    const layer = [...editor.manifest.layers].reverse().find((item) => { if (!item.text || !visible.has(item.id)) return false; const p = localPoint(point, item.transform, 1, 1); return p.x >= 0 && p.y >= 0 && p.x <= 1 && p.y <= 1; });
    if (layer && !event.shiftKey) { start(layer); return; }
    boxGesture = { start: point, end: point }; editor.gesture = { kind: 'text-box' }; editor.overlay.setPointerCapture(event.pointerId);
  };
  editor.pointerMove = (event) => { if (!boxGesture) return move(event); boxGesture.end = editor.toDocument(editor.viewPoint(event)); editor.draw(); };
  editor.pointerUp = (event) => {
    if (!boxGesture) return up(event); editor.pointerMove(event); const box = boxGesture; boxGesture = null; editor.gesture = null;
    if (editor.overlay.hasPointerCapture(event.pointerId)) editor.overlay.releasePointerCapture(event.pointerId);
    const width = Math.abs(box.end.x - box.start.x), height = Math.abs(box.end.y - box.start.y); start(null, box.start, Math.max(width, height) * editor.zoom >= 4 ? { x: Math.min(box.start.x, box.end.x), y: Math.min(box.start.y, box.end.y), width, height } : null);
  };
  editor.cancelGesture = () => { if (boxGesture) { boxGesture = null; editor.gesture = null; editor.draw(); } else cancelGesture(); };
  editor.render = () => { render(); position(); if (boxGesture) { const ctx = editor.overlay.getContext('2d'); ctx.save(); ctx.translate(editor.pan.x, editor.pan.y); ctx.scale(editor.zoom, editor.zoom); ctx.lineWidth = 1 / editor.zoom; ctx.strokeStyle = '#78a9ff'; ctx.strokeRect(boxGesture.start.x, boxGesture.start.y, boxGesture.end.x - boxGesture.start.x, boxGesture.end.y - boxGesture.start.y); ctx.restore(); } };
  const previous = editor.advancedCommand;
  editor.advancedCommand = async (command) => { if (command === 'edit-text' && editor.active?.text) { start(editor.active); return true; } if (draft && command === 'undo') { stop(false); return true; } if (draft && !['zoom-in', 'zoom-out', 'fit', 'actual'].includes(command) && !stop(true)) return true; return await previous(command); };
  editor.inlineText = {
    finish: stop,
    capture() { return draft ? { before: draft.before, value: { layer: structuredClone(draft.layer), style: inputStyle(draft), width: draft.width, height: draft.height, fixed: draft.fixed, modified: draft.modified } } : null; },
    restore(value) {
      const before = editor.snapshot(), existing = editor.manifest.layers.find((layer) => layer.id === value.layer.id);
      const layer = existing ?? structuredClone(value.layer); Object.assign(layer, structuredClone(value.layer), { text: structuredClone(value.style) });
      if (!existing) editor.manifest.layers.push(layer);
      start(layer); draft.before = before; draft.width = value.width; draft.height = value.height; draft.fixed = value.fixed; draft.modified = value.modified;
      position(); editor.update();
    },
  };
  const select = editor.select.bind(editor), mutate = editor.mutate.bind(editor), create = editor.newCanvas.bind(editor);
  editor.select = (...args) => { if (!stop(true)) return; return select(...args); };
  editor.mutate = (...args) => { if (!stop(true)) return; return mutate(...args); };
  editor.newCanvas = (...args) => { if (!stop(true)) return; editor.gradient?.finish(true); return create(...args); };
}
