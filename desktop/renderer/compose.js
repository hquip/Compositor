import { CANVAS_BLEND, blendRGBA, layerEntries } from './core.js';
import { applyAdjustment } from './adjustments.js';
import { applyEffects } from './effects.js';
import { affine, inverse, multiply } from './affine.js';
import { renderVector } from './vector-render.js';
import { attachHDRAssets } from './hdr-layer.js';
const effectCache = new WeakMap();
const vectorCache = new WeakMap();

export function surface(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  if (!canvas.getContext('2d')) throw new Error('Could not allocate image pixels. Try a smaller canvas.');
  return canvas;
}

export function place(context, image, transform, scale = 1) {
  const [x, y] = transform.origin, [w, h] = transform.size;
  context.save();
  context.translate((x + w / 2) * scale, (y + h / 2) * scale);
  context.rotate(transform.rotation * Math.PI / 180);
  context.scale(transform.flipX ? -1 : 1, transform.flipY ? -1 : 1);
  context.imageSmoothingEnabled = transform.sampling !== 'Nearest';
  context.imageSmoothingQuality = transform.sampling === 'High quality' ? 'high' : 'low';
  context.drawImage(image, -w * scale / 2, -h * scale / 2, w * scale, h * scale);
  context.restore();
}

export function compose(manifest, images, masks, scale = 1) {
  const width = Math.max(1, Math.round(manifest.width * scale)), height = Math.max(1, Math.round(manifest.height * scale));
  const output = surface(width, height), context = output.getContext('2d');
  const entries = layerEntries(manifest.layers);
  const byID = new Map(manifest.layers.map((layer) => [layer.id, layer]));
  const entryByID = new Map(entries.map((entry) => [entry.layer.id, entry]));
  const coverageCache = new Map();
  const visible = entries.filter((entry) => entry.visible && !entry.layer.isGroup), stacks = new Map(), stacked = new Set();
  for (let i = 0; i < visible.length; i++) {
    const base = visible[i].layer; if (base.maskSourceID || base.adjustment) continue;
    const children = [];
    for (let j = i + 1; j < visible.length; j++) { const child = visible[j].layer; if (child.maskSourceID !== base.id || child.parentID !== base.parentID) break; children.push(visible[j]); stacked.add(child.id); }
    if (children.length) stacks.set(base.id, children);
  }
  function placedMask(layer) {
    const mask = masks.get(layer.id), canvas = surface(width, height), ctx = canvas.getContext('2d');
    if (mask.width === 1 && mask.height === 1) { ctx.fillStyle = `rgba(255,255,255,${mask.getContext('2d').getImageData(0, 0, 1, 1).data[3] / 255})`; ctx.fillRect(0, 0, width, height); return canvas; }
    if (!layer.maskPlacement) { place(ctx, mask, layer.transform, scale); return canvas; }
    const edge = mask.getContext('2d').getImageData(0, 0, mask.width, mask.height).data; let total = 0, count = 0;
    for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) if (!x || !y || x === mask.width - 1 || y === mask.height - 1) { total += edge[(y * mask.width + x) * 4 + 3]; count++; }
    if (total * 2 >= count * 255) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); }
    const matrix = affine(layer.maskPlacement); ctx.setTransform(...matrix.map((value) => value * scale)); ctx.beginPath(); ctx.rect(0, 0, 1, 1); ctx.clip(); ctx.clearRect(0, 0, 1, 1); ctx.drawImage(mask, 0, 0, 1, 1); return canvas;
  }
  function coverage(layer) {
    if (coverageCache.has(layer.id)) return coverageCache.get(layer.id);
    const canvas = surface(width, height), ctx = canvas.getContext('2d');
    coverageCache.set(layer.id, canvas);
    const rendered = ownImage(layer);
    if (rendered) place(ctx, rendered.image, rendered.transform, scale);
    if (layer.maskSourceID) {
      const source = byID.get(layer.maskSourceID);
      if (source) {
        ctx.globalCompositeOperation = 'destination-in';
        ctx.globalAlpha = entryByID.get(source.id)?.opacity ?? source.opacity ?? 1;
        ctx.drawImage(coverage(source), 0, 0);
      }
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    return canvas;
  }
  function ownImage(layer) {
    let source = images.get(layer.id); if (!source) return null;
    if (layer.vectorPath && !layer.effects) {
      const size = layer.transform.size, factor = Math.min(scale, 30000 / Math.max(...size), Math.sqrt(16000000 / (size[0] * size[1])));
      const w = Math.max(1, Math.ceil(size[0] * factor)), h = Math.max(1, Math.ceil(size[1] * factor)), key = `${w},${h}`;
      let cached = vectorCache.get(layer.vectorPath);
      if (cached?.key !== key) { cached = { key, image: renderVector(layer.vectorPath, w, h) }; vectorCache.set(layer.vectorPath, cached); }
      source = cached.image;
    }
    const mask = layer.maskEnabled !== false ? masks.get(layer.id) : null;
    const factor = Math.min(1, scale * Math.max(layer.transform.size[0] / source.width, layer.transform.size[1] / source.height));
    const effects = layer.effects, key = JSON.stringify([effects, layer.maskPlacement && [layer.maskPlacement, layer.transform], factor, source.compositorRevision ?? 0, mask?.compositorRevision ?? 0]);
    let cached = effectCache.get(source)?.find((entry) => entry.key === key && entry.mask === mask);
    if (!cached) {
      const w = Math.max(1, Math.round(source.width * factor)), h = Math.max(1, Math.round(source.height * factor));
      let image = surface(w, h), local = image.getContext('2d'); local.drawImage(source, 0, 0, w, h);
      if (mask) {
        const matte = surface(w, h), m = matte.getContext('2d');
        if (mask.width === 1 && mask.height === 1) { m.fillStyle = `rgba(255,255,255,${mask.getContext('2d').getImageData(0, 0, 1, 1).data[3] / 255})`; m.fillRect(0, 0, w, h); }
        else {
          if (layer.maskPlacement) { const bytes = mask.getContext('2d').getImageData(0, 0, mask.width, mask.height).data; let total = 0, count = 0; for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) if (!x || !y || x === mask.width - 1 || y === mask.height - 1) { total += bytes[(y * mask.width + x) * 4 + 3]; count++; } if (total * 2 >= count * 255) { m.fillStyle = '#fff'; m.fillRect(0, 0, w, h); } }
          const transform = multiply([w, 0, 0, h, 0, 0], multiply(inverse(affine(layer.transform)), affine(layer.maskPlacement ?? layer.transform)));
          m.setTransform(...transform); m.beginPath(); m.rect(0, 0, 1, 1); m.clip(); m.clearRect(0, 0, 1, 1); m.drawImage(mask, 0, 0, 1, 1);
        }
        local.globalCompositeOperation = 'destination-in'; local.drawImage(matte, 0, 0);
      }
      let padding = 0;
      for (const [kind, effect] of Object.entries(effects ?? {})) if (effect && effect.enabled !== false) padding = Math.max(padding, kind === 'shadow' || kind === 'innerShadow' ? (effect.distance ?? 10) + (effect.blur ?? 10) * 1.5 : (effect.size ?? 1) * (kind.includes('Glow') ? 1.5 : 1));
      padding = Math.ceil(padding * factor) + (padding ? 2 : 0);
      if (padding) { const padded = surface(w + padding * 2, h + padding * 2); padded.getContext('2d').drawImage(image, padding, padding); image = padded; }
      if (effects) image = applyEffects(image, effects, factor);
      cached = { key, mask, image, x: image.width / w, y: image.height / h };
      const list = effectCache.get(source) ?? []; list.unshift(cached); if (list.length > 4) list.pop(); effectCache.set(source, list);
    }
    const transform = structuredClone(layer.transform), [w, h] = transform.size;
    transform.size = [w * cached.x, h * cached.y]; transform.origin = [transform.origin[0] + (w - transform.size[0]) / 2, transform.origin[1] + (h - transform.size[1]) / 2];
    return { image: cached.image, transform };
  }
  function blendInto(target, source, mode, opacity = 1) {
    const ctx = target.getContext('2d');
    if (CANVAS_BLEND[mode]) { ctx.globalAlpha = opacity; ctx.globalCompositeOperation = CANVAS_BLEND[mode]; ctx.drawImage(source, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
    else {
      const base = ctx.getImageData(0, 0, width, height), top = source.getContext('2d').getImageData(0, 0, width, height);
      for (let i = 0; i < base.data.length; i += 4) if (top.data[i + 3]) { const pixel = [...top.data.subarray(i, i + 4)]; pixel[3] *= opacity; base.data.set(blendRGBA(base.data.subarray(i, i + 4), pixel, mode), i); }
      ctx.putImageData(base, 0, 0);
    }
  }
  function adjustTarget(target, entry) {
    const { layer } = entry, mode = layer.blendMode ?? 'Normal', ctx = target.getContext('2d');
    const adjusted = applyAdjustment(target, layer.adjustment, scale), changedContext = adjusted.getContext('2d');
    const original = ctx.getImageData(0, 0, width, height); let changed = changedContext.getImageData(0, 0, width, height);
    if (mode !== 'Normal') {
      const opaque = surface(width, height), a = new ImageData(new Uint8ClampedArray(original.data), width, height), b = new ImageData(new Uint8ClampedArray(changed.data), width, height);
      for (let i = 3; i < a.data.length; i += 4) a.data[i] = b.data[i] = 255;
      opaque.getContext('2d').putImageData(a, 0, 0); adjusted.getContext('2d').putImageData(b, 0, 0); blendInto(opaque, adjusted, mode);
      changed = opaque.getContext('2d').getImageData(0, 0, width, height); for (let i = 3; i < changed.data.length; i += 4) changed.data[i] = original.data[i];
    }
    const mask = surface(width, height), maskContext = mask.getContext('2d'); maskContext.fillStyle = '#fff'; maskContext.fillRect(0, 0, width, height);
    for (const item of [...entry.ancestors, layer]) if (item.maskFile && item.maskEnabled !== false && masks.has(item.id)) { maskContext.globalCompositeOperation = 'destination-in'; maskContext.drawImage(placedMask(item), 0, 0); }
    const matte = maskContext.getImageData(0, 0, width, height);
    for (let i = 0; i < original.data.length; i += 4) {
      const amount = entry.opacity * matte.data[i + 3] / 255, a = original.data[i + 3] * (1 - amount), b = changed.data[i + 3] * amount, alpha = a + b;
      for (let c = 0; c < 3; c++) original.data[i + c] = alpha ? (original.data[i + c] * a + changed.data[i + c] * b) / alpha : 0;
      original.data[i + 3] = alpha;
    }
    ctx.putImageData(original, 0, 0);
  }
  for (const entry of entries) {
    const { layer } = entry;
    if (!entry.visible || layer.isGroup || !entry.opacity || stacked.has(layer.id)) continue;
    const ancestorMasks = entry.ancestors.filter((group) => masks.has(group.id) && group.maskEnabled !== false);
    const mode = layer.blendMode ?? 'Normal';
    if (stacks.has(layer.id)) {
      const group = surface(width, height), groupContext = group.getContext('2d'); groupContext.globalAlpha = entry.opacity;
      groupContext.drawImage(coverage(layer), 0, 0); groupContext.globalAlpha = 1;
      const pixels = groupContext.getImageData(0, 0, width, height), alpha = new Uint8Array(width * height);
      for (let i = 0; i < alpha.length; i++) { alpha[i] = pixels.data[i * 4 + 3]; pixels.data[i * 4 + 3] = 255; } groupContext.putImageData(pixels, 0, 0);
      for (const childEntry of stacks.get(layer.id)) {
        const child = childEntry.layer;
        if (child.adjustment) adjustTarget(group, childEntry);
        else if (images.has(child.id)) {
          const own = surface(width, height), rendered = ownImage(child); place(own.getContext('2d'), rendered.image, rendered.transform, scale);
          blendInto(group, own, child.blendMode ?? 'Normal', childEntry.opacity);
        }
      }
      const result = groupContext.getImageData(0, 0, width, height); for (let i = 0; i < alpha.length; i++) result.data[i * 4 + 3] = alpha[i]; groupContext.putImageData(result, 0, 0);
      for (const parent of ancestorMasks) { groupContext.globalCompositeOperation = 'destination-in'; groupContext.drawImage(placedMask(parent), 0, 0); }
      blendInto(output, group, mode); continue;
    }
    if (layer.adjustment) {
      if (!layer.maskSourceID) adjustTarget(output, entry); continue;
    }
    if (!images.has(layer.id)) continue;
    if (!layer.effects && !layer.maskFile && !layer.maskSourceID && !ancestorMasks.length && CANVAS_BLEND[mode]) {
      context.globalAlpha = entry.opacity;
      context.globalCompositeOperation = CANVAS_BLEND[mode];
      place(context, images.get(layer.id), layer.transform, scale);
      continue;
    }
    const staged = surface(width, height), stagedContext = staged.getContext('2d');
    stagedContext.globalAlpha = entry.opacity;
    stagedContext.drawImage(coverage(layer), 0, 0);
    stagedContext.globalAlpha = 1;
    for (const group of ancestorMasks) {
      stagedContext.globalCompositeOperation = 'destination-in';
      stagedContext.drawImage(placedMask(group), 0, 0);
    }
    if (CANVAS_BLEND[mode]) {
      context.globalAlpha = 1;
      context.globalCompositeOperation = CANVAS_BLEND[mode];
      context.drawImage(staged, 0, 0);
    } else {
      const back = context.getImageData(0, 0, width, height), front = stagedContext.getImageData(0, 0, width, height);
      for (let i = 0; i < front.data.length; i += 4) {
        if (!front.data[i + 3]) continue;
        back.data.set(blendRGBA(back.data.subarray(i, i + 4), front.data.subarray(i, i + 4), mode), i);
      }
      context.putImageData(back, 0, 0);
    }
  }
  context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
  return output;
}

export async function decodeImage(data) {
  const image = new Image();
  image.src = data;
  try { await image.decode(); } catch { throw new Error('The image is damaged or its format is unsupported.'); }
  return image;
}

export async function decodeAssets(manifest, assets) {
  const images = new Map(), masks = new Map();
  for (const layer of manifest.layers) {
    if (layer.imageFile) {
      const image = await decodeImage(`data:image/png;base64,${assets[layer.imageFile]}`);
      const canvas = surface(image.naturalWidth, image.naturalHeight);
      canvas.getContext('2d').drawImage(image, 0, 0);
      images.set(layer.id, canvas);
      if (layer.hdrSourceFile) await attachHDRAssets(layer, canvas, assets);
    }
    if (layer.maskFile) {
      const image = await decodeImage(`data:image/png;base64,${assets[layer.maskFile]}`);
      const canvas = surface(image.naturalWidth, image.naturalHeight), ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        pixels.data[i + 3] = pixels.data[i];
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
      }
      ctx.putImageData(pixels, 0, 0);
      masks.set(layer.id, canvas);
    }
  }
  return { images, masks };
}
