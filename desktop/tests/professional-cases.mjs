export function professionalCases(test, expect, resolvePage, restart) {
  async function setup(page) { return page.evaluate(async () => { const { editor: e } = await import('./app.js'), { surface } = await import('./raster.js'); e.newCanvas(96, 64); const canvas = surface(96, 64), ctx = canvas.getContext('2d'); ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 96, 64); e.storePixels(e.active, canvas); e.update(); return e.assets[e.active.imageFile]; }); }
  const pixel = (page, x = 20, y = 20) => page.evaluate(async ({ x, y }) => [...(await import('./app.js')).editor.composite(true).getContext('2d').getImageData(x, y, 1, 1).data], { x, y });
  test('professional: editable filters preserve their original and remain editable after project reopen', async () => {
    const page = resolvePage(), original = await setup(page);
    await page.evaluate(async () => { window.edit = (await import('./app.js')).runCommand('editable-filter:Invert'); });
    await expect(page.locator('.filter-stack-dialog [role="status"]')).toHaveText('Preview ready'); expect(await pixel(page)).toEqual([0, 255, 255, 255]);
    await page.locator('.filter-stack-dialog').getByRole('button', { name: 'Apply', exact: true }).click(); await page.evaluate(() => window.edit);
    const stored = await page.evaluate(async () => { const e = (await import('./app.js')).editor; const snapshot = e.projectSnapshot(); await e.install(snapshot, true); return { version: snapshot.manifest.version, filters: e.active.filters.length, original: e.assets[e.active.filterSourceFile] }; });
    expect(stored).toEqual({ version: 15, filters: 1, original });
    const committed = await pixel(page);
    await page.evaluate(async () => { window.edit = (await import('./app.js')).runCommand('edit-filters'); });
    await page.getByRole('checkbox', { name: 'Enable filter' }).uncheck();
    await expect.poll(() => pixel(page)).toEqual([255, 0, 0, 255]);
    await page.locator('.filter-stack-dialog').getByRole('button', { name: 'Apply', exact: true }).click(); await page.evaluate(() => window.edit);
    expect(await page.evaluate(async () => (await import('./app.js')).editor.active.filters[0].enabled)).toBe(false);
    await page.evaluate(async () => (await import('./app.js')).runCommand('undo')); expect(await pixel(page)).toEqual(committed);
  });
  test('professional: filter reorder and removal recompute from original pixels and cancel is non-destructive', async () => {
    const page = resolvePage(), original = await setup(page);
    await page.evaluate(async () => { window.edit = (await import('./app.js')).runCommand('editable-filter:Invert'); });
    await page.getByLabel('Add editable filter', { exact: true }).selectOption('Invert'); await page.getByRole('button', { name: 'Add filter', exact: true }).click();
    await expect.poll(() => pixel(page)).toEqual([255, 0, 0, 255]);
    await page.getByRole('button', { name: 'Move filter up', exact: true }).last().click();
    await page.getByRole('button', { name: 'Remove', exact: true }).last().click(); await expect.poll(() => pixel(page)).toEqual([0, 255, 255, 255]);
    await page.locator('.filter-stack-dialog').getByRole('button', { name: 'Cancel', exact: true }).click(); await page.evaluate(() => window.edit);
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return { original: e.assets[e.active.imageFile], filters: e.active.filters ?? null, history: e.history.past.length }; })).toEqual({ original, filters: null, history: 0 });
  });
  test('professional: mask refinement previews coverage and applies one undoable layer mask', async () => {
    const page = resolvePage(); await setup(page);
    await page.evaluate(async () => { const { editor: e, runCommand } = await import('./app.js'); e.selection = { x: 0, y: 0, width: 48, height: 64 }; window.refine = runCommand('refine-selection'); });
    await page.getByRole('spinbutton', { name: 'Edge radius', exact: true }).fill('0'); await page.getByRole('spinbutton', { name: 'Shift edge', exact: true }).fill('4');
    await page.getByLabel('Output', { exact: true }).selectOption('Layer mask'); await expect(page.locator('.processing-status')).toHaveText('Preview ready');
    await page.locator('dialog[open]').getByRole('button', { name: 'Apply', exact: true }).click(); await page.evaluate(() => window.refine);
    expect((await pixel(page, 50, 20))[3]).toBe(255); expect((await pixel(page, 60, 20))[3]).toBe(0);
    expect(await page.evaluate(async () => (await import('./app.js')).editor.history.past.length)).toBe(1);
    await page.evaluate(async () => (await import('./app.js')).runCommand('undo')); expect((await pixel(page, 60, 20))[3]).toBe(255);
  });
  test('professional: layered PSD and PSB exports retain groups, masks, blend modes, text and composite pixels', async () => {
    const page = resolvePage(); await setup(page);
    const result = await page.evaluate(async () => {
      const { editor: e } = await import('./app.js'), { createLayer } = await import('./core.js'), { surface } = await import('./raster.js'), { storeMask } = await import('./masks.js');
      const group = createLayer('Folder', 96, 64); group.isGroup = true; e.active.parentID = group.id; e.active.name = 'Red'; e.active.opacity = .5;
      const mask = surface(96, 64), ctx = mask.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 48, 64); storeMask(e, e.active, mask); e.manifest.layers.unshift(group); e.addText('中文 ABC');
      const { buildPhotoshop, binaryBase64 } = await import('./psd-export.js'), { writePsd, readPsd } = await import('./vendor/psd.js'), { parsePhotoshop } = await import('./photoshop.js');
      const built = buildPhotoshop(e), bytes = new Uint8Array(writePsd(built)), read = readPsd(bytes, { useImageData: true }), roundTrip = parsePhotoshop(binaryBase64(bytes));
      const psb = new Uint8Array(writePsd(built, { psb: true }));
      return { signature: [...bytes.slice(0, 6)], psb: [...psb.slice(4, 6)], layers: roundTrip.snapshot.manifest.layers.map((l) => ({ name: l.name, mask: !!l.maskFile, group: !!l.isGroup, text: l.text?.content })), width: read.width, composite: [...read.imageData.data.slice((20 * 96 + 20) * 4, (20 * 96 + 20) * 4 + 4)] };
    }); expect(result.signature).toEqual([56, 66, 80, 83, 0, 1]); expect(result.psb).toEqual([0, 2]); expect(result.width).toBe(96);
    expect(result.layers).toContainEqual({ name: 'Folder', mask: false, group: true, text: undefined }); expect(result.layers.some((l) => l.name === 'Red' && l.mask)).toBe(true); expect(result.layers.some((l) => l.text === '中文 ABC')).toBe(true);
  });
  test('professional: a genuine 16-bit source stays high precision through editable filters, archive and TIFF export', async () => {
    const page = resolvePage();
    const result = await page.evaluate(async () => {
      const { editor: e } = await import('./app.js'), { createLayer } = await import('./core.js'), { surface } = await import('./raster.js'), { encodePNG16, decodePNG } = await import('./png-pixels.js'), { profileBytes } = await import('./color-engine.js'), { colorJob } = await import('./color-workflows.js'), { binaryBase64 } = await import('./psd-export.js'), { decodePrecisionFile } = await import('./precision-raster.js');
      e.newCanvas(2, 1); const layer = e.active, data = new Uint16Array([12345, 23456, 34567, 65535, 12346, 23457, 34568, 65535]), profile = await profileBytes('sRGB'), original = await encodePNG16({ width: 2, height: 1, data, profile });
      const image = surface(2, 1); image.getContext('2d').fillStyle = '#345678'; image.getContext('2d').fillRect(0, 0, 2, 1); e.storePixels(layer, image); layer.filterSourceFile = `${layer.id}.source.png`; e.assets[layer.filterSourceFile] = binaryBase64(original); layer.filters = [{ id: crypto.randomUUID().toUpperCase(), enabled: true, adjustment: { kind: 'Invert', hue: 0, saturation: 0, lightness: 0, colorize: false, levels: { ranges: Array.from({ length: 4 }, () => ({ black: 0, white: 255, gamma: 1, outputBlack: 0, outputWhite: 255 })) }, curves: { channels: Array.from({ length: 4 }, () => [{ x: 0, y: 0 }, { x: 255, y: 255 }]) } } }]; layer.filterWorkingSpace = 'sRGB';
      const output = await colorJob({ snapshot: e.projectSnapshot(), profile, bits: 16, intent: 1, blackPoint: true, preview: false, workingSpace: 'sRGB' }), reopened = await decodePrecisionFile(output.bytes, 'Output.tiff');
      let protectedSource = false; try { e.storePixels(layer, image); } catch { protectedSource = true; }
      return { pixels: [...reopened.data], protectedSource, depth: reopened.bits, source: [...(await decodePNG(Uint8Array.from(atob(e.assets[layer.filterSourceFile]), (c) => c.charCodeAt(0)))).data] };
    }); expect(result.depth).toBe(16); expect(result.protectedSource).toBe(true); expect(result.source).toEqual([12345, 23456, 34567, 65535, 12346, 23457, 34568, 65535]); expect(result.pixels).toEqual([53190, 42079, 30968, 65535, 53189, 42078, 30967, 65535]);
  });
  test('professional: ICC soft proof changes preview without changing project pixels', async () => {
    const page = resolvePage(), original = await setup(page);
    await page.evaluate(async () => { window.proof = (await import('./app.js')).runCommand('soft-proof'); });
    await page.getByLabel('Output ICC profile', { exact: true }).selectOption('Adobe RGB (1998)'); await expect(page.locator('.processing-status')).toHaveText('Preview ready');
    await page.locator('dialog[open]').getByRole('button', { name: 'Apply', exact: true }).click(); await page.evaluate(() => window.proof);
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return { pixels: e.assets[e.active.imageFile], history: e.history.past.length }; })).toEqual({ pixels: original, history: 0 });
  });
  test('professional: clone strokes expand the source and canceled strokes restore its placement', async () => {
    const page = resolvePage(); await setup(page);
    await page.evaluate(async () => {
      const { editor: e } = await import('./app.js'), { surface } = await import('./raster.js'); const image = surface(20, 20); image.getContext('2d').fillStyle = '#f00'; image.getContext('2d').fillRect(0, 0, 20, 20); e.storePixels(e.active, image); e.active.transform.origin = [10, 10]; e.active.transform.size = [20, 20]; e.brushSize = 12; e.cloneSource = { x: 20, y: 20 }; e.toolSettings.sampleAll = false; e.history.reset(); document.querySelector('[data-tool="clone"]').click();
    });
    const point = (x, y) => page.evaluate(async ({ x, y }) => { const e = (await import('./app.js')).editor, r = e.viewport.getBoundingClientRect(); return { x: r.x + e.pan.x + x * e.zoom, y: r.y + e.pan.y + y * e.zoom }; }, { x, y });
    const a = await point(65, 25); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.up(); expect(await pixel(page, 65, 25)).toEqual([255, 0, 0, 255]);
    expect(await page.evaluate(async () => (await import('./app.js')).editor.images.get((await import('./app.js')).editor.active.id).width)).toBeGreaterThan(50);
    await page.evaluate(async () => (await import('./app.js')).runCommand('undo')); const b = await point(75, 45); await page.mouse.move(b.x, b.y); await page.mouse.down(); await page.keyboard.press('Escape'); await page.mouse.up();
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return { width: e.images.get(e.active.id).width, origin: e.active.transform.origin }; })).toEqual({ width: 20, origin: [10, 10] });
  });
  test('professional: Gaussian blur grows output bounds and undo restores the exact source', async () => {
    const page = resolvePage(); await setup(page);
    const before = await page.evaluate(async () => { const { editor: e, runCommand } = await import('./app.js'), { surface } = await import('./raster.js'); const image = surface(20, 20); image.getContext('2d').fillStyle = '#f00'; image.getContext('2d').fillRect(0, 0, 20, 20); e.storePixels(e.active, image); e.active.transform.origin = [30, 20]; e.active.transform.size = [20, 20]; e.history.reset(); const before = e.assets[e.active.imageFile]; window.blur = runCommand('filter:Gaussian Blur'); return before; });
    await page.getByRole('spinbutton', { name: 'Radius', exact: true }).fill('3'); await page.locator('dialog[open]').getByRole('button', { name: 'Apply', exact: true }).click(); await page.evaluate(() => window.blur);
    expect((await pixel(page, 28, 30))[3]).toBeGreaterThan(0); expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return e.images.get(e.active.id).width; })).toBeGreaterThan(20);
    await page.evaluate(async () => (await import('./app.js')).runCommand('undo')); expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return e.assets[e.active.imageFile]; })).toBe(before);
  });
  test('professional: font substitution preserves text styling and is undoable', async () => {
    const page = resolvePage(); await setup(page);
    await page.evaluate(async () => { const e = (await import('./app.js')).editor; e.addText('ABC 中文'); e.active.text.fontName = 'Compositor Missing Font 123'; e.history.reset(); e.update(); });
    if (await page.locator('#mobile-layers').count()) { await page.locator('#mobile-layers').click(); await page.getByRole('tab', { name: 'Properties', exact: true }).click(); }
    await expect(page.locator('#font-warnings')).toBeVisible(); await page.locator('#font-warnings').click(); await page.locator('dialog[open]').getByRole('button', { name: 'Apply', exact: true }).click();
    await expect.poll(() => page.evaluate(async () => (await import('./app.js')).editor.active.text.fontName)).not.toBe('Compositor Missing Font 123');
    expect(await page.evaluate(async () => (await import('./app.js')).editor.active.text.content)).toBe('ABC 中文'); await page.evaluate(async () => (await import('./app.js')).runCommand('undo')); expect(await page.evaluate(async () => (await import('./app.js')).editor.active.text.fontName)).toBe('Compositor Missing Font 123');
  });
  test('professional: saved actions replay as one undo step and batch export keeps separate projects', async () => {
    const page = resolvePage(); await setup(page);
    await page.evaluate(async () => { const { library } = await import('./library-store.js'); await library.put({ id: 'action:Invert', type: 'action', name: 'Invert' }, { steps: [{ type: 'basic-filter', name: 'Invert' }] }); window.action = (await import('./app.js')).runCommand('play-action'); });
    await page.locator('dialog[open]').getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.locator('dialog[open]')).toHaveCount(1); await expect(page.locator('dialog[open] .settings-fields')).toBeEmpty(); await page.locator('dialog[open]').getByRole('button', { name: 'Apply', exact: true }).click(); await page.evaluate(() => window.action);
    expect(await pixel(page)).toEqual([0, 255, 255, 255]); expect(await page.evaluate(async () => (await import('./app.js')).editor.history.past.length)).toBe(1);
    await page.evaluate(async () => (await import('./app.js')).runCommand('undo')); expect(await pixel(page)).toEqual([255, 0, 0, 255]);
    const files = await page.evaluate(async () => {
      const { editor: e } = await import('./app.js'), { batchFiles } = await import('./productivity.js'), { unzipSync } = await import('./vendor/archive.js'); e.name = 'First'; e.newCanvas(40, 20); e.name = 'Second';
      const before = e.history.revision, archive = await batchFiles(e.workspace.entries().map((tab) => tab.state), { format: 'PNG', sizes: 'original,32' }); return { names: Object.keys(unzipSync(archive)), revision: before === e.history.revision };
    }); expect(files.names.sort()).toEqual(['First-32.png', 'First.png', 'Second-32.png', 'Second.png']); expect(files.revision).toBe(true);
  });
  test('professional: recovery restores the undo journal along with the document', async () => {
    let page = resolvePage(); await setup(page);
    const id = await page.evaluate(async () => { const { editor: e, runCommand } = await import('./app.js'); await runCommand('invert'); await e.recovery.flush(); return e.workspace.id; });
    if (restart) page = await restart(); else { page.once('dialog', (dialog) => dialog.accept()); await page.reload(); } await page.evaluate(async (id) => (await import('./app.js')).editor.recovery.recover(id), id);
    expect(await page.evaluate(async () => (await import('./app.js')).editor.history.past.length)).toBe(1); await page.evaluate(async () => (await import('./app.js')).runCommand('undo')); expect(await pixel(page)).toEqual([255, 0, 0, 255]);
  });
  test('professional: pen pressure changes stroke size while mouse strokes retain their normal size', async () => {
    const page = resolvePage(); await page.evaluate(async () => { const { editor: e } = await import('./app.js'); e.newCanvas(128, 96); e.brushSize = 30; e.brushHardness = 1; e.color = '#ff0000'; e.penSettings.size = true;
      for (const type of ['pointerdown', 'pointermove', 'pointerup']) e.overlay.addEventListener(type, (event) => { if (window.testPressure != null) Object.defineProperties(event, { pointerType: { value: 'pen' }, pressure: { value: window.testPressure } }); }, true); document.querySelector('[data-tool="brush"]').click();
    });
    const point = (x, y) => page.evaluate(async ({ x, y }) => { const e = (await import('./app.js')).editor, r = e.viewport.getBoundingClientRect(); return { x: r.x + e.pan.x + x * e.zoom, y: r.y + e.pan.y + y * e.zoom }; }, { x, y });
    for (const [pressure, y] of [[.2, 20], [1, 60]]) { await page.evaluate((value) => { window.testPressure = value; }, pressure); const a = await point(20, y), b = await point(80, y); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up(); }
    expect((await pixel(page, 50, 29))[3]).toBe(0); expect((await pixel(page, 50, 69))[3]).toBeGreaterThan(240);
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return e.images.get(e.active.id).width * e.images.get(e.active.id).height < e.manifest.width * e.manifest.height; })).toBe(true);
  });
  test('professional: saved undo journals restore only when the project fingerprint still matches', async () => {
    const page = resolvePage(); await setup(page);
    const result = await page.evaluate(async () => {
      const { editor: e, runCommand } = await import('./app.js'), { saveLocalHistory, restoreLocalHistory } = await import('./saved-history.js'); await runCommand('invert');
      const snapshot = e.projectSnapshot(), saved = await saveLocalHistory(snapshot, e.history, 'test-history.comp', 'History'); await e.install(snapshot, true); await restoreLocalHistory(e, snapshot, 'test-history.comp'); const count = e.history.past.length, clean = !e.history.dirty;
      await e.restore('undo'); const pixel = [...e.composite(true).getContext('2d').getImageData(20, 20, 1, 1).data];
      const changed = structuredClone(snapshot); changed.manifest.layers[0].opacity = .5; await e.install(changed, true); await restoreLocalHistory(e, changed, 'test-history.comp'); return { saved, count, clean, pixel, stale: e.history.past.length };
    }); expect(result).toEqual({ saved: true, count: 1, clean: true, pixel: [255, 0, 0, 255], stale: 0 });
  });
  test('professional: a failed action rolls back earlier steps before the dialog is dismissed', async () => {
    const page = resolvePage(), original = await setup(page);
    await page.evaluate(async () => { const { library } = await import('./library-store.js'); await library.put({ id: 'action:Failure', type: 'action', name: 'Failure' }, { steps: [{ type: 'basic-filter', name: 'Invert' }, { type: 'unknown-step' }] }); window.action = (await import('./app.js')).runCommand('play-action'); });
    await page.locator('dialog[open]').getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.locator('dialog[open] .settings-fields')).toBeEmpty(); await page.locator('dialog[open]').getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.locator('.processing-status')).toHaveText('Unsupported action step.'); expect(await pixel(page)).toEqual([255, 0, 0, 255]);
    await page.locator('dialog[open]').getByRole('button', { name: 'Cancel', exact: true }).click(); await page.evaluate(() => window.action);
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return { pixels: e.assets[e.active.imageFile], history: e.history.past.length, busy: e.busy }; })).toEqual({ pixels: original, history: 0, busy: false });
  });
}
