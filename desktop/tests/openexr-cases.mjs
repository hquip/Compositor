import { FORMAT_VERSION } from '../renderer/core.js';
import fs from 'node:fs/promises';

const fixture = (name) => fs.readFile(new URL('./fixtures/openexr/' + name, import.meta.url));
export function openEXRCases(test, expect, resolvePage) {
  test('OpenEXR: import dialog retains display-window placement, float source and project round trip', async () => {
    const page = resolvePage(), bytes = [...await fixture('rgba-32-zip.exr')];
    await page.evaluate(async (bytes) => { const { editor: e } = await import('./app.js'); window.exrOperation = (await import('./hdr-workflows.js')).importHDRFile(e, new Uint8Array(bytes), 'Reference EXR'); }, bytes);
    const dialog = page.locator('dialog[open]').last(); await expect(dialog.getByRole('heading')).toHaveText('Import OpenEXR'); await dialog.getByRole('button', { name: 'Apply', exact: true }).click(); await page.evaluate(() => window.exrOperation);
    const result = await page.evaluate(async () => { const { editor: e } = await import('./app.js'), { decodeFloatTIFF } = await import('./vendor/float-tiff.js'), { base64Bytes } = await import('./precision-raster.js'); const snapshot = e.projectSnapshot(); await e.install(snapshot); const raw = decodeFloatTIFF(base64Bytes(e.assets[e.active.hdrSourceFile])); return { size: [e.manifest.width, e.manifest.height], origin: e.active.transform.origin, samples: [...raw.data.slice(4, 8)], version: snapshot.manifest.version, filtered: e.images.get(e.active.id).compositorHDR.data[4] }; });
    expect(result).toEqual({ size: [9, 23], origin: [2, 2], samples: [5, .125, -.125, .5], version: FORMAT_VERSION, filtered: 5 });
  });
  test('OpenEXR: named ACEScg pass import honors data bounds and leaves originals protected', async () => {
    const page = resolvePage(); await page.evaluate(async (bytes) => { const { editor: e } = await import('./app.js'); window.exrOperation = (await import('./hdr-workflows.js')).importHDRFile(e, new Uint8Array(bytes), 'ACES beauty'); }, [...await fixture('beauty-acescg.exr')]);
    const dialog = page.locator('dialog[open]').last(); await expect(dialog.locator('[data-setting="group"]')).toHaveValue('1 · beauty'); await dialog.locator('[data-setting="window"]').selectOption('Data window'); await dialog.getByRole('button', { name: 'Apply', exact: true }).click(); await page.evaluate(() => window.exrOperation);
    const result = await page.evaluate(async () => { const { editor: e } = await import('./app.js'); return { width: e.manifest.width, intensity: e.images.get(e.active.id).compositorHDR.data[4], protected: !!e.active.hdrSourceFile }; }); expect(result.width).toBe(5); expect(result.intensity).toBe(5); expect(result.protected).toBe(true);
  });
  test('OpenEXR: export worker ignores preview tone mapping and preserves source during color conversion', async () => {
    const page = resolvePage(); const result = await page.evaluate(async () => {
      const { editor: e } = await import('./app.js'), { importHDRSource } = await import('./hdr-workflows.js'), { composeHDRCanvas } = await import('./hdr-layer.js'), { hdrIO } = await import('./hdr-io.js'), { decodeOpenEXR } = await import('./openexr.js');
      e.newCanvas(2, 1); await importHDRSource(e, { width: 2, height: 1, data: new Float32Array([4, .25, -.125, 1, 8, 1, 2, .5]) }); const before = e.assets[e.active.hdrSourceFile]; e.manifest.hdrView = { exposure: 5, toneMap: 'Clip' }; e.update();
      const raw = composeHDRCanvas(e.manifest, e.images, e.masks, 1, true), bytes = await hdrIO({ action: 'encode-exr', source: raw, options: { space: 'ACEScg', bits: 32, compression: 'ZIP' } });
      return { pixels: [...decodeOpenEXR(bytes).data], same: before === e.assets[e.active.hdrSourceFile], highlight: e.images.get(e.active.id).compositorHDR.data[0] };
    }); expect(result.same).toBe(true); expect(result.highlight).toBe(4); [4, .25, -.125, 1, 8, 1, 2, .5].forEach((value, i) => expect(result.pixels[i]).toBeCloseTo(value, 5));
  });
  test('OpenEXR: canceled and invalid imports leave documents unchanged and dialogs translate', async () => {
    const page = resolvePage(); await page.locator('#language').selectOption('zh-CN');
    await page.evaluate(async (bytes) => { const { editor: e } = await import('./app.js'); window.exrOperation = (await import('./hdr-workflows.js')).importHDRFile(e, new Uint8Array(bytes), 'Unknown'); }, [...await fixture('untagged.exr')]);
    const dialog = page.locator('dialog[open]').last(); await expect(dialog.getByRole('heading')).toHaveText('导入 OpenEXR'); await expect(dialog.getByLabel('输入色彩空间')).toHaveValue('Linear sRGB'); await dialog.getByRole('button', { name: '取消', exact: true }).click(); expect(await page.evaluate(() => window.exrOperation)).toBe(false);
    expect(await page.evaluate(async () => (await import('./app.js')).editor.manifest)).toBeNull(); await page.locator('#language').selectOption('en');
    const result = await page.evaluate(async (bytes) => { const { editor: e } = await import('./app.js'); try { await (await import('./hdr-workflows.js')).importHDRFile(e, new Uint8Array(bytes), 'Bad'); } catch (error) { return error.message; } }, [...await fixture('piz.exr')].slice(0, 20)); expect(result).toContain('OpenEXR');
  });
}
