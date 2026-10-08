import { FORMAT_VERSION } from '../renderer/core.js';
export function vectorCases(test, expect, resolvePage, restart, nativeTap) {
  const setup = (page, pixels = false) => page.evaluate(async (pixels) => { const { editor: e } = await import('./app.js'); e.newCanvas(128, 96); if (pixels) { const { surface } = await import('./raster.js'), canvas = surface(128, 96); canvas.getContext('2d').fillStyle = '#ff0000'; canvas.getContext('2d').fillRect(0, 0, 128, 96); e.storePixels(e.active, canvas); } e.update(); }, pixels);
  const pixel = (page, x, y) => page.evaluate(async ({ x, y }) => [...(await import('./app.js')).editor.composite(true).getContext('2d').getImageData(x, y, 1, 1).data], { x, y });
  async function tap(page, x, y) {
    const p = await page.evaluate(async ({ x, y }) => { const e = (await import('./app.js')).editor, r = e.overlay.getBoundingClientRect(); return { x: r.x + e.pan.x + x * e.zoom, y: r.y + e.pan.y + y * e.zoom, touch: navigator.maxTouchPoints > 0 }; }, { x, y });
    if (nativeTap) await nativeTap(page, p.x, p.y); else if (p.touch) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y);
  }
  const restore = (page, holes = false) => page.evaluate(async (holes) => {
    const { editor: e, runCommand } = await import('./app.js'); await runCommand('path-new');
    const nodes = (points) => points.map((point) => ({ point }));
    e.pathEditor.restore({ draft: { contours: [{ closed: true, nodes: nodes([[10, 10], [110, 10], [110, 86], [10, 86]]) }, ...(holes ? [{ closed: true, nodes: nodes([[40, 30], [80, 30], [80, 60], [40, 60]]) }] : [])], fillRule: 'evenodd', fill: { red: 0, green: 1, blue: 0 }, stroke: null, strokeWidth: 0, layerID: null, mask: false }, baseline: '', selected: null });
  }, holes);
  test('vector: touch or mouse creates a closed editable path with one undo step and preserves reopening', async () => {
    const page = resolvePage(); await setup(page);
    await page.evaluate(async () => (await import('./app.js')).runCommand('path-new')); await expect(page.locator('.path-controls')).toBeVisible();
    for (const [x, y] of [[20, 20], [100, 20], [100, 70], [20, 70], [20, 20]]) await tap(page, x, y);
    await page.locator('.path-controls [data-command="path-apply"]').click();
    expect((await pixel(page, 50, 40))[3]).toBe(255);
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor, snapshot = e.projectSnapshot(); await e.install(snapshot); return { nodes: e.active.vectorPath.contours[0].nodes.length, closed: e.active.vectorPath.contours[0].closed, version: snapshot.manifest.version, undo: e.history.past.length }; })).toEqual({ nodes: 4, closed: true, version: FORMAT_VERSION, undo: 1 });
    await page.evaluate(async () => (await import('./app.js')).runCommand('undo')); expect((await pixel(page, 50, 40))[3]).toBe(0);
    await page.evaluate(async () => (await import('./app.js')).runCommand('redo')); expect((await pixel(page, 50, 40))[3]).toBe(255);
  });
  test('vector: compound paths retain holes in selections and editable masks', async () => {
    const page = resolvePage(); await setup(page, true); await restore(page, true);
    await page.evaluate(async () => (await import('./app.js')).runCommand('path-selection'));
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return [...e.selection.coverage.getContext('2d').getImageData(50, 40, 1, 1).data]; })).toEqual([0, 0, 0, 0]);
    await page.evaluate(async () => (await import('./app.js')).runCommand('path-mask'));
    expect(await pixel(page, 20, 20)).toEqual([255, 0, 0, 255]); expect((await pixel(page, 50, 40))[3]).toBe(0); expect((await pixel(page, 2, 2))[3]).toBe(0);
    const before = await page.evaluate(async () => { const e = (await import('./app.js')).editor; const snapshot = e.projectSnapshot(); await e.install(snapshot); return { cache: e.assets[e.active.maskFile], contours: e.active.vectorMask.contours.length }; }); expect(before.contours).toBe(2);
    await page.evaluate(async () => { const { editor: e, runCommand } = await import('./app.js'); await runCommand('edit-vector-mask'); await runCommand('path-apply'); });
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return e.assets[e.active.maskFile]; })).toBe(before.cache);
    await page.evaluate(async () => (await import('./app.js')).runCommand('mask:Invert Mask')); expect((await pixel(page, 50, 40))[3]).toBe(255);
    expect(await page.evaluate(async () => !!(await import('./app.js')).editor.active.vectorMask)).toBe(false);
    await page.evaluate(async () => (await import('./app.js')).runCommand('undo')); expect(await page.evaluate(async () => !!(await import('./app.js')).editor.active.vectorMask)).toBe(true);
  });
  test('vector: point insertion, handles, cancellation and deletion keep the saved source intact', async () => {
    const page = resolvePage(); await setup(page); await restore(page);
    await page.evaluate(async () => (await import('./app.js')).runCommand('path-apply'));
    const original = await page.evaluate(async () => (await import('./app.js')).editor.projectSnapshot());
    await page.evaluate(async () => (await import('./app.js')).editor.pathEditor.begin());
    await tap(page, 60, 10); expect(await page.evaluate(async () => (await import('./app.js')).editor.pathDraft.contours[0].nodes.length)).toBe(5);
    await page.locator('.path-controls [data-command="path-smooth"]').click(); expect(await page.evaluate(async () => !!(await import('./app.js')).editor.pathDraft.contours[0].nodes[1].incoming)).toBe(false);
    await page.locator('.path-controls [data-command="path-smooth"]').click(); expect(await page.evaluate(async () => !!(await import('./app.js')).editor.pathDraft.contours[0].nodes[1].incoming)).toBe(true);
    await page.locator('.path-controls [data-command="path-delete"]').click(); expect(await page.evaluate(async () => (await import('./app.js')).editor.pathDraft.contours[0].nodes.length)).toBe(4);
    await page.locator('.path-controls [data-command="path-cancel"]').click(); expect(await page.evaluate(async () => (await import('./app.js')).editor.projectSnapshot())).toEqual(original);
  });
  test('vector: path style supports open strokes and phone controls stay reachable in Chinese', async () => {
    const page = resolvePage(); await setup(page); await restore(page);
    await page.evaluate(async () => { window.style = (await import('./app.js')).runCommand('path-style'); });
    await page.getByRole('checkbox', { name: 'Fill path', exact: true }).uncheck(); await page.getByRole('checkbox', { name: 'Stroke path', exact: true }).check(); await page.getByRole('spinbutton', { name: 'Stroke width', exact: true }).fill('4');
    await page.locator('dialog[open]').getByRole('button', { name: 'Apply', exact: true }).click(); await page.evaluate(() => window.style);
    await page.locator('#language').selectOption('zh-CN');
    await expect(page.locator('.path-controls [data-command="path-apply"]')).toHaveText('应用路径'); await page.locator('.path-controls [data-command="path-close"]').click(); await page.locator('.path-controls [data-command="path-apply"]').click();
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return { fill: e.active.vectorPath.fill, closed: e.active.vectorPath.contours[0].closed, stroke: !!e.active.vectorPath.stroke }; })).toEqual({ fill: null, closed: false, stroke: true });
    expect((await pixel(page, 50, 40))[3]).toBe(0); expect((await pixel(page, 50, 10))[3]).toBeGreaterThan(240);
  });
  test('vector: mask node edits, duplication and PSD delivery retain appearance without stale geometry', async () => {
    const page = resolvePage(); await setup(page, true); await restore(page);
    await page.evaluate(async () => { const { editor: e, runCommand } = await import('./app.js'); await runCommand('path-mask'); await runCommand('edit-vector-mask'); const state = e.pathEditor.serialize(); state.draft.contours[0].nodes.forEach((node) => { node.point[0] += 5; }); e.pathEditor.restore(state); await runCommand('path-apply'); await runCommand('duplicate'); });
    expect(await page.evaluate(async () => (await import('./app.js')).editor.active.vectorMask.contours.length)).toBe(1);
    const result = await page.evaluate(async () => { const e = (await import('./app.js')).editor, { buildPhotoshop } = await import('./psd-export.js'), psd = buildPhotoshop(e); return { left: e.active.maskPlacement.origin[0], masks: psd.children.filter((l) => l.mask).length, alpha: e.composite(true).getContext('2d').getImageData(12, 20, 1, 1).data[3] }; }); expect(result).toEqual({ left: 13, masks: 2, alpha: 0 });
  });
  test('vector: dragging creates curve handles and a canceled gesture restores the draft', async () => {
    const page = resolvePage(); await setup(page);
    await page.evaluate(async () => (await import('./app.js')).runCommand('path-new')); await expect(page.locator('.path-controls')).toBeVisible();
    const p = await page.evaluate(async () => { const e = (await import('./app.js')).editor, r = e.overlay.getBoundingClientRect(); return { x: r.x + e.pan.x + 25 * e.zoom, y: r.y + e.pan.y + 40 * e.zoom, dx: 15 * e.zoom }; });
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + p.dx, p.y, { steps: 5 }); await page.mouse.up();
    const state = await page.evaluate(async () => (await import('./app.js')).editor.pathEditor.serialize());
    expect(state.draft.contours[0].nodes[0].incoming).toBeDefined(); expect(state.draft.contours[0].nodes[0].outgoing).toBeDefined();
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x, p.y + p.dx, { steps: 4 });
    await page.evaluate(async () => (await import('./app.js')).editor.cancelGesture()); await page.mouse.up();
    expect(await page.evaluate(async () => (await import('./app.js')).editor.pathEditor.serialize().draft)).toEqual(state.draft);
    await page.locator('.path-controls [data-command="path-independent"]').click();
    await page.mouse.move(p.x + p.dx, p.y); await page.mouse.down(); await page.mouse.move(p.x + p.dx, p.y + p.dx, { steps: 4 }); await page.mouse.up();
    expect(await page.evaluate(async () => (await import('./app.js')).editor.pathDraft.contours[0].nodes[0].incoming)).toEqual(state.draft.contours[0].nodes[0].incoming);
    await page.keyboard.press('Escape'); expect(await page.evaluate(async () => !!(await import('./app.js')).editor.pathDraft)).toBe(false);
  });
  test('vector: recovery retains an unapplied path and image resizing retains editable geometry', async () => {
    let page = resolvePage(); await setup(page); await restore(page);
    const id = await page.evaluate(async () => { const e = (await import('./app.js')).editor; await e.recovery.flush(); return e.workspace.id; });
    if (restart) page = await restart(); else { page.once('dialog', (dialog) => dialog.accept()); await page.reload(); }
    await expect(page.locator('html')).toHaveAttribute('data-editor-ready', 'true');
    await page.evaluate(async (id) => (await import('./app.js')).editor.recovery.recover(id), id);
    expect(await page.evaluate(async () => (await import('./app.js')).editor.pathDraft.contours[0].nodes.length)).toBe(4);
    await page.keyboard.press('Enter');
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor, { resizeDocument } = await import('./layer-operations.js'); resizeDocument(e, 256, 192, true); return { nodes: e.active.vectorPath.contours[0].nodes.length, history: e.history.past.length }; })).toEqual({ nodes: 4, history: 2 });
    expect((await pixel(page, 100, 80))[3]).toBe(255);
  });
  test('vector: raster previews show pixel changes and canceling keeps the path editable', async () => {
    const page = resolvePage(); await setup(page); await restore(page);
    await page.evaluate(async () => { const { runCommand } = await import('./app.js'); await runCommand('path-apply'); window.filter = runCommand('editable-filter:Invert'); });
    await expect(page.locator('.filter-stack-dialog [role="status"]')).toHaveText('Preview ready'); expect(await pixel(page, 50, 40)).toEqual([255, 0, 255, 255]);
    await page.locator('.filter-stack-dialog').getByRole('button', { name: 'Cancel', exact: true }).click(); await page.evaluate(() => window.filter);
    expect(await pixel(page, 50, 40)).toEqual([0, 255, 0, 255]);
    const p = await page.evaluate(async () => { const e = (await import('./app.js')).editor; document.querySelector('[data-tool="brush"]').click(); e.color = '#ff0000'; e.brushSize = 20; e.brushHardness = 1; await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); const r = e.overlay.getBoundingClientRect(); return { x: r.x + e.pan.x + 50 * e.zoom, y: r.y + e.pan.y + 40 * e.zoom }; });
    await page.mouse.move(p.x, p.y); await page.mouse.down(); expect(await pixel(page, 50, 40)).toEqual([255, 0, 0, 255]);
    await page.evaluate(async () => (await import('./app.js')).editor.cancelGesture()); await page.mouse.up();
    expect(await page.evaluate(async () => !!(await import('./app.js')).editor.active.vectorPath)).toBe(true); expect(await pixel(page, 50, 40)).toEqual([0, 255, 0, 255]);
  });
}
