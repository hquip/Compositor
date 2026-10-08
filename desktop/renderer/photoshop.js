import { readPsd, initializeCanvas, getLayerImageData, getLayerMaskImageData } from './vendor/psd.js';
import { createManifest, createLayer, BLEND_MODES, MAX_PIXELS } from './core.js';
import { surface, colorRecord, colorCSS } from './raster.js';
import { adjustmentDefaults } from './adjustments.js';
import { encodeGray } from './masks.js';
import { renderText } from './tools.js';
import { croppedLayerData } from './psd-channels.js';

initializeCanvas((w, h) => surface(w, h), (w, h) => new ImageData(w, h));
const titleBlend = Object.fromEntries(BLEND_MODES.map((name) => [name.toLowerCase(), name])); titleBlend['linear dodge'] = 'Linear Dodge (Add)';
const channelNames = ['rgb', 'red', 'green', 'blue'];
const color = (value, fallback = { red: 0, green: 0, blue: 0 }) => value && 'r' in value ? { red: value.r / 255, green: value.g / 255, blue: value.b / 255 } : value && 'fr' in value ? { red: value.fr, green: value.fg, blue: value.fb } : fallback;
const unit = (value, fallback = 0) => typeof value === 'number' ? value : value?.value ?? fallback;
function adjustment(source) {
  if (!source) return null;
  const types = { levels: 'Levels', curves: 'Curves', exposure: 'Exposure', 'hue/saturation': 'Hue/Saturation', 'color balance': 'Color Balance', 'black & white': 'Black & White', invert: 'Invert', 'gradient map': 'Gradient Map' };
  const kind = types[source.type]; if (!kind) return null; const result = adjustmentDefaults(kind);
  if (kind === 'Levels') result.levels.ranges = channelNames.map((name) => { const c = source[name] ?? {}; return { black: c.shadowInput ?? 0, white: c.highlightInput ?? 255, outputBlack: c.shadowOutput ?? 0, outputWhite: c.highlightOutput ?? 255, gamma: c.midtoneInput ?? 1 }; });
  if (kind === 'Curves') result.curves.channels = channelNames.map((name) => source[name]?.map((p) => ({ x: p.input, y: p.output })) ?? [{ x: 0, y: 0 }, { x: 255, y: 255 }]);
  if (kind === 'Exposure') result.exposureSettings = { exposure: source.exposure ?? 0, offset: source.offset ?? 0, gamma: source.gamma ?? 1 };
  if (kind === 'Hue/Saturation') { result.hue = source.master?.hue ?? 0; result.saturation = source.master?.saturation ?? 0; result.lightness = source.master?.lightness ?? 0; }
  if (kind === 'Black & White') result.blackWhiteSettings = { ...Object.fromEntries(['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'].map((key, i) => [key, source[key] ?? [40, 60, 40, 60, 20, 80][i]])), tint: source.useTint ?? false, tintHue: 40, tintSaturation: 20 };
  if (kind === 'Color Balance') {
    result.colorBalanceSettings = { preserveLuminosity: source.preserveLuminosity ?? true };
    ['shadows', 'midtones', 'highlights'].forEach((key, i) => { for (const channel of ['cyanRed', 'magentaGreen', 'yellowBlue']) result.colorBalanceSettings[['shadow', 'mid', 'highlight'][i] + channel[0].toUpperCase() + channel.slice(1)] = source[key]?.[channel] ?? 0; });
  }
  return result;
}
function effects(source) {
  if (!source || source.disabled) return undefined;
  const result = {};
  for (const [psd, target] of [['dropShadow', 'shadow'], ['innerShadow', 'innerShadow'], ['outerGlow', 'outerGlow'], ['innerGlow', 'innerGlow'], ['solidFill', 'colorOverlay'], ['stroke', 'stroke']]) {
    const effect = Array.isArray(source[psd]) ? source[psd][0] : source[psd]; if (!effect) continue;
    result[target] = { ...color(effect.color), opacity: effect.opacity ?? 1, enabled: effect.enabled ?? true };
    if (target.includes('Glow') || target === 'stroke') result[target].size = unit(effect.size, 4);
    if (target === 'stroke') result[target].inside = effect.position === 'inside';
    if (target === 'shadow' || target === 'innerShadow') Object.assign(result[target], { angle: effect.angle ?? 90, distance: unit(effect.distance, 10), blur: unit(effect.size, 10) });
  }
  return Object.keys(result).length ? result : undefined;
}
function imageCanvas(data) { if (!data || !data.width || !data.height) return null; const canvas = surface(data.width, data.height); canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data.data), data.width, data.height), 0, 0); return canvas; }
function vectorImage(source) {
  const origin = source.vectorOrigination?.keyDescriptorList?.[0], fill = source.vectorFill?.color, box = origin?.keyOriginShapeBoundingBox;
  if (!fill || source.vectorStroke?.fillEnabled === false) return null;
  if (box && [1, 2, 5].includes(origin.keyOriginType)) {
    const left = unit(box.left), top = unit(box.top), width = Math.max(1, Math.ceil(unit(box.right) - left)), height = Math.max(1, Math.ceil(unit(box.bottom) - top));
    if (width > 30000 || height > 30000 || width * height > MAX_PIXELS) throw new Error('The Photoshop vector exceeds the supported dimensions.');
    const radii = Object.values(origin.keyOriginRRectRadii ?? {}).map((v) => unit(v)), radius = radii.length ? Math.max(...radii) : 0;
    const style = { kind: origin.keyOriginType === 5 ? 'Ellipse' : 'Rectangle', ...color(fill), cornerRadius: radius };
    const canvas = surface(width, height), ctx = canvas.getContext('2d'); ctx.fillStyle = colorCSS(style); ctx.beginPath();
    if (style.kind === 'Ellipse') ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2); else ctx.roundRect(0, 0, width, height, Math.min(radius, width / 2, height / 2)); ctx.fill();
    return { image: canvas, origin: [left, top], style: radii.length && Math.max(...radii) - Math.min(...radii) > .5 ? null : style };
  }
  const paths = source.vectorMask?.paths; if (!paths?.length) return null;
  const coordinates = paths.flatMap((path) => path.knots.flatMap((knot) => [knot.points.slice(0, 2), knot.points.slice(2, 4), knot.points.slice(4, 6)]));
  const left = Math.floor(Math.min(...coordinates.map((p) => p[0]))), top = Math.floor(Math.min(...coordinates.map((p) => p[1]))), width = Math.max(1, Math.ceil(Math.max(...coordinates.map((p) => p[0]))) - left), height = Math.max(1, Math.ceil(Math.max(...coordinates.map((p) => p[1]))) - top);
  if (width > 30000 || height > 30000 || width * height > MAX_PIXELS) throw new Error('The Photoshop path exceeds the supported dimensions.');
  const image = surface(width, height), ctx = image.getContext('2d'); ctx.translate(-left, -top); ctx.fillStyle = colorCSS(color(fill));
  for (const path of paths) { if (!path.knots.length) continue; ctx.globalCompositeOperation = path.operation === 'subtract' ? 'destination-out' : path.operation === 'intersect' ? 'destination-in' : 'source-over'; ctx.beginPath(); const first = path.knots[0].points; ctx.moveTo(first[2], first[3]);
    for (let i = 1; i <= path.knots.length; i++) { if (i === path.knots.length && path.open) break; const a = path.knots[i - 1].points, b = path.knots[i % path.knots.length].points; ctx.bezierCurveTo(a[4], a[5], b[0], b[1], b[2], b[3]); } if (!path.open) ctx.closePath(); ctx.fill(path.fillRule === 'even-odd' ? 'evenodd' : 'nonzero');
  }
  return { image, origin: [left, top], style: null };
}

