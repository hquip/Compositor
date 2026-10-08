import { RecoveryStore } from './recovery-store.js';
import { surface } from './raster.js';
import { decodeImage } from './compose.js';
import { packHistory, unpackHistory } from './history-journal.js';
import { layerAssetNames } from './filter-mix.js';

function packSnapshot(snapshot) {
  const selection = snapshot.selection && { ...snapshot.selection };
  if (selection?.coverage) selection.coverage = selection.coverage.toDataURL('image/png');
  const files = new Set(snapshot.manifest.layers.flatMap(layerAssetNames));
  return { manifest: structuredClone(snapshot.manifest), assets: Object.fromEntries([...files].map((file) => [file, snapshot.assets[file]])), selection };
}
async function unpackSnapshot(snapshot) {
  const selection = snapshot.selection && { ...snapshot.selection };
  if (selection?.coverage) {
    const image = await decodeImage(selection.coverage), canvas = surface(image.naturalWidth, image.naturalHeight);
    canvas.getContext('2d').drawImage(image, 0, 0); selection.coverage = canvas;
  }
  return { ...snapshot, selection };
}

export async function installRecovery(editor, api) {
  const store = new RecoveryStore(), written = new Map(), removed = new Set(), instance = crypto.randomUUID();
  let timer, queue = Promise.resolve(), available = [], lastError = null, recovering = false;
  const button = document.createElement('button'); button.id = 'recovery-status'; button.hidden = true;
  button.addEventListener('click', () => show().catch(api.showError)); document.querySelector('.status-bar').append(button);
  function status(error = null) {
    lastError = error; button.hidden = !error && !available.length;
    button.textContent = error ? 'Recovery unavailable — save your work' : 'Recover unsaved projects';
    button.title = error ? 'The previous recovery copy was kept. Free storage and save the project manually.' : 'Recover unsaved projects';
    button.classList.toggle('recovery-error', !!error);
  }
  function serialize(tab) {
    const active = tab.id === editor.workspace.id, state = tab.state;
    if (removed.has(tab.recoveryID ?? tab.id)) return null;
    if (!state?.manifest || active && (editor.busy || editor.gesture || document.querySelector('dialog[open]'))) return null;
    const text = active && editor.inlineText?.capture(), gradient = active && editor.gradient?.capture(), floating = active && editor.floatingSelection?.capture();
    const path = active && editor.pathEditor?.serialize();
    const pending = text ? { type: 'text', value: text.value } : gradient ? { type: 'gradient', value: gradient } : floating ? { type: 'selection', value: floating } : path ? { type: 'path', value: path } : null;
    const id = tab.recoveryID ?? tab.id, signature = state.history.revision + JSON.stringify(pending);
    if (!state.history.dirty && !pending) return { id, clean: true };
    if (written.get(id) === signature) return null;
    const snapshot = packSnapshot(text?.before ?? (active ? editor.snapshot() : state));
    let journal; try { journal = packHistory(state.history, snapshot, Math.min(state.history.byteLimit, 16 * 1024 * 1024)); } catch { /* Preserve the document even if its optional undo journal cannot be encoded. */ }
    return { id, instance, name: state.name, updated: Date.now(), version: 1, snapshot, pending, journal, signature };
  }
  async function flush() {
    clearTimeout(timer);
    // Capture synchronously; queued writes and deletions retain the order of user actions.
    let records;
    try { records = editor.workspace.entries().map(serialize).filter(Boolean); }
    catch (error) { status(error); return; }
    const job = queue.then(async () => {
      for (const record of records) {
        if (record.clean) { await store.remove(record.id); written.delete(record.id); }
        else { const { signature, ...saved } = record;
          try { await store.put(saved); } catch (error) { if (error.name !== 'QuotaExceededError' || !saved.journal) throw error; delete saved.journal; await store.put(saved); }
          written.set(record.id, signature);
        }
      }
      if (records.length) status();
    });
    queue = job.catch((error) => status(error)); await queue;
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(() => flush().catch((error) => status(error)), 1200); }
  async function remove(id) {
    removed.add(id);
    const job = queue.then(() => store.remove(id)); queue = job.catch((error) => status(error));
    try { await job; } catch (error) { removed.delete(id); throw error; }
    written.delete(id); available = available.filter((item) => item.id !== id); status();
  }
  async function recover(id) {
    if (recovering || editor.busy || editor.gesture) return;
    editor.floatingSelection?.finish(true); editor.gradient?.finish(true); editor.pathEditor?.finish(true); if (editor.inlineText?.finish(true) === false) return;
    recovering = true;
    try {
      const checkpoint = flush(); editor.busy = true; editor.update(false); await checkpoint;
      const record = await store.read(id); if (!record || record.version !== 1) throw new Error('This recovery draft could not be opened.');
      const snapshot = await unpackSnapshot(record.snapshot);
      await editor.workspace.open({ snapshot, name: record.name, path: `recovery:${id}` }); editor.history.savedRevision = null;
      if (record.journal) { try { const history = await unpackHistory(record.journal, record.snapshot); if (history) Object.assign(editor.history, history); } catch { /* A damaged undo journal must not prevent recovery of the document itself. */ } }
      editor.busy = false;
      if (record.pending?.type === 'text') { api.setTool('text'); editor.inlineText.restore(record.pending.value); }
      else if (record.pending?.type === 'gradient') { api.setTool('gradient'); editor.gradient.restore(record.pending.value); }
        else if (record.pending?.type === 'selection') { api.setTool('move'); editor.floatingSelection.restore(record.pending.value); }
        else if (record.pending?.type === 'path') { api.setTool('path'); editor.pathEditor.restore(record.pending.value); }
      removed.delete(id); editor.workspace.setRecoveryID(id);
      available = available.filter((item) => item.id !== id); status(); editor.update(); await flush();
    } finally { recovering = false; editor.busy = false; editor.update(false); }
  }
  async function show() {
    if (editor.busy || editor.gesture || document.querySelector('dialog[open]')) return;
    const openIDs = new Set(editor.workspace.entries().map((tab) => tab.recoveryID ?? tab.id));
    available = (await store.list()).filter((item) => !openIDs.has(item.id)).sort((a, b) => b.updated - a.updated); status(lastError);
    const dialog = document.createElement('dialog'); dialog.className = 'settings-dialog recovery-dialog';
    const title = document.createElement('h2'); title.textContent = 'Recover unsaved projects'; dialog.append(title);
    const note = document.createElement('p'); note.textContent = available.length ? 'Recovered projects open as unsaved copies. Save them to keep your work.' : 'No recovery drafts available.'; dialog.append(note);
    for (const record of available) {
      const row = document.createElement('div'); row.className = 'recovery-row';
      const name = document.createElement('span'); name.dataset.noTranslate = ''; name.textContent = `${record.name} · ${new Date(record.updated).toLocaleString()}`;
      const restore = document.createElement('button'); restore.textContent = 'Recover'; restore.addEventListener('click', async () => { dialog.close(); try { await recover(record.id); } catch (error) { api.showError(error); } });
      const discard = document.createElement('button'); discard.textContent = 'Discard draft'; discard.addEventListener('click', async () => {
        if (discard.dataset.confirm !== 'true') { discard.dataset.confirm = 'true'; discard.textContent = 'Confirm discard'; return; }
        try { await remove(record.id); row.remove(); } catch (error) { api.showError(error); }
      }); row.append(name, restore, discard); dialog.append(row);
    }
    const close = document.createElement('button'); close.textContent = 'Close'; close.addEventListener('click', () => dialog.close()); dialog.append(close);
    dialog.addEventListener('close', () => dialog.remove(), { once: true }); document.body.append(dialog); dialog.showModal();
  }
  editor.recovery = { flush, remove, show, recover, get error() { return lastError; } };
  const change = editor.onChange; editor.onChange = () => { change(); schedule(); };
  const command = editor.advancedCommand; editor.advancedCommand = async (name) => { if (name === 'recover-projects') { await show(); return true; } return command(name); };
  document.addEventListener('input', schedule);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', () => flush());
  setInterval(() => flush(), 5000);
  try { available = await store.list(); status(); } catch (error) { status(error); }
}
