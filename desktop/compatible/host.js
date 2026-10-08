import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readImage, writeImage, readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { Image } from '@tauri-apps/api/image';
import validation from '../lib/validation.cjs';
import workflows from '../lib/workflow-resources.cjs';
import { zipSync, unzipSync, strToU8 } from 'fflate';

const listeners = new Set(), paths = new Map(); let state = {}, lastFingerprint;
const result = async (operation) => { try { return { ok: true, value: await operation() }; } catch (error) { return { ok: false, error: error.message ?? String(error) }; } };
const bytes = (encoded) => Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
const encoded = (data) => { let text = ''; for (let at = 0; at < data.length; at += 32768) text += String.fromCharCode(...data.subarray(at, at + 32768)); return btoa(text); };
function validate(snapshot) {
  validation.validateManifest(snapshot.manifest); let count = 0;
  for (const layer of snapshot.manifest.layers) for (const [file, mask, hdr] of validation.layerResources(layer)) { if (!file) continue; const data = bytes(snapshot.assets[file]); const info = validation.inspectAsset(data, mask, file === layer.filterSourceFile, hdr); validation.validateSourceSize(layer, file, info, snapshot.manifest.version); count += info.pixels; }
  for (const resource of workflows.workflowResources(snapshot.manifest)) count += workflows.inspectWorkflowResource(bytes(snapshot.assets[resource.file]), resource.kind).pixels;
  if (count > 200000000) throw new Error('The project exceeds the document pixel budget.'); return snapshot;
}
const basename = (name) => name.split(/[\\/]/).at(-1).replace(/\.comp$/i, '');
async function readProject(path) { const snapshot = validate(await invoke('read_project', { path })); return { snapshot, path, name: basename(path) }; }
async function writeExport(data, format, name) { const path = await save({ defaultPath: (name ?? state.name ?? 'Image') + '.' + (format === 'jpeg' ? 'jpg' : format), filters: [{ name: format.toUpperCase(), extensions: [format === 'jpeg' ? 'jpg' : format] }] }); if (!path) return null; await invoke('write_file', { path, data }); return path; }
window.desktop = {
  openProject: () => result(async () => { const path = await open({ directory: true, multiple: false, title: 'Open a .comp project directory' }); return path ? readProject(path) : null; }),
  openRecent: (index) => result(async () => { const items = JSON.parse(localStorage.getItem('compositor.recent') ?? '[]'); return items[index] ? readProject(items[index]) : null; }),
  saveProject: (snapshot, saveAs, session) => result(async () => {
    validate(snapshot); let path = !saveAs && paths.get(session);
    if (!path) path = await save({ defaultPath: (state.name ?? 'Project') + '.comp', filters: [{ name: 'Compositor project', extensions: ['comp'] }] }); if (!path) return null;
    await invoke('write_project', { path, snapshot }); paths.set(session, path); lastFingerprint = JSON.stringify(snapshot);
    const recent = JSON.parse(localStorage.getItem('compositor.recent') ?? '[]'); localStorage.setItem('compositor.recent', JSON.stringify([path, ...recent.filter((v) => v !== path)].slice(0, 20))); return { path, name: basename(path) };
  }),
  importImages: () => result(async () => {
    const files = await open({ multiple: true, filters: [{ name: 'Images', extensions: ['png','jpg','jpeg','webp','bmp','psd','psb','tif','tiff','exr','heic','heif','dng','cr2','nef','arw','raf','rw2','orf','svg','ora'] }] }); if (!files) return [];
    return Promise.all(files.map(async (path) => { const data = await invoke('read_file', { path }), extension = path.split('.').at(-1).toLowerCase(), name = path.split(/[\\/]/).at(-1).replace(/\.[^.]+$/, ''), kind = ['psd','psb'].includes(extension) ? 'photoshop' : extension === 'exr' ? 'openexr' : ['heic','heif'].includes(extension) ? 'heif' : ['dng','cr2','nef','arw','raf','rw2','orf'].includes(extension) ? 'raw' : extension === 'ora' ? 'openraster' : extension === 'tiff' || extension === 'tif' ? 'tiff' : 'image'; return { name, kind, extension, data: kind === 'image' ? `data:${extension === 'svg' ? 'image/svg+xml' : 'image/' + (extension === 'jpg' ? 'jpeg' : extension)};base64,${data}` : data }; }));
  }),
  exportImage: (data, format) => result(() => writeExport(data.split(',')[1], format)),
  exportFile: (data, format, name) => result(() => writeExport(data, format, name)),
  copyImage: (data) => result(async () => { const response = await fetch(data), bitmap = await createImageBitmap(await response.blob()), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height; const context = canvas.getContext('2d'); context.drawImage(bitmap,0,0); bitmap.close(); const image = await Image.new(context.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height); try { await writeImage(image); } finally { await image.close(); } }),
  pasteImage: () => result(async () => { try { const image = await readImage(); const size = await image.size(), pixels = await image.rgba(), canvas = document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height; canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels), size.width, size.height),0,0); await image.close(); return canvas.toDataURL('image/png'); } catch { const value = await readText(); return value?.startsWith('data:image/') ? value : null; } }),
  limits: async () => ({ ok: true, value: { documentPixels: 200000000, surfacePixels: 16000000, maxSide: 30000 } }),
  installedFonts: async () => ({ ok: true, value: [] }), colorProfiles: async () => ({ ok: true, value: [] }),
  reloadProject: (id) => result(async () => paths.has(id) ? invoke('read_project', { path: paths.get(id) }) : null),
  setDocumentState: (next) => { state = { ...state, ...next }; if (next.openedPath && next.sessionID) paths.set(next.sessionID, next.openedPath); invoke('document_state', { dirty: !!next.dirty }); getCurrentWindow().setTitle((next.name ?? 'Compositor') + (next.dirty ? ' •' : '') + ' — Compositor'); },
  setLanguage: () => {}, setTheme: () => {}, closeProject: (id) => paths.delete(id),
  readyToClose: () => invoke('close_editor'), onCommand: (callback) => { listeners.add(callback); return () => listeners.delete(callback); },
};
await listen('editor-command', ({ payload }) => { for (const callback of listeners) callback(payload); });
const { runCommand } = await import('../renderer/app.js');
const menu = document.querySelector('.editor-menus');
for (const [name, entries] of [['File', [['New','new'],['New from Clipboard','new-from-clipboard'],['Open','open'],['Import','import'],['Save','save'],['Save As','save-as'],['Export PNG','export-png'],['Export JPEG','export-jpeg'],['Export WebP','export-webp'],['Close project','close-tab']]],['Edit',[['Undo','undo'],['Redo','redo'],['Cut','cut'],['Copy','copy'],['Paste','paste']]]]) {
  const details = document.createElement('details'), summary = document.createElement('summary'), list = document.createElement('div'); summary.textContent = name; details.append(summary); list.className = 'editor-menu-dropdown';
  for (const [label, command] of entries) { const button = document.createElement('button'); button.textContent = label; button.addEventListener('click', () => { details.open = false; runCommand(command); }); list.append(button); } details.append(list); menu.prepend(details);
}
document.documentElement.dataset.compatibleReady = 'true';
