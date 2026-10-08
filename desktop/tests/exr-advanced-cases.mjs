import { FORMAT_VERSION } from '../renderer/core.js';
import fs from 'node:fs/promises';
const fixture = async (name) => [...await fs.readFile(new URL('./fixtures/openexr/' + name, import.meta.url))];
export function advancedEXRCases(test, expect, resolvePage) {
  const begin = async (page, name) => page.evaluate(async (bytes) => { const { editor: e } = await import('./app.js'); window.exrAdvanced = (await import('./hdr-workflows.js')).importHDRFile(e, new Uint8Array(bytes), 'Advanced EXR'); }, await fixture(name));
  const apply = async (page) => { await page.locator('dialog[open]').last().getByRole('button', { name: 'Apply', exact: true }).click(); await page.evaluate(() => window.exrAdvanced); };
  test('EXR advanced: PIZ tiled source and selected working space survive project reopening', async () => {
    const page = resolvePage(); await begin(page, 'tiled-piz.exr'); await page.locator('[data-setting="workingSpace"]').selectOption('ACEScg'); await apply(page);
    const result = await page.evaluate(async () => { const { editor: e } = await import('./app.js'); const before = e.assets[e.active.exrSourceFile], pixels = [...e.images.get(e.active.id).compositorHDRSource.data]; await e.install(e.projectSnapshot()); return { same: before === e.assets[e.active.exrSourceFile], pixels, reopened: [...e.images.get(e.active.id).compositorHDRSource.data], space: e.manifest.hdrWorkingSpace, version: e.manifest.version }; }); expect(result.same).toBe(true); expect(result.reopened).toEqual(result.pixels); expect(result.space).toBe('ACEScg'); expect(result.version).toBe(FORMAT_VERSION);
  });
  test('EXR advanced: multipart import shares its original and deleting one part keeps the remaining source', async () => {
    const page = resolvePage(); await begin(page, 'multipart.exr'); await page.locator('[data-setting="parts"]').selectOption('All image parts'); await apply(page);
    const before = await page.evaluate(async () => { const { editor: e } = await import('./app.js'); const layers = e.manifest.layers.filter((l) => l.exrSourceFile); return { count: layers.length, files: layers.map((l) => l.exrSourceFile), intensities: layers.map((l) => e.images.get(l.id).compositorHDRSource.data[4]) }; }); expect(before.count).toBe(2); expect(before.files[0]).toBe(before.files[1]); expect(before.intensities).toEqual([5, 10]);
    await page.evaluate(async () => (await import('./app.js')).runCommand('delete'));
    const after = await page.evaluate(async () => { const { editor: e } = await import('./app.js'); await e.install(e.projectSnapshot()); const layer = e.manifest.layers.find((l) => l.exrSourceFile); return !!e.assets[layer.exrSourceFile]; }); expect(after).toBe(true);
  });
  test('EXR advanced: Deep range updates are undoable and leave all original samples untouched', async () => {
    const page = resolvePage(); await begin(page, 'deep-tiled.exr'); await apply(page);
    const original = await page.evaluate(async () => { const { editor: e, runCommand } = await import('./app.js'); window.exrAdvanced = runCommand('deep-exr-preview'); return e.assets[e.active.exrSourceFile]; });
    const dialog = page.locator('dialog[open]').last(); await dialog.getByRole('checkbox', { name: 'Limit deep depth range' }).check(); await dialog.getByRole('spinbutton', { name: 'Near depth', exact: true }).fill('1.5'); await dialog.getByRole('spinbutton', { name: 'Far depth', exact: true }).fill('3'); await apply(page);
    const result = await page.evaluate(async () => { const { editor: e, runCommand } = await import('./app.js'); const source = e.assets[e.active.exrSourceFile], pixel = [...e.images.get(e.active.id).compositorHDRSource.data.slice(4, 8)]; await runCommand('undo'); return { source, pixel, restored: e.images.get(e.active.id).compositorHDRSource.data[4], range: e.active.exrView.depthRange ?? null }; }); expect(result.source).toBe(original); expect(result.pixel).toEqual([8, 0, 2, .5]); expect(result.restored).toBe(4); expect(result.range).toBeNull();
  });
  test('EXR advanced: working-space changes retain sources and output converts to the chosen space', async () => {
    const page = resolvePage(); await begin(page, 'tiled-piz.exr'); await apply(page);
    await page.evaluate(async () => { const { runCommand } = await import('./app.js'); window.exrAdvanced = runCommand('hdr-working-space'); }); await page.locator('[data-setting="space"]').selectOption('Linear Rec.2020'); await apply(page);
    const result = await page.evaluate(async () => { const { editor: e } = await import('./app.js'), { composeHDRCanvas } = await import('./hdr-layer.js'), { convertHDRColor } = await import('./hdr-color.js'); const raw = composeHDRCanvas(e.manifest, e.images, e.masks, 1, true); return { space: raw.linearSpace, pixels: [...convertHDRColor(raw, raw.linearSpace).data.slice(4, 8)] }; }); expect(result.space).toBe('Linear Rec.2020'); result.pixels.forEach((value, i) => expect(value).toBeCloseTo([5, .125, -.125, .5][i], 4));
  });
  test('EXR advanced: HDR display settings translate and unsupported displays use the SDR preview', async () => {
    const page = resolvePage(); await begin(page, 'tiled-piz.exr'); await apply(page); await page.locator('#language').selectOption('zh-CN');
    await page.evaluate(async () => { window.exrAdvanced = (await import('./app.js')).runCommand('hdr-view'); }); const dialog = page.locator('dialog[open]').last(); await expect(dialog.getByLabel('显示输出')).toBeVisible(); await dialog.getByLabel('显示输出').selectOption('SDR'); await dialog.getByRole('button', { name: '应用', exact: true }).click(); await page.evaluate(() => window.exrAdvanced);
    expect(await page.evaluate(async () => (await import('./app.js')).editor.hdrDisplay.active)).toBe(false); await expect(page.locator('.hdr-display')).toBeHidden(); await page.locator('#language').selectOption('en');
  });
  test('EXR advanced: HDR shader writes values above one into a real float16 GPU target', async () => {
    const page = resolvePage(); const result = await page.evaluate(async () => {
      const adapter = await navigator.gpu?.requestAdapter(); if (!adapter) return { available: false };
      const device = await adapter.requestDevice(), { HDR_SHADER } = await import('./hdr-display.js'), { halfToFloat } = await import('./openexr.js'); device.pushErrorScope('validation');
      const input = device.createTexture({ size: [1, 1], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST }); device.queue.writeTexture({ texture: input }, new Float32Array([4, 2, 1, 1]), { bytesPerRow: 16 }, [1, 1]);
      const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] }), shader = device.createShaderModule({ code: HDR_SHADER });
      const pipeline = await device.createRenderPipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), vertex: { module: shader, entryPoint: 'vertex' }, fragment: { module: shader, entryPoint: 'fragment', targets: [{ format: 'rgba16float' }] } });
      const uniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(uniform, 0, new Float32Array([1, 1, 0, 0]));
      const bind = device.createBindGroup({ layout, entries: [{ binding: 0, resource: input.createView() }, { binding: 1, resource: { buffer: uniform } }] }), output = device.createTexture({ size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC }), read = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }), encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: output.createView(), loadOp: 'clear', storeOp: 'store' }] }); pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(3); pass.end(); encoder.copyTextureToBuffer({ texture: output }, { buffer: read, bytesPerRow: 256 }, [1, 1]); device.queue.submit([encoder.finish()]); await read.mapAsync(GPUMapMode.READ);
      const pixels = [...new Uint16Array(read.getMappedRange(), 0, 4)].map(halfToFloat), error = await device.popErrorScope(); read.unmap(); device.destroy(); return { available: true, pixels, error: error?.message ?? null };
    });
    test.skip(!result.available, 'This browser does not expose a WebGPU adapter.'); expect(result.error).toBeNull(); expect(result.pixels[0]).toBeGreaterThan(1); expect(result.pixels[0]).toBeCloseTo(1.8248, 2); expect(result.pixels[3]).toBe(1);
  });
}
