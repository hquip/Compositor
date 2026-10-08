const FORMAT_VERSION = 16;
const { decodeFloatTIFF } = require('./float-tiff.cjs');
const { inspectEXRContainer } = require('./exr-container.cjs');
const HDR_SPACES = ['Linear sRGB', 'Linear Rec.2020', 'Linear P3-D65', 'ACEScg', 'ACES2065-1'];
const MAX_SIDE = 30000;
const MAX_SURFACE_PIXELS = 200000000;
const MAX_METADATA = 4 * 1024 * 1024;
const MAX_ASSET = 512 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BLEND_MODES = ['Normal', 'Darken', 'Multiply', 'Color Burn', 'Linear Burn', 'Lighten', 'Screen',
  'Color Dodge', 'Linear Dodge (Add)', 'Overlay', 'Soft Light', 'Hard Light', 'Vivid Light',
  'Linear Light', 'Pin Light', 'Hard Mix', 'Difference', 'Exclusion', 'Subtract', 'Divide',
  'Hue', 'Saturation', 'Color', 'Luminosity'];

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function validateTransform(transform) {
  requireCondition(transform && Array.isArray(transform.origin) && transform.origin.length === 2 &&
    Array.isArray(transform.size) && transform.size.length === 2, 'Invalid layer transform.');
  const [x, y] = transform.origin;
  const [width, height] = transform.size;
  requireCondition([x, y, width, height, transform.rotation].every(Number.isFinite) &&
    Math.abs(x) <= 1000000 && Math.abs(y) <= 1000000 && width >= 1 && height >= 1 &&
    width <= 300000 && height <= 300000, 'Layer geometry exceeds the supported limits.');
  requireCondition(typeof transform.flipX === 'boolean' && typeof transform.flipY === 'boolean' &&
    ['Nearest', 'Smooth', 'High quality'].includes(transform.sampling), 'Invalid layer sampling or flips.');
}

