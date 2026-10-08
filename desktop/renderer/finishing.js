import { kernels, allocate, pixelKernel } from './kernels.js';
import { surface, copySurface, colorRecord } from './raster.js';
import { blurSurface } from './adjustments.js';
import { numberField as n, colorField as c, boolField as b } from './settings-dialog.js';

export const FINISHING = ['Vignette', 'Bloom / Glow', 'Tonal Contrast', 'Lens Correction', 'Dither'];
export function finishingFields(kind) {
  if (kind === 'Vignette') return [n('amount', 'Amount', 0, 100, 35), c('color', 'Color'), n('midpoint', 'Midpoint', 0, 100, 50), n('roundness', 'Roundness', -100, 100, 100), n('feather', 'Feather', 0, 100, 60), n('highlights', 'Protect highlights', 0, 100, 25)];
  if (kind === 'Bloom / Glow') return [n('amount', 'Amount', 0, 100, 40), n('radius', 'Radius', 1, 150, 24)];
  if (kind === 'Tonal Contrast') return [n('amount', 'Amount', 0, 100, 50), n('radius', 'Radius', 1, 100, 16), n('shadows', 'Shadows', -100, 100, 40), n('midtones', 'Midtones', -100, 100, 60), n('highlights', 'Highlights', -100, 100, 30)];
  if (kind === 'Lens Correction') return [n('distortion', 'Remove distortion', -100, 100)];
  return [{ key: 'style', label: 'Style', options: ['Atkinson', 'Floyd–Steinberg', 'Bayer 2', 'Bayer 4', 'Bayer 8', 'Dots', 'Lines', 'Diamonds', 'Patterns', 'Glyphs', 'Scanlines'], default: 'Atkinson' }, n('levels', 'Levels', 2, 8, 2), n('diffusion', 'Diffusion', 0, 1, 1, .01), n('density', 'Density', -1, 1, 0, .01), n('contrast', 'Contrast', -1, 1, 0, .01), n('cell', 'Cell size', 2, 64, 8), n('angle', 'Angle', -180, 180), n('pixelSize', 'Pixel size', 1, 32, 2), b('originalColors', 'Original colors'), c('dark', 'Dark'), c('light', 'Light', { red: 1, green: 1, blue: 1 }), b('lightOnDark', 'Light on dark'), { key: 'characters', label: 'Characters', type: 'text', default: ' .:-=+*#%@' }, n('dots', 'Scanline dots', 0, 1, 0, .01), n('wobble', 'Scanline wobble', 0, 64)];
}
function premultiplied(image) { const data = image.getContext('2d').getImageData(0, 0, image.width, image.height).data; for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] * data[i + 3] / 255); return data; }
export function glyphAtlas(settings) {
  const width = settings.cell ?? 8, height = Math.ceil(width / .6), characters = [...(settings.characters || ' .:-=+*#%@')], glyphs = [];
  for (const character of characters) { const glyph = surface(width, height), ctx = glyph.getContext('2d'); ctx.fillStyle = '#fff'; ctx.font = `${height}px Consolas`; ctx.textBaseline = 'top'; ctx.fillText(character, 0, 0); const rgba = ctx.getImageData(0, 0, width, height).data, alpha = Uint8Array.from({ length: width * height }, (_, i) => rgba[i * 4 + 3]); glyphs.push({ alpha, mean: alpha.reduce((sum, value) => sum + value, 0) / (255 * alpha.length) }); }
  glyphs.sort((a, b) => a.mean - b.mean); const all = new Uint8Array(width * height * glyphs.length); glyphs.forEach((glyph, i) => all.set(glyph.alpha, i * width * height));
  return { width, height, all, means: new Float32Array(glyphs.map((glyph) => glyph.mean)), count: glyphs.length };
}
export function finishingFilter(image, kind, settings) {
  if (kind === 'Bloom / Glow') { const output = copySurface(image), context = output.getContext('2d'); context.globalCompositeOperation = 'screen'; context.globalAlpha = (settings.amount ?? 40) / 100; context.drawImage(blurSurface(image, settings.radius ?? 24), 0, 0); return output; }
  const pixelSize = kind === 'Dither' && settings.style !== 'Glyphs' && settings.style !== 'Scanlines' ? settings.pixelSize ?? 2 : 1;
  const canvas = surface(Math.ceil(image.width / pixelSize), Math.ceil(image.height / pixelSize)), context = canvas.getContext('2d'); context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const data = context.getImageData(0, 0, canvas.width, canvas.height), blurred = kind === 'Tonal Contrast' ? premultiplied(blurSurface(canvas, settings.radius ?? 16)) : null;
  pixelKernel(data.data, canvas.width, canvas.height, (p, w, h, stride) => {
    if (kind === 'Vignette') { const color = settings.color ?? { red: 0, green: 0, blue: 0 }; kernels.adjust_colored_vignette(p, w, h, stride, 0, 0, w, h, 0, settings.amount ?? 35, settings.midpoint ?? 50, settings.roundness ?? 100, settings.feather ?? 60, settings.highlights ?? 25, color.red, color.green, color.blue); }
    else if (kind === 'Tonal Contrast') kernels.adjust_tonal_contrast(p, allocate(blurred), w, h, stride, stride, settings.amount ?? 50, settings.shadows ?? 40, settings.midtones ?? 60, settings.highlights ?? 30);
    else if (kind === 'Lens Correction') { const target = allocate(data.data.length); kernels.lens_distort(p, target, w, h, stride, (settings.distortion ?? 0) / 100 * .35); kernels.memcpy(p, target, data.data.length); }
    else if (kind === 'Dither') {
      const params = new ArrayBuffer(72), view = new DataView(params), styles = ['Atkinson', 'Floyd–Steinberg', 'Bayer 2', 'Bayer 4', 'Bayer 8', 'Dots', 'Lines', 'Diamonds', 'Patterns', 'Glyphs', 'Scanlines'];
      view.setInt32(0, styles.indexOf(settings.style ?? 'Atkinson'), true); view.setInt32(4, settings.levels ?? 2, true);
      view.setFloat32(8, settings.diffusion ?? 1, true); view.setFloat32(12, settings.density ?? 0, true); view.setFloat32(16, settings.contrast ?? 0, true); view.setInt32(20, settings.cell ?? 8, true); view.setFloat32(24, (settings.angle ?? 0) * Math.PI / 180, true);
      view.setInt32(28, settings.lightOnDark ? 1 : 0, true); view.setInt32(32, settings.originalColors ? 1 : 0, true);
      ['red', 'green', 'blue'].forEach((key, c) => { view.setUint8(36 + c, Math.round((settings.dark?.[key] ?? 0) * 255)); view.setUint8(39 + c, Math.round((settings.light?.[key] ?? 1) * 255)); });
      if (settings.style === 'Glyphs') {
        const atlas = settings.glyphAtlas ?? glyphAtlas(settings);
        view.setInt32(44, atlas.width, true); view.setInt32(48, atlas.height, true); view.setUint32(52, allocate(atlas.all), true); view.setUint32(56, allocate(atlas.means), true); view.setInt32(60, atlas.count, true);
      }
      view.setFloat32(64, settings.dots ?? 0, true); view.setFloat32(68, settings.wobble ?? 0, true);
      if (!kernels.dither_apply(p, w, h, stride, allocate(new Uint8Array(params)))) throw new Error('Dithering could not allocate working memory.');
    }
  });
  context.putImageData(data, 0, 0);
  if (pixelSize === 1) return canvas;
  const enlarged = surface(image.width, image.height); enlarged.getContext('2d').imageSmoothingEnabled = false; enlarged.getContext('2d').drawImage(canvas, 0, 0, image.width, image.height); return enlarged;
}
