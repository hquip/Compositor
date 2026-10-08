import './bridge.js';
import { installLocalization } from './localization.js';
import { installTheme } from './theme.js';
import { Editor } from './editor.js';
import { BLEND_MODES, canvasSize, layerEntries } from './core.js';
import { surface } from './compose.js';
import { icon, installIcons } from './icons.js';
import { installAdvanced } from './advanced.js';
import { importFiles } from './importers.js';
import { jpegPreview } from './export-dialog.js';
import { webpExport } from './webp-export.js';
import { selectionTransform, transformSelection } from './layer-operations.js';
import { installRecovery } from './recovery.js';
import { saveLocalHistory } from './saved-history.js';

const $ = (selector) => document.querySelector(selector);
let currentOperation = false, saving = false, inputResolve = null, confirmResolve = null;
export const editor = new Editor($('#viewport'), $('#display'), $('#overlay'), synchronize);
editor.onError = showError;
window.desktop.limits().then((response) => { if (response.ok) editor.pixelBudget = response.value.documentPixels; });

function showError(error) {
  $('#error-message').textContent = error?.message || String(error);
  if (!$('#error-dialog').open) $('#error-dialog').showModal();
}
function status(text) { $('#status-message').textContent = text; }
async function native(operation) {
  const result = await operation;
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function synchronize() {
  const doc = editor.manifest, active = editor.active;
  const groupedTransform = active && !editor.editMask && (active.isGroup || editor.selectedIDs?.size > 1);
  const activeTransform = editor.editMask ? active?.maskPlacement ?? active?.transform : groupedTransform ? selectionTransform(editor) : active?.transform;
  $('#welcome').hidden = !!doc;
  $('#document-title').textContent = editor.name;
  $('#document-dirty').textContent = editor.history.dirty || editor.textDraft || editor.gradientDraft || editor.floatingDraft || editor.pathDraft ? '•' : '';
  $('#dimensions').textContent = doc ? `${doc.width.toLocaleString()} × ${doc.height.toLocaleString()} px` : 'No canvas';
  $('#layer-count').textContent = String(doc?.layers.length ?? 0);
  $('#paint-color').value = editor.color;
  $('#undo').disabled = (!editor.history.past.length && !editor.gradientDraft) || editor.busy;
  $('#redo').disabled = !editor.history.future.length || editor.busy;
  $('#undo').title = `Undo ${editor.history.past.at(-1)?.name ?? ''} · Ctrl+Z`;
  $('#redo').title = `Redo ${editor.history.future.at(-1)?.name ?? ''} · Ctrl+Shift+Z`;
  const properties = {
    '#position-x': activeTransform?.origin[0], '#position-y': activeTransform?.origin[1],
    '#layer-width': activeTransform?.size[0], '#layer-height': activeTransform?.size[1], '#layer-angle': activeTransform?.rotation,
  };
  for (const [selector, value] of Object.entries(properties)) {
    $(selector).disabled = !active || editor.busy;
    $(selector).value = value == null ? '' : Math.round(value * 100) / 100;
  }
  $('#blend-mode').value = active?.blendMode ?? 'Normal';
  $('#blend-mode').disabled = !active || active.isGroup || editor.busy;
  $('#layer-opacity').value = Math.round((active?.opacity ?? 1) * 100);
  $('#layer-opacity').disabled = !active || editor.busy;
  const highPrecision = active?.filterSourceFile && editor.assets[active.filterSourceFile] && atob(editor.assets[active.filterSourceFile].slice(0, 44)).charCodeAt(24) === 16;
  $('#layer-kind').textContent = active?.isGroup ? 'Folder' : active?.vectorPath ? 'Vector path' : active?.text ? 'Text layer' : active?.shape ? 'Shape layer' : highPrecision ? '16-bit source' : active?.filters?.length ? 'Filtered pixels' : 'Pixel layer';
  document.querySelector('.color-profile').textContent = highPrecision ? '16-bit source · sRGB preview' : 'sRGB · 8-bit';
  document.querySelectorAll('[data-command]').forEach((button) => {
    const needsCanvas = !['new', 'open', 'import'].includes(button.dataset.command);
    button.disabled = editor.busy || (needsCanvas && !doc);
  });
  $('#undo').disabled ||= !editor.history.past.length && !editor.gradientDraft;
  $('#redo').disabled ||= !editor.history.future.length;
  const list = $('#layer-list'); list.replaceChildren();
  if (!doc?.layers.length) {
    const message = document.createElement('p'); message.className = 'empty-layers'; message.textContent = 'Your layers will appear here.'; list.append(message);
  } else for (const entry of layerEntries(doc.layers).reverse()) {
    if (entry.ancestors.some((group) => editor.collapsedGroups?.has(group.id))) continue;
    const layer = entry.layer;
    const row = document.createElement('div'); row.className = `layer-row${active?.id === layer.id ? ' active' : ''}${editor.selectedIDs?.has(layer.id) ? ' multiselected' : ''}${entry.visible ? '' : ' hidden-layer'}`;
    row.dataset.layerId = layer.id; row.tabIndex = 0; row.setAttribute('role', 'listitem');
    row.draggable = true;
    row.setAttribute('aria-label', layer.name); row.style.paddingLeft = `${10 + Math.min(4, entry.depth) * 9}px`;
    const visible = document.createElement('button'); visible.className = 'visibility'; visible.append(icon(layer.isVisible ? 'eye' : 'eyeOff', 16));
    visible.title = layer.isVisible ? 'Hide layer' : 'Show layer'; visible.setAttribute('aria-label', visible.title);
    visible.addEventListener('click', (event) => { event.stopPropagation(); editor.mutate('Layer Visibility', () => { layer.isVisible = !layer.isVisible; }); });
    row.append(visible);
    if (layer.isGroup) { const toggle = document.createElement('button'); toggle.className = 'folder-toggle'; toggle.textContent = editor.collapsedGroups?.has(layer.id) ? '›' : '⌄'; toggle.setAttribute('aria-label', editor.collapsedGroups?.has(layer.id) ? 'Expand group' : 'Collapse group'); toggle.addEventListener('click', (event) => { event.stopPropagation(); if (editor.collapsedGroups.has(layer.id)) editor.collapsedGroups.delete(layer.id); else editor.collapsedGroups.add(layer.id); editor.update(false); }); row.append(toggle); }
    if (layer.imageFile) {
      const thumb = document.createElement('img'); thumb.className = 'layer-thumbnail'; thumb.alt = ''; thumb.src = `data:image/png;base64,${editor.assets[layer.imageFile]}`; row.append(thumb);
    } else { const thumb = document.createElement('span'); thumb.className = 'layer-thumbnail group-thumbnail'; thumb.append(icon(layer.isGroup ? 'folder' : 'layer', 19)); row.append(thumb); }
    const text = document.createElement('span'); text.className = 'layer-text';
    const name = document.createElement('span'); name.className = 'layer-name'; name.textContent = layer.name;
    const detail = document.createElement('span'); detail.className = 'layer-detail';
    detail.textContent = [layer.isGroup ? 'Folder' : layer.adjustment?.kind ?? (layer.text ? 'Text' : layer.shape?.kind ?? 'Pixels'), layer.maskFile ? (editor.editMask && layer.id === active?.id ? 'Editing mask' : 'Mask') : '', layer.maskSourceID ? 'Clipped' : ''].filter(Boolean).join(' · ');
    text.append(name, detail); row.append(text);
    row.addEventListener('click', (event) => editor.select(layer.id, event.ctrlKey || event.shiftKey));
    row.addEventListener('dblclick', () => runCommand(layer.adjustment ? 'edit-adjustment' : layer.text ? 'edit-text' : layer.shape ? 'edit-shape' : 'rename'));
    row.addEventListener('keydown', (event) => { if (event.key === 'Enter') editor.select(layer.id); });
    list.append(row);
  }
  window.desktop.setDocumentState({ name: editor.name, sessionID: editor.workspace?.id, documentID: doc?.documentID, dirty: !!editor.pathDraft || !!editor.floatingDraft || !!editor.gradientDraft || !!editor.textDraft || (editor.workspace?.anyDirty() ?? (!!doc && editor.history.dirty)) });
}

async function askInput(title, caption, value = '') {
  $('#input-title').textContent = title; $('#input-caption').textContent = caption; $('#input-value').value = value;
  $('#input-dialog').showModal(); $('#input-value').focus(); $('#input-value').select();
  return new Promise((resolve) => { inputResolve = resolve; });
}

async function mayReplaceDocument() {
  if (!editor.manifest || !editor.history.dirty) return true;
  $('#confirm-dialog').showModal();
  const choice = await new Promise((resolve) => { confirmResolve = resolve; });
  if (choice === 'cancel') return false;
  if (choice === 'save') return await save(false);
  return true;
}

async function save(saveAs) {
  editor.pathEditor?.finish(true);
  editor.floatingSelection?.finish(true);
  editor.gradient?.finish(true);
  if (editor.inlineText?.finish(true) === false) return false;
  if (!editor.manifest || saving || editor.gesture) return false;
  saving = true; status('Saving project…');
  const revision = editor.history.revision, snapshot = editor.projectSnapshot(), sessionID = editor.workspace?.id;
  const history = { past: [...editor.history.past], future: [...editor.history.future], revision, byteLimit: editor.history.byteLimit };
  try {
    const result = await native(window.desktop.saveProject(snapshot, saveAs, sessionID));
    if (!result) { status('Save canceled'); return false; }
    if (editor.workspace) editor.workspace.saved(sessionID, result, revision);
    else { editor.history.savedRevision = revision; editor.name = result.name; editor.update(false); }
    const journalSaved = await saveLocalHistory(snapshot, history, result.path, result.name);
    await editor.recovery?.flush();
    status(journalSaved ? 'Project saved' : 'Project saved; local undo history is unavailable.'); return true;
  } finally { saving = false; }
}

const names = { move: 'Move / Transform', brush: 'Brush', eraser: 'Eraser', marquee: 'Rectangle Selection', shape: 'Shape', text: 'Type', eyedropper: 'Eyedropper', hand: 'Hand', ellipse: 'Ellipse Selection', lasso: 'Lasso', polygon: 'Polygonal Lasso', wand: 'Magic Wand', clone: 'Clone Stamp', heal: 'Spot Healing', blur: 'Retouch', gradient: 'Gradient', crop: 'Crop' };
function setTool(tool) {
  if (editor.busy) return;
  if (tool !== editor.tool) editor.pathEditor?.finish(true);
  if (tool !== editor.tool) editor.floatingSelection?.finish(true);
  if (tool !== editor.tool) editor.gradient?.finish(true);
  if (tool !== editor.tool && editor.inlineText?.finish(true) === false) return;
  if (editor.gesture) editor.cancelGesture();
  editor.tool = tool;
  const gradientControls = document.querySelector('.gradient-controls'); if (gradientControls) gradientControls.hidden = tool !== 'gradient' || !editor.manifest;
  document.querySelectorAll('[data-tool]').forEach((button) => button.classList.toggle('selected', button.dataset.tool === tool));
  $('#tool-name').textContent = tool === 'path' ? 'Pen / Path' : names[tool]; $('#brush-options').hidden = !['brush', 'eraser'].includes(tool); $('#shape-options').hidden = tool !== 'shape';
  $('#overlay').style.cursor = tool === 'hand' ? 'grab' : ['brush', 'eraser', 'shape', 'marquee', 'eyedropper'].includes(tool) ? 'crosshair' : 'default';
  if (editor.manifest && editor.followsFit) editor.fit(); else editor.draw();
  if (tool === 'text' && editor.manifest && !editor.inlineText) runCommand('text');
}

export async function runCommand(command) {
  const recentIndex = command.startsWith('open-recent:') ? Number(command.split(':')[1]) : null;
  if (recentIndex != null) command = 'open';
  if (currentOperation || editor.busy || editor.gesture || (document.querySelector('dialog[open]') && command !== 'close')) return;
  if (saving && ['new', 'open', 'close', 'save', 'save-as'].includes(command)) return;
  try {
    if (command === 'save' || command === 'save-as') { await save(command === 'save-as'); return; }
    currentOperation = true;
    editor.recovery?.flush();
    if (await editor.advancedCommand?.(command)) return;
    switch (command) {
      case 'new':
        if (editor.workspace || await mayReplaceDocument()) { $('#new-error').textContent = ''; $('#new-dialog').showModal(); $('#new-width').focus(); $('#new-width').select(); }
        break;
      case 'open': {
        if (!editor.workspace && !await mayReplaceDocument()) break;
        const result = await native(recentIndex == null ? window.desktop.openProject() : window.desktop.openRecent(recentIndex));
        if (!result) break;
        editor.busy = true;
        if (editor.workspace) await editor.workspace.open(result); else { await editor.install(result.snapshot, true); editor.name = result.name; editor.fit(); }
        editor.busy = false; editor.update(false);
        window.desktop.setDocumentState({ name: editor.name, documentID: editor.manifest.documentID, dirty: editor.workspace?.anyDirty() ?? false, openedPath: result.path }); status('Project opened'); break;
      }
      case 'import': {
        const files = await native(window.desktop.importImages());
        if (!files?.length) break;
        editor.busy = true; synchronize(); status('Importing images…');
        await importFiles(editor, files); editor.busy = false; editor.update(); status(`Imported ${files.length} image${files.length === 1 ? '' : 's'}`); break;
      }
      case 'export-png': case 'export-jpeg': case 'export-webp': {
        if (!editor.manifest) break;
        const format = command === 'export-jpeg' ? 'jpeg' : command === 'export-webp' ? 'webp' : 'png';
        status('Rendering export…');
        let canvas = editor.composite(true);
        if (format === 'jpeg') { const opaque = surface(canvas.width, canvas.height); const ctx = opaque.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(canvas, 0, 0); canvas = opaque; }
        const data = format === 'jpeg' ? await jpegPreview(canvas) : format === 'webp' ? await webpExport(canvas) : canvas.toDataURL('image/png');
        if (!data) { status('Export canceled'); break; }
        if (data === 'data:,') throw new Error('Could not encode the export. Try a smaller canvas.');
        const result = await native(window.desktop.exportImage(data, format, editor.manifest.resolution ?? 72)); status(result ? 'Image exported' : 'Export canceled'); break;
      }
      case 'undo': case 'redo': await editor.restore(command); break;
      case 'add-layer': editor.addLayer(); break;
      case 'duplicate': editor.duplicate(); break;
      case 'delete': case 'delete-layer': await editor.deleteLayer(); break;
      case 'raise': editor.reorder(1); break;
      case 'lower': editor.reorder(-1); break;
      case 'rename': {
        if (!editor.active) break;
        const name = await askInput('Rename layer', 'Name', editor.active.name);
        if (name?.trim()) editor.mutate('Rename Layer', () => { editor.active.name = name.trim(); }); break;
      }
      case 'text': {
        const content = await askInput('Add text', 'Text', 'Your text');
        if (content) editor.addText(content); break;
      }
      case 'flip-x': case 'flip-y':
        if (editor.active && !editor.active.isGroup) editor.mutate('Flip Layer', () => { const property = command === 'flip-x' ? 'flipX' : 'flipY'; editor.active.transform[property] = !editor.active.transform[property]; });
        if (editor.active && !editor.active.isGroup) editor.recordAction?.({ type: 'flip-layer', axis: command === 'flip-x' ? 'x' : 'y' });
        break;
      case 'grayscale': editor.applyFilter('Grayscale'); break;
      case 'invert': editor.applyFilter('Invert'); break;
      case 'blur': editor.applyFilter('Blur'); break;
      case 'crop': editor.crop(); break;
      case 'deselect': editor.selection = null; editor.update(false); break;
      case 'fit': editor.fit(); break;
      case 'actual': editor.setZoom(1 / (window.devicePixelRatio || 1)); break;
      case 'zoom-in': editor.setZoom(editor.zoom * 1.25); break;
      case 'zoom-out': editor.setZoom(editor.zoom / 1.25); break;
      case 'close': if (await mayReplaceDocument()) window.desktop.readyToClose(); break;
    }
  } catch (error) { showError(error); status('Action failed'); }
  finally { currentOperation = false; if (editor.busy) { editor.busy = false; editor.update(false); } }
}

for (const mode of BLEND_MODES) { const option = document.createElement('option'); option.textContent = mode; $('#blend-mode').append(option); }
document.querySelectorAll('[data-command]').forEach((button) => button.addEventListener('click', () => runCommand(button.dataset.command)));
document.querySelectorAll('[data-tool]').forEach((button) => button.addEventListener('click', () => setTool(button.dataset.tool)));
document.querySelectorAll('[data-dismiss]').forEach((button) => button.addEventListener('click', () => $(`#${button.dataset.dismiss}`).close()));
document.querySelectorAll('[data-preset]').forEach((button) => button.addEventListener('click', () => { const [width, height] = button.dataset.preset.split(','); $('#new-width').value = width; $('#new-height').value = height; }));
$('#new-form').addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    const width = Number($('#new-width').value), height = Number($('#new-height').value); canvasSize(width, height);
    editor.newCanvas(width, height); window.desktop.setDocumentState({ name: editor.name, documentID: editor.manifest.documentID, dirty: true, resetPath: true });
    $('#new-dialog').close(); status('Canvas created');
  } catch (error) { $('#new-error').textContent = error.message; }
});
$('#input-form').addEventListener('submit', (event) => { event.preventDefault(); const value = $('#input-value').value; $('#input-dialog').close(value); inputResolve?.(value); inputResolve = null; });
$('#input-dialog').addEventListener('close', () => { inputResolve?.(null); inputResolve = null; });
document.querySelectorAll('[data-confirm]').forEach((button) => button.addEventListener('click', () => { const choice = button.dataset.confirm; $('#confirm-dialog').close(); confirmResolve?.(choice); confirmResolve = null; }));
$('#confirm-dialog').addEventListener('cancel', () => { confirmResolve?.('cancel'); confirmResolve = null; });
$('#paint-color').addEventListener('input', (event) => { editor.color = event.target.value; });
$('#brush-size').addEventListener('change', (event) => { editor.brushSize = Math.max(1, Math.min(1000, Number(event.target.value) || 1)); event.target.value = editor.brushSize; });
$('#brush-hardness').addEventListener('input', (event) => { editor.brushHardness = Number(event.target.value) / 100; });
$('#brush-opacity').addEventListener('input', (event) => { editor.brushOpacity = Number(event.target.value) / 100; });
$('#shape-kind').addEventListener('change', (event) => { editor.shapeKind = event.target.value; });
$('#blend-mode').addEventListener('change', (event) => editor.mutate('Blend Mode', () => { if (editor.active && !editor.active.isGroup) editor.active.blendMode = event.target.value; }));
$('#layer-opacity').addEventListener('change', (event) => editor.mutate('Layer Opacity', () => { if (editor.active) editor.active.opacity = Math.max(0, Math.min(1, Number(event.target.value) / 100)); }));
for (const [id, property, index] of [['position-x', 'origin', 0], ['position-y', 'origin', 1], ['layer-width', 'size', 0], ['layer-height', 'size', 1], ['layer-angle', 'rotation', null]]) {
  $(`#${id}`).addEventListener('change', (event) => {
    const value = Number(event.target.value);
    if (!Number.isFinite(value) || !editor.active) return;
    const valid = property === 'origin' ? Math.abs(value) <= 1000000 : property === 'size' ? value >= 1 && value <= 300000 : true;
    if (!valid) { synchronize(); return; }
    editor.mutate('Transform Layer', () => { if (!editor.editMask && (editor.active.isGroup || editor.selectedIDs?.size > 1)) { transformSelection(editor, property, index, value); return; } if (editor.editMask) { editor.active.maskPlacement ??= structuredClone(editor.active.transform); editor.active.maskLinked = false; } const transform = editor.editMask ? editor.active.maskPlacement : editor.active.transform; if (index == null) transform[property] = value; else transform[property][index] = value; });
  });
}

