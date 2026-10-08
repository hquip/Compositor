import { cloneLayers, selected } from './layer-operations.js';
import { settingsDialog, numberField as n } from './settings-dialog.js';
import { createLayer, History } from './core.js';
import { surface, copySurface, place } from './raster.js';
import { decodeImage } from './compose.js';
import { canvasSize } from './core.js';
import { selectionCanvas } from './masks.js';
import { mappedSelection } from './tools.js';
import { restoreLocalHistory } from './saved-history.js';

const stateKeys = ['manifest', 'assets', 'images', 'masks', 'history', 'name', 'selection', 'zoom', 'pan', 'selectedIDs', 'editMask', 'followsFit', 'collapsedGroups'];
export function installWorkspace(editor, api) {
  const strip = document.createElement('div'); strip.className = 'project-tabs'; document.querySelector('.canvas-column').prepend(strip);
  const tabs = [{ id: crypto.randomUUID(), state: null }]; let current = tabs[0], switching = false, clipboard = null;
  const capture = () => Object.fromEntries(stateKeys.map((key) => [key, editor[key]]));
  const saveCurrent = () => { current.state = capture(); };
  const anyDirty = () => tabs.some((tab) => tab === current ? !!editor.manifest && editor.history.dirty : !!tab.state?.manifest && tab.state.history.dirty);
  const draw = () => {
    saveCurrent(); strip.replaceChildren();
    for (const tab of tabs) {
      const button = document.createElement('button'); button.className = `project-tab${tab === current ? ' selected' : ''}`;
      const name = document.createElement('span'); name.textContent = (tab.state?.name ?? 'Untitled') + (tab.state?.manifest && tab.state.history.dirty ? ' •' : '');
      const close = document.createElement('span'); close.className = 'tab-close'; close.textContent = '×'; close.setAttribute('aria-label', 'Close project');
      close.addEventListener('click', (event) => { event.stopPropagation(); closeTab(tab); }); button.append(name, close); button.addEventListener('click', () => activate(tab));
      button.draggable = true; button.addEventListener('dragstart', (event) => event.dataTransfer.setData('application/x-compositor-tab', tab.id));
      button.addEventListener('dragover', (event) => { event.preventDefault(); if (event.dataTransfer.types.includes('application/x-compositor-layers') && tab !== current) activate(tab); }); button.addEventListener('drop', (event) => {
        const layerKey = event.dataTransfer.getData('application/x-compositor-layers');
        if (layerKey && editor.layerDrag?.id === layerKey && editor.layerDrag.sourceSession !== current.id) { editor.mutate('Copy Layers Between Projects', () => cloneLayers(editor, editor.layerDrag.ids, editor.layerDrag.snapshot)); return; }
        const id = event.dataTransfer.getData('application/x-compositor-tab'), other = tabs.find((item) => item.id === id); if (other && other !== tab) { tabs.splice(tabs.indexOf(other), 1); tabs.splice(tabs.indexOf(tab), 0, other); draw(); } }); strip.append(button);
    }
    const add = document.createElement('button'); add.className = 'new-tab'; add.textContent = '+'; add.title = 'New project'; add.addEventListener('click', () => api.runCommand('new')); strip.append(add);
  };
  async function activate(tab, force = false) {
    if (tab === current || (!force && editor.busy) || editor.gesture || document.querySelector('dialog[open]')) return;
    editor.floatingSelection?.finish(true); editor.gradient?.finish(true); editor.pathEditor?.finish(true); if (editor.inlineText?.finish(true) === false) return; saveCurrent(); current = tab; if (tab.state) Object.assign(editor, tab.state); editor.update();
    if (tab.external) { tab.external = false; editor.workspace.external(tab.id); }
  }
  async function closeTab(tab) {
    if (editor.busy || editor.gesture || document.querySelector('dialog[open]')) return;
    editor.floatingSelection?.finish(true); editor.gradient?.finish(true); editor.pathEditor?.finish(true); if (editor.inlineText?.finish(true) === false) return; await activate(tab);
    if (!await api.mayReplaceDocument()) return;
    await editor.recovery?.remove(tab.recoveryID ?? tab.id);
    const index = tabs.indexOf(tab); tabs.splice(index, 1);
    window.desktop.closeProject?.(tab.id);
    if (!tabs.length) { const empty = { id: crypto.randomUUID(), state: null }; tabs.push(empty); current = empty; editor.manifest = null; editor.assets = {}; editor.images = new Map(); editor.masks = new Map(); editor.history.reset(); editor.name = 'Untitled'; }
    else { current = tabs[Math.min(index, tabs.length - 1)]; Object.assign(editor, current.state); }
    editor.update();
  }
  const onChange = editor.onChange;
  editor.onChange = () => { if (!switching) draw(); onChange(); };
  const create = editor.newCanvas.bind(editor);
  editor.newCanvas = (...args) => {
    if (editor.manifest) { saveCurrent(); current = { id: crypto.randomUUID(), state: null }; tabs.push(current); }
    switching = true; editor.history = new History(); editor.collapsedGroups = new Set(); create(...args); switching = false; editor.update();
  };
  editor.workspace = {
    get id() { return current.id; },
    entries() { saveCurrent(); return tabs.map((tab) => ({ ...tab })); },
    setRecoveryID(id) { current.recoveryID = id; },
    anyDirty,
    async open(result) {
      const existing = tabs.find((tab) => tab.path === result.path);
      if (existing) { await activate(existing, true); return; }
      const before = capture(); saveCurrent();
      switching = true;
      try {
        editor.history = new History(); editor.collapsedGroups = new Set(); await editor.install(result.snapshot, true);
        if (before.manifest) { current = { id: crypto.randomUUID(), state: null }; tabs.push(current); }
        current.path = result.path; editor.name = result.name; editor.fit(); await restoreLocalHistory(editor, result.snapshot, result.path);
      } catch (error) { Object.assign(editor, before); throw error; }
      finally { switching = false; editor.update(); }
    },
    saved(id, result, revision) {
      const tab = tabs.find((item) => item.id === id);
      if (!tab) return;
      tab.path = result.path;
      if (tab === current) { editor.history.savedRevision = revision; editor.name = result.name; }
      else { tab.state.history.savedRevision = revision; tab.state.name = result.name; }
      editor.update(false);
    },
    async closeAll() {
      saveCurrent();
      for (const tab of [...tabs]) { await activate(tab); if (!await api.mayReplaceDocument()) return false; }
      for (const tab of tabs) await editor.recovery?.remove(tab.recoveryID ?? tab.id);
      return true;
    },
    async external(id) {
      const tab = tabs.find((item) => item.id === id);
      if (!tab) return;
      if (tab !== current) { tab.external = true; return; }
      if (editor.busy || editor.gesture || document.querySelector('dialog[open]')) { setTimeout(() => editor.workspace.external(id), 1000); return; }
      if (editor.history.dirty || editor.textDraft || editor.gradientDraft || editor.floatingDraft) {
        const result = await settingsDialog('Project changed on disk', [{ key: 'choice', label: 'Unsaved edits', options: ['Keep my edits', 'Reload from disk'], default: 'Keep my edits' }], {});
        if (!result || result.choice !== 'Reload from disk') return;
      }
      const result = await window.desktop.reloadProject(id); if (!result.ok || !result.value) return;
      if (tab !== current) { tab.external = true; return; }
      const zoom = editor.zoom, pan = editor.pan;
      editor.floatingSelection?.finish(false); editor.inlineText?.finish(false); editor.gradient?.finish(false); editor.pathEditor?.finish(false);
      await editor.install(result.value, true); editor.zoom = zoom; editor.pan = pan; editor.update();
    },
  };
  const previous = editor.advancedCommand;
  editor.advancedCommand = async (command) => {
    if (command === 'new-from-clipboard') {
      const response = await window.desktop.pasteImage(); if (!response.ok) throw new Error(response.error);
      if (!response.value) throw new Error('The clipboard does not contain an image.');
      const image = await decodeImage(response.value), width = image.naturalWidth, height = image.naturalHeight; canvasSize(width, height);
      if (width * height > editor.pixelBudget) throw new Error('The clipboard image exceeds the document pixel budget.');
      const canvas = surface(width, height); canvas.getContext('2d').drawImage(image, 0, 0);
      if (editor.manifest) editor.projectSnapshot(); editor.newCanvas(width, height);
      editor.mutate('New from Clipboard', () => { editor.active.name = 'Pasted'; editor.storePixels(editor.active, canvas); });
      window.desktop.setDocumentState({ name: editor.name, documentID: editor.manifest.documentID, dirty: true, resetPath: true }); return true;
    }
    if (command === 'close') { if (await editor.workspace.closeAll()) window.desktop.readyToClose(); return true; }
    if (command === 'close-tab') { await closeTab(current); return true; }
    if (command === 'copy' || command === 'copy-merged' || command === 'cut') {
      if (!editor.manifest) return true;
      if (editor.selection || command === 'copy-merged') {
        const canvas = command === 'copy-merged' ? editor.composite(true) : surface(editor.manifest.width, editor.manifest.height);
        if (command !== 'copy-merged' && editor.active && editor.images.get(editor.active.id)) place(canvas.getContext('2d'), editor.images.get(editor.active.id), editor.active.transform);
        if (editor.selection) { const context = canvas.getContext('2d'); context.globalCompositeOperation = 'destination-in'; context.drawImage(selectionCanvas(editor), 0, 0); }
        clipboard = { image: canvas }; await window.desktop.copyImage(canvas.toDataURL('image/png'));
      } else { clipboard = { state: { ...capture(), manifest: structuredClone(editor.manifest), assets: { ...editor.assets }, images: new Map(editor.images), masks: new Map(editor.masks) }, ids: new Set(selected(editor)) }; }
      if (command === 'cut') {
        if (editor.selection && editor.active && editor.images.has(editor.active.id)) editor.mutate('Cut Pixels', () => { const layer = editor.active, image = copySurface(editor.images.get(layer.id)), ctx = image.getContext('2d'); ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(mappedSelection(editor, layer, image.width, image.height), 0, 0); editor.storePixels(layer, image); editor.rasterize(layer); });
        else await editor.deleteLayer();
      } return true;
    }
    if (command === 'paste') {
      if (!editor.manifest) return true;
      if (clipboard?.state) editor.mutate('Paste Layers', () => cloneLayers(editor, clipboard.ids, clipboard.state));
      else if (clipboard?.image) editor.mutate('Paste', () => { const canvas = clipboard.image, layer = createLayer('Pasted', canvas.width, canvas.height); editor.manifest.layers.push(layer); editor.manifest.activeLayerID = layer.id; editor.storePixels(layer, canvas); });
      else { const response = await window.desktop.pasteImage(); if (response.ok && response.value) await editor.importImages([{ name: 'Pasted', data: response.value }]); }
      return true;
    }
    return await previous(command);
  };
  document.addEventListener('keydown', (event) => {
    if (event.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || document.querySelector('dialog[open]') || !event.ctrlKey) return;
    const key = event.key.toLowerCase(), command = key === 'c' ? event.shiftKey ? 'copy-merged' : 'copy' : key === 'v' ? 'paste' : key === 'x' ? 'cut' : key === 'w' ? 'close-tab' : key === 'g' ? (event.shiftKey ? 'ungroup' : 'group') : key === 'e' && !event.shiftKey ? 'merge-down' : null;
    if (command) { event.preventDefault(); api.runCommand(command); }
  });
  window.desktop.onCommand((command, message) => { if (command === 'external-change') editor.workspace.external(message.documentID); });
  draw();
}
