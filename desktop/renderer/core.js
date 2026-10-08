export const MAX_SIDE = 30000;
export const FORMAT_VERSION = 17;
export function documentPixels(editor) {
  let pixels = [...editor.images.values(), ...editor.masks.values()].reduce((sum, image) => sum + image.width * image.height, 0);
  for (const resource of editor.manifest?.resources ?? []) if (resource.kind === 'channels' && editor.assets[resource.file]) {
    const bytes = Uint8Array.from(atob(editor.assets[resource.file].slice(0, 44)), (c) => c.charCodeAt(0));
    if (bytes.length >= 28) { const view = new DataView(bytes.buffer); pixels += view.getUint32(8, true) * view.getUint32(12, true) * view.getUint32(24, true) * view.getUint32(20, true) / 32; }
  }
  for (const layer of editor.manifest?.layers ?? []) if (layer.filterSourceFile && editor.assets[layer.filterSourceFile]) {
    const bytes = Uint8Array.from(atob(editor.assets[layer.filterSourceFile].slice(0, 44)), (c) => c.charCodeAt(0));
    if (bytes.length >= 25) { const view = new DataView(bytes.buffer); pixels += view.getUint32(16) * view.getUint32(20) * (bytes[24] === 16 ? 2 : 1); }
  }
  for (const layer of editor.manifest?.layers ?? []) for (const filter of layer.filters ?? []) if (filter.maskFile && editor.assets[filter.maskFile]) {
    const bytes = Uint8Array.from(atob(editor.assets[filter.maskFile].slice(0, 44)), (c) => c.charCodeAt(0));
    if (bytes.length >= 25) { const view = new DataView(bytes.buffer); pixels += view.getUint32(16) * view.getUint32(20); }
  }
  for (const layer of editor.manifest?.layers ?? []) if (layer.hdrSourceFile && editor.assets[layer.hdrSourceFile]) {
    const bytes = Uint8Array.from(atob(editor.assets[layer.hdrSourceFile].slice(0, 684)), (c) => c.charCodeAt(0)), view = new DataView(bytes.buffer), at = view.getUint32(4, true), count = view.getUint16(at, true); let width, height;
    for (let i = 0; i < count; i++) { const p = at + 2 + i * 12, tag = view.getUint16(p, true); if (tag === 256) width = view.getUint32(p + 8, true); if (tag === 257) height = view.getUint32(p + 8, true); } pixels += width * height * 4;
  }
  return pixels;
}
export const MAX_PIXELS = 200000000;
let surfaceLimit = MAX_PIXELS, sideLimit = MAX_SIDE;
export function configureCanvasLimits(side, pixels) { sideLimit = Math.min(MAX_SIDE, side); surfaceLimit = Math.min(MAX_PIXELS, pixels); }
export const BLEND_MODES = ['Normal', 'Darken', 'Multiply', 'Color Burn', 'Linear Burn', 'Lighten', 'Screen',
  'Color Dodge', 'Linear Dodge (Add)', 'Overlay', 'Soft Light', 'Hard Light', 'Vivid Light', 'Linear Light',
  'Pin Light', 'Hard Mix', 'Difference', 'Exclusion', 'Subtract', 'Divide', 'Hue', 'Saturation', 'Color', 'Luminosity'];
export const CANVAS_BLEND = { Normal: 'source-over', Darken: 'darken', Multiply: 'multiply', 'Color Burn': 'color-burn',
  Lighten: 'lighten', Screen: 'screen', 'Color Dodge': 'color-dodge', Overlay: 'overlay', 'Soft Light': 'soft-light',
  'Hard Light': 'hard-light', Difference: 'difference', Exclusion: 'exclusion', Hue: 'hue', Saturation: 'saturation',
  Color: 'color', Luminosity: 'luminosity' };

export function canvasSize(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > sideLimit ||
    height > sideLimit || width * height > surfaceLimit) throw new Error(`Use whole dimensions from 1 to ${sideLimit.toLocaleString('en-US')} pixels, up to ${surfaceLimit / 1000000} megapixels.`);
  return [width, height];
}

export function createManifest(width, height) {
  canvasSize(width, height);
  return { format: 'com.compositor.project', version: FORMAT_VERSION, colorSpace: 'sRGB', resolution: 72,
    documentID: crypto.randomUUID().toUpperCase(), width, height, activeLayerID: null, layers: [] };
}

export function createLayer(name, width, height) {
  return { id: crypto.randomUUID().toUpperCase(), name, isVisible: true, isGroup: false, opacity: 1, blendMode: 'Normal',
    transform: { origin: [0, 0], size: [width, height], rotation: 0, flipX: false, flipY: false, sampling: 'High quality' } };
}

export function localPoint(point, transform, width, height) {
  const [x, y] = transform.origin, [w, h] = transform.size;
  const angle = transform.rotation * Math.PI / 180;
  const dx = point.x - x - w / 2, dy = point.y - y - h / 2;
  let u = (dx * Math.cos(angle) + dy * Math.sin(angle)) / w + 0.5;
  let v = (-dx * Math.sin(angle) + dy * Math.cos(angle)) / h + 0.5;
  if (transform.flipX) u = 1 - u;
  if (transform.flipY) v = 1 - v;
  return { x: u * width, y: v * height };
}

