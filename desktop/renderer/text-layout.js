import { surface, colorCSS } from './raster.js';
import { canvasSize } from './core.js';
import { fontDescriptor, normalizedTextStyle, styleUnits } from './text-style.js';
import { bidiFactory, LineBreaker } from './vendor/text.js';

const bidi = bidiFactory(), graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const fontString = (font, size) => { const face = fontDescriptor(font); return `${face.style} ${face.weight} ${size}px ${JSON.stringify(face.family)}`; };
function configure(context, font, style, direction = 'ltr') {
  context.font = fontString(font, style.fontSize); context.fontKerning = 'normal'; context.textBaseline = 'alphabetic'; context.direction = direction; context.textAlign = 'start';
  if ('letterSpacing' in context) context.letterSpacing = `${style.tracking ?? 0}px`;
}
export function layoutText(input) {
  const style = normalizedTextStyle({ fontName: 'Arial', fontSize: 72, tracking: 0, leading: 0, red: 0, green: 0, blue: 0, alignment: 'Left', ...input }), text = style.content;
  if (text.length > 100000 || !Number.isFinite(style.fontSize) || style.fontSize < 1 || style.fontSize > 2000) throw new Error('The text layer exceeds the supported dimensions.');
  const context = surface(1, 1).getContext('2d'), fonts = styleUnits(style, 'fontRuns'), colors = styleUnits(style, 'colorRuns'), leading = style.leading || style.fontSize * 1.2;
  const fixed = style.boxSize, available = fixed ? Math.max(1, fixed[0] - 24) : Infinity, lines = [];
  let paragraphStart = 0;
  const maximumLines = fixed ? Math.max(1, Math.ceil(Math.max(1, fixed[1] - 24) / leading) + 1) : Infinity;
  paragraphs: for (const paragraph of text.split('\n')) {
    const embedding = bidi.getEmbeddingLevels(paragraph), clusters = [...graphemes.segment(paragraph)].map((item) => ({ start: item.index, end: item.index + item.segment.length }));
    const boundaries = new Set(clusters.map((item) => item.end)), breaker = new LineBreaker(paragraph), breaks = []; let next;
    while ((next = breaker.nextBreak())) if (boundaries.has(next.position)) breaks.push(next.position);
    if (!breaks.includes(paragraph.length)) breaks.push(paragraph.length);
    const shape = (start, end) => {
      const runs = []; let run;
      let low = 0, high = clusters.length; while (low < high) { const middle = (low + high) >> 1; if (clusters[middle].start < start) low = middle + 1; else high = middle; }
      for (let index = low; index < clusters.length && clusters[index].start < end; index++) {
        const cluster = clusters[index];
        const font = fonts[paragraphStart + cluster.start]?.fontName ?? style.fontName, level = embedding.levels[cluster.start] ?? 0;
        if (!run || run.font !== font || run.level !== level) { run = { start: cluster.start, end: cluster.end, font, level }; runs.push(run); } else run.end = cluster.end;
      }
      for (const item of runs) { item.text = paragraph.slice(item.start, item.end); item.direction = item.level % 2 ? 'rtl' : 'ltr'; configure(context, item.font, style, item.direction); const metric = context.measureText(item.text); item.width = metric.width + (!('letterSpacing' in context) ? (style.tracking ?? 0) * [...graphemes.segment(item.text)].length : 0); item.descent = metric.fontBoundingBoxDescent ?? style.fontSize * .22; }
      const order = Array.from({ length: end - start }, (_, index) => index + start);
      for (const [a, b] of bidi.getReorderSegments(paragraph, embedding, start, end - 1)) for (let i = a, j = b; i < j; i++, j--) [order[i - start], order[j - start]] = [order[j - start], order[i - start]];
      const visual = [], seen = new Set(); for (const index of order) { const item = runs.find((run) => index >= run.start && index < run.end); if (item && !seen.has(item)) { seen.add(item); visual.push(item); } }
      return { start: paragraphStart + start, end: paragraphStart + end, text: paragraph.slice(start, end), width: visual.reduce((sum, run) => sum + run.width, 0), runs: visual.map((run) => ({ ...run, start: run.start + paragraphStart, end: run.end + paragraphStart })) };
    };
    if (!paragraph.length) lines.push({ start: paragraphStart, end: paragraphStart, text: '', width: 0, runs: [] });
    else if (!fixed) lines.push(shape(0, paragraph.length));
    else {
      let start = 0;
      while (start < paragraph.length) {
        if (lines.length >= maximumLines) break paragraphs;
        const options = breaks.filter((end) => end > start); let low = 0, high = options.length - 1, chosen = -1;
        while (low <= high) { const middle = (low + high) >> 1; if (shape(start, options[middle]).width <= available) { chosen = middle; low = middle + 1; } else high = middle - 1; }
        let end = chosen >= 0 ? options[chosen] : null;
        if (end == null) { const ends = clusters.filter((cluster) => cluster.end > start).map((cluster) => cluster.end); low = 0; high = ends.length - 1; let best = 0;
          while (low <= high) { const middle = (low + high) >> 1; if (shape(start, ends[middle]).width <= available) { best = middle; low = middle + 1; } else high = middle - 1; } end = ends[best]; }
        const visualEnd = end < paragraph.length ? Math.max(start + 1, start + paragraph.slice(start, end).replace(/[ \t]+$/, '').length) : end;
        lines.push(shape(start, visualEnd)); start = end;
      }
    }
    paragraphStart += paragraph.length + 1;
  }
  const width = Math.ceil(fixed?.[0] ?? Math.max(16, ...lines.map((line) => line.width + 24 + style.fontSize * .1))), height = Math.ceil(fixed?.[1] ?? Math.max(16, lines.length * leading + 24));
  canvasSize(width, height);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]; line.x = style.alignment === 'Center' ? (width - line.width) / 2 : style.alignment === 'Right' ? width - 12 - line.width : 12;
    line.baseline = 12 + (i + 1) * leading - Math.max(style.fontSize * .2, ...line.runs.map((run) => run.descent));
    let x = line.x; for (const run of line.runs) { run.x = x; x += run.width; }
  }
  return { style, width, height, lines, colors };
}
function colorSections(layout, run) {
  const sections = []; let current;
  for (const item of graphemes.segment(run.text)) {
    const index = run.start + item.index, color = layout.colors[index] ?? layout.style, key = `${color.red},${color.green},${color.blue}`;
    if (!current || current.key !== key) { current = { key, start: item.index, end: item.index + item.segment.length, color }; sections.push(current); } else current.end = item.index + item.segment.length;
  }
  return sections;
}
function colorRectangles(run, style, sections) {
  const probe = document.createElement('span'); probe.dataset.noTranslate = ''; probe.setAttribute('aria-hidden', 'true');
  Object.assign(probe.style, { position: 'fixed', left: '-100000px', top: '0', visibility: 'hidden', whiteSpace: 'pre', font: fontString(run.font, style.fontSize), fontKerning: 'normal', letterSpacing: `${style.tracking ?? 0}px`, direction: run.direction, unicodeBidi: 'isolate' });
  const node = document.createTextNode(run.text); probe.append(node); document.body.append(probe); const bounds = probe.getBoundingClientRect();
  try { return sections.map((section) => { const range = document.createRange(); range.setStart(node, section.start); range.setEnd(node, section.end); return [...range.getClientRects()].map((rect) => ({ x: rect.left - bounds.left, width: rect.width })); }); }
  finally { probe.remove(); }
}
export function renderText(input) {
  const layout = layoutText(input), { style, width, height } = layout, canvas = surface(width, height), context = canvas.getContext('2d');
  context.save(); context.beginPath(); context.rect(12, 12, Math.max(1, width - 24), Math.max(1, height - 24)); context.clip();
  for (const line of layout.lines) for (const run of line.runs) {
    const draw = (ctx, x, baseline, color) => {
      configure(ctx, run.font, style, run.direction); ctx.fillStyle = colorCSS(color);
      if ('letterSpacing' in ctx || !style.tracking) { ctx.fillText(run.text, x + (run.direction === 'rtl' ? run.width : 0), baseline); return; }
      // Keep contextual glyph shapes on engines without Canvas letter spacing.
      const clusters = [...graphemes.segment(run.text)].map((item) => ({ start: item.index, end: item.index + item.segment.length })), clips = colorRectangles(run, { ...style, tracking: 0 }, clusters), naturalWidth = ctx.measureText(run.text).width;
      for (let index = 0; index < clusters.length; index++) {
        const shift = style.tracking * (run.direction === 'rtl' ? clusters.length - 1 - index : index);
        ctx.save(); ctx.beginPath(); for (const clip of clips[index]) ctx.rect(x + clip.x + shift, baseline - style.fontSize * 2, clip.width, style.fontSize * 4); ctx.clip();
        ctx.fillText(run.text, x + (run.direction === 'rtl' ? naturalWidth : 0) + shift, baseline); ctx.restore();
      }
    };
    const sections = colorSections(layout, run);
    if (sections.length <= 1) { if (sections.length) draw(context, run.x, line.baseline, sections[0].color); continue; }
    const left = Math.floor(Math.max(0, run.x - style.fontSize)), top = Math.floor(Math.max(0, line.baseline - style.fontSize * 2)), right = Math.ceil(Math.min(width, run.x + run.width + style.fontSize)), bottom = Math.ceil(Math.min(height, line.baseline + style.fontSize));
    if (right <= left || bottom <= top) continue;
    const colored = surface(right - left, bottom - top), ctx = colored.getContext('2d'); draw(ctx, run.x - left, line.baseline - top, style);
    const result = ctx.getImageData(0, 0, colored.width, colored.height), rectangles = colorRectangles(run, style, sections);
    for (let i = 0; i < sections.length; i++) {
      ctx.clearRect(0, 0, colored.width, colored.height); draw(ctx, run.x - left, line.baseline - top, sections[i].color);
      const next = ctx.getImageData(0, 0, colored.width, colored.height);
      for (let x = 0; x < colored.width; x++) {
        const position = x + left + .5 - run.x;
        if (!rectangles[i].some((rect) => position >= (rect.x <= .5 ? -Infinity : rect.x) && position < (rect.x + rect.width >= run.width - .5 ? Infinity : rect.x + rect.width))) continue;
        for (let y = 0; y < colored.height; y++) { const index = (y * colored.width + x) * 4; for (let channel = 0; channel < 3; channel++) result.data[index + channel] = next.data[index + channel]; }
      }
    }
    // One glyph mask, regardless of color runs: no alpha seams through ligatures or combining marks.
    ctx.putImageData(result, 0, 0); context.drawImage(colored, left, top);
  }
  context.restore(); canvas.textLayout = layout; return canvas;
}
