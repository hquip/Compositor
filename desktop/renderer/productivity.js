import { library } from './library-store.js';
import { filterAssetNames } from './filter-mix.js';
import { copyFilterResources } from './filter-resources.js';
import { settingsDialog, numberField as n } from './settings-dialog.js';
import { surface } from './raster.js';
import { compose } from './compose.js';
import { buildPhotoshop, binaryBase64 } from './psd-export.js';
import { writePsd } from './vendor/psd.js';
import { zipSync } from './vendor/archive.js';
import { colorJob } from './color-workflows.js';
import { profileBytes } from './color-engine.js';
import { withResolution } from './image-metadata.js';

export function exportName(name) { const value = String(name || 'Image').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '').replace(/[. ]+$/, '').slice(0, 100) || 'Image'; return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value) ? '_' + value : value; }
export async function batchFiles(states, options, progress = () => {}, signal) {
  const sizes = [...new Set(String(options.sizes ?? 'original').split(',').map((item) => item.trim().toLowerCase()))];
  if (!sizes.length || sizes.length > 10 || sizes.some((size) => size !== 'original' && (!/^\d+$/.test(size) || +size < 1 || +size > 30000)) || states.length * sizes.length > 100) throw new Error('Choose up to ten sizes such as original, 2048, 1080, with at most 100 output files.');
  const files = {}; let count = 0, bytes = 0;
  for (const state of states) for (const size of sizes) {
    if (signal?.aborted) throw new DOMException('Canceled', 'AbortError');
    const original = state.manifest, factor = size === 'original' ? 1 : Math.min(1, +size / Math.max(original.width, original.height)), width = Math.max(1, Math.round(original.width * factor)), height = Math.max(1, Math.round(original.height * factor));
    let data, extension;
    if (options.format === 'TIFF 16 bit') {
      const manifest = structuredClone(original); manifest.width = width; manifest.height = height;
      for (const layer of manifest.layers) for (const key of ['transform', 'maskPlacement']) if (layer[key]) { layer[key].origin = layer[key].origin.map((v) => v * factor); layer[key].size = layer[key].size.map((v) => v * factor); }
      data = (await colorJob({ snapshot: { manifest, assets: state.assets }, profile: await profileBytes('sRGB'), intent: 1, blackPoint: true, bits: 16, preview: false, workingSpace: 'sRGB' }, signal)).bytes; extension = 'tiff';
    } else if (options.format === 'PSD') {
      if (factor !== 1) throw new Error('Layered PSD batch export uses original document dimensions.');
      const editor = { ...state, pixelBudget: 800000000, composite: () => compose(state.manifest, state.images, state.masks) }; data = new Uint8Array(writePsd(buildPhotoshop(editor))); extension = 'psd';
    } else {
      const image = compose(state.manifest, state.images, state.masks, factor), canvas = options.format === 'JPEG' ? surface(width, height) : image;
      if (options.format === 'JPEG') { const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); ctx.drawImage(image, 0, 0); }
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, options.format === 'JPEG' ? 'image/jpeg' : 'image/png', (options.quality ?? 92) / 100)); if (!blob) throw new Error('Could not encode the export.'); data = withResolution(new Uint8Array(await blob.arrayBuffer()), options.format === 'JPEG' ? 'jpeg' : 'png', original.resolution ?? 72); extension = options.format === 'JPEG' ? 'jpg' : 'png';
    }
    let filename = exportName(state.name) + (size === 'original' ? '' : '-' + size) + '.' + extension, suffix = 2;
    while (Object.hasOwn(files, filename)) filename = exportName(state.name) + '-' + suffix++ + (size === 'original' ? '' : '-' + size) + '.' + extension;
    bytes += data.length; if (bytes > (options.byteLimit ?? 128 * 1024 * 1024)) throw new Error('The batch export exceeds the archive size limit.'); files[filename] = data; progress(++count, states.length * sizes.length);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (signal?.aborted) throw new DOMException('Canceled', 'AbortError'); return zipSync(files, { level: 0 });
}

