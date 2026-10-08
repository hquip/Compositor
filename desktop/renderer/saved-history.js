import { library } from './library-store.js';
import { packHistory, unpackHistory } from './history-journal.js';
import { layerAssetNames } from './filter-mix.js';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
async function digest(text) { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join(''); }
export async function projectFingerprint(snapshot) {
  const names = [...new Set(snapshot.manifest.layers.flatMap(layerAssetNames))].sort(), hashes = [];
  for (const name of names) hashes.push([name, await digest(snapshot.assets[name])]);
  return digest(JSON.stringify(canonical(snapshot.manifest)) + JSON.stringify(hashes));
}
export async function saveLocalHistory(snapshot, history, path, name) {
  if (!path || !crypto.subtle) return false;
  try { const journal = packHistory(history, snapshot, Math.min(history.byteLimit, 16 * 1024 * 1024)), fingerprint = await projectFingerprint(snapshot); await library.put({ id: 'history:' + path, type: 'saved-history', name, documentID: snapshot.manifest.documentID }, { fingerprint, journal }); return true; }
  catch { return false; }
}
export async function restoreLocalHistory(editor, snapshot, path) {
  if (!path || !crypto.subtle) return;
  try { const entry = await library.get('history:' + path); if (!entry || entry.fingerprint !== await projectFingerprint(snapshot)) return; const history = await unpackHistory(entry.journal, snapshot); if (history) Object.assign(editor.history, history, { savedRevision: history.revision }); }
  catch { /* Local history is optional; a damaged or stale journal never blocks opening the saved project. */ }
}
