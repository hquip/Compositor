const response = await fetch(new URL('./locales/zh-CN.json', import.meta.url));
if (!response.ok) throw new Error('Could not load interface translations.');
const chinese = await response.json();
const lookup = new Map(Object.entries(chinese).map(([key, value]) => [key.toLowerCase(), value]));
let language = localStorage.getItem('compositor.language') || 'en';
export function translate(text, locale = language) {
  if (locale !== 'zh-CN' || !text) return text;
  const direct = lookup.get(text.toLowerCase()); if (direct) return direct;
  const match = text.match(/^(.*?)(…| \([^)]*\)| · (?:Ctrl|Space).*)$/);
  if (match) return translate(match[1], locale) + match[2];
  if (text.endsWith(' tool')) { const name = translate(text.slice(0, -5), locale); if (name !== text.slice(0, -5)) return name + '工具'; }
  const imported = text.match(/^Imported (\d+) images?$/); if (imported) return `已导入 ${imported[1]} 张图像`;
  const dimensions = text.match(/^Use whole dimensions from 1 to ([\d,]+) pixels, up to ([\d.]+) megapixels\.$/);
  if (dimensions) return `请使用 1 至 ${dimensions[1]} 的整数尺寸，总像素不超过 ${dimensions[2]} 百万。`;
  if (text.includes(' · ')) return text.split(' · ').map((part) => translate(part, locale)).join(' · ');
  const component = text.match(/^(\w+) (hue|saturation|luminance)$/);
  if (component && lookup.has(component[1].toLowerCase())) return translate(component[1], locale) + translate(component[2], locale);
  return text;
}
export function getLanguage() { return language; }

// Only presentation strings are translated; user content and serialized enum values stay intact.
export function installLocalization() {
  const sources = new WeakMap(), attributes = new WeakMap();
  const protectedContent = 'script, style, textarea, [contenteditable], [data-no-translate], .layer-name, .project-tab > span:first-child, #document-title';
  const applyText = (node) => {
    if (!node.parentElement || node.parentElement.closest(protectedContent)) return;
    const current = node.nodeValue, saved = sources.get(node);
    const original = saved && current === saved.output ? saved.original : current;
    const trimmed = original.trim(); if (!trimmed) return;
    if (node.parentElement.tagName === 'OPTION' && !node.parentElement.hasAttribute('value')) node.parentElement.value = node.parentElement.textContent;
    const output = original.replace(trimmed, translate(trimmed));
    sources.set(node, { original, output }); if (current !== output) node.nodeValue = output;
  };
  const applyElement = (element) => {
    if (element.closest(protectedContent) || element.matches('.layer-row')) return;
    const saved = attributes.get(element) ?? {};
    for (const name of ['title', 'aria-label', 'placeholder']) {
      const value = element.getAttribute(name); if (!value) continue;
      const original = saved[name]?.output === value ? saved[name].original : value, output = translate(original);
      saved[name] = { original, output }; if (value !== output) element.setAttribute(name, output);
    }
    attributes.set(element, saved);
  };
  const walk = (root) => {
    if (root.nodeType === Node.TEXT_NODE) { applyText(root); return; }
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    applyElement(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) { const node = walker.currentNode; if (node.nodeType === Node.TEXT_NODE) applyText(node); else applyElement(node); }
  };
  const observer = new MutationObserver((records) => {
    observer.disconnect();
    for (const record of records) {
      if (record.type === 'childList') record.addedNodes.forEach(walk);
      else if (record.type === 'characterData') applyText(record.target);
      else applyElement(record.target);
    }
    observe();
  });
  const observe = () => observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label', 'placeholder'] });
  const select = document.querySelector('#language');
  function change(value) {
    language = value === 'zh-CN' ? 'zh-CN' : 'en'; localStorage.setItem('compositor.language', language);
    document.documentElement.lang = language; select.value = language;
    observer.disconnect(); walk(document.body); observe();
    window.desktop?.setLanguage?.(language); window.dispatchEvent(new CustomEvent('languagechange', { detail: language }));
  }
  select.addEventListener('change', () => change(select.value)); change(language);
}
