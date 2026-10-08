import { fontDescriptor, canonicalFontName } from './text-style.js';
import { renderText } from './text-layout.js';
import { resizedGrid } from './raster-space.js';
import { settingsDialog } from './settings-dialog.js';

const generic = new Set(['serif', 'sans-serif', 'monospace', 'system-ui', 'cursive', 'fantasy']);
export function fontAvailable(name, installed) {
  const face = fontDescriptor(name), family = face.family;
  if (generic.has(family.toLowerCase())) return true;
  if (installed?.size) return installed.has(family.toLowerCase());
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d'), sample = 'mmmmmmmmWWWWiiii0123456789汉字';
  return ['monospace', 'serif'].some((fallback) => { ctx.font = `${face.style} ${face.weight} 48px ${fallback}`; const base = ctx.measureText(sample).width; ctx.font = `${face.style} ${face.weight} 48px ${JSON.stringify(family)}, ${fallback}`; return Math.abs(ctx.measureText(sample).width - base) > .01; });
}
export function installFontManager(editor, api) {
  let installed, families = ['Arial', 'Segoe UI', 'Noto Sans', 'Times New Roman', 'Courier New', 'sans-serif', 'serif', 'monospace'];
  const cache = new Map(), warning = document.createElement('button'); warning.id = 'font-warnings'; warning.dataset.command = 'substitute-fonts'; warning.textContent = 'Missing fonts…'; warning.hidden = true;
  warning.addEventListener('click', () => api.runCommand('substitute-fonts')); document.querySelector('.properties-panel').append(warning);
  const names = () => [...new Set((editor.manifest?.layers ?? []).flatMap((layer) => layer.text ? [layer.text.fontName, ...(layer.text.fontRuns ?? []).map((run) => run.fontName)] : []))];
  const available = (name) => { if (!cache.has(name)) cache.set(name, fontAvailable(name, installed)); return cache.get(name); };
  const refresh = () => { const missing = names().filter((name) => !available(name)); warning.hidden = !missing.length; warning.title = missing.join(', '); };
  const changed = editor.onChange; editor.onChange = () => { changed(); refresh(); };
  if (window.desktop.fontFamilies) window.desktop.fontFamilies().then((response) => { if (response.ok) { families = [...response.value, 'sans-serif', 'serif', 'monospace']; installed = new Set(families.map((name) => name.toLowerCase())); cache.clear(); refresh(); } });
  document.fonts.addEventListener('loadingdone', () => { cache.clear(); refresh(); });
  const previous = editor.advancedCommand;
  editor.advancedCommand = async (command) => {
    if (command !== 'substitute-fonts') return previous(command);
    if (editor.inlineText?.finish(true) === false) return true;
    const missing = names().filter((name) => !available(name)); if (!missing.length) return true;
    const choices = families.filter(available), defaultFont = choices.find((name) => name === 'Arial') ?? choices[0] ?? 'sans-serif';
    const value = await settingsDialog('Substitute missing fonts', missing.map((name, index) => ({ key: 'font' + index, label: name, options: choices.length ? choices : ['sans-serif'], default: defaultFont })), {}); if (!value) return true;
    const replacements = new Map(missing.map((name, index) => {
      const original = fontDescriptor(name), family = fontDescriptor(value['font' + index]).family, bold = original.weight === '700', italic = original.style === 'italic';
      const replacement = family === 'Arial' ? canonicalFontName(family + (bold ? ' Bold' : '') + (italic ? ' Italic' : '')) : canonicalFontName(family + (bold || italic ? '-' + (bold ? 'Bold' : '') + (italic ? 'Italic' : '') : ''));
      return [name, replacement];
    }));
    editor.mutate('Substitute Fonts', () => {
      for (const layer of editor.manifest.layers) {
        if (!layer.text || ![layer.text.fontName, ...(layer.text.fontRuns ?? []).map((run) => run.fontName)].some((name) => replacements.has(name))) continue;
        const style = structuredClone(layer.text); style.fontName = replacements.get(style.fontName) ?? style.fontName;
        if (style.fontRuns) style.fontRuns = style.fontRuns.map((run) => ({ ...run, fontName: replacements.get(run.fontName) ?? run.fontName }));
        const image = renderText(style), before = editor.images.get(layer.id);
        if (before) { if (layer.maskFile && !layer.maskPlacement) layer.maskPlacement = structuredClone(layer.transform); layer.transform = resizedGrid(layer.transform, before.width, before.height, 0, 0, image.width, image.height); }
        layer.text = style; editor.storePixels(layer, image);
      }
    }); return true;
  };
  editor.fontManager = { missing: () => names().filter((name) => !available(name)) };
}
