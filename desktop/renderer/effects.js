import { surface, copySurface, alphaSurface, clamp, colorCSS, morphology } from './raster.js';
import { blurSurface } from './adjustments.js';

function distanceTo(alpha, width, height, solid) {
  const data = new Float64Array(width * height), temp = new Float64Array(data.length);
  for (let i = 0; i < data.length; i++) data[i] = (alpha[i] >= 128) === solid ? 0 : 1e12;
  const length = Math.max(width, height), f = new Float64Array(length), d = new Float64Array(length), v = new Int32Array(length), z = new Float64Array(length + 1);
  function transform(n) {
    let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let s;
      do { const p = v[k]; s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * (q - p)); if (s <= z[k]) k--; else break; } while (k >= 0);
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
  }
  for (let y = 0; y < height; y++) { for (let x = 0; x < width; x++) f[x] = data[y * width + x]; transform(width); for (let x = 0; x < width; x++) temp[y * width + x] = d[x]; }
  for (let x = 0; x < width; x++) { for (let y = 0; y < height; y++) f[y] = temp[y * width + x]; transform(height); for (let y = 0; y < height; y++) data[y * width + x] = Math.sqrt(d[y]); }
  return data;
}
function tint(mask, effect) {
  const canvas = copySurface(mask), context = canvas.getContext('2d'); context.globalCompositeOperation = 'source-in'; context.fillStyle = colorCSS(effect);
  context.globalAlpha = effect.opacity ?? 1; context.fillRect(0, 0, canvas.width, canvas.height); return canvas;
}
export function applyEffects(source, effects, scale = 1) {
  if (!effects || !Object.values(effects).some((effect) => effect && effect.enabled !== false)) return source;
  const { width, height } = source, base = copySurface(source), context = base.getContext('2d');
  const pixels = context.getImageData(0, 0, width, height), alpha = new Uint8ClampedArray(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = pixels.data[i * 4 + 3];
  const mask = alphaSurface(alpha, width, height), behind = surface(width, height), back = behind.getContext('2d');
  function edge(effect, inside, glow) {
    const size = Math.max(.01, (effect.size ?? 4) * scale), coverage = new Uint8ClampedArray(alpha.length);
    const blurred = glow ? blurSurface(mask, size / 2).getContext('2d').getImageData(0, 0, width, height).data : null;
    const spread = glow ? null : morphology(alpha, width, height, Math.max(1, Math.round(size)), !inside);
    for (let i = 0; i < coverage.length; i++) {
      coverage[i] = glow ? Math.round(inside ? alpha[i] * (1 - blurred[i * 4 + 3] / 255) : blurred[i * 4 + 3] * (1 - alpha[i] / 255)) : Math.max(0, inside ? alpha[i] - spread[i] : spread[i] - alpha[i]);
    }
    return tint(alphaSurface(coverage, width, height), effect);
  }
  const on = (key) => effects[key] && effects[key].enabled !== false;
  if (on('shadow')) {
    const s = effects.shadow, a = (s.angle ?? 90) * Math.PI / 180, distance = (s.distance ?? 20) * scale;
    back.drawImage(tint(blurSurface(mask, (s.blur ?? 20) * scale / 2), s), -Math.cos(a) * distance, Math.sin(a) * distance);
  }
  if (on('outerGlow')) back.drawImage(edge(effects.outerGlow, false, true), 0, 0);
  if (on('stroke') && !effects.stroke.inside) back.drawImage(edge(effects.stroke, false, false), 0, 0);
  back.drawImage(source, 0, 0);
  if (on('colorOverlay')) back.drawImage(tint(mask, effects.colorOverlay), 0, 0);
  if (on('innerGlow')) back.drawImage(edge(effects.innerGlow, true, true), 0, 0);
  if (on('innerShadow')) {
    const s = effects.innerShadow, a = (s.angle ?? 90) * Math.PI / 180, distance = (s.distance ?? 10) * scale;
    const inner = copySurface(mask), ctx = inner.getContext('2d'); ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(blurSurface(mask, (s.blur ?? 10) * scale / 2), -Math.cos(a) * distance, Math.sin(a) * distance);
    back.drawImage(tint(inner, s), 0, 0);
  }
  if (on('stroke') && effects.stroke.inside) back.drawImage(edge(effects.stroke, true, false), 0, 0);
  return behind;
}

export function effectDefaults(kind) {
  const color = { red: 0, green: 0, blue: 0, opacity: 1, enabled: true };
  if (kind === 'stroke') return { ...color, size: 4, inside: false };
  if (kind === 'shadow' || kind === 'innerShadow') return { ...color, angle: 90, distance: 10, blur: 10, opacity: .5 };
  if (kind === 'outerGlow' || kind === 'innerGlow') return { ...color, red: 1, green: 1, blue: 1, size: 20, opacity: .75 };
  return color;
}