function validateAdjustment(value, version) {
  requireCondition(value && typeof value === 'object' && !Array.isArray(value), 'Invalid adjustment settings.');
  const kinds = ['Hue/Saturation', 'Levels', 'Curves', 'Exposure', 'Gradient Map', 'Grain', 'Black & White', 'Color Balance', 'Invert', 'Gaussian Blur', 'Motion Blur', 'Add Noise'];
  requireCondition(kinds.includes(value.kind) && version >= (['Gaussian Blur', 'Motion Blur', 'Add Noise'].includes(value.kind) ? 9 : 7), 'Invalid adjustment kind or version.');
  const range = (object, key, min, max, fallback) => { const n = object?.[key] ?? fallback; requireCondition(Number.isFinite(n) && n >= min && n <= max, `Invalid adjustment ${key}.`); return n; };
  const flag = (object, key, required = false) => requireCondition(!required && object?.[key] == null || typeof object?.[key] === 'boolean', `Invalid adjustment ${key}.`);
  const color = (object) => { for (const key of ['red', 'green', 'blue']) range(object, key, 0, 1); };
  range(value, 'hue', -360, 360); range(value, 'saturation', -100, 100); range(value, 'lightness', -100, 100); flag(value, 'colorize', true);
  requireCondition(value.levels && ['RGB', 'Red', 'Green', 'Blue'].includes(value.levels.channel ?? 'RGB') && Array.isArray(value.levels.ranges) && value.levels.ranges.length === 4, 'Invalid Levels settings.');
  for (const item of value.levels.ranges) { const black = range(item, 'black', 0, 254); range(item, 'white', black + 1, 255); range(item, 'gamma', .1, 9.99); range(item, 'outputBlack', 0, 255); range(item, 'outputWhite', 0, 255); }
  requireCondition(value.curves && ['RGB', 'Red', 'Green', 'Blue'].includes(value.curves.channel ?? 'RGB') && Array.isArray(value.curves.channels) && value.curves.channels.length === 4, 'Invalid Curves settings.');
  for (const channel of value.curves.channels) { requireCondition(Array.isArray(channel) && channel.length >= 2 && channel.length <= 32 && channel[0].x === 0 && channel.at(-1).x === 255, 'Invalid curve endpoints.'); let previous = -1; for (const point of channel) { const x = range(point, 'x', 0, 255); range(point, 'y', 0, 255); requireCondition(x > previous, 'Curve points must be ordered.'); previous = x; } }
  range(value, 'blurRadius', .1, 250, 10); range(value, 'motionAngle', -90, 90, 0); range(value, 'motionDistance', 1, 2000, 10); range(value, 'noiseAmount', .1, 400, 10); flag(value, 'noiseGaussian'); flag(value, 'noiseMonochromatic');
  requireCondition(Number.isInteger(range(value, 'noiseSeed', 0, 4294967295, 0)), 'Invalid noise seed.');
  if (value.exposureSettings) { const s = value.exposureSettings; range(s, 'exposure', -20, 20); range(s, 'offset', -.5, .5); range(s, 'gamma', .01, 9.99); }
  if (value.gradientMapSettings) { color(value.gradientMapSettings.shadows); color(value.gradientMapSettings.highlights); flag(value.gradientMapSettings, 'reversed', true); }
  if (value.grainSettings) { const s = value.grainSettings; range(s, 'amount', 0, 100); range(s, 'size', .5, 20); range(s, 'roughness', 0, 100); requireCondition(Number.isInteger(range(s, 'seed', 0, 4294967295, 0)), 'Invalid grain seed.'); }
  if (value.blackWhiteSettings) { const s = value.blackWhiteSettings; for (const key of ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas']) range(s, key, -200, 300); flag(s, 'tint'); range(s, 'tintHue', 0, 360, 40); range(s, 'tintSaturation', 0, 100, 20); }
  if (value.colorBalanceSettings) { const s = value.colorBalanceSettings; for (const band of ['shadow', 'mid', 'highlight']) for (const color of ['CyanRed', 'MagentaGreen', 'YellowBlue']) range(s, band + color, -100, 100, 0); flag(s, 'preserveLuminosity'); }
  if (value.hsvSettings) {
    const s = value.hsvSettings, names = ['Master', 'Reds', 'Yellows', 'Greens', 'Cyans', 'Blues', 'Magentas']; requireCondition(names.includes(s.range), 'Invalid hue range.'); flag(s, 'colorize', true); flag(s, 'invertRange', true);
    const entries = (object) => { if (Array.isArray(object)) { requireCondition(object.length % 2 === 0 && object.length <= 14, 'Invalid hue range dictionary.'); return Array.from({ length: object.length / 2 }, (_, i) => [object[i * 2], object[i * 2 + 1]]); } requireCondition(object && typeof object === 'object', 'Invalid hue range dictionary.'); return Object.entries(object); };
    for (const [name, item] of entries(s.adjustments)) { requireCondition(names.includes(name), 'Invalid hue range name.'); range(item, 'hue', -360, 360); range(item, 'saturation', -100, 100); range(item, 'lightness', -100, 100); }
    for (const [name, item] of entries(s.bands)) { requireCondition(names.includes(name) && ['falloffStart', 'rangeStart', 'rangeEnd', 'falloffEnd'].every((key) => Number.isFinite(item?.[key])), 'Invalid hue band.'); }
  }
}

function validateManifest(manifest) {
  requireCondition(manifest && manifest.format === 'com.compositor.project', 'This is not a Compositor project.');
  requireCondition(Number.isInteger(manifest.version) && manifest.version >= 1 && manifest.version <= FORMAT_VERSION,
    `This client supports Compositor project versions 1–${FORMAT_VERSION}.`);
  requireCondition(manifest.colorSpace === 'sRGB' && UUID.test(manifest.documentID), 'Invalid document metadata.');
  requireCondition(Number.isInteger(manifest.width) && Number.isInteger(manifest.height) &&
    manifest.width >= 1 && manifest.height >= 1 && manifest.width <= MAX_SIDE && manifest.height <= MAX_SIDE &&
    manifest.width * manifest.height <= MAX_SURFACE_PIXELS, 'Canvas exceeds the 200-megapixel or 30,000-pixel limit.');
  requireCondition(manifest.resolution == null || (Number.isFinite(manifest.resolution) &&
    manifest.resolution >= 1 && manifest.resolution <= 9600), 'Invalid document resolution.');
  requireCondition(Array.isArray(manifest.layers) && manifest.layers.length <= 10000, 'Invalid layer list.');
  const byID = new Map();
  for (const layer of manifest.layers) {
    requireCondition(layer && UUID.test(layer.id) && !byID.has(layer.id.toUpperCase()), 'Invalid or duplicate layer ID.');
    byID.set(layer.id.toUpperCase(), layer);
    requireCondition(typeof layer.name === 'string' && layer.name.trim() && new TextEncoder().encode(layer.name).length <= 16384 &&
      typeof layer.isVisible === 'boolean', 'Invalid layer name or visibility.');
    requireCondition(layer.isGroup == null || typeof layer.isGroup === 'boolean', 'Invalid folder flag.');
    validateTransform(layer.transform);
    requireCondition(layer.imageFile == null || layer.imageFile === `${layer.id.toUpperCase()}.png`, 'Unsafe image filename.');
    requireCondition(layer.maskFile == null || layer.maskFile === `${layer.id.toUpperCase()}.mask.png`, 'Unsafe mask filename.');
    requireCondition(layer.opacity == null || (Number.isFinite(layer.opacity) && layer.opacity >= 0 && layer.opacity <= 1),
      'Invalid layer opacity.');
    requireCondition(layer.blendMode == null || BLEND_MODES.includes(layer.blendMode), 'Invalid blend mode.');
    requireCondition(layer.isGroup !== true || (!layer.imageFile && (layer.blendMode ?? 'Normal') === 'Normal'),
      'A folder cannot contain its own image or blend mode.');
    requireCondition(layer.maskEnabled == null || (typeof layer.maskEnabled === 'boolean' && layer.maskFile), 'Invalid mask metadata.');
    if (layer.maskPlacement) {
      requireCondition(layer.maskFile, 'A mask placement requires a mask.');
      validateTransform(layer.maskPlacement);
    }
    requireCondition(layer.maskLinked == null || (typeof layer.maskLinked === 'boolean' && layer.maskFile), 'Invalid mask link.');
    requireCondition(!layer.adjustment || (manifest.version >= 7 && !layer.imageFile && !layer.isGroup && !layer.text),
      'Invalid adjustment layer.');
    if (layer.adjustment) validateAdjustment(layer.adjustment, manifest.version);
    requireCondition(!layer.text || (layer.imageFile && !layer.isGroup && !layer.adjustment), 'Invalid text layer.');
    if (layer.text != null) validateText(layer.text, manifest.version);
    if (layer.hdrSourceFile != null) {
      requireCondition(manifest.version >= 15 && layer.hdrSourceFile === `${layer.id.toUpperCase()}.hdr-source.tif` && layer.imageFile && !layer.filterSourceFile && !layer.isGroup && !layer.adjustment && !layer.text && !layer.shape && !layer.vectorPath && Array.isArray(layer.filters) && layer.filters.length > 0, 'Invalid HDR source layer.');
    }
    if (layer.exrSourceFile != null) {
      const view = layer.exrView; requireCondition(view?.encoding == null || [...HDR_SPACES, 'File color metadata'].includes(view.encoding), 'Invalid EXR input color space.'); requireCondition(manifest.version >= 16 && layer.hdrSourceFile && /^[0-9a-f-]{36}\.exr-source\.exr$/i.test(layer.exrSourceFile) && UUID.test(layer.exrSourceFile.slice(0, 36)) && view && Number.isInteger(view.part) && view.part >= 0 && view.part < 64 && typeof view.group === 'string' && view.group.length <= 255 && !/[\x00-\x1f]/.test(view.group) && ['levelX', 'levelY'].every((key) => Number.isInteger(view[key]) && view[key] >= 0 && view[key] <= 30) && (view.depthRange == null || Array.isArray(view.depthRange) && view.depthRange.length === 2 && view.depthRange.every((n) => Number.isFinite(n) && Math.abs(n) <= 1e12) && view.depthRange[0] <= view.depthRange[1]), 'Invalid retained OpenEXR source.');
    } else requireCondition(layer.exrView == null, 'OpenEXR view requires an embedded source.');
    if (layer.smartObject != null) {
      const object = layer.smartObject;
      requireCondition(manifest.version >= 15 && object && UUID.test(object.id) && layer.imageFile && (layer.filterSourceFile || layer.hdrSourceFile) && !layer.isGroup && !layer.adjustment && !layer.text && !layer.shape && !layer.vectorPath, 'Invalid smart object layer.');
      requireCondition(Number.isInteger(object.width) && Number.isInteger(object.height) && object.width > 0 && object.height > 0 && object.width <= MAX_SIDE && object.height <= MAX_SIDE && object.width * object.height <= MAX_SURFACE_PIXELS, 'Invalid smart object source dimensions.'); validateTransform(object.baseTransform);
    }
    if (layer.vectorPath != null) {
      requireCondition(manifest.version >= 13 && layer.imageFile && !layer.isGroup && !layer.adjustment && !layer.text && !layer.shape && !layer.filters && !layer.filterSourceFile, 'Invalid vector path layer or format version.');
      validateVector(layer.vectorPath);
    }
    if (layer.vectorMask != null) { requireCondition(manifest.version >= 13 && layer.maskFile, 'A vector mask requires a version 13 raster mask cache.'); validateVector(layer.vectorMask, true); }
    if (layer.filters != null || layer.filterSourceFile != null) {
      requireCondition(manifest.version >= 12 && layer.imageFile && !layer.isGroup && !layer.adjustment && !layer.text && !layer.shape, 'Editable filters require a version 12 pixel layer.');
      requireCondition(layer.hdrSourceFile || layer.filterSourceFile === `${layer.id.toUpperCase()}.source.png`, 'Unsafe filter source filename.');
      requireCondition(layer.filterWorkingSpace == null || ['sRGB', 'Adobe RGB (1998)', 'Display P3', 'ProPhoto RGB'].includes(layer.filterWorkingSpace), 'Invalid filter working space.');
      requireCondition(Array.isArray(layer.filters) && layer.filters.length > 0 && layer.filters.length <= 32, 'Invalid editable filter list.');
      const ids = new Set();
      for (const filter of layer.filters) {
        requireCondition(filter && UUID.test(filter.id) && !ids.has(filter.id.toUpperCase()) && typeof filter.enabled === 'boolean', 'Invalid editable filter.'); ids.add(filter.id.toUpperCase());
        if (filter.maskFile != null || filter.maskEnabled != null || filter.opacity != null) {
          requireCondition(manifest.version >= 14, 'Filter masks and opacity require format version 14.');
          requireCondition(filter.maskFile == null || filter.maskFile === `${layer.id.toUpperCase()}.${filter.id.toUpperCase()}.filter-mask.png`, 'Unsafe filter mask filename.');
          requireCondition(filter.maskEnabled == null || filter.maskFile && typeof filter.maskEnabled === 'boolean', 'Invalid filter mask visibility.');
          requireCondition(filter.opacity == null || Number.isFinite(filter.opacity) && filter.opacity >= 0 && filter.opacity <= 1, 'Invalid filter opacity.');
        }
        requireCondition(filter.adjustment && ['Hue/Saturation', 'Levels', 'Curves', 'Exposure', 'Gradient Map', 'Grain', 'Black & White', 'Color Balance', 'Invert', 'Gaussian Blur', 'Motion Blur', 'Add Noise'].includes(filter.adjustment.kind), 'Invalid editable filter kind.');
        validateAdjustment(filter.adjustment, manifest.version);
        const check = (value, depth = 0) => { requireCondition(depth < 16, 'Editable filter settings are too deeply nested.'); if (typeof value === 'number') requireCondition(Number.isFinite(value), 'Invalid editable filter parameter.'); else if (value && typeof value === 'object') { requireCondition(Object.keys(value).length <= 1000, 'Editable filter settings are too large.'); Object.values(value).forEach((entry) => check(entry, depth + 1)); } };
        check(filter.adjustment);
      }
    }
    requireCondition(manifest.version >= 2 || (!layer.parentID && !layer.isGroup), 'Folders require format version 2.');
    requireCondition(manifest.version >= 3 || ((layer.opacity ?? 1) === 1 && (layer.blendMode ?? 'Normal') === 'Normal'),
      'Layer appearance requires format version 3.');
    requireCondition(!layer.maskFile || manifest.version >= (layer.isGroup ? 6 : 4), 'Mask format version is too old.');
    requireCondition(manifest.version >= 5 || !layer.maskSourceID, 'Clipping masks require format version 5.');
    requireCondition(!layer.isGroup || manifest.version >= 8 || (layer.opacity ?? 1) === 1, 'Folder opacity requires version 8.');
  }
  const find = (id) => typeof id === 'string' ? byID.get(id.toUpperCase()) : undefined;
  for (const layer of manifest.layers) {
    let parent = layer.parentID;
    const parents = new Set([layer.id.toUpperCase()]);
    while (parent) {
      const node = find(parent);
      requireCondition(node?.isGroup && !parents.has(parent.toUpperCase()) && parents.size <= 64, 'Invalid folder hierarchy.');
      parents.add(parent.toUpperCase());
      parent = node.parentID;
    }
    let source = layer.maskSourceID;
    const sources = new Set([layer.id.toUpperCase()]);
    while (source) {
      const node = find(source);
      requireCondition(!layer.isGroup && node && !node.isGroup && !node.adjustment && !sources.has(source.toUpperCase()) && sources.size <= 256,
        'Invalid clipping mask chain.');
      sources.add(source.toUpperCase());
      source = node.maskSourceID;
    }
  }
  requireCondition(manifest.activeLayerID == null || find(manifest.activeLayerID), 'The active layer is missing.');
  const guides = manifest.guides ?? [];
  if (manifest.hdrWorkingSpace != null) requireCondition(manifest.version >= 16 && HDR_SPACES.includes(manifest.hdrWorkingSpace), 'Invalid HDR working space.');
  if (manifest.hdrView != null) { const view = manifest.hdrView; requireCondition(manifest.version >= 15 && view && Number.isFinite(view.exposure) && view.exposure >= -20 && view.exposure <= 20 && ['Reinhard', 'Clip'].includes(view.toneMap) && (view.displayMode == null || manifest.version >= 16 && ['Auto', 'HDR', 'SDR'].includes(view.displayMode)), 'Invalid HDR preview settings.'); }
  requireCondition(Array.isArray(guides) && guides.length <= 1000 && (manifest.version >= 8 || !guides.length), 'Invalid guides.');
  const guideIDs = new Set();
  for (const guide of guides) {
    requireCondition(UUID.test(guide.id) && !guideIDs.has(guide.id.toUpperCase()) &&
      ['horizontal', 'vertical'].includes(guide.axis) && Number.isFinite(guide.position) &&
      Math.abs(guide.position) <= 1000000, 'Invalid guide metadata.');
    guideIDs.add(guide.id.toUpperCase());
  }
  return manifest;
}

function validateVector(style, mask = false) {
  requireCondition(style && typeof style === 'object' && ['evenodd', 'nonzero'].includes(style.fillRule), 'Invalid vector fill rule.');
  requireCondition(Array.isArray(style.contours) && style.contours.length > 0 && style.contours.length <= 64, 'Invalid vector contours.');
  let count = 0;
  for (const contour of style.contours) {
    requireCondition(contour && typeof contour.closed === 'boolean' && (!mask || contour.closed) && Array.isArray(contour.nodes) && contour.nodes.length >= (contour.closed ? 3 : 2), 'Invalid vector contour.');
    count += contour.nodes.length; requireCondition(count <= 4096, 'Too many vector points.');
    for (const node of contour.nodes) {
      requireCondition(node && typeof node === 'object' && node.point != null && Object.keys(node).every((key) => ['point', 'incoming', 'outgoing'].includes(key)), 'Invalid vector node.');
      for (const point of Object.values(node)) requireCondition(Array.isArray(point) && point.length === 2 && point.every((n) => Number.isFinite(n) && Math.abs(n) <= 4), 'Invalid vector coordinates.');
    }
  }
  for (const color of [style.fill, style.stroke]) if (color != null) requireCondition(['red', 'green', 'blue'].every((key) => Number.isFinite(color[key]) && color[key] >= 0 && color[key] <= 1), 'Invalid vector color.');
  requireCondition(Number.isFinite(style.strokeWidth) && style.strokeWidth >= 0 && style.strokeWidth <= 1 && (style.fill != null || style.stroke != null && style.strokeWidth > 0), 'Invalid vector stroke or fill.');
  requireCondition(!mask || style.fill?.red === 1 && style.fill?.green === 1 && style.fill?.blue === 1 && style.stroke == null && style.strokeWidth === 0, 'Invalid vector mask style.');
}

function validateText(text, version) {
  requireCondition(text && typeof text === 'object' && typeof text.content === 'string' && text.content.length <= 100000, 'Invalid text content.');
  requireCondition(version >= 9 && typeof text.fontName === 'string' && text.fontName.length > 0, 'Invalid text font or format version.');
  const range = (object, key, low, high) => requireCondition(Number.isFinite(object[key]) && object[key] >= low && object[key] <= high, `Invalid text ${key}.`);
  for (const channel of ['red', 'green', 'blue']) range(text, channel, 0, 1);
  range(text, 'fontSize', 1, 2000); range(text, 'tracking', -100, 1000); range(text, 'leading', 0, 5000);
  requireCondition(['Left', 'Center', 'Right'].includes(text.alignment), 'Invalid text alignment.');
  if (text.boxSize != null) requireCondition(Array.isArray(text.boxSize) && text.boxSize.length === 2 && text.boxSize.every((value) => Number.isFinite(value) && value >= 16 && value <= MAX_SIDE) && text.boxSize[0] * text.boxSize[1] <= MAX_SURFACE_PIXELS, 'Invalid paragraph bounds.');
  for (const key of ['colorRuns', 'fontRuns']) {
    if (text[key] == null) continue;
    requireCondition(version >= (key === 'colorRuns' ? 10 : 11) && Array.isArray(text[key]) && text[key].length > 0, 'Invalid text run list or version.');
    let end = 0;
    for (const run of text[key]) {
      requireCondition(run && Number.isInteger(run.location) && Number.isInteger(run.length) && run.location >= end && run.length > 0 && run.location + run.length <= text.content.length, 'Invalid text run range.'); end = run.location + run.length;
      if (key === 'fontRuns') requireCondition(typeof run.fontName === 'string' && run.fontName.length > 0 && run.fontName.length <= 200 && !/[\r\n\u0085\u2028\u2029]/.test(run.fontName), 'Invalid text run font.');
      else for (const channel of ['red', 'green', 'blue']) range(run, channel, 0, 1);
    }
  }
}

function inspectPNG(bytes, isMask = false, source = false) {
  requireCondition(bytes instanceof Uint8Array && bytes.length >= 33 && bytes.length <= MAX_ASSET &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value) &&
    String.fromCharCode(...bytes.subarray(12, 16)) === 'IHDR', 'Missing, oversized, or invalid PNG asset.');
  const width = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16), height = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(20);
  requireCondition(width >= 1 && height >= 1 && width <= MAX_SIDE && height <= MAX_SIDE && ([1, 2, 4, 8].includes(bytes[24]) || source && bytes[24] === 16),
    'PNG dimensions or bit depth exceed the supported limits.');
  requireCondition(!isMask || (bytes[24] === 8 && bytes[25] === 0), 'Masks must be 8-bit grayscale PNGs.');
  return { width, height, pixels: width * height * (bytes[24] === 16 ? 2 : 1) };
}