export function parsePhotoshop(encoded, budget = MAX_PIXELS) {
  const binary = atob(encoded), bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const header = new DataView(bytes.buffer);
  if (bytes.length < 26 || header.getUint16(22) !== 8 || header.getUint16(24) !== 3) throw new Error('Photoshop import supports 8-bit RGB PSD and PSB files.');
  const width = header.getUint32(18), height = header.getUint32(14);
  const manifest = createManifest(width, height), assets = {}, report = [];
  const psd = readPsd(bytes, { useRawData: true, useImageData: true, skipThumbnail: true, skipCompositeImageData: false, logMissingFeatures: false });
  let total = 0, oversized = false;
  const measure = (nodes) => { for (const layer of nodes) { const w = Math.max(0, (layer.right ?? 0) - (layer.left ?? 0)), h = Math.max(0, (layer.bottom ?? 0) - (layer.top ?? 0)); if (!layer.children) { total += w * h; oversized ||= w > 30000 || h > 30000 || w * h > MAX_PIXELS; } if (layer.mask) total += Math.max(0, (layer.mask.right ?? 0) - (layer.mask.left ?? 0)) * Math.max(0, (layer.mask.bottom ?? 0) - (layer.mask.top ?? 0)); if (layer.children) measure(layer.children); } };
  measure(psd.children ?? []); const cropToCanvas = oversized || total > budget;
  if (cropToCanvas) report.push('Large layer bounds are cropped to the Photoshop canvas to fit the available pixel budget.');
  manifest.resolution = psd.imageResources?.resolutionInfo?.horizontalResolution ?? 72;
  let used = 0;
  function visit(nodes, parentID) {
    let clipBase;
    for (const source of [...nodes].reverse()) {
      const w = Math.max(1, (source.right ?? width) - (source.left ?? 0)), h = Math.max(1, (source.bottom ?? height) - (source.top ?? 0));
      const layer = createLayer(source.name || 'Layer', source.children ? width : w, source.children ? height : h);
      layer.parentID = parentID; layer.isGroup = !!source.children; layer.isVisible = !source.hidden; layer.opacity = source.opacity ?? 1;
      layer.blendMode = layer.isGroup ? 'Normal' : titleBlend[source.blendMode] ?? 'Normal'; layer.transform.origin = source.children ? [0, 0] : [source.left ?? 0, source.top ?? 0];
      layer.effects = effects(source.effects);
      if (source.blendMode && !['pass through', ...Object.keys(titleBlend)].includes(source.blendMode)) report.push(`${layer.name}: ${source.blendMode} uses Normal.`);
      if (source.clipping && clipBase) layer.maskSourceID = clipBase; else if (!source.children) clipBase = layer.id;
      const adjusted = adjustment(source.adjustment);
      if (adjusted) { layer.adjustment = adjusted; layer.transform = createLayer('', width, height).transform; }
      else if (!source.children) {
        const cropped = cropToCanvas ? croppedLayerData(source, width, height) : null;
        if (!cropToCanvas && (w > 30000 || h > 30000 || used + w * h > budget)) throw new Error('The Photoshop layer stack exceeds the current pixel budget.');
        let image = imageCanvas(cropped ? cropped.imageData : source.imageData ?? getLayerImageData(source));
        if (cropped?.imageData) { layer.transform.origin = [cropped.crop.left, cropped.crop.top]; layer.transform.size = [cropped.crop.width, cropped.crop.height]; }
        const vector = !cropToCanvas ? vectorImage(source) : null;
        if (vector) { if (!image) { image = vector.image; layer.transform.origin = vector.origin; layer.transform.size = [image.width, image.height]; } if (vector.style) layer.shape = vector.style; }
        if (source.text && source.text.orientation !== 'vertical' && !cropToCanvas) {
          const style = source.text.style ?? {}, paragraph = source.text.paragraphStyle ?? {};
          layer.text = { content: source.text.text, fontName: style.font?.name ?? 'Arial', fontSize: style.fontSize ?? 72, ...color(style.fillColor),
            alignment: { left: 'Left', center: 'Center', right: 'Right' }[paragraph.justification] ?? 'Left', tracking: (style.tracking ?? 0) / 1000 * (style.fontSize ?? 72), leading: style.leading ?? 0 };
          const colorRuns = [], fontRuns = []; let position = 0, mixedSize = false;
          for (const run of source.text.styleRuns ?? []) {
            const length = Math.min(run.length, layer.text.content.length - position), current = run.style ?? {};
            if (current.fontSize != null && Math.abs(current.fontSize - layer.text.fontSize) > .01) mixedSize = true;
            if (length > 0 && current.fillColor) { const value = color(current.fillColor); if (['red', 'green', 'blue'].some((key) => Math.abs(value[key] - layer.text[key]) > .0001)) colorRuns.push({ location: position, length, ...value }); }
            if (length > 0 && current.font?.name && current.font.name !== layer.text.fontName) fontRuns.push({ location: position, length, fontName: current.font.name }); position += run.length;
          }
          if (colorRuns.length) layer.text.colorRuns = colorRuns; if (fontRuns.length) layer.text.fontRuns = fontRuns;
          if (mixedSize && image) { delete layer.text; report.push(`${layer.name}: mixed text sizes use the saved pixels.`); }
          if (!image) { image = renderText(layer.text); layer.transform.size = [image.width, image.height]; }
        }
        if (image) { if (used + image.width * image.height > budget) throw new Error('The Photoshop document still exceeds the pixel budget after cropping.'); layer.imageFile = `${layer.id}.png`; assets[layer.imageFile] = image.toDataURL('image/png').split(',')[1]; used += image.width * image.height; }
        if (source.adjustment && !adjusted) report.push(`${layer.name}: ${source.adjustment.type} is imported from its saved pixels.`);
        if (source.text?.orientation === 'vertical') report.push(`${layer.name}: vertical text uses its saved pixels.`);
        if (source.vectorMask && !layer.shape) report.push(`${layer.name}: vector content uses raster pixels.`);
      }
      if (source.mask) {
        const cropped = cropToCanvas ? croppedLayerData(source, width, height, true) : null;
        const data = cropped ? cropped.imageData : source.mask.imageData ?? getLayerMaskImageData(source);
        if (data?.width && data?.height) {
          if (used + data.width * data.height > budget) throw new Error('The Photoshop masks exceed the pixel budget.');
          const canvas = imageCanvas(data), context = canvas.getContext('2d'), mask = context.getImageData(0, 0, canvas.width, canvas.height);
          for (let i = 0; i < mask.data.length; i += 4) mask.data[i + 3] = mask.data[i]; context.putImageData(mask, 0, 0);
          layer.maskFile = `${layer.id}.mask.png`; layer.maskEnabled = !source.mask.disabled; layer.maskLinked = false;
          layer.maskPlacement = { ...createLayer('', canvas.width, canvas.height).transform, origin: [cropped?.crop.left ?? source.mask.left ?? layer.transform.origin[0], cropped?.crop.top ?? source.mask.top ?? layer.transform.origin[1]] };
          assets[layer.maskFile] = encodeGray(canvas); used += canvas.width * canvas.height;
        }
      }
      manifest.layers.push(layer); if (source.children) visit(source.children, layer.id);
    }
  }
  if (psd.children?.length) visit(psd.children, undefined);
  else {
    const canvas = imageCanvas(psd.imageData) ?? psd.canvas;
    if (canvas) { const layer = createLayer('Background', width, height); layer.imageFile = `${layer.id}.png`; manifest.layers.push(layer); assets[layer.imageFile] = canvas.toDataURL('image/png').split(',')[1]; }
  }
  manifest.activeLayerID = manifest.layers.at(-1)?.id ?? null;
  return { snapshot: { manifest, assets }, report };
}
