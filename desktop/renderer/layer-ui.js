export function installLayerUI(editor, api) {
  const list = document.querySelector('#layer-list'); let menu;
  function dismiss() { menu?.remove(); menu = null; }
  list.addEventListener('contextmenu', (event) => {
    const row = event.target.closest('.layer-row'); if (!row) return; event.preventDefault(); editor.select(row.dataset.layerId); dismiss();
    menu = document.createElement('div'); menu.className = 'layer-context-menu'; menu.setAttribute('role', 'menu');
    const entries = [['Rename', 'rename'], ['Duplicate', 'duplicate'], ['Delete', 'delete-layer'], ['Group selected', 'group'], ['Ungroup', 'ungroup'], ['Merge down', 'merge-down'], ['Add mask', 'mask:Add Mask'], ['Edit mask', 'edit-mask'], ['Edit image', 'edit-image'], ['Create clipping mask', 'clip'], ['Release clipping mask', 'unclip'], ['Layer effects…', 'effect:shadow']];
    for (const [label, command] of entries) { const button = document.createElement('button'); button.textContent = label; button.setAttribute('role', 'menuitem'); button.addEventListener('click', () => { dismiss(); api.runCommand(command); }); menu.append(button); }
    Object.assign(menu.style, { left: `${Math.min(event.clientX, window.innerWidth - 212)}px`, top: `${Math.min(event.clientY, window.innerHeight - 380)}px` }); document.body.append(menu);
  });
  document.addEventListener('pointerdown', (event) => { if (menu && !menu.contains(event.target)) dismiss(); });
  const previous = editor.advancedCommand;
  editor.advancedCommand = async (command) => {
    if (command !== 'rename' || !editor.active) return await previous(command);
    const id = editor.active.id, row = [...list.querySelectorAll('.layer-row')].find((node) => node.dataset.layerId === id), label = row?.querySelector('.layer-name'); if (!label) return true;
    const input = document.createElement('input'); input.className = 'layer-rename'; input.value = editor.active.name; input.maxLength = 200; input.setAttribute('aria-label', 'Layer name'); label.replaceWith(input); input.focus(); input.select(); let finished = false;
    const finish = (commit) => { if (finished) return; finished = true; const name = input.value.trim(); if (commit && name) editor.mutate('Rename Layer', () => { const layer = editor.manifest.layers.find((item) => item.id === id); if (layer) layer.name = name; }); else editor.update(false); };
    input.addEventListener('blur', () => finish(true)); input.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(event.key === 'Enter'); editor.viewport.focus(); } }); return true;
  };
}
