export function enhancementCases(test, expect, resolvePage, restart) {
  const create = (page, width = 128, height = 96) => page.evaluate(async ({ width, height }) => {
    const { editor: e } = await import('./app.js'), { surface } = await import('./raster.js'); e.newCanvas(width, height);
    const image = surface(width, height), context = image.getContext('2d'); context.fillStyle = '#f00'; context.fillRect(0, 0, 40, 40); context.fillStyle = '#00f'; context.fillRect(70, 10, 20, 20); e.storePixels(e.active, image); e.update();
  }, { width, height });
  const list = (page) => page.evaluate(async () => new (await import('./recovery-store.js')).RecoveryStore().list());
  async function reload(page) { if (restart) page = await restart(); else { page.once('dialog', (dialog) => dialog.accept()); await page.reload(); } await expect(page.locator('html')).toHaveAttribute('data-editor-ready', 'true'); return page; }
  const recover = (page, id) => page.evaluate(async (id) => (await import('./app.js')).editor.recovery.recover(id), id);
  const pixel = (page, x, y) => page.evaluate(async ({ x, y }) => [...(await import('./app.js')).editor.composite(true).getContext('2d').getImageData(x, y, 1, 1).data], { x, y });

  test('enhancement: autosave recovers two unsaved tabs and selection holes after reload', async () => {
    let page = resolvePage(); await create(page);
    await page.evaluate(async () => {
      const { editor: e } = await import('./app.js'), { surface } = await import('./raster.js'); e.name = 'Recovery One';
      const coverage = surface(128, 96), ctx = coverage.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 40, 40); ctx.clearRect(10, 10, 10, 10);
      e.selection = { x: 0, y: 0, width: 40, height: 40, coverage }; e.update();
      e.newCanvas(80, 60); e.name = 'Recovery Two'; e.mutate('Rename', () => { e.active.name = 'Second draft'; });
    });
    await expect.poll(async () => (await list(page)).length).toBe(2);
    const records = await list(page); page = await reload(page);
    await expect(page.locator('#recovery-status')).toBeVisible(); await page.locator('#recovery-status').click();
    await page.locator('.recovery-row').filter({ hasText: 'Recovery One' }).getByRole('button', { name: 'Recover', exact: true }).click();
    await expect(page.locator('#document-title')).toHaveText('Recovery One');
    expect(await pixel(page, 5, 5)).toEqual([255, 0, 0, 255]);
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return { dirty: e.history.dirty, hole: e.selection.coverage.getContext('2d').getImageData(15, 15, 1, 1).data[3] }; })).toEqual({ dirty: true, hole: 0 });
    await recover(page, records.find((record) => record.name === 'Recovery Two').id);
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return { name: e.active.name, tabs: e.workspace.entries().length, dirty: e.history.dirty }; })).toEqual({ name: 'Second draft', tabs: 2, dirty: true });
  });

  test('enhancement: recovery preserves uncommitted Unicode text and cancel restores the original', async () => {
    let page = resolvePage(); await create(page);
    const baseline = await page.evaluate(async () => {
      const { editor: e, runCommand } = await import('./app.js'); e.addText('Original'); const snapshot = JSON.stringify(e.projectSnapshot());
      e.history.savedRevision = e.history.revision; await runCommand('edit-text'); return snapshot;
    });
    await page.getByRole('textbox', { name: 'Edit text on canvas' }).fill('未提交 ABC مرحبا 👩‍💻');
    await page.evaluate(async () => (await import('./app.js')).editor.recovery.flush());
    const records = await list(page); expect(records.length).toBe(1);
    page = await reload(page); await recover(page, records[0].id);
    await expect(page.getByRole('textbox', { name: 'Edit text on canvas' })).toHaveText('未提交 ABC مرحبا 👩‍💻');
    await page.getByRole('button', { name: 'Cancel text', exact: true }).click();
    expect(await page.evaluate(async () => JSON.stringify((await import('./app.js')).editor.projectSnapshot()))).toBe(baseline);
  });

  test('enhancement: pending gradients recover without committing their pixels or history', async () => {
    let page = resolvePage(); await create(page);
    const state = await page.evaluate(async () => {
      const { editor: e } = await import('./app.js'); document.querySelector('[data-tool="gradient"]').click();
      e.gradient.restore({ start: { x: 0, y: 40 }, end: { x: 128, y: 40 }, layerID: e.active.id, isMask: false, color: '#00ff00', settings: { shape: 'Linear', style: 'Foreground to Background', reversed: false, opacity: 100, background: { red: 0, green: 0, blue: 1 } } });
      const before = e.assets[e.active.imageFile]; await e.recovery.flush(); return { before, history: e.history.past.length };
    });
    expect(state.history).toBe(0); const id = (await list(page))[0].id; page = await reload(page); await recover(page, id);
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return { pending: !!e.gradientDraft, before: e.assets[e.active.imageFile], history: e.history.past.length }; })).toEqual({ pending: true, before: state.before, history: 0 });
    await page.getByRole('button', { name: 'Apply gradient', exact: true }).click(); expect((await pixel(page, 100, 40))[2]).toBeGreaterThan(180);
    expect(await page.evaluate(async () => (await import('./app.js')).editor.history.past.length)).toBe(1);
  });

  test('enhancement: failed recovery writes keep the previous copy and successful saves clear drafts', async () => {
    let page = resolvePage(); await create(page);
    const result = await page.evaluate(async () => {
      const { editor: e } = await import('./app.js'), { RecoveryStore } = await import('./recovery-store.js'); await e.recovery.flush();
      const store = new RecoveryStore(), id = (await store.list())[0].id, before = await store.read(id), original = RecoveryStore.prototype.put;
      RecoveryStore.prototype.put = async () => { throw new DOMException('Storage full', 'QuotaExceededError'); };
      e.mutate('Rename', () => { e.active.name = 'Newer'; }); await e.recovery.flush();
      const error = !!e.recovery.error, retained = await store.read(id); RecoveryStore.prototype.put = original;
      await e.recovery.flush(); const updated = await store.read(id); e.history.savedRevision = e.history.revision; await e.recovery.flush();
      return { error, retained: retained.snapshot.manifest.layers[0].name === before.snapshot.manifest.layers[0].name, updated: updated.snapshot.manifest.layers[0].name, count: (await store.list()).length };
    }); expect(result).toEqual({ error: true, retained: true, updated: 'Newer', count: 0 });
  });

  test('enhancement: floating selections preserve holes, grow pixels, recover, and commit as one undo step', async () => {
    let page = resolvePage(); await create(page);
    const before = await page.evaluate(async () => {
      const { editor: e, runCommand } = await import('./app.js'), { surface } = await import('./raster.js');
      const coverage = surface(128, 96), ctx = coverage.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 40, 40); ctx.clearRect(10, 10, 10, 10); e.selection = { x: 0, y: 0, width: 40, height: 40, coverage };
      const original = e.assets[e.active.imageFile]; await runCommand('transform-selection');
      e.floatingSelection.setCorners([{ x: 80, y: 40 }, { x: 160, y: 40 }, { x: 160, y: 120 }, { x: 80, y: 120 }]); await e.recovery.flush();
      return { original, untouched: original === e.assets[e.active.imageFile], history: e.history.past.length };
    }); expect(before.untouched).toBe(true); expect(before.history).toBe(0);
    expect(await pixel(page, 15, 15)).toEqual([255, 0, 0, 255]); expect((await pixel(page, 105, 65))[3]).toBe(0); expect(await pixel(page, 90, 50)).toEqual([255, 0, 0, 255]);
    const id = (await list(page))[0].id; page = await reload(page); await recover(page, id); await expect(page.getByRole('button', { name: 'Apply transform', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Apply transform', exact: true }).click();
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return { size: [e.images.get(e.active.id).width, e.images.get(e.active.id).height], history: e.history.past.length, pending: !!e.floatingDraft, version: e.projectSnapshot().manifest.version }; })).toEqual({ size: [160, 120], history: 1, pending: false, version: 15 });
    await page.evaluate(async () => (await import('./app.js')).runCommand('undo'));
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return e.assets[e.active.imageFile]; })).toBe(before.original);
    await page.evaluate(async () => (await import('./app.js')).runCommand('redo')); expect(await pixel(page, 90, 50)).toEqual([255, 0, 0, 255]);
  });

  test('enhancement: floating rotation, perspective, cancellation, and invalid corners retain source pixels', async () => {
    let page = resolvePage(); await create(page);
    const result = await page.evaluate(async () => {
      const { editor: e, runCommand } = await import('./app.js'); e.selection = { x: 0, y: 0, width: 40, height: 40 }; const before = e.assets[e.active.imageFile]; await runCommand('transform-selection-copy');
      e.floatingSelection.setCorners([{ x: 110, y: 10 }, { x: 110, y: 50 }, { x: 70, y: 50 }, { x: 70, y: 10 }]);
      let rejected = false; try { e.floatingSelection.setCorners([{ x: 0, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 30 }, { x: 30, y: 0 }]); } catch { rejected = true; }
      e.floatingSelection.setCorners([{ x: 60, y: 40 }, { x: 120, y: 45 }, { x: 110, y: 85 }, { x: 70, y: 80 }]);
      return { before, rejected, pending: !!e.floatingDraft, original: e.assets[e.active.imageFile] === before };
    }); expect(result.rejected).toBe(true); expect(result.pending).toBe(true); expect(result.original).toBe(true);
    expect(await pixel(page, 80, 60)).toEqual([255, 0, 0, 255]); expect(await pixel(page, 5, 5)).toEqual([255, 0, 0, 255]);
    await page.getByRole('button', { name: 'Cancel transform', exact: true }).click();
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return { original: e.assets[e.active.imageFile], history: e.history.past.length, pending: !!e.floatingDraft }; })).toEqual({ original: result.before, history: 0, pending: false });
  });

  test('enhancement: background filters match source kernels and cancel without blocking the event loop', async () => {
    let page = resolvePage();
    const result = await page.evaluate(async () => {
      const { FilterTask } = await import('./filter-task.js'), { surface } = await import('./raster.js'), { applyAdjustment, applyCameraRaw } = await import('./adjustments.js'), { finishingFilter } = await import('./finishing.js');
      const source = surface(72, 48), ctx = source.getContext('2d'), data = ctx.createImageData(72, 48);
      for (let i = 0; i < data.data.length; i += 4) { data.data[i] = i % 239; data.data[i + 1] = (i * 17) % 251; data.data[i + 2] = (i * 31) % 241; data.data[i + 3] = i % 3 ? 255 : 128; } ctx.putImageData(data, 0, 0);
      const task = new FilterTask(), cases = [['filter', 'Exposure', { kind: 'Exposure', exposureSettings: { exposure: 1, offset: .01, gamma: 1.2 } }], ['filter', 'Gaussian Blur', { kind: 'Gaussian Blur', blurRadius: 3 }], ['camera-raw', null, { exposure: .5, contrast: 20 }], ['finishing', 'Tonal Contrast', { amount: 30, radius: 3 }]], differences = [], rawDifferences = [];
      for (const [action, kind, settings] of cases) {
        const output = await task.run(source, action, kind, settings), expected = action === 'filter' ? applyAdjustment(source, settings) : action === 'camera-raw' ? applyCameraRaw(source, settings) : finishingFilter(source, kind, settings);
        const actual = output.getContext('2d').getImageData(0, 0, 72, 48).data, baseline = expected.getContext('2d').getImageData(0, 0, 72, 48).data;
        rawDifferences.push(Math.max(...actual.map((value, i) => Math.abs(value - baseline[i]))));
        let difference = 0;
        for (let i = 0; i < actual.length; i += 4) {
          difference = Math.max(difference, Math.abs(actual[i + 3] - baseline[i + 3]));
          for (let c = 0; c < 3; c++) difference = Math.max(difference, Math.abs(actual[i + c] * actual[i + 3] - baseline[i + c] * baseline[i + 3]) / 255);
        }
        differences.push(difference);
      }
      const large = surface(2000, 1500), largeContext = large.getContext('2d'); largeContext.fillStyle = '#b7593f'; largeContext.fillRect(0, 0, large.width, large.height);
      let ticks = 0; const timer = setInterval(() => ticks++, 1);
      const pending = task.run(large, 'filter', 'Motion Blur', { kind: 'Motion Blur', motionDistance: 2000 }).catch((error) => error.name);
      await new Promise((resolve) => setTimeout(resolve, 20)); task.cancel(); await pending; clearInterval(timer);
      const cancelable = task.run(source, 'filter', 'Invert', { kind: 'Invert' }).catch((error) => error.name); task.cancel(); const canceled = await cancelable;
      return { differences, rawDifferences, ticks, canceled };
    }); expect(result.differences.every((difference) => difference <= 3), JSON.stringify(result)).toBe(true); expect(result.ticks).toBeGreaterThan(0); expect(result.canceled).toBe('AbortError');
  });

  test('enhancement: filter dialogs preview masks through their coverage and keep undo atomic', async () => {
    let page = resolvePage(); await create(page);
    const before = await page.evaluate(async () => {
      const { editor: e, runCommand } = await import('./app.js'), { surface } = await import('./raster.js'), { storeMask } = await import('./masks.js');
      const mask = surface(128, 96), ctx = mask.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 128, 96); ctx.clearRect(10, 10, 10, 10); storeMask(e, e.active, mask); e.editMask = true; e.selection = { x: 0, y: 0, width: 40, height: 40 };
      const before = e.assets[e.active.imageFile]; window.filterOperation = runCommand('filter:Invert'); return before;
    });
    await expect(page.locator('.processing-status')).toHaveText('Preview ready'); expect((await pixel(page, 5, 5))[3]).toBe(0); expect((await pixel(page, 15, 15))[3]).toBe(255);
    await page.getByRole('button', { name: 'Apply', exact: true }).click(); await page.evaluate(() => window.filterOperation);
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return { before: e.assets[e.active.imageFile], history: e.history.past.length, outside: e.masks.get(e.active.id).getContext('2d').getImageData(80, 15, 1, 1).data[3] }; })).toEqual({ before, history: 1, outside: 255 });
    await page.evaluate(async () => (await import('./app.js')).runCommand('undo')); expect((await pixel(page, 5, 5))[3]).toBe(255);
  });

  test('enhancement: canceling full-resolution processing never commits a preview', async () => {
    let page = resolvePage(); await create(page, 2048, 1536);
    const before = await page.evaluate(async () => {
      const { editor: e, runCommand } = await import('./app.js'); const before = e.assets[e.active.imageFile]; window.filterOperation = runCommand('filter:Motion Blur'); return before;
    });
    await page.getByRole('spinbutton', { name: 'Distance', exact: true }).fill('2000');
    await page.locator('dialog[open] form').evaluate((form) => { form.requestSubmit(); form.querySelector('button[type="button"]').click(); });
    await page.evaluate(() => window.filterOperation);
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return { image: e.assets[e.active.imageFile], history: e.history.past.length, preview: !!e.rasterPreview }; })).toEqual({ image: before, history: 0, preview: false });
  });

  test('enhancement: on-canvas selection handles resize and arrow keys nudge the floating pixels', async () => {
    let page = resolvePage(); await create(page);
    await page.evaluate(async () => { const { editor: e, runCommand } = await import('./app.js'); e.selection = { x: 0, y: 0, width: 40, height: 40 }; await runCommand('transform-selection'); });
    await expect(page.getByRole('button', { name: 'Apply transform', exact: true })).toBeVisible();
    const positions = await page.evaluate(async () => {
      const e = (await import('./app.js')).editor; await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const r = e.viewport.getBoundingClientRect(), point = (x, y) => ({ x: r.x + e.pan.x + x * e.zoom, y: r.y + e.pan.y + y * e.zoom }); return [point(40, 40), point(60, 50)];
    });
    await page.mouse.move(positions[0].x, positions[0].y); await page.mouse.down(); await page.mouse.move(positions[1].x, positions[1].y, { steps: 3 }); await page.mouse.up(); await page.keyboard.press('ArrowRight');
    const result = await page.evaluate(async () => { const e = (await import('./app.js')).editor; return { corners: e.floatingSelection.capture().corners, history: e.history.past.length }; });
    expect(result.corners[0].x).toBeCloseTo(1, 0); expect(result.corners[2].x).toBeCloseTo(61, 0); expect(result.corners[2].y).toBeCloseTo(50, 0); expect(result.history).toBe(0);
    await page.keyboard.press('Enter'); expect(await pixel(page, 50, 35)).toEqual([255, 0, 0, 255]);
  });

  test('enhancement: explicitly discarding a tab removes its recovery copy without recreating it', async () => {
    let page = resolvePage(); await create(page);
    await page.evaluate(async () => { const { editor: e, runCommand } = await import('./app.js'); await e.recovery.flush(); window.closingTab = runCommand('close-tab'); });
    await page.locator('[data-confirm="discard"]').click(); await page.evaluate(() => window.closingTab);
    await page.evaluate(async () => (await import('./app.js')).editor.recovery.flush()); expect((await list(page)).length).toBe(0);
    page = await reload(page); await expect(page.locator('#recovery-status')).toBeHidden();
  });
}