function inspectAsset(bytes, mask = false, source = false, hdr = false) { if (hdr === 'exr') return { ...inspectEXRContainer(bytes), pixels: 0 }; if (!hdr) return inspectPNG(bytes, mask, source); const image = decodeFloatTIFF(bytes, 16000000, true); return { width: image.width, height: image.height, pixels: image.width * image.height * 4, linearSpace: image.linearSpace }; }
function validateSourceSize(layer, name, info, version = FORMAT_VERSION) { if (info.linearSpace && info.linearSpace !== 'Linear sRGB') requireCondition(version >= 16, 'Wide-gamut HDR requires project format 16.'); if (name === layer.exrSourceFile) { const part = info.parts[layer.exrView.part]; requireCondition(part && part.groups.includes(layer.exrView.group), 'Invalid OpenEXR view reference.'); } if (layer.smartObject && name === (layer.hdrSourceFile ?? layer.filterSourceFile)) requireCondition(info.width === layer.smartObject.width && info.height === layer.smartObject.height, 'The embedded source dimensions do not match its smart object.'); }
function layerResources(layer) { return [[layer.imageFile, false], [layer.maskFile, true], [layer.filterSourceFile, false], [layer.hdrSourceFile, false, true], [layer.exrSourceFile, false, 'exr'], ...(layer.filters ?? []).filter((entry) => entry.maskFile).map((entry) => [entry.maskFile, true])]; }
module.exports = { FORMAT_VERSION, MAX_SIDE, MAX_SURFACE_PIXELS, MAX_METADATA, MAX_ASSET, BLEND_MODES, requireCondition, validateManifest, inspectPNG, inspectAsset, validateSourceSize, layerResources };
