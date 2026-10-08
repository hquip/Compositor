export function fontDescriptor(name = 'Arial') {
  const aliases = { ArialMT: 'Arial', Arial: 'Arial', Helvetica: 'Arial', HelveticaNeue: 'Arial', 'Helvetica Neue': 'Arial', CourierNewPSMT: 'Courier New', CourierNewPS: 'Courier New', Courier: 'Courier New', TimesNewRomanPSMT: 'Times New Roman', TimesNewRomanPS: 'Times New Roman', 'Times-Roman': 'Times New Roman' };
  const suffix = name.match(/-(BoldItalic|BoldOblique|Bold|Italic|Oblique|Regular)(?:MT)?$/), base = suffix ? name.slice(0, suffix.index) : name;
  return { family: Object.hasOwn(aliases, base) ? aliases[base] : base, weight: suffix?.[1].includes('Bold') ? '700' : '400', style: /Italic|Oblique/.test(suffix?.[1] ?? '') ? 'italic' : 'normal' };
}
export function fontFamily(name = 'Arial') { return fontDescriptor(name).family; }
export function canonicalFontName(name) {
  const aliases = new Map([['Arial', 'ArialMT'], ['Arial Bold', 'Arial-BoldMT'], ['Arial Italic', 'Arial-ItalicMT'], ['Arial Bold Italic', 'Arial-BoldItalicMT'], ['Courier New', 'CourierNewPSMT'], ['Times New Roman', 'TimesNewRomanPSMT']]);
  return aliases.get(name.trim()) ?? name.trim();
}
const keys = { colorRuns: ['red', 'green', 'blue'], fontRuns: ['fontName'], sizeRuns: ['fontSize'] };
const same = (a, b, fields) => fields.every((field) => a[field] === b[field]);
export function styleUnits(style, kind) {
  const units = Array.from({ length: style.content.length }, () => style);
  for (const run of style[kind] ?? []) for (let i = Math.max(0, run.location); i < Math.min(units.length, run.location + run.length); i++) units[i] = run;
  return units;
}
export function canonicalRuns(units, base, kind) {
  const result = [], fields = keys[kind];
  for (let i = 0; i < units.length; i++) {
    const value = units[i]; if (same(value, base, fields)) continue;
    const previous = result.at(-1);
    if (previous && previous.location + previous.length === i && same(previous, value, fields)) previous.length++;
    else result.push({ location: i, length: 1, ...Object.fromEntries(fields.map((key) => [key, value[key]])) });
  }
  return result.length ? result : undefined;
}
export function normalizedTextStyle(style) {
  if (!/[\r\u0085\u2028\u2029\v\f]/.test(style.content)) return { ...style };
  const result = { ...style, content: '' }, colors = styleUnits(style, 'colorRuns'), fonts = styleUnits(style, 'fontRuns'), sizes = styleUnits(style, 'sizeRuns'), colorUnits = [], fontUnits = [], sizeUnits = [];
  for (let i = 0; i < style.content.length; i++) {
    result.content += /[\r\u0085\u2028\u2029\v\f]/.test(style.content[i]) ? '\n' : style.content[i]; colorUnits.push(colors[i]); fontUnits.push(fonts[i]); sizeUnits.push(sizes[i]);
    if (style.content[i] === '\r' && style.content[i + 1] === '\n') i++;
  }
  result.colorRuns = canonicalRuns(colorUnits, result, 'colorRuns'); result.fontRuns = canonicalRuns(fontUnits, result, 'fontRuns'); result.sizeRuns = canonicalRuns(sizeUnits, result, 'sizeRuns'); return result;
}
export function replaceTextContent(style, content) {
  const before = style.content; let start = 0, end = 0;
  while (start < before.length && start < content.length && before[start] === content[start]) start++;
  while (end < before.length - start && end < content.length - start && before[before.length - end - 1] === content[content.length - end - 1]) end++;
  const result = { ...style, content };
  for (const kind of Object.keys(keys)) {
    const units = styleUnits(style, kind), inherited = units[Math.max(0, start - 1)] ?? style;
    const next = [...units.slice(0, start), ...Array.from({ length: content.length - start - end }, () => inherited), ...units.slice(before.length - end)];
    result[kind] = canonicalRuns(next, result, kind);
  }
  return result;
}
export function textSpans(style) {
  const breaks = new Set([0, style.content.length]);
  for (const kind of Object.keys(keys)) for (const run of style[kind] ?? []) { breaks.add(Math.max(0, Math.min(style.content.length, run.location))); breaks.add(Math.max(0, Math.min(style.content.length, run.location + run.length))); }
  const offsets = [...breaks].sort((a, b) => a - b), spans = [];
  for (let i = 0; i + 1 < offsets.length; i++) {
    const start = offsets[i], end = offsets[i + 1]; if (end === start) continue;
    const color = style.colorRuns?.find((run) => start >= run.location && start < run.location + run.length) ?? style, font = style.fontRuns?.find((run) => start >= run.location && start < run.location + run.length) ?? style;
    const size = style.sizeRuns?.find((run) => start >= run.location && start < run.location + run.length) ?? style;
    spans.push({ start, end, text: style.content.slice(start, end), fontName: font.fontName, fontSize: size.fontSize, red: color.red, green: color.green, blue: color.blue });
  }
  return spans;
}
