export function fullWorkflowCases(test, expect, resolvePage) {
  test('full workflows: mixed Photoshop text sizes remain editable and survive another Photoshop export', async () => {
    const page = resolvePage();
    const result = await page.evaluate(async () => {
      const { editor:e }=await import('./app.js'),{writePsd,readPsd}=await import('./vendor/psd.js'),{parsePhotoshop}=await import('./photoshop.js'),{buildPhotoshop,binaryBase64}=await import('./psd-export.js'),{renderText,layoutText}=await import('./text-layout.js');
      const text={content:'Small BIG 中文',fontName:'ArialMT',fontSize:18,red:0,green:0,blue:0,alignment:'Left',tracking:0,leading:0,sizeRuns:[{location:6,length:3,fontSize:40}]},image=renderText(text);
      const psd={width:300,height:100,children:[{name:'Mixed text',imageData:image.getContext('2d').getImageData(0,0,image.width,image.height),text:{text:text.content,style:{font:{name:'ArialMT'},fontSize:18,fillColor:{r:0,g:0,b:0}},styleRuns:[{length:6,style:{fontSize:18}},{length:3,style:{fontSize:40}},{length:3,style:{fontSize:18}}],paragraphStyle:{justification:'left'}}}]};
      const parsed=parsePhotoshop(binaryBase64(new Uint8Array(writePsd(psd,{generateThumbnail:false}))),1000000);await e.install(parsed.snapshot);const layer=e.manifest.layers.find(l=>l.text),sizes=layer.text.sizeRuns,layout=layoutText(layer.text),roundTrip=readPsd(writePsd(buildPhotoshop(e),{generateThumbnail:false}),{useImageData:true});return{sizes,rendered:layout.lines[0].runs.map(r=>r.fontSize),exported:roundTrip.children[0].text.styleRuns.map(r=>r.style.fontSize)};
    });
    expect(result.sizes).toContainEqual({location:6,length:3,fontSize:40});expect(result.rendered).toContain(40);expect(result.exported).toContain(40);
  });

  test('full workflows: PSD artboards become independent projects with translated layers and masks', async () => {
    const page = resolvePage();
    const result = await page.evaluate(async () => {
      const { writePsd } = await import('./vendor/psd.js'), { parsePhotoshopArtboards } = await import('./photoshop-artboards.js'), { binaryBase64 } = await import('./psd-export.js');
      const image = { width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4) }; for (let i=0;i<image.data.length;i+=4) image.data.set([255,0,0,255],i);
      const mask = { width:4,height:4,data:new Uint8ClampedArray(4*4*4) }; mask.data.fill(255);
      const document={width:40,height:20,children:[{name:'中文画板',artboard:{rect:{left:10,top:4,right:20,bottom:14}},children:[{name:'Red',left:12,top:6,imageData:image,mask:{left:12,top:6,right:16,bottom:10,imageData:mask,defaultColor:0}}]},{name:'Second',artboard:{rect:{left:24,top:0,right:36,bottom:12}},children:[{name:'Red 2',left:25,top:1,imageData:image}]}]};
      const boards=await parsePhotoshopArtboards(binaryBase64(new Uint8Array(writePsd(document,{generateThumbnail:false}))),1000000);
      return boards.map((board)=>({name:board.name,width:board.snapshot.manifest.width,height:board.snapshot.manifest.height,origin:board.snapshot.manifest.layers.find((l)=>l.imageFile).transform.origin,mask:!!board.snapshot.manifest.layers.find((l)=>l.imageFile).maskFile}));
    });
    expect(result).toEqual([{name:'中文画板',width:10,height:10,origin:[2,2],mask:true},{name:'Second',width:12,height:12,origin:[1,1],mask:false}]);
  });

  test('full workflows: precision PSD/PSB channel samples retain low bits and float values on import', async () => {
    const page = resolvePage();
    const result = await page.evaluate(async () => {
      const { editor: e } = await import('./app.js'), { surface } = await import('./raster.js'), { writePsd } = await import('./vendor/psd.js'), { buildPhotoshop, binaryBase64 } = await import('./psd-export.js'), { patchPhotoshopDepth, precisionPhotoshopSources } = await import('./photoshop-precision-export.js'), { parsePhotoshopExtended } = await import('./photoshop-extended.js'), { encodeChannelSource, decodeChannelSource } = await import('./channel-source.js'), { addResource, resourceBytes } = await import('./workflow-assets.js'), { profileBytes } = await import('./color-engine.js');
      const samples = [];
      for (const bits of [16, 32]) for (const psb of [false, true]) {
        e.newCanvas(2, 1); const image = surface(2, 1); image.getContext('2d').fillStyle = '#808080'; image.getContext('2d').fillRect(0, 0, 2, 1); e.storePixels(e.active, image); const source = { width: 2, height: 1, channels: 4, mode: 'RGB', bits, data: new Float32Array([bits === 16 ? 12345 / 65535 : 1.25, .5, .25, 1, .25, .5, bits === 16 ? 43210 / 65535 : .00123, .5]) };
        e.active.workflow = { type: 'channels', channelFile: addResource(e, encodeChannelSource(source), 'channels'), bits, mode: 'RGB' }; e.manifest.workflow = { colorMode: 'RGB', bits };
        const base = new Uint8Array(writePsd(buildPhotoshop(e), { psb, generateThumbnail: false })), encoded = patchPhotoshopDepth(base, precisionPhotoshopSources(e), source, 'RGB', bits, await profileBytes('sRGB'));
        const imported = await parsePhotoshopExtended(binaryBase64(encoded), 1000000), layer = imported.snapshot.manifest.layers.find((l) => l.workflow?.channelFile), decoded = decodeChannelSource(resourceBytes(imported.snapshot.assets, layer.workflow.channelFile)); samples.push({ bits, psb, first: decoded.data[0], blue: decoded.data[6], alpha: decoded.data[7] });
      }
      return samples;
    });
    for (const sample of result) { expect(sample.first).toBeCloseTo(sample.bits === 16 ? 12345 / 65535 : 1.25, 5); expect(sample.blue).toBeCloseTo(sample.bits === 16 ? 43210 / 65535 : .00123, 5); expect(sample.alpha).toBeCloseTo(.5, 4); }
  });

  test('full workflows: LUT/live layers retain their source, masks, Fill effects and project resources', async () => {
    const page = resolvePage();
    const result = await page.evaluate(async () => {
      const { editor: e } = await import('./app.js'), { surface } = await import('./raster.js'), { addResource } = await import('./workflow-assets.js'), { createLayer } = await import('./core.js'), { storeMask } = await import('./masks.js');
      e.newCanvas(16, 8); const image = surface(16, 8); image.getContext('2d').fillStyle = '#ff0000'; image.getContext('2d').fillRect(0, 0, 16, 8); e.storePixels(e.active, image); const source = e.assets[e.active.imageFile];
      const layer = createLayer('Invert LUT', 16, 8); const text = 'LUT_1D_SIZE 2\n1 1 1\n0 0 0'; layer.workflow = { type: 'lut', file: addResource(e, new TextEncoder().encode(text), 'lookup') }; e.manifest.layers.push(layer); e.manifest.activeLayerID = layer.id; layer.opacity = .5;
      const mask = surface(16, 8); mask.getContext('2d').fillStyle = '#fff'; mask.getContext('2d').fillRect(0, 0, 8, 8); storeMask(e, layer, mask);
      const pixel = (x) => [...e.composite(true).getContext('2d').getImageData(x, 4, 1, 1).data]; const masked = pixel(12), graded = pixel(4), snapshot = e.projectSnapshot(); await e.install(snapshot);
      const reopened = pixel(4); e.manifest.layers.pop(); e.manifest.activeLayerID = e.manifest.layers[0].id; e.active.fillOpacity = 0; e.active.effects = { colorOverlay: { red: 0, green: 1, blue: 0, opacity: 1 } }; const effect = pixel(4); e.active.effects = null; const fill = pixel(4);
      return { masked, graded, reopened, source: e.assets[e.active.imageFile] === source, resources: snapshot.manifest.resources.length, effect, fill };
    });
    expect(result.masked).toEqual([255, 0, 0, 255]); expect(result.graded).toEqual([128, 128, 128, 255]); expect(result.reopened).toEqual(result.graded); expect(result.source).toBe(true); expect(result.resources).toBe(1); expect(result.effect).toEqual([0, 255, 0, 255]); expect(result.fill[3]).toBe(0);
  });

  test('full workflows: Lab channel edits preserve the other components and support undo', async () => {
    const page = resolvePage();
    await page.evaluate(async () => { const { editor: e, runCommand } = await import('./app.js'), { surface } = await import('./raster.js'); e.newCanvas(8, 4); const image = surface(8, 4); image.getContext('2d').fillStyle = '#808080'; image.getContext('2d').fillRect(0, 0, 8, 4); e.storePixels(e.active, image); e.history.reset(); window.modeOperation = runCommand('document-color-mode'); });
    await page.getByLabel('Color mode', { exact: true }).selectOption('Lab'); await page.getByLabel('Channel depth', { exact: true }).selectOption('16'); await page.getByRole('button', { name: 'Apply', exact: true }).click(); await page.evaluate(() => window.modeOperation);
    const original = await page.evaluate(async () => { const e = (await import('./app.js')).editor; return JSON.stringify(e.projectSnapshot()); });
    await page.evaluate(async () => { window.modeOperation = (await import('./app.js')).runCommand('channels'); }); await page.getByLabel('Channel', { exact: true }).selectOption('L'); await page.getByLabel('Channel operation', { exact: true }).selectOption('Fill'); await page.getByRole('spinbutton', { name: 'Channel value', exact: true }).fill('80'); await page.getByRole('button', { name: 'Apply', exact: true }).click(); await page.evaluate(() => window.modeOperation);
    expect(await page.evaluate(async () => { const e = (await import('./app.js')).editor, { decodeChannelSource } = await import('./channel-source.js'), { resourceBytes } = await import('./workflow-assets.js'); const source = decodeChannelSource(resourceBytes(e.assets, e.active.workflow.channelFile)); return Math.round(source.data[0]); })).toBe(80);
    await page.evaluate(async () => (await import('./app.js')).runCommand('undo')); expect(await page.evaluate(async () => JSON.stringify((await import('./app.js')).editor.projectSnapshot()))).toBe(original);
  });

  test('full workflows: plugins transform isolated image pixels and reject malformed output', async () => {
    const page = resolvePage();
    const result = await page.evaluate(async () => {
      const { runImagePlugin } = await import('./plugin-api.js'), source = 'function transform(image){for(let i=0;i<image.data.length;i+=4)image.data[i]=255-image.data[i];return image;}', image = new ImageData(new Uint8ClampedArray([20, 30, 40, 128]), 1, 1);
      const good = [...await runImagePlugin(source, image)]; let refused = false;
      try { await runImagePlugin('function transform(image){return {width:1,height:1,data:new Uint8ClampedArray(2)}}', image); } catch { refused = true; }
      const isolated = [...await runImagePlugin('function transform(image){image.data[0]=typeof fetch==="undefined"&&typeof window==="undefined"&&typeof require==="undefined"&&typeof indexedDB==="undefined"?1:0;return image;}', image)];
      return { good, refused, isolated: isolated[0] };
    });
    expect(result).toEqual({ good: [235, 30, 40, 128], refused: true, isolated: 1 });
  });

  test('full workflows: OpenRaster export includes a standard layer stack and a complete editable round-trip', async () => {
    const page = resolvePage();
    const result = await page.evaluate(async () => {
      const { editor: e } = await import('./app.js'), { surface } = await import('./raster.js'), { encodeOpenRaster, decodeOpenRaster } = await import('./openraster.js'), { unzipSync } = await import('./vendor/archive.js');
      e.newCanvas(12, 8); const image = surface(12, 8); image.getContext('2d').fillStyle = '#ff0000'; image.getContext('2d').fillRect(0, 0, 12, 8); e.storePixels(e.active, image); e.name = '中文 ORA'; const original = e.projectSnapshot(), bytes = encodeOpenRaster(e), files = unzipSync(bytes), reopened = await decodeOpenRaster(bytes); await e.install(reopened);
      return { mime: new TextDecoder().decode(files.mimetype), stack: new TextDecoder().decode(files['stack.xml']), manifest: JSON.stringify(reopened.manifest) === JSON.stringify(original.manifest), pixel: [...e.composite(true).getContext('2d').getImageData(2, 2, 1, 1).data] };
    });
    expect(result.mime).toBe('image/openraster'); expect(result.stack).toContain('<layer'); expect(result.manifest).toBe(true); expect(result.pixel).toEqual([255, 0, 0, 255]);
  });

  test('full workflows: appearance follows system changes, persists and preserves the document', async () => {
    const page = resolvePage();
    const before = await page.evaluate(async () => { const e = (await import('./app.js')).editor; e.newCanvas(30, 20); return JSON.stringify(e.projectSnapshot()); });
    await page.getByLabel('Appearance', { exact: true }).selectOption('Light'); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate(async () => JSON.stringify((await import('./app.js')).editor.projectSnapshot()))).toBe(before);
    await page.getByLabel('Appearance', { exact: true }).selectOption('System'); await page.emulateMedia({ colorScheme: 'dark' }); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.emulateMedia({ colorScheme: 'light' }); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByLabel('Appearance', { exact: true }).selectOption('Dark'); await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('full workflows: Dodge/Burn strokes honor selection holes, cap stroke opacity and undo as one edit', async () => {
    const page = resolvePage();
    await page.evaluate(async () => {
      const { editor: e } = await import('./app.js'), { surface, alphaSurface } = await import('./raster.js');
      e.newCanvas(48, 32); const image = surface(48, 32); image.getContext('2d').fillStyle = '#808080'; image.getContext('2d').fillRect(0, 0, 48, 32); e.storePixels(e.active, image); e.brushSize = 16; e.brushHardness = 1; e.brushOpacity = .5;
      const mask = new Uint8Array(48 * 32); mask.fill(255); for (let y = 10; y < 22; y++) for (let x = 26; x < 38; x++) mask[y * 48 + x] = 0;
      e.selection = { x: 0, y: 0, width: 48, height: 32, coverage: alphaSurface(mask, 48, 32) }; e.history.reset(); e.update();
    });
    await page.locator('[data-tool=brush]').click(); await page.getByLabel('Brush mode', { exact: true }).selectOption('Dodge');
    const point = (x) => page.evaluate(async (x) => { const e = (await import('./app.js')).editor, r = e.overlay.getBoundingClientRect(); return { x: r.x + e.pan.x + x * e.zoom, y: r.y + e.pan.y + 16 * e.zoom }; }, x);
    const a = await point(14), b = await point(32); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
    const sample = (x) => page.evaluate(async (x) => { const e = (await import('./app.js')).editor; return [...e.images.get(e.active.id).getContext('2d').getImageData(x, 16, 1, 1).data]; }, x);
    expect((await sample(14))[0]).toBeGreaterThan(128); expect(await sample(32)).toEqual([128, 128, 128, 255]);
    expect(await page.evaluate(async () => (await import('./app.js')).editor.history.past.length)).toBe(1);
    await page.evaluate(async () => (await import('./app.js')).runCommand('undo')); expect(await sample(14)).toEqual([128, 128, 128, 255]);
    await page.getByLabel('Dodge/Burn exposure', { exact: true }).fill('0'); await page.mouse.click(a.x, a.y);
    expect(await page.evaluate(async () => (await import('./app.js')).editor.history.past.length)).toBe(0);
  });
}
