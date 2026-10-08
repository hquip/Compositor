import { base64Bytes } from './precision-raster.js';
const binaryBase64 = (bytes) => { let text = ''; for (let at = 0; at < bytes.length; at += 32768) text += String.fromCharCode(...bytes.subarray(at, at + 32768)); return btoa(text); };

export function addResource(editor, bytes, kind) {
  const file = crypto.randomUUID().toUpperCase() + '.resource.bin';
  (editor.manifest.resources ??= []).push({ file, kind }); editor.assets[file] = binaryBase64(bytes); return file;
}
export function replaceResource(editor, file, bytes, kind) {
  if (!file || !(editor.manifest.resources ?? []).some((resource) => resource.file === file && resource.kind === kind)) return addResource(editor, bytes, kind);
  editor.assets[file] = binaryBase64(bytes); return file;
}
export function resourceBytes(assets, file) {
  if (!file || typeof assets?.[file] !== 'string') throw new Error('A professional workflow resource is missing.');
  return base64Bytes(assets[file]);
}
export function resourceText(assets, file) { return new TextDecoder('utf-8', { fatal: true }).decode(resourceBytes(assets, file)); }
export function retainResources(editor, source) {
  const existing = new Set((editor.manifest.resources ?? []).map((item) => item.file));
  for (const resource of source.manifest.resources ?? []) {
    if (existing.has(resource.file)) { if (editor.assets[resource.file] !== source.assets[resource.file]) throw new Error('Conflicting project workflow resources.'); continue; }
    (editor.manifest.resources ??= []).push(structuredClone(resource)); editor.assets[resource.file] = source.assets[resource.file]; existing.add(resource.file);
  }
}