document.addEventListener('keydown', (event) => {
  const textField = event.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName);
  if (window.chrome?.webview && (event.ctrlKey || event.metaKey) && !document.querySelector('dialog[open]')) {
    const key = event.key.toLowerCase();
    const command = key === 's' ? (event.altKey && event.shiftKey ? 'export-jpeg' : event.shiftKey ? 'save-as' : 'save') :
      key === 'n' ? (event.shiftKey ? 'add-layer' : 'new') : key === 'o' ? 'open' : key === 'i' ? 'import' :
      !textField && key === 'z' ? (event.shiftKey ? 'redo' : 'undo') : !textField && key === 'y' ? 'redo' :
      !textField && key === 'j' ? 'duplicate' : key === 'e' && event.shiftKey ? 'export-png' :
      !textField && key === '0' ? 'fit' : !textField && key === '1' ? 'actual' :
      !textField && (key === '+' || key === '=') ? 'zoom-in' : !textField && key === '-' ? 'zoom-out' : null;
    if (command) { event.preventDefault(); runCommand(command); return; }
  }
  if (textField || document.querySelector('dialog[open]')) return;
  if (event.code === 'Space') { event.preventDefault(); editor.spaceDown = true; $('#overlay').style.cursor = 'grab'; }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const tools = { v: 'move', b: 'brush', e: 'eraser', m: 'marquee', u: 'shape', t: 'text', i: 'eyedropper', h: 'hand' };
  if (tools[event.key.toLowerCase()]) { event.preventDefault(); setTool(tools[event.key.toLowerCase()]); }
  if (event.key === 'Escape') { editor.cancelGesture(); editor.selection = null; editor.draw(); }
  if (event.key === 'Delete') runCommand('delete');
  if (event.key === '[' || event.key === ']') { editor.brushSize = Math.max(1, Math.min(1000, editor.brushSize + (event.key === '[' ? -5 : 5))); $('#brush-size').value = editor.brushSize; }
  const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (directions[event.key] && editor.active && editor.tool === 'move' && !editor.active.isGroup) {
    event.preventDefault(); const step = event.shiftKey ? 10 : 1;
    editor.mutate('Nudge Layer', () => { editor.active.transform.origin[0] += directions[event.key][0] * step; editor.active.transform.origin[1] += directions[event.key][1] * step; });
  }
});
document.addEventListener('keyup', (event) => { if (event.code === 'Space') { editor.spaceDown = false; $('#overlay').style.cursor = editor.tool === 'hand' ? 'grab' : 'default'; } });
window.addEventListener('blur', () => { editor.spaceDown = false; });

