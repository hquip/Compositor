import { createLayer, createManifest } from '../renderer/core.js';
import { png } from './fixtures.mjs';

export function compatibilityFixture() {
  let next = 1;
  const id = () => `C011AB1E-0000-4000-8000-${String(next++).padStart(12, '0')}`;
  const manifest = createManifest(64, 48); manifest.documentID = 'C011AB1E-0000-4000-8000-000000000000'; manifest.resolution = 144;
  const assets = {};
  const add = (name, image = true) => { const layer = createLayer(name, 16, 16); layer.id = id(); layer.transform.origin = [8, 8]; if (image) { layer.imageFile = `${layer.id}.png`; assets[layer.imageFile] = png(16, 16, [120, 80, 200, 255]).toString('base64'); } manifest.layers.push(layer); return layer; };
  const group = add('Windows folder', false); group.isGroup = true; group.transform.size = [64, 48]; group.transform.origin = [0, 0]; group.opacity = .8;
  const base = add('Base pixels'); base.parentID = group.id; base.transform.rotation = 12; base.opacity = .75; base.maskFile = `${base.id}.mask.png`; base.maskEnabled = true; base.maskLinked = false; base.maskPlacement = structuredClone(base.transform); assets[base.maskFile] = png(16, 16, [220], true).toString('base64');
  const clipped = add('Clipped pixels'); clipped.parentID = group.id; clipped.maskSourceID = base.id; clipped.blendMode = 'Screen';
  const text = add('Editable text'); text.text = { content: 'Windows', fontName: 'Helvetica', fontSize: 12, red: .3, green: .4, blue: .5, alignment: 'Left', tracking: 0, leading: 0, boxSize: [64, 24], colorRuns: [{ location: 0, length: 3, red: 1, green: 0, blue: 0 }], fontRuns: [{ location: 3, length: 4, fontName: 'Courier' }] };
  const shape = add('Editable shape'); shape.shape = { kind: 'Rectangle', red: .4, green: .5, blue: .6, cornerRadius: 3 };
  shape.effects = { stroke: { size: 2, red: .8, green: .2, blue: .1, opacity: .6, inside: false, enabled: true }, shadow: { angle: 90, distance: 3, blur: 2, red: 0, green: 0, blue: 0, opacity: .5 }, colorOverlay: { red: .1, green: .2, blue: .3, opacity: .1 }, innerShadow: { angle: 45, distance: 1, blur: 2, red: 0, green: 0, blue: 0, opacity: .2 }, outerGlow: { size: 2, red: 1, green: 1, blue: 1, opacity: .2 }, innerGlow: { size: 2, red: 1, green: 1, blue: 1, opacity: .2 } };
  for (const kind of ['Hue/Saturation', 'Levels', 'Curves', 'Exposure', 'Gradient Map', 'Grain', 'Invert', 'Black & White', 'Color Balance', 'Gaussian Blur', 'Motion Blur', 'Add Noise']) {
    const layer = add(kind, false); layer.opacity = .05; layer.transform.origin = [0, 0]; layer.transform.size = [64, 48];
    layer.adjustment = { kind, hue: 0, saturation: 0, lightness: 0, colorize: false, levels: { channel: 'RGB', ranges: Array.from({ length: 4 }, () => ({ black: 0, gamma: 1, white: 255, outputBlack: 0, outputWhite: 255 })) }, curves: { channel: 'RGB', channels: Array.from({ length: 4 }, () => [{ x: 0, y: 0 }, { x: 255, y: 255 }]) } };
  }
  manifest.activeLayerID = base.id; manifest.guides = [{ id: id(), axis: 'vertical', position: 32 }];
  return { manifest, assets };
}