export function documentPoint(point, transform) {
  const [x, y] = transform.origin, [w, h] = transform.size;
  const angle = transform.rotation * Math.PI / 180;
  const u = (transform.flipX ? 1 - point.x : point.x) - 0.5;
  const v = (transform.flipY ? 1 - point.y : point.y) - 0.5;
  return { x: x + w / 2 + u * w * Math.cos(angle) - v * h * Math.sin(angle),
    y: y + h / 2 + u * w * Math.sin(angle) + v * h * Math.cos(angle) };
}

export function layerEntries(layers) {
  const result = [];
  function visit(parent, opacity, visible, ancestors) {
    for (const layer of layers.filter((item) => (item.parentID ?? null) === parent)) {
      const entry = { layer, opacity: opacity * (layer.opacity ?? 1), visible: visible && layer.isVisible,
        depth: ancestors.length, ancestors };
      result.push(entry);
      if (layer.isGroup) visit(layer.id, entry.opacity, entry.visible, [...ancestors, layer]);
    }
  }
  visit(null, 1, true, []);
  return result;
}

export function unsupportedFeatures(manifest) {
  const features = new Set();
  for (const layer of manifest.layers) {
    if (layer.adjustment && !['Hue/Saturation', 'Levels', 'Curves', 'Exposure', 'Gradient Map', 'Grain', 'Black & White', 'Color Balance', 'Invert', 'Gaussian Blur', 'Motion Blur', 'Add Noise'].includes(layer.adjustment.kind)) features.add(`unknown adjustment ${layer.adjustment.kind}`);
  }
  return [...features];
}

const clamp = (x) => Math.max(0, Math.min(1, x));
function burn(back, front) { return front === 0 ? 0 : 1 - Math.min(1, (1 - back) / front); }
function dodge(back, front) { return front === 1 ? 1 : Math.min(1, back / (1 - front)); }
export function blendChannel(back, front, mode) {
  switch (mode) {
    case 'Linear Burn': return Math.max(0, back + front - 1);
    case 'Linear Dodge (Add)': return Math.min(1, back + front);
    case 'Vivid Light': return front < 0.5 ? burn(back, 2 * front) : dodge(back, 2 * (front - 0.5));
    case 'Linear Light': return clamp(back + 2 * front - 1);
    case 'Pin Light': return front < 0.5 ? Math.min(back, 2 * front) : Math.max(back, 2 * front - 1);
    case 'Hard Mix': return blendChannel(back, front, 'Vivid Light') < 0.5 ? 0 : 1;
    case 'Subtract': return Math.max(0, back - front);
    case 'Divide': return front === 0 ? 1 : Math.min(1, back / front);
    default: throw new Error(`Unsupported blend calculation: ${mode}`);
  }
}

export function blendRGBA(back, front, mode) {
  const ab = back[3] / 255, af = front[3] / 255;
  const alpha = af + ab * (1 - af);
  if (!alpha) return [0, 0, 0, 0];
  return [0, 1, 2].map((channel) => {
    const b = back[channel] / 255, f = front[channel] / 255;
    return Math.round(255 * ((1 - af) * ab * b + (1 - ab) * af * f + af * ab * blendChannel(b, f, mode)) / alpha);
  }).concat(Math.round(alpha * 255));
}

export class History {
  constructor(limit = 100, byteLimit = 256 * 1024 * 1024) { this.limit = limit; this.byteLimit = byteLimit; this.reset(); }
  reset() { this.past = []; this.future = []; this.revision = crypto.randomUUID(); this.savedRevision = this.revision; }
  get dirty() { return this.revision !== this.savedRevision; }
  push(before, after, name) {
    const revision = crypto.randomUUID();
    this.past.push({ before, after, name, beforeRevision: this.revision, afterRevision: revision });
    this.future = [];
    this.revision = revision;
    while (this.past.length > this.limit || this.retainedBytes(after) > this.byteLimit) this.past.shift();
  }
  retainedBytes(current) {
    const seen = new Set(Object.values(current.assets));
    const selections = new Set(current.selection?.coverage ? [current.selection.coverage] : []);
    let bytes = 0;
    for (const entry of [...this.past, ...this.future]) for (const snapshot of [entry.before, entry.after]) {
      const mask = snapshot.selection?.coverage; if (mask && !selections.has(mask)) { selections.add(mask); bytes += mask.width * mask.height * 4; }
      for (const value of Object.values(snapshot.assets)) if (!seen.has(value)) { seen.add(value); bytes += value.length * 2; }
    }
    return bytes;
  }
  undo() {
    const entry = this.past.pop();
    if (!entry) return null;
    this.future.push(entry); this.revision = entry.beforeRevision;
    return entry.before;
  }
  redo() {
    const entry = this.future.pop();
    if (!entry) return null;
    this.past.push(entry); this.revision = entry.afterRevision;
    return entry.after;
  }
}
