import { surface, colorRecord } from './raster.js';
import { convertFloatChannels, profileBytes, validateProfile } from './color-engine.js';
import { encodeChannelSource, decodeChannelSource, channelValue } from './channel-source.js';
import { addResource, replaceResource, resourceBytes } from './workflow-assets.js';
import { pickFile } from './color-workflows.js';
import { settingsDialog, numberField } from './settings-dialog.js';
import { mappedSelection } from './raster-space.js';
import { base64Bytes, decodePrecisionFile } from './precision-raster.js';
import { decodeFloatTIFF } from './vendor/float-tiff.js';

export async function channelPreview(source, profile) {
  const values = new Float32Array(source.width * source.height * (source.channels - 1));
  for (let i = 0, j = 0; i < source.data.length; i += source.channels) for (let c = 0; c < source.channels - 1; c++) values[j++] = source.data[i + c];
  const rgb = await convertFloatChannels(values, source.mode, 'RGB', profile, await profileBytes('sRGB'));
  const image = surface(source.width, source.height), context = image.getContext('2d'), pixels = context.createImageData(source.width, source.height);
  for (let i = 0; i < source.width * source.height; i++) { for (let c = 0; c < 3; c++) pixels.data[i * 4 + c] = Math.max(0, Math.min(1, rgb[i * 3 + c])) * 255; pixels.data[i * 4 + 3] = source.data[i * source.channels + source.channels - 1] * 255; }
  context.putImageData(pixels, 0, 0); return image;
}
async function sourceFor(editor, layer) {
  if (layer.workflow?.channelFile) return decodeChannelSource(resourceBytes(editor.assets, layer.workflow.channelFile));
  if (layer.hdrSourceFile) { const source = decodeFloatTIFF(base64Bytes(editor.assets[layer.hdrSourceFile]), 16000000, true); return { width: source.width, height: source.height, mode: 'RGB', bits: 32, channels: 4, data: source.data.slice() }; }
  if (layer.filterSourceFile) { const source = await decodePrecisionFile(base64Bytes(editor.assets[layer.filterSourceFile])); return { width: source.width, height: source.height, mode: 'RGB', bits: 16, channels: 4, data: Float32Array.from(source.data, (v) => v / 65535) }; }
  const image = editor.images.get(layer.id); if (!image) throw new Error('Select a raster layer to edit its channels.');
  const pixels = image.getContext('2d').getImageData(0, 0, image.width, image.height).data;
  return { width: image.width, height: image.height, mode: 'RGB', bits: 8, channels: 4, data: Float32Array.from(pixels, (v) => v / 255) };
}
export async function commitChannelSource(editor, layer, source, profile, name, before) {
  const bytes = encodeChannelSource(source), image = await channelPreview(decodeChannelSource(bytes), profile);
  const apply = () => {
    editor.storePixels(layer, image, { filterCache: true, channelCache: true }); delete layer.text; delete layer.shape; delete layer.vectorPath;
    layer.workflow = { ...layer.workflow, type: 'channels', channelFile: replaceResource(editor, layer.workflow?.channelFile, bytes, 'channels'), mode: source.mode, bits: source.bits };
    if (profile) { if (!layer.workflow.profileFile) layer.workflow.profileFile = addResource(editor, profile, 'icc'); } else delete layer.workflow.profileFile;
  };
  if (before) { apply(); editor.history.push(before, editor.snapshot(), name); editor.update(); } else editor.mutate(name, apply);
}
export function installChannelWorkflows(editor, api) {
  const previous = editor.advancedCommand; let clipboard;
  const down = editor.pointerDown.bind(editor), paint = editor.paintSegment.bind(editor), up = editor.pointerUp.bind(editor);
  editor.pointerDown = (event) => {
    if (editor.tool === 'brush' && editor.active?.workflow?.channelFile && editor.channelPaint?.layerID !== editor.active.id) { api.showError(new Error('Choose Paint channel in Channels before painting this layer.')); return; }
    down(event);
  };
  editor.paintSegment = (from, to) => {
    const g = editor.gesture, target = editor.channelPaint;
    if (g?.kind !== 'paint' || g.tool !== 'brush' || g.isMask || target?.layerID !== g.layer.id) return paint(from, to);
    g.channelPaint ??= { source: structuredClone(target.source), channel: target.channel, profile: target.profile };
    const foreground = colorRecord(editor.color), value = .2126 * foreground.red + .7152 * foreground.green + .0722 * foreground.blue, color = editor.color; editor.color = '#ffffff'; try { paint(from, to); } finally { editor.color = color; }
    const mask = g.paint.getContext('2d').getImageData(0, 0, g.paint.width, g.paint.height).data, clip = g.clip?.getContext('2d').getImageData(0, 0, g.clip.width, g.clip.height).data;
    const { source, channel } = g.channelPaint, result = structuredClone(source), min = source.mode === 'Lab' && channel > 0 && channel < 3 ? -128 : 0, max = source.mode === 'Lab' && channel < 3 ? channel ? 127 : 100 : 1;
    for (let i = 0; i < source.width * source.height; i++) { const amount = mask[i * 4 + 3] / 255 * editor.brushOpacity * (clip ? clip[i * 4 + 3] / 255 : 1); channelValue(result, i, channel, source.data[i * source.channels + channel] * (1 - amount) + (min + value * (max - min)) * amount); }
    g.channelPaint.result = result;
  };
  editor.pointerUp = (event) => {
    const g = editor.gesture; if (!g?.channelPaint) return up(event);
    editor.pointerMove(event); editor.gesture = null; if (editor.overlay.hasPointerCapture(event.pointerId)) editor.overlay.releasePointerCapture(event.pointerId);
    const { result, source, profile } = g.channelPaint;
    if (!result || result.data.every((v, i) => v === source.data[i])) { editor.images.set(g.layer.id, g.source); editor.update(); return; }
    editor.busy = true;
    commitChannelSource(editor, g.layer, result, profile, 'Paint channel', g.before).then(() => { if (editor.channelPaint?.layerID === g.layer.id) editor.channelPaint.source = result; }).catch(async (error) => { await editor.install(g.before); api.showError(error); }).finally(() => { editor.busy = false; editor.update(); });
  };
  editor.advancedCommand = async (command) => {
    if (command === 'document-color-mode') {
      if (!editor.manifest) return true;
      const options = await settingsDialog('Document color mode', [{ key: 'mode', label: 'Color mode', options: ['RGB', 'CMYK', 'Lab'], default: editor.manifest.workflow?.colorMode ?? 'RGB' }, { key: 'bits', label: 'Channel depth', options: ['8', '16', '32'], default: String(editor.manifest.workflow?.bits ?? 16) }], {}); if (!options) return true;
      let profile; if (options.mode === 'CMYK') { const file = await pickFile('.icc,.icm'); if (!file) return true; profile = new Uint8Array(await file.arrayBuffer()); if (validateProfile(profile) !== 'CMYK') throw new Error('Select a CMYK ICC profile for this document.'); }
      else if (options.mode === 'RGB') profile = await profileBytes('sRGB');
      const prepared = [];
      for (const layer of editor.manifest.layers.filter((l) => editor.images.has(l.id))) {
        const source = await sourceFor(editor, layer), currentProfile = layer.workflow?.profileFile ? resourceBytes(editor.assets, layer.workflow.profileFile) : source.mode === 'RGB' ? await profileBytes('sRGB') : null;
        const colors = new Float32Array(source.width * source.height * (source.channels - 1)); for (let i = 0, j = 0; i < source.data.length; i += source.channels) for (let c = 0; c < source.channels - 1; c++) colors[j++] = source.data[i + c];
        const converted = await convertFloatChannels(colors, source.mode, options.mode, currentProfile, profile), channels = options.mode === 'CMYK' ? 5 : 4, data = new Float32Array(source.width * source.height * channels);
        for (let i = 0; i < source.width * source.height; i++) { for (let c = 0; c < channels - 1; c++) data[i * channels + c] = converted[i * (channels - 1) + c]; data[i * channels + channels - 1] = source.data[i * source.channels + source.channels - 1]; }
        const next = { width: source.width, height: source.height, mode: options.mode, channels, bits: Number(options.bits), data }, bytes = encodeChannelSource(next), quantized = decodeChannelSource(bytes); prepared.push({ layer, bytes, image: await channelPreview(quantized, profile) });
      }
      editor.mutate('Document color mode', () => {
        const profileFile = profile && addResource(editor, profile, 'icc');
        editor.manifest.workflow = { ...editor.manifest.workflow, colorMode: options.mode, bits: Number(options.bits), profileFile: profileFile || undefined };
        for (const { layer, bytes, image } of prepared) { editor.storePixels(layer, image, { filterCache: true, channelCache: true }); layer.workflow = { ...layer.workflow, type: 'channels', channelFile: addResource(editor, bytes, 'channels'), profileFile: profileFile || undefined, mode: options.mode, bits: Number(options.bits) }; }
      }); return true;
    }
    if (command === 'channels') {
      const layer = editor.active; if (!layer || layer.isGroup || layer.adjustment) return true;
      let source = await sourceFor(editor, layer); const names = source.mode === 'CMYK' ? ['C', 'M', 'Y', 'K', 'A'] : source.mode === 'Lab' ? ['L', 'a', 'b', 'A'] : ['R', 'G', 'B', 'A'];
      const value = await settingsDialog('Channels', [{ key: 'channel', label: 'Channel', options: names, default: names[0] }, { key: 'operation', label: 'Channel operation', options: ['Inspect', 'Paint channel', 'Fill', 'Invert', 'Copy', 'Paste'], default: 'Inspect' }, numberField('value', 'Channel value', -128, 127, 0, .01)], {}); if (!value) return true;
      const channel = names.indexOf(value.channel);
      if (value.operation === 'Paint channel') { editor.channelPaint = { layerID: layer.id, source, channel, profile: layer.workflow?.profileFile ? resourceBytes(editor.assets, layer.workflow.profileFile) : source.mode === 'RGB' ? await profileBytes('sRGB') : null }; editor.brushMode = 'Paint'; const select = document.querySelector('#brush-mode'); if (select) { select.value = 'Paint'; select.dispatchEvent(new Event('change')); } api.setTool('brush'); return true; }
      if (value.operation === 'Inspect') { const image = surface(source.width, source.height), ctx = image.getContext('2d'), pixels = ctx.createImageData(source.width, source.height); for (let i = 0; i < source.width * source.height; i++) { let v = source.data[i * source.channels + channel]; if (source.mode === 'Lab' && channel < 3) v = channel ? (v + 128) / 255 : v / 100; pixels.data.set([v * 255, v * 255, v * 255, 255], i * 4); } ctx.putImageData(pixels, 0, 0); const preview = document.createElement('img'); preview.src = image.toDataURL(); preview.className = 'matte-preview'; await settingsDialog('Channel preview', [], {}, null, { previewElement: preview }); return true; }
      if (value.operation === 'Copy') { clipboard = { width: source.width, height: source.height, values: Float32Array.from({ length: source.width * source.height }, (_, i) => source.data[i * source.channels + channel]) }; return true; }
      if (value.operation === 'Paste' && (!clipboard || clipboard.width !== source.width || clipboard.height !== source.height)) throw new Error('The copied channel dimensions do not match.');
      const mask = editor.selection && mappedSelection(editor, layer, source.width, source.height).getContext('2d').getImageData(0, 0, source.width, source.height).data;
      for (let i = 0; i < source.width * source.height; i++) { const current = source.data[i * source.channels + channel], maximum = source.mode === 'Lab' && channel < 3 ? channel ? 127 : 100 : 1, minimum = source.mode === 'Lab' && channel > 0 && channel < 3 ? -128 : 0; let next = value.operation === 'Paste' ? clipboard.values[i] : value.operation === 'Invert' ? maximum + minimum - current : value.value; const amount = mask ? mask[i * 4 + 3] / 255 : 1; channelValue(source, i, channel, current * (1 - amount) + next * amount); }
      const profile = layer.workflow?.profileFile ? resourceBytes(editor.assets, layer.workflow.profileFile) : source.mode === 'RGB' ? await profileBytes('sRGB') : null;
      await commitChannelSource(editor, layer, source, profile, 'Edit Channel'); return true;
    }
    return previous(command);
  };
}
