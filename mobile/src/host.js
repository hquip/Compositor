import { Capacitor, registerPlugin } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Clipboard } from '@capacitor/clipboard';
import { App } from '@capacitor/app';
import { base64, unbase64, decodeProject, encodeProject, MOBILE_PIXELS } from './archive.js';
import { ProjectLibrary } from './projects.js';
import { installTouch } from './touch.js';
import { translate } from './localization.js';
import { configureCanvasLimits } from './core.js';
import { withResolution } from './metadata.js';
import { decodeTiff } from './tiff.js';
import { installMobileLayout } from './layout.js';
const library = new ProjectLibrary(Filesystem, Directory.Data), sessions = new Map(), listeners = new Set();
const nativeImages = registerPlugin('CompositorImages');
const nativeClipboard = registerPlugin('CompositorClipboard');
if (!crypto.randomUUID) crypto.randomUUID = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(''); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
let state = {}, saving = false;
const result = async (operation) => { try { return { ok: true, value: await operation() }; } catch (error) { return { ok: false, error: translate(error.message) }; } };
function picker(accept, multiple = false) {
  return new Promise((resolve) => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = accept; input.multiple = multiple; input.hidden = true;
    const finish = () => { const files = [...input.files]; input.remove(); resolve(files); };
    input.addEventListener('change', finish, { once: true }); input.addEventListener('cancel', finish, { once: true }); document.body.append(input); input.click();
  });
}
async function importArchive() {
  const [file] = await picker('.zip,application/zip,application/x-zip-compressed'); if (!file) return null;
  if (file.size > 128 * 1024 * 1024) throw new Error('The project archive is too large.');
  const snapshot = decodeProject(new Uint8Array(await file.arrayBuffer())), name = file.name.replace(/\.comp\.zip$|\.zip$/i, '');
  const record = await library.save(snapshot, name); return { snapshot, name, path: record.id };
}
async function openProject() {
  const projects = await library.list();
  const dialog = document.createElement('dialog'); dialog.className = 'mobile-projects';
  const title = document.createElement('h2'); title.textContent = 'Projects'; dialog.append(title);
  const subtitle = document.createElement('p'); subtitle.textContent = projects.length ? 'On this device' : 'No saved projects yet.'; dialog.append(subtitle);
  const choice = await new Promise((resolve) => {
    let selected = null;
    for (const project of projects) { const button = document.createElement('button'); button.className = 'saved-project'; button.dataset.noTranslate = ''; button.textContent = project.name; button.addEventListener('click', () => { selected = project; dialog.close(); }); dialog.append(button); }
    for (const label of ['Import project archive', 'Cancel']) { const button = document.createElement('button'); button.textContent = label; button.addEventListener('click', () => { selected = label === 'Cancel' ? null : 'import'; dialog.close(); }); dialog.append(button); }
    dialog.addEventListener('close', () => { dialog.remove(); resolve(selected); }, { once: true }); document.body.append(dialog); dialog.showModal();
  });
  if (!choice) return null; if (choice === 'import') return await importArchive();
  return { snapshot: await library.read(choice), name: choice.name, path: choice.id };
}
async function askName() {
  const dialog = document.createElement('dialog'), form = document.createElement('form'); form.method = 'dialog';
  const title = document.createElement('h2'); title.textContent = 'Choose a project name'; const input = document.createElement('input'); input.value = state.name ?? 'Untitled'; input.required = true; input.maxLength = 100; input.setAttribute('aria-label', 'Project name');
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.addEventListener('click', () => dialog.close('cancel'));
  const save = document.createElement('button'); save.type = 'submit'; save.textContent = 'Save'; save.value = 'save'; form.append(title, input, cancel, save); dialog.append(form); document.body.append(dialog); dialog.showModal(); input.focus();
  return await new Promise((resolve) => dialog.addEventListener('close', () => { const name = dialog.returnValue === 'save' ? input.value.trim() : null; dialog.remove(); resolve(name); }, { once: true }));
}
async function shareBytes(bytes, name, type) {
  if (Capacitor.isNativePlatform()) {
    const filename = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
    const saved = await Filesystem.writeFile({ path: 'exports/' + filename, directory: Directory.Cache, data: base64(bytes), recursive: true });
    await Share.share({ title: name, files: [saved.uri], dialogTitle: translate('Save and share') });
  } else {
    const file = new File([bytes], name, { type });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: name });
    else { const url = URL.createObjectURL(file), link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
  }
  return true;
}
window.desktop = Object.freeze({
  openProject: () => result(openProject),
  openRecent: () => result(openProject),
  saveProject: (snapshot, saveAs, session = state.sessionID) => result(async () => {
    if (saving) throw new Error('A project is already being saved.'); saving = true;
    try {
      const existing = sessions.get(session), name = saveAs || !existing ? await askName() : state.name;
      if (!name) return null;
      const record = await library.save(snapshot, name, saveAs ? undefined : existing); sessions.set(session, record.id);
      return { name, path: record.id };
    } finally { saving = false; }
  }),
  importImages: () => result(async () => {
    const files = await picker('image/*,.ora,image/openraster,.exr,.psd,.psb,.heic,.heif,.dng,.cr2,.nef,.arw,.raf', true), images = [];
    for (const file of files) {
      if (file.size > 128 * 1024 * 1024) throw new Error('The selected image is too large.');
      const extension = file.name.split('.').at(-1).toLowerCase(), name = file.name.replace(/\.[^.]+$/, ''), data = base64(new Uint8Array(await file.arrayBuffer()));
      if (extension === 'tif' || extension === 'tiff') { images.push({ name, kind: 'image', data: decodeTiff(unbase64(data)) }); continue; }
      const kind = extension === 'exr' ? 'openexr' : extension === 'ora' ? 'openraster' : /^(psd|psb)$/.test(extension) ? 'photoshop' : /^(heic|heif|hif)$/.test(extension) ? 'heif' : /^(dng|cr2|cr3|nef|nrw|arw|raf|orf|rw2|pef|raw)$/.test(extension) ? 'raw' : 'image';
      const mime = file.type || ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' }[extension] ?? 'application/octet-stream');
      images.push({ name, kind, extension, data: kind === 'image' ? `data:${mime};base64,${data}` : data });
    }
    return images;
  }),
  exportImage: (data, format, resolution) => result(async () => shareBytes(withResolution(unbase64(data.split(',')[1]), format, resolution), (state.name ?? 'Image') + '.' + (format === 'jpeg' ? 'jpg' : format), 'image/' + format)),
  exportFile: (data, format, name) => result(async () => shareBytes(unbase64(data), (name || state.name || 'Image') + '.' + format, { ora: 'image/openraster', psd: 'image/vnd.adobe.photoshop', psb: 'image/vnd.adobe.photoshop', tiff: 'image/tiff', exr: 'image/x-exr', icc: 'application/vnd.iccprofile', zip: 'application/zip' }[format] ?? 'application/octet-stream')),
  reloadProject: (id) => result(async () => { const record = (await library.list()).find((project) => project.id === sessions.get(id)); return record ? library.read(record) : null; }),
  copyImage: (data) => result(() => Clipboard.write({ image: data })),
  developRaw: Capacitor.getPlatform() === 'ios' ? (file, settings) => nativeImages.developRaw({ data: file.data, extension: file.extension ?? 'raw', settings: settings ?? null }) : null,
  pasteImage: () => result(async () => {
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') return (await nativeClipboard.readImage()).data ?? null;
    const value = await Clipboard.read(); return value.type.startsWith('image/') ? value.value : null;
  }),
  limits: async () => ({ ok: true, value: { documentPixels: MOBILE_PIXELS, surfacePixels: 16000000, maxSide: 8192 } }),
  setDocumentState: (next) => { state = { ...next, sessionID: next.sessionID ?? state.sessionID }; if (next.openedPath && state.sessionID) sessions.set(state.sessionID, next.openedPath); },
  setLanguage: () => {}, closeProject: (id) => sessions.delete(id),
  readyToClose: () => { if (Capacitor.getPlatform() === 'android') App.exitApp(); },
  onCommand: (callback) => { listeners.add(callback); return () => listeners.delete(callback); },
});
document.body.classList.add('mobile-app');
configureCanvasLimits(8192, 16000000);
const { editor, runCommand } = await import('./app.js');
editor.history.byteLimit = 64 * 1024 * 1024;
const newCanvas = editor.newCanvas.bind(editor), openCanvas = editor.install.bind(editor);
editor.newCanvas = (...args) => { newCanvas(...args); editor.history.byteLimit = 64 * 1024 * 1024; };
editor.install = async (...args) => { await openCanvas(...args); editor.history.byteLimit = 64 * 1024 * 1024; };
document.querySelector('.inspector-note span').textContent = `${Capacitor.getPlatform() === 'ios' ? 'iOS' : Capacitor.getPlatform() === 'android' ? 'Android' : 'Mobile'} · 0.5`;
document.querySelector('#tool-hint').textContent = 'Two fingers to pan and zoom';
const menu = document.querySelector('.editor-menus');
for (const [name, entries] of [ ['File', [['New', 'new'], ['New from Clipboard', 'new-from-clipboard'], ['Open', 'open'], ['Import', 'import'], ['Save', 'save'], ['Save As', 'save-as'], ['Share project', 'share-project'], ['Export PNG', 'export-png'], ['Export JPEG', 'export-jpeg'], ['Export WebP', 'export-webp'], ['Close project', 'close-tab']]], ['Edit', [['Undo', 'undo'], ['Redo', 'redo'], ['Cut', 'cut'], ['Copy', 'copy'], ['Copy Merged', 'copy-merged'], ['Paste', 'paste']]] ]) {
  const details = document.createElement('details'), summary = document.createElement('summary'), dropdown = document.createElement('div'); details.dataset.category = name.toLowerCase(); summary.textContent = name; dropdown.className = 'editor-menu-dropdown';
  for (const [label, command] of entries) {
    const button = document.createElement('button'); button.textContent = label;
    button.addEventListener('click', async () => {
      details.open = false;
      if (command !== 'share-project') { await runCommand(command); return; }
      if (!editor.manifest) return; editor.inlineText?.finish(true);
      const response = await result(() => shareBytes(encodeProject(editor.projectSnapshot(), editor.name), editor.name + '.comp.zip', 'application/zip'));
      if (!response.ok) editor.onError(new Error(response.error));
    }); dropdown.append(button);
  }
  details.append(summary, dropdown); menu.prepend(details);
}
const mobileLayout = installMobileLayout(editor, menu);
installTouch(editor);
if (Capacitor.isNativePlatform()) {
  App.addListener('appStateChange', ({ isActive }) => { if (!isActive) editor.recovery?.flush(); });
  App.addListener('backButton', () => { const dialog = document.querySelector('dialog[open]'); if (dialog) dialog.close(); else if (!mobileLayout.close()) runCommand('close'); });
}
if (!Capacitor.isNativePlatform()) window.addEventListener('beforeunload', (event) => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
document.documentElement.dataset.mobileReady = 'true';
