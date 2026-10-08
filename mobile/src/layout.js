import { icon } from './icons.js';
import { settingsDialog, numberField } from './settings-dialog.js';

export function installMobileLayout(editor, menu) {
  const makeButton = (name, glyph) => {
    const button = document.createElement('button'); button.type = 'button'; button.setAttribute('aria-label', name); button.append(icon(glyph, 21));
    const text = document.createElement('span'); text.textContent = name; button.append(text); return button;
  };
  function sheet(name, className) {
    const dialog = document.createElement('dialog'); dialog.className = `mobile-sheet ${className}`;
    const heading = document.createElement('header'); heading.className = 'mobile-sheet-heading';
    const title = document.createElement('h2'); title.textContent = name;
    const close = makeButton('Close panel', 'close'); close.className = 'mobile-sheet-close'; close.addEventListener('click', () => dialog.close());
    heading.append(title, close); dialog.append(heading); document.body.append(dialog);
    dialog.addEventListener('click', (event) => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
    let start;
    heading.addEventListener('pointerdown', (event) => { if (!event.target.closest('button')) { start = event.clientY; heading.setPointerCapture(event.pointerId); } });
    heading.addEventListener('pointerup', (event) => { if (start != null && event.clientY - start > 60) dialog.close(); start = null; });
    return dialog;
  }
  const openSheet = (dialog) => { if (editor.busy) return; if (editor.gesture) editor.cancelGesture(); if (editor.inlineText?.finish(true) === false) return; dialog.showModal(); };
  const commandSheet = sheet('Menu', 'mobile-command-sheet'); commandSheet.append(menu);
  menu.prepend(menu.querySelector('[data-category="file"]'));
  menu.addEventListener('click', (event) => { if (event.target.closest('button')) commandSheet.close(); }, true);
  const commandBar = document.createElement('div'); commandBar.className = 'mobile-command-bar';
  const commands = makeButton('Menu', 'menu'); commands.id = 'mobile-menu'; commands.addEventListener('click', () => {
    menu.querySelectorAll('details').forEach((details) => { details.open = details.dataset.category === 'file'; }); openSheet(commandSheet);
  });
  const layers = makeButton('Layers', 'layer'); layers.id = 'mobile-layers';
  commandBar.append(commands, document.querySelector('.history-actions'), layers); document.querySelector('.app-bar').after(commandBar);

  const inspectorSheet = sheet('Layers and properties', 'mobile-inspector-sheet');
  const inspector = document.querySelector('.inspector'), properties = inspector.querySelector('.properties-panel'), layerPanel = inspector.querySelector('.layers-panel');
  const tabs = document.createElement('div'); tabs.className = 'mobile-inspector-tabs'; tabs.setAttribute('role', 'tablist');
  const layerTab = document.createElement('button'), propertiesTab = document.createElement('button');
  layerTab.textContent = 'Layers'; propertiesTab.textContent = 'Properties';
  for (const tab of [layerTab, propertiesTab]) { tab.setAttribute('role', 'tab'); tabs.append(tab); }
  const selectTab = (selected) => { const showLayers = selected === layerTab; properties.hidden = showLayers; layerPanel.hidden = !showLayers; layerTab.setAttribute('aria-selected', String(showLayers)); propertiesTab.setAttribute('aria-selected', String(!showLayers)); };
  layerTab.addEventListener('click', () => selectTab(layerTab)); propertiesTab.addEventListener('click', () => selectTab(propertiesTab));
  inspectorSheet.append(tabs, inspector); selectTab(layerTab);
  layers.addEventListener('click', () => openSheet(inspectorSheet));
  inspector.addEventListener('click', (event) => { if (event.target.closest('[data-command]')) inspectorSheet.close(); }, true);
  inspector.addEventListener('dblclick', (event) => { if (event.target.closest('.layer-row')) inspectorSheet.close(); }, true);

  const toolSheet = sheet('All tools', 'mobile-tools-sheet'), grid = document.createElement('div'); grid.className = 'mobile-tool-grid'; toolSheet.append(grid);
  const names = { path: 'Pen / Path', move: 'Move / Transform', brush: 'Brush', eraser: 'Eraser', marquee: 'Rectangle selection', shape: 'Shape', text: 'Type', eyedropper: 'Eyedropper', hand: 'Hand', ellipse: 'Ellipse selection', lasso: 'Lasso', polygon: 'Polygonal lasso', wand: 'Magic wand', object: 'Object selection', clone: 'Clone stamp', heal: 'Spot healing', blur: 'Blur / Smudge / Liquify', gradient: 'Gradient', crop: 'Crop' };
  const rail = document.querySelector('.tool-rail'); rail.classList.add('mobile-tool-dock'); document.body.append(rail);
  for (const original of rail.querySelectorAll('[data-tool]')) {
    const key = original.dataset.tool, button = document.createElement('button'); button.className = 'mobile-tool-option'; button.dataset.toolTarget = key;
    button.append(original.querySelector('svg').cloneNode(true)); const label = document.createElement('span'); label.textContent = names[key] ?? key; button.append(label);
    button.addEventListener('click', () => { toolSheet.close(); original.click(); }); grid.append(button);
    original.dataset.mobilePrimary = String(['move', 'brush', 'eraser', 'marquee', 'text'].includes(key));
    original.title = names[key] ?? original.title;
  }
  const allTools = makeButton('All tools', 'more'); allTools.id = 'mobile-all-tools'; allTools.addEventListener('click', () => openSheet(toolSheet));
  const color = document.querySelector('#paint-color'), swatch = document.createElement('label'); swatch.className = 'mobile-color-swatch'; swatch.title = 'Foreground color'; swatch.append(color); rail.append(allTools, swatch);
  const refreshColor = () => { swatch.style.backgroundColor = editor.color; }; color.addEventListener('input', refreshColor);
  const changed = editor.onChange; editor.onChange = () => { changed(); refreshColor(); }; refreshColor();
  document.querySelector('.tool-options').classList.add('mobile-options');
  const settings = document.querySelector('.tool-settings'); settings.textContent = 'Settings';
  settings.addEventListener('click', async (event) => {
    if (editor.tool === 'move') {
      event.stopImmediatePropagation();
      const modes = editor.active?.isGroup || editor.selectedIDs?.size > 1 ? ['Move / Resize', 'Rotate'] : ['Move / Resize', 'Rotate', 'Free Distort'];
      const selected = await settingsDialog('Transform', [{ key: 'mode', label: 'Mode', options: modes, default: 'Move / Resize' }, { key: 'lockAspect', label: 'Lock aspect ratio', type: 'checkbox', default: false }], { mode: editor.transformHandleMode ?? 'Move / Resize', lockAspect: editor.lockTransformAspect ?? false });
      if (selected) { editor.transformHandleMode = selected.mode; editor.lockTransformAspect = selected.lockAspect; } return;
    }
    if (!['brush', 'eraser'].includes(editor.tool)) return;
    event.stopImmediatePropagation();
    const selected = await settingsDialog('Brush settings', [numberField('size', 'Size', 1, 1000, 40), numberField('hardness', 'Hardness', 0, 100, 80), numberField('opacity', 'Opacity', 1, 100, 100), numberField('smoothing', 'Smoothing', 0, 100, 0)], { size: editor.brushSize, hardness: editor.brushHardness * 100, opacity: editor.brushOpacity * 100, smoothing: editor.toolSettings.smoothing });
    if (selected) { editor.brushSize = selected.size; editor.brushHardness = selected.hardness / 100; editor.brushOpacity = selected.opacity / 100; editor.toolSettings.smoothing = selected.smoothing; document.querySelector('#brush-size').value = selected.size; document.querySelector('#brush-hardness').value = selected.hardness; document.querySelector('#brush-opacity').value = selected.opacity; }
  }, true);
  const selectionMode = document.createElement('select'); selectionMode.id = 'mobile-selection-mode'; selectionMode.setAttribute('aria-label', 'Selection mode');
  for (const [value, title] of [['replace', 'New selection'], ['add', 'Add to selection'], ['subtract', 'Subtract from selection'], ['intersect', 'Intersect selection']]) { const option = document.createElement('option'); option.value = value; option.textContent = title; selectionMode.append(option); }
  selectionMode.addEventListener('change', () => { editor.selectionMode = selectionMode.value; }); settings.before(selectionMode);
  const sourceButton = makeButton('Choose source', 'eyedropper'); sourceButton.id = 'mobile-clone-source'; let choosingSource = false;
  sourceButton.addEventListener('click', () => { choosingSource = !choosingSource; editor.draw(); }); settings.before(sourceButton);
  const finishPolygon = document.createElement('button'); finishPolygon.id = 'mobile-finish-polygon'; finishPolygon.textContent = 'Finish selection'; finishPolygon.addEventListener('click', () => editor.finishPolygonSelection()); settings.before(finishPolygon);
  const down = editor.pointerDown.bind(editor);
  editor.pointerDown = (event) => {
    if (choosingSource && editor.tool === 'clone' && editor.manifest && !editor.busy && !document.querySelector('dialog[open]')) { editor.cloneSource = editor.toDocument(editor.viewPoint(event)); editor.cloneOffset = null; choosingSource = false; editor.draw(); return; }
    down(event);
  };
  const refreshControls = () => {
    selectionMode.hidden = !['marquee', 'ellipse', 'lasso', 'polygon', 'wand', 'object'].includes(editor.tool);
    sourceButton.hidden = editor.tool !== 'clone'; if (sourceButton.hidden) choosingSource = false;
    sourceButton.setAttribute('aria-pressed', String(choosingSource));
    if (sourceButton.dataset.armed !== String(choosingSource)) { sourceButton.dataset.armed = String(choosingSource); sourceButton.lastElementChild.textContent = choosingSource ? 'Tap a source point' : 'Choose source'; }
    finishPolygon.hidden = editor.tool !== 'polygon'; finishPolygon.disabled = (editor.polygon?.points.length ?? 0) < 3;
  };
  const draw = editor.draw.bind(editor); editor.draw = () => { refreshControls(); draw(); }; refreshControls();
  const hint = document.createElement('span'); hint.className = 'mobile-gesture-hint'; hint.textContent = 'Two fingers to pan and zoom'; document.querySelector('.status-bar').append(hint);
  const viewportChanged = () => {
    const height = window.visualViewport?.height ?? innerHeight;
    document.body.style.setProperty('--visible-height', `${height}px`);
    document.body.style.setProperty('--keyboard-inset', `${Math.max(0, innerHeight - height - (window.visualViewport?.offsetTop ?? 0))}px`);
    document.body.classList.toggle('keyboard-open', innerHeight - height > 140);
  };
  window.visualViewport?.addEventListener('resize', viewportChanged); window.addEventListener('resize', viewportChanged); viewportChanged();
  return { close() { const open = document.querySelector('.mobile-sheet[open]'); if (open) { open.close(); return true; } return false; } };
}