export function installProductivity(editor, api) {
  async function saveSnapshot() {
    if (!editor.manifest) return;
    const name = await api.askInput('Save snapshot', 'Name', editor.name + ' · ' + new Date().toLocaleTimeString()); if (!name?.trim()) return;
    const snapshot = editor.projectSnapshot(); await library.put({ id: 'snapshot:' + crypto.randomUUID(), type: 'snapshot', name: name.trim(), documentID: snapshot.manifest.documentID }, snapshot);
  }
  async function historyPanel() {
    if (!editor.manifest) return;
    const dialog = document.createElement('dialog'); dialog.className = 'settings-dialog history-dialog'; const heading = document.createElement('h2'); heading.textContent = 'History and snapshots'; dialog.append(heading);
    const steps = [...editor.history.past, ...[...editor.history.future].reverse()], position = editor.history.past.length, history = document.createElement('div'); history.className = 'history-list';
    for (let index = 0; index <= steps.length; index++) {
      const button = document.createElement('button'); button.textContent = index ? steps[index - 1].name : 'Initial state'; button.classList.toggle('selected', index === position); button.disabled = index === position;
      button.addEventListener('click', async () => { dialog.close(); editor.busy = true; try { let snapshot; while (editor.history.past.length > index) snapshot = editor.history.undo(); while (editor.history.past.length < index) snapshot = editor.history.redo(); if (snapshot) await editor.install(snapshot); } catch (error) { api.showError(error); } finally { editor.busy = false; editor.update(); } }); history.append(button);
    } dialog.append(history);
    const snapshots = (await library.list('snapshot')).filter((item) => item.documentID === editor.manifest.documentID), title = document.createElement('h3'); title.textContent = 'Saved snapshots'; dialog.append(title);
    for (const item of snapshots) {
      const row = document.createElement('div'); row.className = 'recovery-row'; const name = document.createElement('span'); name.dataset.noTranslate = ''; name.textContent = item.name;
      const restore = document.createElement('button'); restore.textContent = 'Restore'; restore.addEventListener('click', async () => { dialog.close(); const before = editor.snapshot(); editor.busy = true;
        try { const snapshot = await library.get(item.id); if (!snapshot) throw new Error('The snapshot is no longer available.'); await editor.install(snapshot); editor.history.push(before, editor.snapshot(), 'Restore Snapshot'); } catch (error) { api.showError(error); } finally { editor.busy = false; editor.update(); }
      });
      const remove = document.createElement('button'); remove.textContent = 'Delete'; remove.addEventListener('click', async () => { if (!remove.dataset.confirm) { remove.dataset.confirm = 'yes'; remove.textContent = 'Confirm delete'; return; } try { await library.remove(item.id); row.remove(); } catch (error) { api.showError(error); } }); row.append(name, restore, remove); dialog.append(row);
    }
    const actions = document.createElement('div'); actions.className = 'dialog-actions'; const save = document.createElement('button'); save.textContent = 'Save snapshot'; save.addEventListener('click', async () => { try { await saveSnapshot(); dialog.close(); } catch (error) { api.showError(error); } });
    const close = document.createElement('button'); close.textContent = 'Close'; close.addEventListener('click', () => dialog.close()); actions.append(save, close); dialog.append(actions); document.body.append(dialog); dialog.showModal();
    await new Promise((resolve) => dialog.addEventListener('close', () => { dialog.remove(); resolve(); }, { once: true }));
  }
  const previous = editor.advancedCommand;
  editor.advancedCommand = async (command) => {
    if (command === 'save-snapshot') { await saveSnapshot(); return true; }
    if (command === 'history-panel') { editor.projectSnapshot(); await historyPanel(); return true; }
    if (command === 'save-filter-preset') {
      if (!editor.active?.filters?.length) throw new Error('Add editable filters before saving a preset.');
      const name = await api.askInput('Save filter preset', 'Name', 'My preset'); if (name?.trim()) await library.put({ id: 'preset:' + name.trim(), type: 'filter-preset', name: name.trim() }, { filters: structuredClone(editor.active.filters), maskAssets: Object.fromEntries(filterAssetNames(editor.active).map((name) => [name, editor.assets[name]])) }); return true;
    }
    if (command === 'apply-filter-preset') {
      const presets = await library.list('filter-preset'); if (!presets.length) throw new Error('No filter presets have been saved.');
      const value = await settingsDialog('Apply filter preset', [{ key: 'name', label: 'Preset', options: presets.map((item) => item.name), default: presets[0].name }], {}); if (!value) return true;
      const preset = await library.get(presets.find((item) => item.name === value.name).id); if (!editor.active) return true; const copy = copyFilterResources(preset.filters, preset.maskAssets, editor.active.id); editor.pendingFilterPreset = copy.filters; editor.pendingFilterAssets = copy.assets; return previous('edit-filters');
    }
    if (command !== 'batch-export') return previous(command);
    if (!editor.manifest) return true; editor.projectSnapshot(); const tabs = editor.workspace.entries().filter((tab) => tab.state?.manifest); let output;
    const progress = document.createElement('p'); progress.setAttribute('role', 'status');
    const value = await settingsDialog('Batch export', [{ key: 'scope', label: 'Projects', options: ['Current project', 'All open projects'], default: 'All open projects' }, { key: 'format', label: 'Format', options: ['PNG', 'JPEG', 'TIFF 16 bit', 'PSD'], default: 'PNG' }, { key: 'sizes', label: 'Maximum side lengths (original, 2048, 1080)', type: 'text', default: 'original' }, n('quality', 'JPEG quality', 1, 100, 92)], {}, null, { previewElement: progress,
      apply: async (options, signal) => { output = await batchFiles(tabs.filter((tab) => options.scope !== 'Current project' || tab.id === editor.workspace.id).map((tab) => tab.state), options, (done, total) => { progress.textContent = `${done} / ${total}`; }, signal); },
    });
    if (value && output) { const response = await window.desktop.exportFile(binaryBase64(output), 'zip', 'Compositor-export'); if (!response.ok) throw new Error(response.error); } return true;
  };
}
