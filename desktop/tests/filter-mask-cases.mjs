export function filterMaskCases(test, expect, resolvePage, restart, nativeTap) {
  const setup = (page) => page.evaluate(async () => { const { editor: e } = await import('./app.js'), { surface } = await import('./raster.js'); e.newCanvas(96, 64); const image = surface(96, 64), ctx = image.getContext('2d'); ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 96, 64); e.storePixels(e.active, image); e.selection = { x: 0, y: 0, width: 48, height: 64 }; e.update(); });
  const pixel = (page, x) => page.evaluate(async (x) => [...(await import('./app.js')).editor.composite(true).getContext('2d').getImageData(x, 20, 1, 1).data], x);
  const open = (page, command = 'editable-filter:Invert') => page.evaluate(async (command) => { window.filters = (await import('./app.js')).runCommand(command); }, command);
  const apply = async (page) => { await page.locator('.filter-stack-dialog').getByRole('button', { name: 'Apply', exact: true }).click(); await page.evaluate(() => window.filters); };
  test('filter mask: selection, independent opacity and visibility preserve the source and reopen', async () => {
    const page = resolvePage(); await setup(page); await page.evaluate(async () => { (await import('./app.js')).editor.manifest.version = 13; }); await open(page);
    await page.getByRole('button', { name: 'Use selection as filter mask', exact: true }).click();
    await expect.poll(() => pixel(page, 20)).toEqual([0, 255, 255, 255]); await expect.poll(() => pixel(page, 70)).toEqual([255, 0, 0, 255]);
    await page.getByRole('spinbutton', { name: 'Filter opacity', exact: true }).fill('50'); await page.getByRole('spinbutton', { name: 'Filter opacity', exact: true }).press('Tab'); await expect.poll(() => pixel(page, 20)).toEqual([128, 128, 128, 255]);
    await page.getByRole('checkbox', { name: 'Enable filter mask', exact: true }).uncheck(); await expect.poll(() => pixel(page, 70)).toEqual([128, 128, 128, 255]); await page.getByRole('checkbox', { name: 'Enable filter mask', exact: true }).check();
    await apply(page);
    const snapshot = await page.evaluate(async () => { const e = (await import('./app.js')).editor, snapshot = e.projectSnapshot(); await e.install(snapshot); return snapshot; }); expect(snapshot.manifest.version).toBe(15);
    expect(snapshot.assets[snapshot.manifest.layers[0].filters[0].maskFile]).toBeTruthy(); expect(await pixel(page, 70)).toEqual([255, 0, 0, 255]);
    await page.evaluate(async () => (await import('./app.js')).runCommand('undo')); expect(await pixel(page, 20)).toEqual([255, 0, 0, 255]);
  });
  test('filter mask: painted feathered masks support cancellation and Chinese phone controls', async () => {
    const page = resolvePage(); await setup(page); await open(page);
    await page.getByRole('button', { name: 'Add filter mask…', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Filter mask', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Hide all', exact: true }).click(); await page.getByRole('spinbutton', { name: 'Hardness', exact: true }).fill('100');
    const canvas = page.locator('.filter-mask-preview'); await expect(canvas).toBeVisible(); await canvas.click({ trial: true }); if (nativeTap) await nativeTap(page, async () => { const box = await canvas.boundingBox(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; }); else await canvas.click();
    await page.getByRole('spinbutton', { name: 'Feather', exact: true }).fill('2');
    await page.locator('dialog[open]').last().getByRole('button', { name: 'Apply', exact: true }).click();
    await expect.poll(async () => [await pixel(page, 5), await pixel(page, 48)]).toEqual([[255, 0, 0, 255], [0, 255, 255, 255]]);
    await page.locator('.filter-stack-dialog').getByRole('button', { name: 'Cancel', exact: true }).click(); await page.evaluate(() => window.filters); expect(await pixel(page, 48)).toEqual([255, 0, 0, 255]);
    await page.locator('#language').selectOption('zh-CN'); await open(page); await page.getByRole('button', { name: '添加滤镜蒙版…', exact: true }).click();
    await page.getByLabel('蒙版画笔', { exact: true }).selectOption('Hide'); await page.getByRole('button', { name: '全部隐藏', exact: true }).click();
    await page.locator('dialog[open]').last().getByRole('button', { name: '应用', exact: true }).click(); await expect.poll(() => pixel(page, 20)).toEqual([255, 0, 0, 255]);
    await page.locator('.filter-stack-dialog').getByRole('button', { name: '应用', exact: true }).click(); await page.evaluate(() => window.filters);
    expect(await page.evaluate(async () => !!(await import('./app.js')).editor.active.filters[0].maskFile)).toBe(true);
  });
  test('filter mask: reordering, removal and outer cancel retain mask assets atomically', async () => {
    const page = resolvePage(); await setup(page); await open(page); await page.getByRole('button', { name: 'Use selection as filter mask', exact: true }).click(); await apply(page);
    const before = await page.evaluate(async () => (await import('./app.js')).editor.projectSnapshot()); await open(page, 'edit-filters');
    await page.getByLabel('Add editable filter', { exact: true }).selectOption('Invert'); await page.getByRole('button', { name: 'Add filter', exact: true }).click(); await expect.poll(() => pixel(page, 20)).toEqual([255, 0, 0, 255]);
    await page.getByRole('button', { name: 'Move filter up', exact: true }).last().click(); await page.getByRole('button', { name: 'Remove', exact: true }).last().click();
    await page.locator('.filter-stack-dialog').getByRole('button', { name: 'Cancel', exact: true }).click(); await page.evaluate(() => window.filters); expect(await page.evaluate(async () => (await import('./app.js')).editor.projectSnapshot())).toEqual(before);
    await open(page, 'edit-filters'); await page.getByRole('button', { name: 'Remove filter mask', exact: true }).click(); await apply(page);
    expect(await page.evaluate(async (name) => (await import('./app.js')).editor.assets[name] ?? null, Object.keys(before.assets).find((name) => name.endsWith('filter-mask.png')))).toBeNull(); await page.evaluate(async () => (await import('./app.js')).runCommand('undo')); expect(await pixel(page, 70)).toEqual([255, 0, 0, 255]);
  });
  test('filter mask: duplicate, preset and action resources use fresh owned filenames', async () => {
    const page = resolvePage(); await setup(page); await open(page); await page.getByRole('button', { name: 'Use selection as filter mask', exact: true }).click(); await apply(page);
    const result = await page.evaluate(async () => {
      const { editor: e, runCommand } = await import('./app.js'), { applyActionStep } = await import('./actions.js'); const source = e.active, filter = structuredClone(source.filters[0]), asset = e.assets[filter.maskFile]; await runCommand('duplicate'); const copyName = e.active.filters[0].maskFile;
      await applyActionStep(e, { type: 'editable-filters', filters: [filter], maskAssets: { [filter.maskFile]: asset } }); const actionName = e.active.filters[0].maskFile;
      return { original: filter.maskFile, duplicate: copyName, action: actionName, value: e.assets[actionName], asset };
    }); expect(result.original).not.toBe(result.duplicate); expect(result.action).not.toBe(result.duplicate); expect(result.value).toBe(result.asset);
    await page.evaluate(async () => { window.preset = (await import('./app.js')).runCommand('save-filter-preset'); }); await page.locator('#input-value').fill('Masked'); await page.locator('#input-form').getByRole('button', { name: 'Apply', exact: true }).click(); await page.evaluate(() => window.preset);
    await page.evaluate(async () => { const { editor: e, runCommand } = await import('./app.js'); e.addLayer(); const { surface } = await import('./raster.js'); const image = surface(96, 64); image.getContext('2d').fillStyle = '#f00'; image.getContext('2d').fillRect(0, 0, 96, 64); e.storePixels(e.active, image); window.preset = runCommand('apply-filter-preset'); });
    await page.locator('dialog[open]').last().getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.locator('.filter-stack-dialog')).toBeVisible(); await apply(page); await page.evaluate(() => window.preset);
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return e.active.filters[0].maskFile.startsWith(e.active.id + '.'); })).toBe(true);
  });
  test('filter mask: 16-bit TIFF rendering keeps untouched low bits and applies the masked filter', async () => {
    const page = resolvePage();
    const result = await page.evaluate(async () => {
      const { editor: e } = await import('./app.js'), { surface } = await import('./raster.js'), { encodePNG16, encodePNGGray } = await import('./png-pixels.js'), { adjustmentDefaults } = await import('./adjustments.js'), { profileBytes } = await import('./color-engine.js'), { binaryBase64 } = await import('./psd-export.js'), { colorJob } = await import('./color-workflows.js'), { decodePrecisionFile } = await import('./precision-raster.js'), { filterMaskName } = await import('./filter-mix.js');
      e.newCanvas(2, 1); const layer = e.active, image = surface(2, 1); e.storePixels(layer, image); layer.filterSourceFile = `${layer.id}.source.png`; const profile = await profileBytes('sRGB'); e.assets[layer.filterSourceFile] = binaryBase64(await encodePNG16({ width: 2, height: 1, data: new Uint16Array([12345, 23456, 34567, 65535, 12346, 23457, 34568, 65535]), profile }));
      const id = crypto.randomUUID().toUpperCase(), maskFile = filterMaskName(layer.id, id); e.assets[maskFile] = binaryBase64(await encodePNGGray(2, 1, new Uint8Array([0, 255]))); layer.filters = [{ id, enabled: true, maskFile, maskEnabled: true, adjustment: adjustmentDefaults('Invert') }];
      const output = await colorJob({ snapshot: e.projectSnapshot(), profile, bits: 16, intent: 1, blackPoint: true, preview: false, workingSpace: 'sRGB' }); return [...(await decodePrecisionFile(output.bytes, 'Masked.tiff')).data];
    }); expect(result).toEqual([12345, 23456, 34567, 65535, 53189, 42078, 30967, 65535]);
  });
  test('filter mask: cold recovery and saved history fingerprints include the independent mask pixels', async () => {
    let page = resolvePage(); await setup(page); await open(page); await page.getByRole('button', { name: 'Use selection as filter mask', exact: true }).click(); await apply(page);
    const id = await page.evaluate(async () => { const e = (await import('./app.js')).editor; await e.recovery.flush(); return e.workspace.id; });
    if (restart) page = await restart(); else { page.once('dialog', (dialog) => dialog.accept()); await page.reload(); }
    await expect(page.locator('html')).toHaveAttribute('data-editor-ready', 'true'); await page.evaluate(async (id) => (await import('./app.js')).editor.recovery.recover(id), id); expect(await pixel(page, 70)).toEqual([255, 0, 0, 255]);
    const result = await page.evaluate(async () => { const e = (await import('./app.js')).editor, { projectFingerprint } = await import('./saved-history.js'), { encodePNGGray } = await import('./png-pixels.js'), { binaryBase64 } = await import('./psd-export.js'); const snapshot = e.projectSnapshot(), first = await projectFingerprint(snapshot), name = e.active.filters[0].maskFile; snapshot.assets[name] = binaryBase64(await encodePNGGray(1, 1, new Uint8Array([0]))); return { changed: first !== await projectFingerprint(snapshot), undo: e.history.past.length }; }); expect(result.changed).toBe(true); expect(result.undo).toBe(1);
    await page.evaluate(async () => (await import('./app.js')).runCommand('undo')); expect(await pixel(page, 20)).toEqual([255, 0, 0, 255]);
  });
}
