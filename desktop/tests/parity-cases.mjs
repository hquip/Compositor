export function parityCases(test, expect, resolvePage) {
  async function create(page, width = 160, height = 120) { await page.evaluate(async ({ width, height }) => { (await import('./app.js')).editor.newCanvas(width, height); }, { width, height }); }
  async function tool(page, name) { await page.evaluate((name) => { document.querySelector(`[data-tool="${name}"]`).click(); return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); }, name); }
  async function point(page, x, y) { return await page.evaluate(async ({ x, y }) => { const { editor } = await import('./app.js'), bounds = editor.viewport.getBoundingClientRect(); return { x: bounds.x + editor.pan.x + x * editor.zoom, y: bounds.y + editor.pan.y + y * editor.zoom }; }, { x, y }); }
  async function drag(page, x, y, toX, toY) { const a = await point(page, x, y), b = await point(page, toX, toY); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up(); }
  async function pixel(page, x, y) { return await page.evaluate(async ({ x, y }) => [...(await import('./app.js')).editor.composite(true).getContext('2d').getImageData(x, y, 1, 1).data], { x, y }); }

  test('parity: gradient endpoints and colors remain editable until one commit', async ({}) => {
    const page = resolvePage(); await create(page, 101, 20); await tool(page, 'gradient');
    await page.evaluate(async () => { (await import('./app.js')).editor.color = '#000000'; });
    await page.getByLabel('Gradient style').selectOption('Foreground to Background');
    await drag(page, .5, 10, 100.5, 10);
    const pending = await page.evaluate(async () => { const e = (await import('./app.js')).editor; return { pending: !!e.gradientDraft, layers: e.manifest.layers.length, image: e.active.imageFile ?? null, undo: e.history.past.length }; });
    expect(pending).toEqual({ pending: true, layers: 1, image: null, undo: 0 }); expect((await pixel(page, 50, 10))[0]).toBeGreaterThan(120);
    await page.evaluate(() => { const input = document.querySelector('#paint-color'); input.value = '#ff0000'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect((await pixel(page, 0, 10))[0]).toBeGreaterThan(250); expect((await pixel(page, 0, 10))[1]).toBeLessThan(4);
    await drag(page, 100.5, 10, 60.5, 10); expect((await pixel(page, 80, 10))[1]).toBeGreaterThan(250);
    await page.getByRole('button', { name: 'Apply gradient', exact: true }).click();
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return { undo: e.history.past.length, pending: !!e.gradientDraft, layers: e.manifest.layers.length }; })).toEqual({ undo: 1, pending: false, layers: 1 });
    await page.evaluate(async () => { await (await import('./app.js')).runCommand('undo'); }); expect((await pixel(page, 50, 10))[3]).toBe(0);
    await page.evaluate(async () => { await (await import('./app.js')).runCommand('redo'); }); expect((await pixel(page, 80, 10))[3]).toBe(255);
  });

  test('parity: canceling a gradient restores pixels and saving resolves a mask gradient', async ({}) => {
    const page = resolvePage(); await create(page, 101, 20);
    const before = await page.evaluate(async () => {
      const { editor } = await import('./app.js'), { surface } = await import('./raster.js'), { storeMask } = await import('./masks.js');
      const image = surface(101, 20); image.getContext('2d').fillStyle = '#ff0000'; image.getContext('2d').fillRect(0, 0, 101, 20); editor.storePixels(editor.active, image);
      const mask = surface(1, 1); mask.getContext('2d').fillStyle = '#fff'; mask.getContext('2d').fillRect(0, 0, 1, 1); storeMask(editor, editor.active, mask); editor.history.reset(); editor.update(); return JSON.stringify(editor.snapshot().manifest);
    });
    await tool(page, 'gradient'); await drag(page, .5, 10, 100.5, 10); await page.getByRole('button', { name: 'Cancel gradient', exact: true }).click();
    expect(await pixel(page, 50, 10)).toEqual([255, 0, 0, 255]);
    expect(await page.evaluate(async () => JSON.stringify((await import('./app.js')).editor.manifest))).toBe(before);
    await page.evaluate(async () => { const e = (await import('./app.js')).editor; e.editMask = true; e.color = '#000000'; }); await page.getByLabel('Gradient style').selectOption('Foreground to Background');
    await drag(page, .5, 10, 100.5, 10);
    const saved = await page.evaluate(async () => { const e = (await import('./app.js')).editor, snapshot = e.projectSnapshot(); return { version: snapshot.manifest.version, mask: !!snapshot.manifest.layers[0].maskFile, undo: e.history.past.length, pending: !!e.gradientDraft }; });
    expect(saved).toEqual({ version: 15, mask: true, undo: 1, pending: false }); expect((await pixel(page, 0, 10))[3]).toBeLessThan(4); expect((await pixel(page, 100, 10))[3]).toBeGreaterThan(250);
    await page.evaluate(async () => { await (await import('./app.js')).runCommand('undo'); }); expect(await pixel(page, 0, 10)).toEqual([255, 0, 0, 255]);
  });

  test('parity: selected pixels move beyond source bounds with their mask and undo restores both', async ({}) => {
    const page = resolvePage(); await create(page);
    await page.evaluate(async () => {
      const { editor } = await import('./app.js'), { surface } = await import('./raster.js'), { storeMask } = await import('./masks.js');
      const image = surface(20, 20); image.getContext('2d').fillStyle = '#ff0000'; image.getContext('2d').fillRect(0, 0, 20, 20); editor.storePixels(editor.active, image);
      editor.active.transform.origin = [40, 30]; editor.active.transform.size = [40, 40];
      const mask = surface(20, 20); mask.getContext('2d').fillStyle = '#fff'; mask.getContext('2d').fillRect(0, 0, 20, 20); storeMask(editor, editor.active, mask);
      editor.selection = { x: 40, y: 30, width: 20, height: 40 }; editor.history.reset(); editor.update();
    });
    await tool(page, 'move'); await drag(page, 50, 50, 110, 50);
    expect((await pixel(page, 50, 50))[3]).toBe(0); expect(await pixel(page, 70, 50)).toEqual([255, 0, 0, 255]); expect(await pixel(page, 110, 50)).toEqual([255, 0, 0, 255]);
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return [e.images.get(e.active.id).width, e.masks.get(e.active.id).width, e.selection.x, e.history.past.length]; })).toEqual([40, 40, 100, 1]);
    await page.evaluate(async () => { await (await import('./app.js')).runCommand('undo'); });
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return [e.images.get(e.active.id).width, e.masks.get(e.active.id).width, e.selection.x]; })).toEqual([20, 20, 40]); expect(await pixel(page, 50, 50)).toEqual([255, 0, 0, 255]);
    await page.evaluate(async () => { (await import('./app.js')).editor.selectionDragMode = 'Duplicate pixels'; }); await drag(page, 50, 50, 110, 50);
    expect(await pixel(page, 50, 50)).toEqual([255, 0, 0, 255]); expect(await pixel(page, 110, 50)).toEqual([255, 0, 0, 255]);
  });

  test('parity: selection outlines preserve holes, drag independently, and cancel cleanly', async ({}) => {
    const page = resolvePage(); await create(page);
    const outline = await page.evaluate(async () => {
      const { editor } = await import('./app.js'), { surface } = await import('./raster.js'), { combineSelection } = await import('./masks.js'), { selectionPath } = await import('./selection-contour.js');
      const mask = surface(160, 120), ctx = mask.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(10, 10, 50, 50); ctx.clearRect(25, 25, 20, 20); combineSelection(editor, mask); editor.history.reset();
      const path = selectionPath(editor.selection); return { hole: ctx.isPointInStroke(path, 25, 35), center: ctx.isPointInStroke(path, 35, 35) };
    }); expect(outline).toEqual({ hole: true, center: false });
    await tool(page, 'marquee'); await drag(page, 18, 18, 28, 23);
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return { x: e.selection.x, y: e.selection.y, images: Object.keys(e.assets).length }; })).toEqual({ x: 20, y: 15, images: 0 });
    const a = await point(page, 28, 23), b = await point(page, 48, 43); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y); await page.keyboard.press('Escape'); await page.mouse.up();
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return { x: e.selection.x, y: e.selection.y, undo: e.history.past.length }; })).toEqual({ x: 20, y: 15, undo: 1 });
  });

  test('parity: deleting chained clipping sources can cancel, bake, or release in one undo step', async ({}) => {
    const page = resolvePage(); await create(page, 80, 40);
    await page.evaluate(async () => {
      const { editor: e } = await import('./app.js'), { createLayer } = await import('./core.js'), { surface } = await import('./raster.js'), { storeMask } = await import('./masks.js');
      const group = createLayer('Folder', 80, 40); group.isGroup = true; group.opacity = .5;
      const base = e.active; base.name = 'Base'; base.parentID = group.id; base.isVisible = false; base.opacity = .5;
      const image = surface(80, 40); image.getContext('2d').fillStyle = '#f00'; image.getContext('2d').fillRect(0, 0, 40, 40); e.storePixels(base, image);
      const middle = createLayer('Intermediate', 80, 40); middle.opacity = .5; middle.maskSourceID = base.id; middle.isVisible = false;
      const solid = surface(80, 40); solid.getContext('2d').fillStyle = '#0f0'; solid.getContext('2d').fillRect(0, 0, 80, 40); e.storePixels(middle, solid);
      const top = createLayer('Target', 80, 40); top.maskSourceID = middle.id; top.opacity = .8; top.effects = { colorOverlay: { red: 0, green: 0, blue: 1, opacity: .2 } }; e.storePixels(top, solid);
      const mask = surface(1, 1); mask.getContext('2d').fillStyle = 'rgba(255,255,255,.75)'; mask.getContext('2d').fillRect(0, 0, 1, 1); storeMask(e, top, mask);
      e.manifest.layers.push(group, middle, top); e.manifest.activeLayerID = group.id; e.selectedIDs = new Set([group.id, middle.id]); e.history.reset(); e.update();
    });
    const before = await pixel(page, 20, 20); expect(before[3]).toBeGreaterThan(0); expect((await pixel(page, 60, 20))[3]).toBe(0);
    const deleteSelected = () => page.evaluate(async () => { window.pendingDeletion = (await import('./app.js')).editor.deleteLayer(); });
    await deleteSelected(); await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await page.evaluate(() => window.pendingDeletion);
    expect(await page.evaluate(async () => (await import('./app.js')).editor.manifest.layers.length)).toBe(4);
    await deleteSelected(); await page.getByRole('button', { name: 'Bake and Delete' }).click(); await page.evaluate(() => window.pendingDeletion);
    // Mac's baker applies only the source coverage. Retained layer effects are reevaluated afterward.
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return [...e.images.get(e.active.id).getContext('2d').getImageData(20, 20, 1, 1).data]; })).toEqual([0, 255, 0, 32]);
    expect((await pixel(page, 60, 20))[3]).toBe(0);
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return { layers: e.manifest.layers.length, clip: e.active.maskSourceID ?? null, mask: !!e.active.maskFile, effects: !!e.active.effects, undo: e.history.past.length }; })).toEqual({ layers: 1, clip: null, mask: true, effects: true, undo: 1 });
    await page.evaluate(async () => { await (await import('./app.js')).editor.restore('undo'); const e = (await import('./app.js')).editor; e.selectedIDs = new Set(e.manifest.layers.filter((layer) => ['Folder', 'Intermediate'].includes(layer.name)).map((layer) => layer.id)); });
    await deleteSelected(); await page.getByRole('button', { name: 'Remove Links and Delete' }).click(); await page.evaluate(() => window.pendingDeletion);
    expect((await pixel(page, 60, 20))[3]).toBeGreaterThan(140);
  });

  test('parity: merging a semitransparent clipping stack preserves alpha and retargets dependents', async ({}) => {
    const page = resolvePage(); await create(page, 64, 48);
    await page.evaluate(async () => {
      const { editor: e } = await import('./app.js'), { createLayer } = await import('./core.js'), { surface } = await import('./raster.js');
      const base = e.active; base.name = 'Base'; base.opacity = .5;
      const image = surface(64, 48); image.getContext('2d').fillStyle = '#f00'; image.getContext('2d').fillRect(10, 10, 20, 20); e.storePixels(base, image);
      for (const [name, color, opacity] of [['Green', '#0f0', .5], ['Blue', '#00f', .4], ['Dependent', '#fff', 1]]) {
        const layer = createLayer(name, 64, 48); layer.maskSourceID = name === 'Dependent' ? e.manifest.layers.at(-1).id : base.id; layer.opacity = opacity; layer.isVisible = name !== 'Dependent';
        const pixels = surface(64, 48); pixels.getContext('2d').fillStyle = color; pixels.getContext('2d').fillRect(0, 0, 64, 48); e.storePixels(layer, pixels); e.manifest.layers.push(layer);
      }
      e.manifest.activeLayerID = e.manifest.layers[2].id; e.selectedIDs = new Set(e.manifest.layers.slice(0, 3).map((layer) => layer.id)); e.history.reset(); e.update();
    });
    const before = await pixel(page, 15, 15); expect(before[3]).toBe(128);
    await page.evaluate(async () => { await (await import('./app.js')).runCommand('merge'); }); expect(await pixel(page, 15, 15)).toEqual(before);
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return { layers: e.manifest.layers.length, origin: e.active.transform.origin, size: e.active.transform.size, target: e.manifest.layers.find((layer) => layer.name === 'Dependent').maskSourceID === e.active.id }; })).toEqual({ layers: 2, origin: [10, 10], size: [20, 20], target: true });
    await page.evaluate(async () => { await (await import('./app.js')).runCommand('undo'); }); expect(await pixel(page, 15, 15)).toEqual(before);
  });

  test('parity: linked masks follow a perspective warp while unlinked masks stay placed', async ({}) => {
    const page = resolvePage(); await create(page, 100, 80);
    const result = await page.evaluate(async () => {
      const { editor: e } = await import('./app.js'), { surface } = await import('./raster.js'), { storeMask } = await import('./masks.js'), { distortLayer, homography } = await import('./transforms.js');
      const layer = e.active, image = surface(32, 32), mask = surface(32, 32); image.getContext('2d').fillStyle = '#f00'; image.getContext('2d').fillRect(0, 0, 32, 32); mask.getContext('2d').fillStyle = '#fff'; mask.getContext('2d').fillRect(0, 0, 16, 32);
      layer.transform.origin = [20, 10]; layer.transform.size = [32, 32]; layer.maskPlacement = structuredClone(layer.transform); layer.maskLinked = true; e.storePixels(layer, image); storeMask(e, layer, mask); e.history.reset();
      const original = structuredClone(layer.maskPlacement), corners = [{ x: 20, y: 10 }, { x: 84, y: 18 }, { x: 70, y: 60 }, { x: 10, y: 50 }], h = homography(corners), u = .45, v = .5, d = h[6] * u + h[7] * v + 1;
      const x = Math.floor((h[0] * u + h[1] * v + h[2]) / d), y = Math.floor((h[3] * u + h[4] * v + h[5]) / d);
      e.mutate('Distort', () => distortLayer(e, layer, corners), { followMasks: false }); const linked = e.composite(true).getContext('2d').getImageData(x, y, 1, 1).data[3];
      await e.restore('undo'); e.active.maskLinked = false; e.mutate('Distort', () => distortLayer(e, e.active, corners), { followMasks: false });
      return { linked, unlinked: e.composite(true).getContext('2d').getImageData(x, y, 1, 1).data[3], placement: e.active.maskPlacement, original };
    }); expect(result.linked).toBeGreaterThan(240); expect(result.unlinked).toBe(0); expect(result.placement).toEqual(result.original);
  });

  test('parity: text wraps by words and graphemes and retains native shaping across color runs', async ({}) => {
    const page = resolvePage();
    const result = await page.evaluate(async () => {
      const { layoutText, renderText } = await import('./text-layout.js'), { surface } = await import('./raster.js');
      const base = { fontName: 'Arial', fontSize: 32, red: 0, green: 0, blue: 0, alignment: 'Left', tracking: 0, leading: 0 };
      const errors = [];
      for (const [content, direction] of [['AVATAR office', 'ltr'], ['سلام', 'rtl'], ['e\u0301 👩‍👩‍👧‍👦', 'ltr'], ['abc אבג 123', 'ltr'], ['नमस्ते दुनिया', 'ltr']]) {
        const actual = renderText({ ...base, content }), layout = actual.textLayout, reference = surface(actual.width, actual.height), ctx = reference.getContext('2d');
        ctx.font = 'normal 400 32px "Arial"'; ctx.fontKerning = 'normal'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.direction = direction; ctx.fillStyle = '#000'; if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
        ctx.beginPath(); ctx.rect(12, 12, actual.width - 24, actual.height - 24); ctx.clip(); ctx.fillText(content, 12, layout.lines[0].baseline);
        const a = actual.getContext('2d').getImageData(0, 0, actual.width, actual.height).data, b = ctx.getImageData(0, 0, actual.width, actual.height).data;
        let difference = 0, coverage = 0; for (let i = 3; i < a.length; i += 4) { difference += Math.abs(a[i] - b[i]); coverage += b[i]; } errors.push({ content, fraction: difference / Math.max(1, coverage) });
      }
      const plain = renderText({ ...base, content: 'سلام' }), colored = renderText({ ...base, content: 'سلام', colorRuns: [{ location: 0, length: 2, red: 1, green: 0, blue: 0 }] });
      const a = plain.getContext('2d').getImageData(0, 0, plain.width, plain.height).data, b = colored.getContext('2d').getImageData(0, 0, colored.width, colored.height).data; let maskDifference = 0, red = 0;
      for (let i = 0; i < a.length; i += 4) { maskDifference += Math.abs(a[i + 3] - b[i + 3]); if (b[i] > 200 && b[i + 3] > 0) red++; }
      return { errors, maskDifference, red, words: layoutText({ ...base, fontSize: 20, content: 'one two three', boxSize: [80, 180] }).lines.map((line) => line.text), emoji: layoutText({ ...base, content: '👩‍👩‍👧‍👦AB', boxSize: [40, 200] }).lines.map((line) => line.text) };
    });
    for (const error of result.errors) expect(error.fraction, error.content).toBeLessThan(.015);
    expect(result.maskDifference).toBe(0); expect(result.red).toBeGreaterThan(0); expect(result.words).toEqual(['one', 'two', 'three']); expect(result.emoji[0]).toBe('👩‍👩‍👧‍👦');
  });

  test('parity: paragraph text preserves blank lines and UTF-16 styling through inline edits', async ({}) => {
    const page = resolvePage(); await create(page, 600, 360); await tool(page, 'text'); await drag(page, 20, 30, 340, 230);
    const input = page.getByRole('textbox', { name: 'Edit text on canvas' }); await input.fill('A😀中 B\n\nSecond line');
    await page.evaluate(() => { const node = document.querySelector('.inline-text-editor'), walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT); let text; while (walker.nextNode()) if (walker.currentNode.textContent.includes('A😀中')) { text = walker.currentNode; break; } const range = document.createRange(); range.setStart(text, 1); range.setEnd(text, 4); getSelection().removeAllRanges(); getSelection().addRange(range); document.dispatchEvent(new Event('selectionchange')); const color = document.querySelector('[aria-label="Text color"]'); color.value = '#ff0000'; color.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.getByRole('textbox', { name: 'Text font', exact: true }).fill('Courier New'); await page.getByRole('textbox', { name: 'Text font', exact: true }).press('Tab');
    await page.getByRole('button', { name: 'Apply text', exact: true }).click();
    const text = await page.evaluate(async () => (await import('./app.js')).editor.active.text);
    expect(text.content).toBe('A😀中 B\n\nSecond line'); expect(text.boxSize).toEqual([320, 200]); expect(text.colorRuns).toEqual([{ location: 1, length: 3, red: 1, green: 0, blue: 0 }]); expect(text.fontRuns).toEqual([{ location: 1, length: 3, fontName: 'CourierNewPSMT' }]);
    const blanks = await page.evaluate(async () => { const { readTextDOM } = await import('./inline-text.js'), node = document.createElement('div'); node.style.fontFamily = 'Arial'; node.style.color = '#000'; node.innerHTML = '<div><br></div><div>甲</div><div><br></div><div>乙😀</div>'; document.body.append(node); const value = readTextDOM(node, { fontName: 'Arial', red: 0, green: 0, blue: 0 }); node.remove(); return value.content; });
    expect(blanks).toBe('\n甲\n\n乙😀');
  });

  test('parity: unchanged text keeps cached Mac pixels and point text reflows without losing scale', async ({}) => {
    const page = resolvePage(); await create(page, 500, 300);
    const before = await page.evaluate(async () => { const { editor: e } = await import('./app.js'), { documentPoint } = await import('./core.js'); e.addText('A'); e.active.transform.size = [100, 70]; e.active.transform.rotation = 23; e.active.transform.flipX = true; e.history.reset(); e.update(); const image = e.images.get(e.active.id); return { asset: e.assets[e.active.imageFile], scale: [100 / image.width, 70 / image.height], anchor: documentPoint({ x: 0, y: 0 }, e.active.transform) }; });
    await page.evaluate(async () => { await (await import('./app.js')).runCommand('edit-text'); }); await page.getByRole('button', { name: 'Apply text', exact: true }).click();
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return { asset: e.assets[e.active.imageFile], undo: e.history.past.length }; })).toEqual({ asset: before.asset, undo: 0 });
    await page.evaluate(async () => { await (await import('./app.js')).runCommand('edit-text'); }); await page.getByRole('textbox', { name: 'Edit text on canvas' }).fill('Longer point text'); await page.getByRole('button', { name: 'Apply text', exact: true }).click();
    const after = await page.evaluate(async () => { const { editor: e } = await import('./app.js'), { documentPoint } = await import('./core.js'), image = e.images.get(e.active.id); return { scale: [e.active.transform.size[0] / image.width, e.active.transform.size[1] / image.height], anchor: documentPoint({ x: 0, y: 0 }, e.active.transform), flip: e.active.transform.flipX, rotation: e.active.transform.rotation }; });
    expect(after.scale[0]).toBeCloseTo(before.scale[0], 7); expect(after.scale[1]).toBeCloseTo(before.scale[1], 7); expect(after.anchor.x).toBeCloseTo(before.anchor.x, 7); expect(after.anchor.y).toBeCloseTo(before.anchor.y, 7); expect(after.flip).toBe(true); expect(after.rotation).toBe(23);
  });

  test('parity: paragraph handles reflow text and invalid drafts remain editable', async ({}) => {
    const page = resolvePage(); await create(page, 500, 300); await tool(page, 'text'); await drag(page, 30, 50, 150, 190);
    const input = page.getByRole('textbox', { name: 'Edit text on canvas' }); await input.fill('one two three four five');
    await page.getByRole('spinbutton', { name: 'Text font size', exact: true }).fill('20'); await page.getByRole('spinbutton', { name: 'Text font size', exact: true }).press('Tab');
    const handle = await page.getByRole('button', { name: 'Resize text bottom right' }).boundingBox(), zoom = await page.evaluate(async () => (await import('./app.js')).editor.zoom); await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down(); await page.mouse.move(handle.x + handle.width / 2 + 100 * zoom, handle.y + handle.height / 2, { steps: 5 }); await page.mouse.up();
    await page.getByRole('button', { name: 'Apply text', exact: true }).click();
    const width = await page.evaluate(async () => (await import('./app.js')).editor.active.text.boxSize[0]); expect(width).toBeGreaterThan(170);
    await page.evaluate(async () => { await (await import('./app.js')).runCommand('edit-text'); }); await input.fill('x'.repeat(100001)); await page.getByRole('button', { name: 'Apply text', exact: true }).click();
    await expect(page.locator('#error-dialog')).toBeVisible(); await page.getByRole('button', { name: 'OK', exact: true }).click(); await expect(input).toHaveText('x'.repeat(100001));
    await input.fill('Recovered'); await page.getByRole('button', { name: 'Apply text', exact: true }).click(); expect(await page.evaluate(async () => (await import('./app.js')).editor.active.text.content)).toBe('Recovered');
  });

  test('parity: merging detaches outside clipping sources and releasing a stack affects higher siblings', async ({}) => {
    const page = resolvePage(); await create(page, 80, 40);
    const result = await page.evaluate(async () => {
      const { editor: e } = await import('./app.js'), { createLayer } = await import('./core.js'), { surface } = await import('./raster.js'), { mergeLayers } = await import('./layer-operations.js'), { releaseClipping, adoptClipping, releaseDetachedClipping } = await import('./clipping.js');
      const base = e.active, fill = (layer, color, width) => { const image = surface(80, 40); image.getContext('2d').fillStyle = color; image.getContext('2d').fillRect(0, 0, width, 40); e.storePixels(layer, image); }; fill(base, '#f00', 10);
      const first = createLayer('First', 80, 40), second = createLayer('Second', 80, 40); first.maskSourceID = second.maskSourceID = base.id; fill(first, '#0f0', 80); fill(second, '#00f', 20); e.manifest.layers.push(first, second); e.manifest.activeLayerID = first.id;
      releaseClipping(e); const released = !first.maskSourceID && !second.maskSourceID;
      second.maskSourceID = base.id; adoptClipping(first.id, e.manifest.layers); const adopted = first.maskSourceID === base.id;
      e.manifest.layers = [first, base, second]; releaseDetachedClipping(e.manifest.layers); const detached = !first.maskSourceID;
      first.maskSourceID = base.id; e.manifest.layers = [base, first, second]; e.manifest.activeLayerID = second.id; e.selectedIDs = new Set([first.id, second.id]); mergeLayers(e);
      return { released, adopted, detached, pixel: [...e.composite(true).getContext('2d').getImageData(60, 20, 1, 1).data], layers: e.manifest.layers.length, external: e.manifest.layers.some((layer) => layer.id === base.id), clipped: !!e.active.maskSourceID };
    }); expect(result).toEqual({ released: true, adopted: true, detached: true, pixel: [0, 255, 0, 255], layers: 2, external: true, clipped: false });
  });

  test('parity: Delete clears mask selection to white while the layer trash removes the target', async ({}) => {
    const page = resolvePage(); await create(page, 64, 32);
    await page.evaluate(async () => { const { editor: e } = await import('./app.js'), { surface } = await import('./raster.js'), { storeMask } = await import('./masks.js'); const pixels = surface(64, 32); pixels.getContext('2d').fillStyle = '#f00'; pixels.getContext('2d').fillRect(0, 0, 64, 32); e.storePixels(e.active, pixels); storeMask(e, e.active, surface(1, 1)); e.editMask = true; e.selection = { x: 0, y: 0, width: 32, height: 32 }; e.history.reset(); e.update(); });
    await page.evaluate(async () => { await (await import('./app.js')).runCommand('delete'); }); expect(await pixel(page, 10, 10)).toEqual([255, 0, 0, 255]); expect((await pixel(page, 50, 10))[3]).toBe(0);
    await page.evaluate(async () => { await (await import('./app.js')).runCommand('delete-layer'); }); expect(await pixel(page, 50, 10)).toEqual([255, 0, 0, 255]);
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return { layers: e.manifest.layers.length, mask: !!e.active.maskFile }; })).toEqual({ layers: 1, mask: false });
    await page.evaluate(async () => { await (await import('./app.js')).runCommand('delete-layer'); }); expect(await page.evaluate(async () => (await import('./app.js')).editor.manifest.layers.length)).toBe(0);
  });

  test('parity: radial gradient settings redraw the original pixels and folder masks retain Mac placement', async ({}) => {
    const page = resolvePage(); await create(page, 101, 101); await tool(page, 'gradient');
    await page.evaluate(async () => { const e = (await import('./app.js')).editor; e.color = '#000000'; Object.assign(e.gradient.settings, { shape: 'Radial', style: 'Foreground to Background' }); });
    await drag(page, 50.5, 50.5, 90.5, 50.5);
    const values = await Promise.all([[70, 50], [30, 50], [50, 70], [50, 30]].map(([x, y]) => pixel(page, x, y))); for (const value of values) expect(Math.abs(value[0] - 128)).toBeLessThanOrEqual(4);
    await page.evaluate(async () => { const e = (await import('./app.js')).editor; e.gradient.settings.reversed = true; e.gradient.settings.opacity = 50; e.gradient.refresh(); });
    const center = await pixel(page, 50, 50); expect(center[0]).toBeGreaterThan(250); expect(Math.abs(center[3] - 128)).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Cancel gradient', exact: true }).click(); expect((await pixel(page, 50, 50))[3]).toBe(0);
    await page.evaluate(async () => { const { editor: e } = await import('./app.js'), { createLayer } = await import('./core.js'), { surface } = await import('./raster.js'), { storeMask } = await import('./masks.js'); const child = e.active, image = surface(101, 101); image.getContext('2d').fillStyle = '#f00'; image.getContext('2d').fillRect(0, 0, 101, 101); e.storePixels(child, image); const group = createLayer('Masked group', 101, 101); group.isGroup = true; child.parentID = group.id; e.manifest.layers.push(group); const mask = surface(1, 1); mask.getContext('2d').fillStyle = '#fff'; mask.getContext('2d').fillRect(0, 0, 1, 1); storeMask(e, group, mask); e.manifest.activeLayerID = group.id; e.editMask = true; Object.assign(e.gradient.settings, { shape: 'Linear', reversed: false, opacity: 100 }); e.update(); });
    await drag(page, .5, 50, 100.5, 50); await page.getByRole('button', { name: 'Apply gradient', exact: true }).click();
    expect((await pixel(page, 0, 50))[3]).toBeLessThan(4); expect((await pixel(page, 100, 50))[3]).toBeGreaterThan(250);
    expect(await page.evaluate(async () => (await import('./app.js')).editor.active.maskPlacement ?? null)).toBeNull();
  });

  test('parity: pixel filters respect selection holes and mask filters preserve the image', async ({}) => {
    const page = resolvePage(); await create(page, 64, 64);
    await page.evaluate(async () => { const { editor: e } = await import('./app.js'), { surface } = await import('./raster.js'), { combineSelection } = await import('./masks.js'); const pixels = surface(64, 64); pixels.getContext('2d').fillStyle = '#f00'; pixels.getContext('2d').fillRect(0, 0, 64, 64); e.storePixels(e.active, pixels); const selection = surface(64, 64), ctx = selection.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(8, 8, 48, 48); ctx.clearRect(20, 20, 24, 24); combineSelection(e, selection); e.history.reset(); });
    await page.evaluate(async () => { await (await import('./app.js')).runCommand('invert'); }); expect(await pixel(page, 12, 12)).toEqual([0, 255, 255, 255]); expect(await pixel(page, 32, 32)).toEqual([255, 0, 0, 255]); expect(await pixel(page, 2, 2)).toEqual([255, 0, 0, 255]);
    const before = await page.evaluate(async () => { const { editor: e } = await import('./app.js'), { surface } = await import('./raster.js'), { storeMask } = await import('./masks.js'); await e.restore('undo'); const mask = surface(1, 1); mask.getContext('2d').fillStyle = 'rgba(255,255,255,.25)'; mask.getContext('2d').fillRect(0, 0, 1, 1); storeMask(e, e.active, mask); e.editMask = true; e.selection = { x: 0, y: 0, width: 32, height: 64 }; return { image: e.assets[e.active.imageFile], alpha: mask.getContext('2d').getImageData(0, 0, 1, 1).data[3] }; });
    await page.evaluate(async () => { await (await import('./app.js')).runCommand('invert'); }); expect(Math.abs((await pixel(page, 10, 10))[3] - (255 - before.alpha))).toBeLessThanOrEqual(1); expect((await pixel(page, 50, 10))[3]).toBe(before.alpha);
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return e.assets[e.active.imageFile]; })).toBe(before.image);
  });
}
