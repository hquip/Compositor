import { createLayer } from './core.js';
import { settingsDialog, numberField, boolField } from './settings-dialog.js';
import { pickFile } from './color-workflows.js';
import { parseCube } from './lut.js';
import { addResource, resourceText, retainResources } from './workflow-assets.js';
import { library } from './library-store.js';
import { ADJUSTMENT_KINDS, adjustmentDefaults } from './adjustments.js';
import { adjustmentFields, cameraRawFields } from './adjustment-controls.js';
import { FINISHING, finishingFields } from './finishing.js';

function liveLayer(editor, name, workflow) {
  const layer = createLayer(name, editor.manifest.width, editor.manifest.height); layer.workflow = workflow; layer.parentID = editor.active?.parentID;
  editor.manifest.layers.push(layer); editor.manifest.activeLayerID = layer.id; return layer;
}
export function installProfessionalWorkflows(editor, api) {
  const previous = editor.advancedCommand;
  editor.advancedCommand = async (command) => {
    if (command === 'import-lut') {
      if (!editor.manifest) throw new Error('Create or open an image before importing a LUT.');
      const file = await pickFile('.cube'); if (!file) return true; if (file.size > 32 * 1024 * 1024) throw new Error('The LUT exceeds the supported size.');
      const text = await file.text(), table = parseCube(text);
      editor.mutate('Import LUT', () => liveLayer(editor, table.title === 'LUT' ? file.name : table.title, { type: 'lut', file: addResource(editor, new TextEncoder().encode(text), 'lookup') }));
      await library.put({ id: 'lut:' + file.name, type: 'lut', name: file.name }, { text }); return true;
    }
    if (command === 'edit-live-layer') {
      const layer = editor.active, workflow = layer?.workflow; if (!workflow || !['lut', 'live-filter'].includes(workflow.type)) return true;
      if (workflow.type === 'lut') {
        parseCube(resourceText(editor.assets, workflow.file));
        const value = await settingsDialog('LUT layer', [numberField('opacity', 'Strength', 0, 100, 100), boolField('visible', 'Visible', true)], { opacity: (layer.opacity ?? 1) * 100, visible: layer.isVisible });
        if (value) editor.mutate('LUT layer', () => { layer.opacity = value.opacity / 100; layer.isVisible = value.visible; });
      } else if (workflow.transform) {
        const fields = workflow.transform.flatMap(([x, y], i) => [numberField(`points.${i}.0`, 'Corner ' + (i + 1) + ' X', -4, 4, x, .01), numberField(`points.${i}.1`, 'Corner ' + (i + 1) + ' Y', -4, 4, y, .01)]);
        const value = await settingsDialog('Live transform', fields, { points: workflow.transform }); if (value) editor.mutate('Live transform', () => { workflow.transform = value.points; });
      } else if (workflow.cameraRaw) {
        const value = await settingsDialog('Camera Raw', cameraRawFields(editor.composite(true)), workflow.cameraRaw); if (value) editor.mutate('Live Camera Raw', () => { workflow.cameraRaw = value; });
      } else if (workflow.finishing) {
        const value = await settingsDialog(workflow.finishing.kind, finishingFields(workflow.finishing.kind), workflow.finishing.settings); if (value) editor.mutate('Live filter', () => { workflow.finishing.settings = value; });
      } else {
        const value = await settingsDialog(workflow.adjustment.kind, adjustmentFields(workflow.adjustment.kind), workflow.adjustment); if (value) editor.mutate('Live filter', () => { workflow.adjustment = value; });
      } return true;
    }
    if (command.startsWith('live-filter:')) {
      if (!editor.manifest) return true; const kind = command.slice(12);
      if (kind === 'Transform') editor.mutate('Live transform', () => liveLayer(editor, 'Live transform', { type: 'live-filter', transform: [[0, 0], [1, 0], [1, 1], [0, 1]] }));
      else if (kind === 'Camera Raw') { const value = await settingsDialog('Camera Raw', cameraRawFields(editor.composite(true)), {}); if (value) editor.mutate('Live Camera Raw', () => liveLayer(editor, kind, { type: 'live-filter', cameraRaw: value })); }
      else if (FINISHING.includes(kind)) { const value = await settingsDialog(kind, finishingFields(kind), {}); if (value) editor.mutate('Live filter', () => liveLayer(editor, kind, { type: 'live-filter', finishing: { kind, settings: value } })); }
      else if (ADJUSTMENT_KINDS.includes(kind)) {
        const value = await settingsDialog(kind, adjustmentFields(kind), adjustmentDefaults(kind)); if (value) editor.mutate('Live filter', () => liveLayer(editor, kind, { type: 'live-filter', adjustment: value }));
      } return true;
    }
    if (command === 'save-adjustment-preset') {
      const layers = editor.manifest?.layers.filter((layer) => layer.adjustment || ['lut', 'live-filter'].includes(layer.workflow?.type)); if (!layers?.length) throw new Error('Add adjustment layers before saving a preset.');
      const name = await api.askInput('Save adjustment preset', 'Name', 'My grade'); if (!name?.trim()) return true;
      await library.put({ id: 'grade:' + name.trim(), type: 'adjustment-preset', name: name.trim() }, { manifest: { layers: structuredClone(layers), resources: structuredClone(editor.manifest.resources ?? []) }, assets: { ...editor.assets } }); return true;
    }
    if (command === 'apply-adjustment-preset') {
      const items = await library.list('adjustment-preset'); if (!items.length) throw new Error('No adjustment presets have been saved.');
      const value = await settingsDialog('Apply adjustment preset', [{ key: 'name', label: 'Preset', options: items.map((item) => item.name), default: items[0].name }], {}); if (!value) return true;
      const preset = await library.get(items.find((item) => item.name === value.name).id);
      editor.mutate('Apply adjustment preset', () => {
        retainResources(editor, preset); let last;
        for (const source of preset.manifest.layers) {
          const layer = structuredClone(source), id = crypto.randomUUID().toUpperCase(); layer.id = id; delete layer.parentID; delete layer.maskSourceID;
          if (source.maskFile) { layer.maskFile = `${id}.mask.png`; editor.assets[layer.maskFile] = preset.assets[source.maskFile]; }
          layer.transform = createLayer('', editor.manifest.width, editor.manifest.height).transform; editor.manifest.layers.push(layer); last = id;
        }
        editor.manifest.activeLayerID = last;
      }); await editor.install(editor.snapshot()); return true;
    }
    if (command === 'layer-fill') {
      if (!editor.active) return true; const value = await settingsDialog('Layer Fill', [numberField('fill', 'Fill opacity', 0, 100, 100)], { fill: (editor.active.fillOpacity ?? 1) * 100 });
      if (value) editor.mutate('Layer Fill', () => { editor.active.fillOpacity = value.fill / 100; }); return true;
    }
    return previous(command);
  };
}
