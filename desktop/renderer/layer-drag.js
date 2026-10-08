import { descendants, selected, cloneLayers, boundsOf } from './layer-operations.js';
import { adoptClipping, releaseDetachedClipping } from './clipping.js';

export function installLayerDrag(editor, api) {
  editor.collapsedGroups = new Set();
  const list = document.querySelector('#layer-list');
  list.addEventListener('dragstart', (event) => {
    const row = event.target.closest('.layer-row'); if (!row || editor.busy) return;
    if (!editor.selectedIDs.has(row.dataset.layerId)) { editor.selectedIDs = new Set([row.dataset.layerId]); editor.manifest.activeLayerID = row.dataset.layerId; }
    const id = crypto.randomUUID(), snapshot = { manifest: structuredClone(editor.manifest), assets: { ...editor.assets }, images: new Map(editor.images), masks: new Map(editor.masks) };
    editor.layerDrag = { id, sourceSession: editor.workspace.id, ids: new Set(selected(editor)), snapshot }; event.dataTransfer.setData('application/x-compositor-layers', id); event.dataTransfer.effectAllowed = 'copyMove';
  });
  list.addEventListener('dragover', (event) => { if (event.dataTransfer.types.includes('application/x-compositor-layers')) event.preventDefault(); });
  list.addEventListener('drop', (event) => {
    const drag = editor.layerDrag, row = event.target.closest('.layer-row');
    if (!drag || !row || event.dataTransfer.getData('application/x-compositor-layers') !== drag.id) return; event.preventDefault();
    if (drag.sourceSession !== editor.workspace.id) { editor.mutate('Copy Layers Between Projects', () => cloneLayers(editor, drag.ids, drag.snapshot)); return; }
    const ids = descendants(editor, drag.ids), target = editor.manifest.layers.find((layer) => layer.id === row.dataset.layerId); if (!target || ids.has(target.id)) return;
    editor.mutate('Move Layers', () => {
      const rect = row.getBoundingClientRect(), into = target.isGroup && event.clientY > rect.top + rect.height * .25 && event.clientY < rect.bottom - rect.height * .25;
      const moved = editor.manifest.layers.filter((layer) => ids.has(layer.id)); editor.manifest.layers = editor.manifest.layers.filter((layer) => !ids.has(layer.id));
      for (const layer of moved) if (!ids.has(layer.parentID)) layer.parentID = into ? target.id : target.parentID;
      const index = editor.manifest.layers.indexOf(target) + (event.clientY < rect.top + rect.height / 2 ? 1 : 0); editor.manifest.layers.splice(index, 0, ...moved);
      for (const layer of moved) adoptClipping(layer.id, editor.manifest.layers);
      releaseDetachedClipping(editor.manifest.layers);
      if (into) editor.collapsedGroups.delete(target.id);
    });
  });
  editor.viewport.addEventListener('drop', (event) => {
    const drag = editor.layerDrag; if (!drag || event.dataTransfer.getData('application/x-compositor-layers') !== drag.id) return;
    event.preventDefault(); event.stopImmediatePropagation(); document.querySelector('#drop-indicator').hidden = true;
    if (drag.sourceSession !== editor.workspace.id || event.ctrlKey) editor.mutate('Copy Layers', () => cloneLayers(editor, drag.ids, drag.snapshot));
    const point = editor.toDocument(editor.viewPoint(event)); editor.mutate('Place Layers', () => {
      const ids = descendants(editor, selected(editor)), layers = editor.manifest.layers.filter((layer) => ids.has(layer.id)), bounds = boundsOf(layers.filter((layer) => !layer.isGroup));
      const dx = point.x - bounds.x - bounds.width / 2, dy = point.y - bounds.y - bounds.height / 2;
      for (const layer of layers) { layer.transform.origin[0] += dx; layer.transform.origin[1] += dy; }
    });
  }, true);
}