$('#viewport').addEventListener('dragover', (event) => { event.preventDefault(); $('#drop-indicator').hidden = false; });
$('#viewport').addEventListener('dragleave', (event) => { if (!$('#viewport').contains(event.relatedTarget)) $('#drop-indicator').hidden = true; });
$('#viewport').addEventListener('drop', async (event) => {
  event.preventDefault(); $('#drop-indicator').hidden = true;
  if (currentOperation || editor.busy || editor.gesture || document.querySelector('dialog[open]')) return;
  currentOperation = true; editor.busy = true; synchronize();
  try {
    if (window.desktop.dropFiles && event.dataTransfer.files.length) {
      const results = await native(window.desktop.dropFiles([...event.dataTransfer.files]));
      if (results.length) {
        for (const result of results) {
          if (result.kind === 'project') { await editor.workspace.open(result); window.desktop.setDocumentState({ name: editor.name, sessionID: editor.workspace.id, documentID: editor.manifest.documentID, dirty: editor.workspace.anyDirty(), openedPath: result.path }); }
          else await importFiles(editor, [result.file]);
        }
        status('Files opened'); return;
      }
    }
    const files = [];
    for (const file of event.dataTransfer.files) {
      if (!/^image\/(png|jpeg|webp|bmp)$/.test(file.type)) throw new Error('Drop PNG, JPEG, WebP, or BMP images.');
      if (file.size > 512 * 1024 * 1024) throw new Error('The selected image is too large.');
      const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Could not read the dropped image.')); reader.readAsDataURL(file); });
      files.push({ name: file.name.replace(/\.[^.]+$/, ''), data });
    }
    await editor.importImages(files); status('Images imported');
  } catch (error) { showError(error); }
  finally { currentOperation = false; editor.busy = false; editor.update(); }
});

window.desktop.onCommand(runCommand);
installAdvanced(editor, { runCommand, synchronize, showError, askInput, mayReplaceDocument, save, setTool });
installIcons();
synchronize();
installLocalization();
installTheme();
await installRecovery(editor, { setTool, showError });
document.body.inert = false;
document.documentElement.dataset.editorReady = 'true';
