export function upstreamEnhancementCases(test, expect, resolvePage) {
  test('upstream: new from clipboard creates a correctly sized tab and failed reads retain the original project', async () => {
    const page = resolvePage();
    const result = await page.evaluate(async () => {
      const { editor: e, runCommand } = await import('./app.js'), { surface } = await import('./raster.js');
      e.newCanvas(30, 20); const original = JSON.stringify(e.projectSnapshot().manifest), host = window.desktop;
      let failed = false;
      try {
        window.desktop = { ...host, pasteImage: async () => ({ ok: true, value: null }) };
        try { await e.advancedCommand('new-from-clipboard'); } catch { failed = true; }
        const unchanged = JSON.stringify(e.projectSnapshot().manifest) === original;
        const image = surface(14, 8); image.getContext('2d').fillStyle = '#ff0000'; image.getContext('2d').fillRect(0, 0, 14, 8);
        window.desktop = { ...host, pasteImage: async () => ({ ok: true, value: image.toDataURL('image/png') }) };
        await runCommand('new-from-clipboard');
        return { failed, unchanged, size: [e.manifest.width, e.manifest.height], pixel: [...e.composite(true).getContext('2d').getImageData(0, 0, 1, 1).data], tabs: e.workspace.entries().length, original: JSON.stringify(e.workspace.entries()[0].state.manifest) === original };
      } finally { window.desktop = host; }
    });
    expect(result).toEqual({ failed: true, unchanged: true, size: [14, 8], pixel: [255, 0, 0, 255], tabs: 2, original: true });
  });

  test('upstream: lossless WebP retains RGBA samples, lossy exports decode, and cancel leaves the project intact', async () => {
    const page = resolvePage();
    const output = await page.evaluate(async () => {
      const { encodeWebPImage } = await import('./webp-export.js');
      const original = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 0, 0, 0, 0]);
      const image = new ImageData(original, 2, 2), lossless = await encodeWebPImage(image, { quality: 90, lossless: true });
      const bitmap = await createImageBitmap(new Blob([lossless], { type: 'image/webp' }));
      const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2; const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0); bitmap.close();
      const samples = [...context.getImageData(0, 0, 2, 2).data];
      const lossy = await encodeWebPImage(image, { quality: 70, lossless: false });
      const decoded = await createImageBitmap(new Blob([lossy], { type: 'image/webp' })); const size = [decoded.width, decoded.height]; decoded.close();
      const controller = new AbortController(); controller.abort(); let canceled = false;
      try { await encodeWebPImage(image, { quality: 80, lossless: false }, controller.signal); } catch (error) { canceled = error.name === 'AbortError'; }
      return { samples, header: new TextDecoder().decode(lossless.slice(0, 4)), size, canceled };
    });
    expect(output.samples).toEqual([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 0, 0, 0, 0]);
    expect(output.header).toBe('RIFF'); expect(output.size).toEqual([2, 2]); expect(output.canceled).toBe(true);
    await page.evaluate(async () => { const { editor, runCommand } = await import('./app.js'); editor.newCanvas(16, 12); window.webpOperation = runCommand('export-webp'); });
    await page.getByLabel('Lossless', { exact: true }).check();
    await page.locator('#language').selectOption('zh-CN');
    await expect(page.getByRole('heading', { name: '导出 WebP' })).toBeVisible(); await expect(page.getByLabel('无损', { exact: true })).toBeChecked();
    await page.getByRole('button', { name: '取消', exact: true }).click(); await page.evaluate(() => window.webpOperation);
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return [e.manifest.width, e.manifest.height, e.history.past.length]; })).toEqual([16, 12, 0]);
  });

  test('upstream: selection stroke grows a small source, retains effects and selection, and supports undo', async () => {
    const page = resolvePage();
    const result = await page.evaluate(async () => {
      const { editor: e } = await import('./app.js'), { surface } = await import('./raster.js'), { applySelectionStroke } = await import('./selection-stroke.js');
      e.newCanvas(40, 30); const image = surface(4, 4); image.getContext('2d').fillStyle = '#0000ff'; image.getContext('2d').fillRect(0, 0, 4, 4);
      e.storePixels(e.active, image); e.active.transform.origin = [10, 10]; e.active.transform.size = [4, 4];
      e.active.effects = { stroke: { size: 1, red: 0, green: 1, blue: 0, opacity: 1, inside: true } }; e.selection = { x: 10, y: 10, width: 4, height: 4 }; e.history.reset();
      const before = JSON.stringify(e.snapshot().manifest), selected = e.selection;
      const options = { width: 2, position: 'Outside', color: { red: 1, green: 0, blue: 0 }, opacity: 100, blendMode: 'Normal', preserveTransparency: false };
      applySelectionStroke(e, options);
      const source = e.images.get(e.active.id), pixel = [...source.getContext('2d').getImageData(0, 0, 1, 1).data];
      const result = { size: [source.width, source.height], pixel, selected: e.selection === selected, effects: !!e.active.effects, undo: e.history.past.length };
      await e.restore('undo'); result.restored = JSON.stringify(e.snapshot().manifest) === before;
      await e.restore('redo'); result.redone = e.images.get(e.active.id).width;
      const history = e.history.past.length; applySelectionStroke(e, { ...options, opacity: 0 }); result.noop = e.history.past.length === history;
      return result;
    });
    expect(result).toEqual({ size: [8, 8], pixel: [255, 0, 0, 255], selected: true, effects: true, undo: 1, restored: true, redone: 8, noop: true });
  });

  test('upstream: invalid crop settings keep the dialog open and Chinese selection stroke controls are usable', async () => {
    const page = resolvePage();
    await page.evaluate(async () => { const { editor, runCommand } = await import('./app.js'); editor.newCanvas(80, 60); editor.selection = { x: 10, y: 10, width: 30, height: 20 }; window.settingsOperation = runCommand('tool-settings'); });
    await page.getByLabel('Crop ratio', { exact: true }).selectOption('Custom'); await page.getByRole('spinbutton', { name: 'Custom ratio width', exact: true }).fill('0');
    await page.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.locator('dialog[open]')).toBeVisible();
    await page.getByRole('spinbutton', { name: 'Custom ratio width', exact: true }).fill('9'); await page.getByRole('spinbutton', { name: 'Custom ratio height', exact: true }).fill('20'); await page.getByRole('button', { name: 'Apply', exact: true }).click(); await page.evaluate(() => window.settingsOperation);
    expect(await page.evaluate(async () => (await import('./app.js')).editor.toolSettings.cropWidth)).toBe(9);
    await page.locator('#language').selectOption('zh-CN'); await page.evaluate(async () => { window.settingsOperation = (await import('./app.js')).runCommand('stroke-selection'); });
    await expect(page.getByRole('heading', { name: '选区描边' })).toBeVisible(); await expect(page.getByLabel('描边位置', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '取消', exact: true }).click(); await page.evaluate(() => window.settingsOperation);
  });
}
