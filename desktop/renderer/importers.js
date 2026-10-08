import { parsePhotoshop } from './photoshop.js';
import { parsePhotoshopExtended } from './photoshop-extended.js';
import { surface } from './raster.js';
import { applyCameraRaw } from './adjustments.js';
import { decodeImage } from './compose.js';
import { settingsDialog, numberField as n } from './settings-dialog.js';
import { developRaw } from './raw.js';
import { importHDRFile } from './hdr-workflows.js';
import { base64Bytes } from './precision-raster.js';

export async function decodeHeif(encoded) {
  const imported = await import('./vendor/libheif.mjs');
  const lib = typeof imported.default === 'function' ? await imported.default() : await (imported.default.ready ?? imported.default);
  const decoder = new lib.HeifDecoder(), images = decoder.decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)));
  if (!images.length) throw new Error('No image was found in the HEIC file.');
  const image = images[0], width = image.get_width(), height = image.get_height();
  if (width > 30000 || height > 30000 || width * height > 200000000) throw new Error('The HEIC image exceeds the pixel budget.');
  const canvas = surface(width, height), context = canvas.getContext('2d'), data = context.createImageData(width, height);
  try {
    await new Promise((resolve, reject) => image.display(data, (result) => result ? resolve() : reject(new Error('HEIC decoding failed.'))));
    context.putImageData(data, 0, 0); return canvas.toDataURL('image/png');
  } finally { for (const image of images) image.free?.(); decoder.free?.(); }
}
export async function importFiles(editor, files) {
  const ordinary = [];
  for (const file of files) {
    if (file.kind === 'photoshop') {
      const used = [...editor.images.values(), ...editor.masks.values()].reduce((sum, image) => sum + image.width * image.height, 0);
      const parsed = await parsePhotoshopExtended(file.data, editor.pixelBudget - used);
      const summary = document.createElement('dialog'); const title = document.createElement('h2'); title.textContent = 'Photoshop conversion';
      const text = document.createElement('p'); text.className = 'dialog-description'; text.textContent = `${parsed.snapshot.manifest.width} × ${parsed.snapshot.manifest.height} px · ${parsed.snapshot.manifest.layers.length} layers\n\n` + (parsed.report.join('\n') || 'Layers, masks, blend modes and supported editable content are preserved.');
      const actions = document.createElement('div'); actions.className = 'dialog-actions'; for (const label of ['Cancel', 'Import']) { const button = document.createElement('button'); button.textContent = label; button.addEventListener('click', () => summary.close(label)); actions.append(button); } summary.append(title, text, actions); document.body.append(summary); summary.showModal();
      const choice = await new Promise((resolve) => summary.addEventListener('close', () => resolve(summary.returnValue), { once: true })); summary.remove();
      if (choice === 'Import') {
        if (!editor.manifest) { await editor.install(parsed.snapshot, true); editor.name = file.name; editor.history.savedRevision = null; editor.fit(); }
        else { const before = editor.snapshot(), imported = parsed.snapshot; editor.manifest.layers.push(...imported.manifest.layers); Object.assign(editor.assets, imported.assets); editor.manifest.activeLayerID = imported.manifest.activeLayerID; await editor.install(editor.snapshot()); editor.history.push(before, editor.snapshot(), 'Import Photoshop'); }
      }
    } else if (file.kind === 'openexr') {
      if (ordinary.length) { await editor.importImages(ordinary); ordinary.length = 0; }
      await importHDRFile(editor, base64Bytes(file.data), file.name);
    } else if (file.kind === 'heif') ordinary.push({ ...file, data: await decodeHeif(file.data) });
    else if (file.kind === 'raw') {
      const data = await developRaw(file); if (data) ordinary.push({ ...file, data });
    } else ordinary.push(file);
  }
  if (ordinary.length) await editor.importImages(ordinary);
}
