export function channelRegressionCases(test, expect, resolvePage) {
  test('channel regression: editing a copied channel layer leaves its sibling original unchanged', async () => {
    const page = resolvePage();
    const result = await page.evaluate(async () => {
      const { editor: e, runCommand } = await import('./app.js'), { surface } = await import('./raster.js'), { commitChannelSource } = await import('./channel-workflows.js'), { profileBytes } = await import('./color-engine.js'), { decodeChannelSource } = await import('./channel-source.js'), { resourceBytes } = await import('./workflow-assets.js');
      e.newCanvas(4, 2); const image = surface(4, 2); image.getContext('2d').fillStyle = '#804020'; image.getContext('2d').fillRect(0, 0, 4, 2); e.storePixels(e.active, image);
      const samples = new Float32Array(4 * 2 * 4); for (let i = 0; i < samples.length; i += 4) samples.set([.25, .5, .75, 1], i);
      const profile = await profileBytes('sRGB'); await commitChannelSource(e, e.active, { width: 4, height: 2, channels: 4, mode: 'RGB', bits: 16, data: samples }, profile, 'Channels');
      const originalID = e.active.id, originalFile = e.active.workflow.channelFile, originalBytes = e.assets[originalFile]; await runCommand('duplicate');
      const copy = e.active, source = decodeChannelSource(resourceBytes(e.assets, copy.workflow.channelFile)); source.data[0] = .9;
      await commitChannelSource(e, copy, source, profile, 'Edit copy');
      const sample = (layer) => decodeChannelSource(resourceBytes(e.assets, layer.workflow.channelFile)).data[0];
      const original = e.manifest.layers.find((layer) => layer.id === originalID), result = { original: sample(original), copy: sample(copy), unchangedBytes: e.assets[originalFile] === originalBytes, isolated: original.workflow.channelFile !== copy.workflow.channelFile };
      const saved = e.projectSnapshot(); await e.install(saved); result.reopened = e.manifest.layers.map(sample); await runCommand('undo'); result.undone = e.manifest.layers.map(sample); await runCommand('redo'); result.redone = e.manifest.layers.map(sample);
      return result;
    });
    expect(result.original).toBeCloseTo(.25, 4); expect(result.copy).toBeCloseTo(.9, 4); expect(result.unchangedBytes).toBe(true); expect(result.isolated).toBe(true);
    expect(result.reopened[0]).toBeCloseTo(.25, 4); expect(result.reopened[1]).toBeCloseTo(.9, 4); expect(result.undone[1]).toBeCloseTo(.25, 4); expect(result.redone[1]).toBeCloseTo(.9, 4);
  });

  test('channel regression: paint uses current samples after undo and supports mask painting', async () => {
    const page = resolvePage();
    await page.evaluate(async () => {
      const { editor: e } = await import('./app.js'), { surface } = await import('./raster.js'), { commitChannelSource } = await import('./channel-workflows.js'), { profileBytes } = await import('./color-engine.js'), { storeMask } = await import('./masks.js');
      e.newCanvas(40, 20); const image = surface(40, 20); image.getContext('2d').fillStyle = '#408080'; image.getContext('2d').fillRect(0, 0, 40, 20); e.storePixels(e.active, image);
      const samples = new Float32Array(40 * 20 * 4); for (let i = 0; i < samples.length; i += 4) samples.set([.25, .5, .5, 1], i);
      await commitChannelSource(e, e.active, { width: 40, height: 20, mode: 'RGB', bits: 16, channels: 4, data: samples }, await profileBytes('sRGB'), 'Channels');
      const mask = surface(1, 1); mask.getContext('2d').fillStyle = '#fff'; mask.getContext('2d').fillRect(0, 0, 1, 1); storeMask(e, e.active, mask); e.history.reset(); e.brushSize = 6; e.brushHardness = 1; e.brushOpacity = 1; e.color = '#ffffff'; e.update();
    });
    await page.evaluate(async () => { window.channelOperation = (await import('./app.js')).runCommand('channels'); });
    await page.getByLabel('Channel', { exact: true }).selectOption('R'); await page.getByLabel('Channel operation', { exact: true }).selectOption('Paint channel'); await page.getByRole('button', { name: 'Apply', exact: true }).click(); await page.evaluate(() => window.channelOperation);
    const point = (x) => page.evaluate(async (x) => { const e = (await import('./app.js')).editor, box = e.overlay.getBoundingClientRect(); return { x: box.x + e.pan.x + x * e.zoom, y: box.y + e.pan.y + 10 * e.zoom }; }, x);
    const paint = async (x) => { const p = await point(x); await page.mouse.click(p.x, p.y); await expect.poll(() => page.evaluate(async () => (await import('./app.js')).editor.busy)).toBe(false); };
    const samples = () => page.evaluate(async () => { const e = (await import('./app.js')).editor, { decodeChannelSource } = await import('./channel-source.js'), { resourceBytes } = await import('./workflow-assets.js'), source = decodeChannelSource(resourceBytes(e.assets, e.active.workflow.channelFile)); return [source.data[(10 * 40 + 8) * 4], source.data[(10 * 40 + 30) * 4]]; });
    await paint(8); expect((await samples())[0]).toBeGreaterThan(.9); await page.evaluate(async () => (await import('./app.js')).runCommand('undo'));
    await paint(30); const current = await samples(); expect(current[0]).toBeCloseTo(.25, 4); expect(current[1]).toBeGreaterThan(.9);
    const before = await page.evaluate(async () => { const e = (await import('./app.js')).editor; return e.assets[e.active.workflow.channelFile]; });
    await page.evaluate(async () => { const e = (await import('./app.js')).editor; e.channelPaint = null; e.editMask = true; e.color = '#000000'; e.update(); }); await paint(8);
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor; return e.assets[e.active.workflow.channelFile]; })).toBe(before);
    const maskAlpha = () => page.evaluate(async () => { const e = (await import('./app.js')).editor, { localPoint } = await import('./core.js'), mask = e.masks.get(e.active.id), p = localPoint({ x: 8, y: 10 }, e.active.maskPlacement ?? e.active.transform, mask.width, mask.height); return mask.getContext('2d').getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data[3]; });
    expect(await maskAlpha()).toBeLessThan(20);
    await page.evaluate(async () => { const e = (await import('./app.js')).editor; await e.install(e.projectSnapshot()); }); expect(await maskAlpha()).toBeLessThan(20);
    await page.evaluate(async () => (await import('./app.js')).runCommand('undo')); expect(await maskAlpha()).toBe(255);
    await page.evaluate(async () => (await import('./app.js')).runCommand('redo')); expect(await maskAlpha()).toBeLessThan(20);
  });

  test('channel regression: replacing a copied ICC profile preserves its sibling and reopens with the matching preview', async () => {
    const result = await resolvePage().evaluate(async () => {
      const { editor: e, runCommand } = await import('./app.js'), { surface } = await import('./raster.js'), { commitChannelSource, channelPreview } = await import('./channel-workflows.js'), { profileBytes } = await import('./color-engine.js'), { resourceBytes } = await import('./workflow-assets.js'), { decodeChannelSource } = await import('./channel-source.js');
      e.newCanvas(2, 1); const image = surface(2, 1); e.storePixels(e.active, image);
      const source = { width: 2, height: 1, channels: 4, mode: 'RGB', bits: 16, data: new Float32Array([.8, .4, .2, 1, .3, .5, .7, .5]) }, srgb = await profileBytes('sRGB'), p3 = await profileBytes('Display P3');
      await commitChannelSource(e, e.active, source, srgb, 'Channels'); const originalID = e.active.id, originalProfile = e.active.workflow.profileFile, originalBytes = e.assets[originalProfile]; await runCommand('duplicate');
      await commitChannelSource(e, e.active, source, p3, 'Change profile'); const copyID = e.active.id, profileMatches = (layer, profile) => { const bytes = resourceBytes(e.assets, layer.workflow.profileFile); return bytes.length === profile.length && bytes.every((v, i) => v === profile[i]); }, sample = (image) => [...image.getContext('2d').getImageData(0, 0, 1, 1).data];
      const result = { isolated: e.active.workflow.profileFile !== originalProfile, originalUnchanged: e.assets[originalProfile] === originalBytes, matching: profileMatches(e.active, p3), pixel: sample(e.images.get(copyID)), expected: sample(await channelPreview(decodeChannelSource(resourceBytes(e.assets, e.active.workflow.channelFile)), p3)) };
      await e.install(e.projectSnapshot()); result.reopened = profileMatches(e.active, p3); result.reopenedPixel = sample(e.images.get(copyID));
      await runCommand('undo'); result.undone = profileMatches(e.active, srgb); await runCommand('redo'); result.redone = profileMatches(e.active, p3); result.original = profileMatches(e.manifest.layers.find((l) => l.id === originalID), srgb); return result;
    });
    expect(result.isolated).toBe(true); expect(result.originalUnchanged).toBe(true); expect(result.matching).toBe(true); expect(result.reopened).toBe(true); expect(result.undone).toBe(true); expect(result.redone).toBe(true); expect(result.original).toBe(true); expect(result.pixel).toEqual(result.expected); expect(result.reopenedPixel).toEqual(result.expected);
  });

  test('channel regression: copying channel resources respects the pixel budget and rolls back failed edits', async () => {
    const result = await resolvePage().evaluate(async () => {
      const { editor: e, runCommand } = await import('./app.js'), { surface } = await import('./raster.js'), { commitChannelSource } = await import('./channel-workflows.js'), { profileBytes } = await import('./color-engine.js'), { documentPixels } = await import('./core.js');
      e.newCanvas(4, 2); e.storePixels(e.active, surface(4, 2)); const source = { width: 4, height: 2, channels: 4, mode: 'RGB', bits: 16, data: new Float32Array(32) }; for (let i = 3; i < 32; i += 4) source.data[i] = 1;
      const profile = await profileBytes('sRGB'); await commitChannelSource(e, e.active, source, profile, 'Channels'); await runCommand('duplicate'); const budget = e.pixelBudget, original = JSON.stringify(e.projectSnapshot()), revision = e.history.revision, preview = e.images.get(e.active.id); e.pixelBudget = documentPixels(e); source.data[0] = 1;
      let rejected = false; try { await commitChannelSource(e, e.active, source, profile, 'Edit copy'); } catch (error) { rejected = /pixel budget/.test(error.message); } finally { e.pixelBudget = budget; }
      return { rejected, unchanged: JSON.stringify(e.projectSnapshot()) === original, revision: e.history.revision === revision, preview: e.images.get(e.active.id) === preview };
    });
    expect(result).toEqual({ rejected: true, unchanged: true, revision: true, preview: true });
  });

  test('channel regression: precision composition converts differing RGB profiles and preserves alpha', async () => {
    const result = await resolvePage().evaluate(async () => {
      const { editor: e } = await import('./app.js'), { surface } = await import('./raster.js'), { commitChannelSource } = await import('./channel-workflows.js'), { composeChannels } = await import('./channel-compose.js'), { profileBytes, convertFloatChannels } = await import('./color-engine.js'), { resourceBytes } = await import('./workflow-assets.js'), { decodeChannelSource } = await import('./channel-source.js');
      e.newCanvas(2, 1); e.storePixels(e.active, surface(2, 1)); const p3 = await profileBytes('Display P3'), srgb = await profileBytes('sRGB');
      await commitChannelSource(e, e.active, { width: 2, height: 1, channels: 4, mode: 'RGB', bits: 16, data: new Float32Array([.8, .4, .2, 1, .3, .5, .7, .5]) }, p3, 'Channels');
      const original = e.assets[e.active.workflow.channelFile], source = decodeChannelSource(resourceBytes(e.assets, e.active.workflow.channelFile)), colors = new Float32Array([...source.data.slice(0, 3), ...source.data.slice(4, 7)]), expected = await convertFloatChannels(colors, 'RGB', 'RGB', p3, srgb), composed = await composeChannels(e, 'RGB', 16, srgb);
      return { colors: [...composed.data.slice(0, 3), ...composed.data.slice(4, 7)], expected: [...expected], alpha: [composed.data[3], composed.data[7]], unchanged: e.assets[e.active.workflow.channelFile] === original };
    });
    result.colors.forEach((v, i) => expect(v).toBeCloseTo(result.expected[i], 5)); expect(result.alpha[0]).toBe(1); expect(result.alpha[1]).toBeCloseTo(.5, 4); expect(result.unchanged).toBe(true);
  });

  test('channel regression: image resize preserves channel precision and scales placement through undo and reopen', async () => {
    const result = await resolvePage().evaluate(async () => {
      const { editor: e, runCommand } = await import('./app.js'), { surface } = await import('./raster.js'), { commitChannelSource } = await import('./channel-workflows.js'), { profileBytes } = await import('./color-engine.js'), { resizeDocument } = await import('./layer-operations.js');
      e.newCanvas(4, 2); const image = surface(4, 2); e.storePixels(e.active, image); const data = new Float32Array(32); for (let i = 0; i < data.length; i += 4) data.set([.12345, .5, .75, 1], i);
      await commitChannelSource(e, e.active, { width: 4, height: 2, channels: 4, mode: 'RGB', bits: 16, data }, await profileBytes('sRGB'), 'Channels'); e.active.transform.origin = [1, .5];
      const file = e.active.workflow.channelFile, original = e.assets[file]; resizeDocument(e, 8, 6, true);
      const state = () => ({ canvas: [e.manifest.width, e.manifest.height], size: e.active.transform.size, origin: e.active.transform.origin, preserved: e.assets[file] === original, preview: [e.images.get(e.active.id).width, e.images.get(e.active.id).height] }), result = { resized: state() };
      await e.install(e.projectSnapshot()); result.reopened = state(); await runCommand('undo'); result.undone = state(); await runCommand('redo'); result.redone = state(); return result;
    });
    const resized = { canvas: [8, 6], size: [8, 6], origin: [2, 1.5], preserved: true, preview: [4, 2] }; expect(result.resized).toEqual(resized); expect(result.reopened).toEqual(resized); expect(result.redone).toEqual(resized); expect(result.undone).toEqual({ canvas: [4, 2], size: [4, 2], origin: [1, .5], preserved: true, preview: [4, 2] });
  });
}
