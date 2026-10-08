import { test, expect, chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { png, project } from './fixtures.mjs';
import store from '../lib/project.cjs';
import { writePsdBuffer } from 'ag-psd';
import { rgbTiff, cameraDng } from './tiff-fixtures.mjs';
import { compatibilityFixture } from './compatibility-fixture.mjs';
import { parityCases } from './parity-cases.mjs';
import { enhancementCases } from './enhancement-cases.mjs';
import { vectorCases } from './vector-cases.mjs';
import { filterMaskCases } from './filter-mask-cases.mjs';
import { smartHDRCases } from './smart-hdr-cases.mjs';
import { openEXRCases } from './openexr-cases.mjs';
import { advancedEXRCases } from './exr-advanced-cases.mjs';
import { professionalCases } from './professional-cases.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
let application, browser, page, directory, errors;
vectorCases(test, expect, () => page);
filterMaskCases(test, expect, () => page);
smartHDRCases(test, expect, () => page);
openEXRCases(test, expect, () => page);
advancedEXRCases(test, expect, () => page);
parityCases(test, expect, () => page);
enhancementCases(test, expect, () => page);
professionalCases(test, expect, () => page);

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test.beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'compositor-ui-'));
  errors = []; browser = null; page = null;
  await launchApplication();
});
async function launchApplication() {
  const port = await freePort();
  const env = { ...process.env, COMPOSITOR_TEST: '1', COMPOSITOR_TEST_DIRECTORY: directory, COMPOSITOR_TEST_PORT: String(port) };
  const executable = process.env.COMPOSITOR_TEST_EXE || path.join(root, 'windows', 'bin', 'Release', 'net48', 'Compositor.exe');
  application = spawn(executable, [], { env, windowsHide: true, stdio: 'pipe' });
  let startupError; application.on('error', (error) => { startupError = error; });
  await expect.poll(async () => {
    if (startupError) throw startupError;
    const error = await fs.readFile(path.join(directory, 'host-error.log'), 'utf8').catch(() => null);
    if (error) throw new Error(error);
    try { const response = await fetch(`http://127.0.0.1:${port}/json/version`); return response.ok; } catch { return false; }
  }, { timeout: 30000 }).toBe(true);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  await expect.poll(() => browser.contexts().flatMap((context) => context.pages()).length).toBeGreaterThan(0);
  page = browser.contexts().flatMap((context) => context.pages())[0];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByRole('heading', { name: 'Welcome to Compositor' })).toBeVisible({ timeout: 30000 });
}
test.afterEach(async () => {
  try { expect(errors).toEqual([]); }
  finally {
    await browser?.close().catch(() => {});
    if (application && application.exitCode == null) {
      const exited = new Promise((resolve) => application.once('exit', resolve)); application.kill(); await exited;
    }
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
  }
});

async function createCanvas(width = 320, height = 240) {
  await page.getByRole('button', { name: 'Create canvas', exact: true }).click();
  await page.locator('#new-width').fill(String(width)); await page.locator('#new-height').fill(String(height));
  await page.locator('#new-dialog').getByRole('button', { name: 'Create canvas' }).click();
  await expect(page.locator('#dimensions')).toHaveText(`${width.toLocaleString()} × ${height.toLocaleString()} px`);
}

test('native recovery survives forced Windows host termination and saves as a new project', async () => {
  test.setTimeout(90000); await createCanvas(64, 48);
  await page.evaluate(async () => {
    const { editor: e } = await import('./app.js'), { surface } = await import('./raster.js');
    const canvas = surface(64, 48), ctx = canvas.getContext('2d'); ctx.fillStyle = '#33aa66'; ctx.fillRect(0, 0, 64, 48); e.storePixels(e.active, canvas); e.name = 'Crash draft'; e.update(); await e.recovery.flush();
  });
  const exited = new Promise((resolve) => application.once('exit', resolve)); application.kill(); await exited;
  await browser.close().catch(() => {}); await launchApplication();
  await page.locator('#recovery-status').click(); await page.getByRole('button', { name: 'Recover', exact: true }).click();
  await expect(page.locator('#document-title')).toHaveText('Crash draft'); expect(await pixels(20, 20)).toEqual([51, 170, 102, 255]);
  await dialogs({ save: path.join(directory, 'Recovered.comp') });
  await page.evaluate(async () => (await import('./app.js')).runCommand('save'));
  await expect(page.locator('#status-message')).toHaveText('Project saved');
  const projects = (await fs.readdir(directory)).filter((name) => name.endsWith('.comp')); expect(projects.length).toBe(1);
  const reopened = await store.readProject(path.join(directory, projects[0])); expect(reopened.manifest.width).toBe(64);
  expect(await page.evaluate(async () => (await new (await import('./recovery-store.js')).RecoveryStore().list()).length)).toBe(0);
});

test('native HDR export and smart/HDR project saving retain the original float source', async () => {
  await page.evaluate(async () => { const { editor: e, runCommand } = await import('./app.js'), { importHDRSource } = await import('./hdr-workflows.js'); e.newCanvas(2, 1); await importHDRSource(e, { width: 2, height: 1, data: new Float32Array([4, .25, -.125, 1, 8, 1, 2, .5]), bits: 32 }); await runCommand('smart-convert'); });
  const exportTarget = path.join(directory, 'Float32.tiff'); await dialogs({ save: exportTarget }); await page.evaluate(async () => (await import('./app.js')).runCommand('export-hdr'));
  const codec = (await import('../lib/float-tiff.cjs')).default; expect([...codec.decodeFloatTIFF(new Uint8Array(await fs.readFile(exportTarget))).data]).toEqual([4, .25, -.125, 1, 8, 1, 2, .5]);
  const projectTarget = path.join(directory, 'SmartHDR.comp'); await dialogs({ save: projectTarget }); await page.evaluate(async () => (await import('./app.js')).runCommand('save'));
  const snapshot = await store.readProject(projectTarget), layer = snapshot.manifest.layers.at(-1); expect(snapshot.manifest.version).toBe(16); expect(layer.smartObject.width).toBe(2); expect(codec.decodeFloatTIFF(Buffer.from(snapshot.assets[layer.hdrSourceFile], 'base64')).data[0]).toBe(4);
});

test('native OpenEXR image picker and export save dialog retain floating highlights and alpha', async () => {
  const file = path.join(directory, 'Reference.exr'); await fs.copyFile(new URL('./fixtures/openexr/rgba-32-zip.exr', import.meta.url), file); await dialogs({ open: file });
  await page.evaluate(async () => { window.exrNativeOperation = (await import('./app.js')).runCommand('import'); });
  await page.locator('dialog[open]').last().getByRole('button', { name: 'Apply', exact: true }).click(); await page.evaluate(() => window.exrNativeOperation);
  expect(await page.evaluate(async () => !!(await import('./app.js')).editor.active.hdrSourceFile)).toBe(true);
  const target = path.join(directory, 'Composite.exr'); await dialogs({ save: target }); await page.evaluate(async () => { window.exrNativeOperation = (await import('./app.js')).runCommand('export-exr'); });
  const dialog = page.locator('dialog[open]').last(); await dialog.locator('[data-setting="compression"]').selectOption('ZIPS'); await dialog.getByRole('button', { name: 'Apply', exact: true }).click(); await page.evaluate(() => window.exrNativeOperation);
  const { decodeOpenEXR } = await import('../renderer/openexr.js'), source = decodeOpenEXR(new Uint8Array(await fs.readFile(target))); expect(source.width).toBe(9); expect(source.height).toBe(23); expect([...source.data.slice((2 * 9 + 3) * 4, (2 * 9 + 3) * 4 + 4)]).toEqual([5, .125, -.125, .5]);
});
test('native EXR advanced original export returns every Deep sample byte unchanged', async () => {
  const bytes = await fs.readFile(new URL('./fixtures/openexr/deep-tiled.exr', import.meta.url)), file = path.join(directory, 'Deep.exr'); await fs.writeFile(file, bytes); await dialogs({ open: file });
  await page.evaluate(async () => { window.originalEXR = (await import('./app.js')).runCommand('import'); }); await page.locator('dialog[open]').last().getByRole('button', { name: 'Apply', exact: true }).click(); await page.evaluate(() => window.originalEXR);
  const target = path.join(directory, 'Original.exr'); await dialogs({ save: target }); await page.evaluate(async () => (await import('./app.js')).runCommand('export-exr-original')); expect(await fs.readFile(target)).toEqual(bytes);
});
test('native EXR advanced exports visible layers as PIZ tiled parts', async () => {
  const file = path.join(directory, 'Multi.exr'); await fs.copyFile(new URL('./fixtures/openexr/multipart.exr', import.meta.url), file); await dialogs({ open: file });
  await page.evaluate(async () => { window.multiEXR = (await import('./app.js')).runCommand('import'); }); await page.locator('[data-setting="parts"]').selectOption('All image parts'); await page.locator('dialog[open]').last().getByRole('button', { name: 'Apply', exact: true }).click(); await page.evaluate(() => window.multiEXR);
  const target = path.join(directory, 'Parts.exr'); await dialogs({ save: target }); await page.evaluate(async () => { window.multiEXR = (await import('./app.js')).runCommand('export-exr'); });
  await page.locator('[data-setting="parts"]').selectOption('Visible layers as parts'); await page.locator('[data-setting="layout"]').selectOption('Tiled'); await page.locator('dialog[open]').last().getByRole('button', { name: 'Apply', exact: true }).click(); await page.evaluate(() => window.multiEXR);
  const { decodeEXR } = await import('../renderer/exr-codec.js'); expect((await decodeEXR(new Uint8Array(await fs.readFile(target)), { part: 1 })).data[4]).toBe(10);
});

test('native PSD export writes a layered document through the Windows save dialog', async () => {
  await createCanvas(64, 48);
  await page.evaluate(async () => { const { editor: e } = await import('./app.js'), { surface } = await import('./raster.js'); const image = surface(64, 48); image.getContext('2d').fillStyle = '#336699'; image.getContext('2d').fillRect(0, 0, 64, 48); e.storePixels(e.active, image); e.update(); });
  const target = path.join(directory, 'Layered.psd'); await dialogs({ save: target });
  await page.evaluate(async () => { window.exportOperation = (await import('./app.js')).runCommand('export-psd'); });
  await page.locator('dialog[open]').getByRole('button', { name: 'Apply', exact: true }).click(); await page.evaluate(() => window.exportOperation);
  const { readPsd } = await import('ag-psd'), bytes = await fs.readFile(target), parsed = readPsd(bytes, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
  expect(bytes.subarray(0, 4).toString()).toBe('8BPS'); expect(parsed.width).toBe(64); expect(parsed.children).toHaveLength(1);
});

test('native TIFF export retains sixteen-bit samples and installs the output atomically', async () => {
  await createCanvas(2, 1);
  await page.evaluate(async () => {
    const { editor: e } = await import('./app.js'), { surface } = await import('./raster.js'), { encodePNG16 } = await import('./png-pixels.js'), { binaryBase64 } = await import('./psd-export.js'), { profileBytes } = await import('./color-engine.js'), { adjustmentDefaults } = await import('./adjustments.js');
    const image = surface(2, 1); image.getContext('2d').fillRect(0, 0, 2, 1); e.storePixels(e.active, image);
    e.active.filterSourceFile = `${e.active.id}.source.png`; e.assets[e.active.filterSourceFile] = binaryBase64(await encodePNG16({ width: 2, height: 1, data: new Uint16Array([12345, 23456, 34567, 65535, 12346, 23457, 34568, 65535]), profile: await profileBytes('sRGB') })); e.active.filterWorkingSpace = 'sRGB'; e.active.filters = [{ id: crypto.randomUUID().toUpperCase(), enabled: false, adjustment: adjustmentDefaults('Exposure') }]; e.update();
  });
  const target = path.join(directory, 'Precision.tiff'); await fs.writeFile(target, 'previous export'); await dialogs({ save: target });
  await page.evaluate(async () => { window.exportOperation = (await import('./app.js')).runCommand('color-export'); });
  await expect(page.locator('.processing-status')).toHaveText('Preview ready'); await page.locator('dialog[open]').getByRole('button', { name: 'Apply', exact: true }).click(); await page.evaluate(() => window.exportOperation);
  const { decodePrecisionFile } = await import('../renderer/precision-raster.js'), decoded = await decodePrecisionFile(new Uint8Array(await fs.readFile(target)), 'Precision.tiff'); expect(decoded.bits).toBe(16); expect([...decoded.data]).toEqual([12345, 23456, 34567, 65535, 12346, 23457, 34568, 65535]);
  expect((await fs.readdir(directory)).filter((name) => name.startsWith('.compositor-export-'))).toEqual([]);
});
async function pixels(x, y) {
  return page.evaluate(async ({ x, y }) => {
    const { editor } = await import('./app.js');
    return [...editor.composite(true).getContext('2d').getImageData(x, y, 1, 1).data];
  }, { x, y });
}
async function coordinates(x, y) {
  return page.evaluate(async ({ x, y }) => {
    const { editor } = await import('./app.js'), bounds = editor.viewport.getBoundingClientRect();
    return { x: bounds.x + editor.pan.x + x * editor.zoom, y: bounds.y + editor.pan.y + y * editor.zoom };
  }, { x, y });
}
async function draw(x1, y1, x2, y2) {
  const start = await coordinates(x1, y1), end = await coordinates(x2, y2);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 12 }); await page.mouse.up();
}
async function dialogs({ open, save } = {}) {
  await fs.writeFile(path.join(directory, 'dialogs.json'), JSON.stringify({ open, save }));
}

test('paint, erase, selection, crop, and undo change real exported pixels', async () => {
  await createCanvas();
  await page.getByRole('button', { name: 'Brush tool', exact: true }).click();
  await page.locator('#brush-hardness').focus(); await page.locator('#brush-hardness').press('End');
  await draw(60, 80, 200, 80);
  expect(await pixels(120, 80)).toEqual([88, 166, 255, 255]);
  expect((await pixels(120, 160))[3]).toBe(0);
  await page.getByRole('button', { name: 'Eraser tool', exact: true }).click(); await draw(120, 80, 120, 80);
  expect((await pixels(120, 80))[3]).toBe(0);
  await page.locator('#undo').click(); expect((await pixels(120, 80))[3]).toBe(255);
  await page.getByRole('button', { name: 'Selection tool', exact: true }).click(); await draw(40, 40, 220, 180);
  await page.getByRole('button', { name: 'Crop to selection' }).click();
  await expect(page.locator('#dimensions')).toHaveText('180 × 140 px');
  expect(await pixels(80, 40)).toEqual([88, 166, 255, 255]);
  await page.locator('#undo').click(); await expect(page.locator('#dimensions')).toHaveText('320 × 240 px');
  await page.screenshot({ path: path.join(root, 'test-results', 'paint-and-selection.png') });
});

test('native project save and reopen preserve layers, transformations, pixels, and clean state', async () => {
  await createCanvas();
  await page.getByRole('button', { name: 'Shape tool', exact: true }).click(); await draw(20, 30, 140, 120);
  await page.getByRole('button', { name: 'Move tool', exact: true }).click();
  await page.getByLabel('Layer X', { exact: true }).fill('40'); await page.getByLabel('Layer X', { exact: true }).press('Tab');
  await page.getByLabel('Layer opacity', { exact: true }).fill('50'); await page.getByLabel('Layer opacity', { exact: true }).press('Tab');
  const target = path.join(directory, 'Windows.comp'); await dialogs({ save: target });
  await page.getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.locator('#status-message')).toHaveText('Project saved');
  const snapshot = await store.readProject(target);
  expect(snapshot.manifest.version).toBe(16); expect(snapshot.manifest.layers).toHaveLength(2);
  expect(snapshot.manifest.layers[1].transform.origin).toEqual([40, 30]); expect(snapshot.manifest.layers[1].opacity).toBe(0.5);
  await expect(page.locator('#document-dirty')).toHaveText('');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.locator('#new-dialog').getByRole('button', { name: 'Create canvas' }).click();
  await dialogs({ open: target }); await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.locator('#document-title')).toHaveText('Windows'); await expect(page.locator('#layer-count')).toHaveText('2');
  expect((await pixels(80, 60))[3]).toBe(128);
  await page.getByRole('button', { name: 'Duplicate layer', exact: true }).click(); await expect(page.locator('#layer-count')).toHaveText('3');
  await page.locator('#undo').click(); await expect(page.locator('#layer-count')).toHaveText('2');
  await page.screenshot({ path: path.join(root, 'test-results', 'windows-editor.png') });
});

test('import and PNG/JPEG export use native filesystem dialogs and real image encoders', async () => {
  const source = path.join(directory, 'red.png'); await fs.writeFile(source, png(32, 24));
  await dialogs({ open: source }); await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.locator('#dimensions')).toHaveText('32 × 24 px'); expect(await pixels(5, 5)).toEqual([255, 0, 0, 255]);
  const target = path.join(directory, 'export.png'); await dialogs({ save: target });
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click(); await expect(page.locator('#status-message')).toHaveText('Image exported');
  expect(store.inspectPNG(await fs.readFile(target))).toMatchObject({ width: 32, height: 24 });
  const jpeg = path.join(directory, 'export.jpg'); await dialogs({ save: jpeg });
  await page.evaluate(async () => { const { runCommand } = await import('./app.js'); void runCommand('export-jpeg'); });
  await page.locator('.jpeg-dialog').getByRole('button', { name: 'Export', exact: true }).click(); await expect(page.locator('#status-message')).toHaveText('Image exported');
  expect((await fs.readFile(jpeg)).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
});

test('Mac grayscale masks and pass-through folders render without losing original assets', async () => {
  const snapshot = project(), layer = snapshot.manifest.layers[0];
  layer.transform.origin = [0, 0]; layer.maskFile = `${layer.id}.mask.png`; layer.maskEnabled = true;
  snapshot.assets[layer.maskFile] = png(4, 4, [128], true).toString('base64');
  const folder = structuredClone(layer); folder.id = crypto.randomUUID().toUpperCase(); folder.name = 'Folder'; folder.isGroup = true; folder.opacity = 0.5;
  delete folder.imageFile; delete folder.maskFile; delete folder.maskEnabled;
  layer.parentID = folder.id; snapshot.manifest.layers.push(folder);
  const source = path.join(directory, 'Masked.comp'); await store.writeProject(source, snapshot);
  await dialogs({ open: source }); await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.locator('#document-title')).toHaveText('Masked'); expect((await pixels(1, 1))[3]).toBe(64);
  await page.evaluate(async () => { const { editor } = await import('./app.js'); editor.mutate('Rename', () => { editor.active.name = 'Changed'; }); });
  await page.getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.locator('#status-message')).toHaveText('Project saved');
  const saved = await store.readProject(source); expect(saved.assets[layer.maskFile]).toBe(snapshot.assets[layer.maskFile]);
});

test('Mac adjustment layers open and change the composite pixels', async () => {
  await createCanvas();
  const snapshot = project(), layer = structuredClone(snapshot.manifest.layers[0]); layer.id = crypto.randomUUID().toUpperCase(); delete layer.imageFile; layer.adjustment = { kind: 'Invert', hue: 0, saturation: 0, lightness: 0, colorize: false, levels: { channel: 'RGB', ranges: Array.from({length: 4}, () => ({ black: 0, white: 255, gamma: 1, outputBlack: 0, outputWhite: 255 })) }, curves: { channel: 'RGB', channels: Array.from({length: 4}, () => [{x: 0, y: 0}, {x: 255, y: 255}]) } }; snapshot.manifest.layers.push(layer);
  const source = path.join(directory, 'Adjustment.comp'); await store.writeProject(source, snapshot);
  await dialogs({ open: source }); await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.locator('#dimensions')).toHaveText('64 × 48 px'); expect(await pixels(3, 4)).toEqual([0, 255, 255, 255]);
});

test('failed native save preserves the saved package and leaves new edits dirty', async () => {
  await createCanvas();
  const destination = path.join(directory, 'Keep.comp'); await dialogs({ save: destination });
  await page.getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.locator('#status-message')).toHaveText('Project saved');
  const original = await store.readProject(destination);
  await page.getByRole('button', { name: 'Add layer', exact: true }).click();
  const result = await page.evaluate(async () => {
    const { editor } = await import('./app.js'), snapshot = editor.projectSnapshot();
    snapshot.manifest.layers[0].imageFile = `${snapshot.manifest.layers[0].id}.png`;
    return await window.desktop.saveProject(snapshot, false);
  });
  expect(result.ok).toBe(false); expect(await store.readProject(destination)).toEqual(original);
  await expect(page.locator('#document-dirty')).toHaveText('•');
});

test('keyboard shortcuts edit the document and canceling replacement retains unsaved work', async () => {
  await createCanvas(); await page.locator('#viewport').focus();
  await page.keyboard.press('Control+Shift+N'); await expect(page.locator('#layer-count')).toHaveText('2');
  await page.keyboard.press('Control+z'); await expect(page.locator('#layer-count')).toHaveText('1');
  await page.keyboard.press('Control+Shift+z'); await expect(page.locator('#layer-count')).toHaveText('2');
  await page.keyboard.press('Control+w'); await expect(page.locator('#confirm-dialog')).toBeVisible();
  await page.locator('#confirm-dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#dimensions')).toHaveText('320 × 240 px'); await expect(page.locator('#layer-count')).toHaveText('2');
});

test('adjustment layers and effects are editable and survive native saving', async () => {
  const source = path.join(directory, 'red.png'); await fs.writeFile(source, png(32, 24)); await dialogs({ open: source });
  await page.getByRole('button', { name: 'Import', exact: true }).click(); await expect(page.locator('#dimensions')).toHaveText('32 × 24 px');
  await page.locator('.editor-menus summary').filter({ hasText: /^Adjust$/ }).click(); await page.locator('[data-advanced="adjust:Invert"]').click();
  await page.locator('.settings-dialog').getByRole('button', { name: 'Apply' }).click(); expect(await pixels(5, 5)).toEqual([0, 255, 255, 255]);
  const target = path.join(directory, 'Adjusted.comp'); await dialogs({ save: target }); await page.getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.locator('#status-message')).toHaveText('Project saved');
  const saved = await store.readProject(target); expect(saved.manifest.layers[1].adjustment.kind).toBe('Invert');
  await page.locator('#undo').click(); expect(await pixels(5, 5)).toEqual([255, 0, 0, 255]);
});

test('painting a grayscale mask hides pixels without altering the image resource', async () => {
  const source = path.join(directory, 'red.png'); await fs.writeFile(source, png(100, 100)); await dialogs({ open: source });
  await page.getByRole('button', { name: 'Import', exact: true }).click(); await expect(page.locator('#dimensions')).toHaveText('100 × 100 px');
  await page.locator('.editor-menus summary').filter({ hasText: /^Layer$/ }).click(); await page.locator('[data-advanced="mask:Add Mask"]').click();
  await page.locator('#paint-color').fill('#000000'); await page.getByRole('button', { name: 'Brush tool', exact: true }).click(); await page.locator('#brush-hardness').focus(); await page.locator('#brush-hardness').press('End');
  await draw(50, 50, 50, 50); expect((await pixels(50, 50))[3]).toBe(0); expect(await pixels(5, 5)).toEqual([255, 0, 0, 255]);
  const target = path.join(directory, 'Mask.comp'); await dialogs({ save: target }); await page.getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.locator('#status-message')).toHaveText('Project saved');
  const snapshot = await store.readProject(target), record = snapshot.manifest.layers[0]; expect(record.maskFile).toBeTruthy();
  expect(Buffer.from(snapshot.assets[record.maskFile], 'base64')[25]).toBe(0);
  await page.locator('#undo').click(); expect((await pixels(50, 50))[3]).toBe(255);
});

test('project tabs keep independent history and save destinations', async () => {
  await createCanvas(80, 60); const first = path.join(directory, 'First.comp'); await dialogs({ save: first });
  await page.getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.locator('#status-message')).toHaveText('Project saved');
  await page.getByRole('button', { name: 'New', exact: true }).click(); await page.locator('#new-width').fill('120'); await page.locator('#new-dialog').getByRole('button', { name: 'Create canvas' }).click();
  const second = path.join(directory, 'Second.comp'); await dialogs({ save: second }); await page.getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.locator('#document-title')).toHaveText('Second');
  await page.locator('.project-tab').filter({ hasText: 'First' }).click(); await expect(page.locator('#dimensions')).toHaveText('80 × 60 px');
  await page.getByRole('button', { name: 'Add layer', exact: true }).click(); await page.getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.locator('#status-message')).toHaveText('Project saved');
  expect((await store.readProject(first)).manifest.layers).toHaveLength(2); expect((await store.readProject(second)).manifest.layers).toHaveLength(1);
});

test('PSD and PSB imports preserve separate layers through the conversion report', async () => {
  for (const psb of [false, true]) {
    const imageData = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4) }; for (let i = 0; i < imageData.data.length; i += 4) imageData.data.set([0, 255, 0, 255], i);
    const bytes = writePsdBuffer({ width: 8, height: 8, imageData, children: [{ name: 'Green pixels', imageData }] }, { psb, generateThumbnail: false });
    const source = path.join(directory, psb ? 'source.psb' : 'source.psd'); await fs.writeFile(source, bytes); await dialogs({ open: source });
    await page.getByRole('button', { name: 'Import', exact: true }).click(); const report = page.locator('dialog').filter({ has: page.getByRole('heading', { name: 'Photoshop conversion' }) });
    await expect(report).toBeVisible(); await report.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.locator('#dimensions')).toHaveText('8 × 8 px'); expect(await pixels(3, 3)).toEqual([0, 255, 0, 255]);
  }
  await expect(page.locator('#layer-count')).toHaveText('2');
});

test('Camera Raw uses the shared pixel kernel and cancellation restores pixels', async () => {
  const source = path.join(directory, 'gray.png'); await fs.writeFile(source, png(16, 16, [100, 100, 100, 255])); await dialogs({ open: source });
  await page.getByRole('button', { name: 'Import', exact: true }).click(); await expect(page.locator('#dimensions')).toHaveText('16 × 16 px');
  await page.locator('.editor-menus summary').filter({ hasText: /^Image$/ }).click(); await page.locator('[data-advanced="camera-raw"]').click();
  await page.locator('[data-setting="exposure"]').fill('1'); await expect.poll(async () => (await pixels(5, 5))[0]).toBeGreaterThan(100);
  await page.locator('.settings-dialog').getByRole('button', { name: 'Cancel' }).click(); await expect.poll(() => pixels(5, 5)).toEqual([100, 100, 100, 255]);
});

test('local subject inference produces a bounded mask without an image upload', async () => {
  const result = await page.evaluate(async () => {
    const { surface } = await import('./raster.js'), { subjectMask } = await import('./subject.js'); const canvas = surface(64, 64), ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 64, 64); ctx.fillStyle = '#203047'; ctx.fillRect(20, 10, 24, 44);
    const mask = await subjectMask(canvas); return { width: mask.width, height: mask.height, pixels: mask.getContext('2d').getImageData(0, 0, 64, 64).data.length };
  });
  expect(result).toEqual({ width: 64, height: 64, pixels: 64 * 64 * 4 });
});

test('TIFF and SVG are decoded at their document dimensions', async () => {
  const tiff = path.join(directory, 'test.tiff'); await fs.writeFile(tiff, rgbTiff()); await dialogs({ open: tiff });
  await page.getByRole('button', { name: 'Import', exact: true }).click(); await expect(page.locator('#dimensions')).toHaveText('16 × 12 px'); expect(await pixels(5, 5)).toEqual([200, 80, 40, 255]);
  const svg = path.join(directory, 'test.svg'); await fs.writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12"><rect width="16" height="12" fill="#008000"/></svg>'); await dialogs({ open: svg });
  await page.getByRole('button', { name: 'Import', exact: true }).click(); await expect(page.locator('#layer-count')).toHaveText('2'); expect(await pixels(5, 5)).toEqual([0, 128, 0, 255]);
});

test('camera RAW develops sensor data through LibRaw before importing pixels', async () => {
  const source = path.join(directory, 'synthetic.dng'); await fs.writeFile(source, cameraDng()); await dialogs({ open: source });
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Develop Camera RAW' })).toBeVisible(); await page.locator('.settings-dialog').getByRole('button', { name: 'Apply' }).click();
  await expect(page.locator('#dimensions')).toHaveText('64 × 64 px'); expect((await pixels(32, 32))[3]).toBe(255);
});

test('HEIC decoding uses the bundled codec', async () => {
  const fixture = path.join(root, 'tests', 'fixtures', 'example.heic'), source = path.join(directory, 'example.heic'); await fs.copyFile(fixture, source); await dialogs({ open: source });
  await page.getByRole('button', { name: 'Import', exact: true }).click(); await expect(page.locator('#layer-count')).toHaveText('1');
  const dimensions = await page.evaluate(async () => { const { editor } = await import('./app.js'); return [editor.manifest.width, editor.manifest.height]; });
  expect(dimensions[0]).toBeGreaterThan(100); expect(dimensions[1]).toBeGreaterThan(100); expect((await pixels(20, 20))[3]).toBe(255);
});

test('inline text edits retain editable metadata and can be undone', async () => {
  await createCanvas(640, 480); await page.getByRole('button', { name: 'Type tool', exact: true }).click(); await draw(40, 50, 440, 250);
  const input = page.getByRole('textbox', { name: 'Edit text on canvas' }); await expect(input).toBeVisible(); await input.fill('Windows text\nSecond line');
  await page.getByRole('button', { name: 'Apply text', exact: true }).click(); await expect(page.locator('#layer-count')).toHaveText('2');
  const target = path.join(directory, 'Text.comp'); await dialogs({ save: target }); await page.getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.locator('#status-message')).toHaveText('Project saved');
  const saved = await store.readProject(target), layer = saved.manifest.layers[1]; expect(layer.text.content).toContain('Windows text'); expect(layer.text.boxSize).toHaveLength(2); expect(layer.imageFile).toBeTruthy();
  await page.locator('#undo').click(); await expect(page.locator('#layer-count')).toHaveText('1');
});

test('copies with the same document ID have independent native save targets', async () => {
  const original = project(), first = path.join(directory, 'Original.comp'), second = path.join(directory, 'Copy.comp'); await store.writeProject(first, original); await store.writeProject(second, original);
  await dialogs({ open: first }); await page.getByRole('button', { name: 'Open', exact: true }).click(); await expect(page.locator('#document-title')).toHaveText('Original');
  await dialogs({ open: second }); await page.getByRole('button', { name: 'Open', exact: true }).click(); await expect(page.locator('#document-title')).toHaveText('Copy'); await expect(page.locator('.project-tab')).toHaveCount(2);
  await page.getByRole('button', { name: 'Add layer', exact: true }).click(); await page.getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.locator('#status-message')).toHaveText('Project saved');
  expect((await store.readProject(first)).manifest.layers).toHaveLength(1); expect((await store.readProject(second)).manifest.layers).toHaveLength(2);
});

test('clipping stacks preserve a semitransparent base alpha', async () => {
  const snapshot = project(), base = snapshot.manifest.layers[0]; base.opacity = .5;
  const top = structuredClone(base); top.id = crypto.randomUUID().toUpperCase(); top.name = 'Clipped'; top.opacity = 1; top.maskSourceID = base.id; top.imageFile = `${top.id}.png`; snapshot.manifest.layers.push(top); snapshot.assets[top.imageFile] = png(4, 4, [0, 255, 0, 255]).toString('base64');
  const source = path.join(directory, 'Clipping.comp'); await store.writeProject(source, snapshot); await dialogs({ open: source }); await page.getByRole('button', { name: 'Open', exact: true }).click(); await expect(page.locator('#layer-count')).toHaveText('2');
  const pixel = await pixels(3, 4); expect(pixel[3]).toBe(128); expect(pixel[1]).toBe(255); expect(pixel[0]).toBe(0);
});

test('painting past source bounds expands pixels and undo restores the original bounds', async () => {
  await createCanvas(200, 140); const source = path.join(directory, 'small.png'); await fs.writeFile(source, png(20, 20)); await dialogs({ open: source }); await page.getByRole('button', { name: 'Import', exact: true }).click(); await expect(page.locator('#layer-count')).toHaveText('2');
  await page.getByRole('button', { name: 'Brush tool', exact: true }).click(); await page.locator('#brush-size').fill('12'); await page.locator('#brush-size').press('Tab'); await draw(100, 70, 145, 70);
  expect((await pixels(140, 70))[3]).toBeGreaterThan(0);
  await page.locator('#undo').click(); expect((await pixels(140, 70))[3]).toBe(0);
});

test('Windows writes the cross-platform fixture with all adjustment and effect records intact', async () => {
  const snapshot = compatibilityFixture(), source = path.join(directory, 'CrossPlatform.comp'); await store.writeProject(source, snapshot); await dialogs({ open: source });
  await page.getByRole('button', { name: 'Open', exact: true }).click(); await expect(page.locator('#layer-count')).toHaveText('17');
  const destination = path.join(directory, 'WindowsRoundTrip.comp'); await dialogs({ save: destination });
  await page.evaluate(async () => { const { runCommand } = await import('./app.js'); await runCommand('save-as'); });
  const saved = await store.readProject(destination); expect(saved.manifest).toEqual(snapshot.manifest); expect(saved.assets).toEqual(snapshot.assets);
  if (process.env.COMPOSITOR_WRITE_MAC_FIXTURE === '1') {
    const target = path.resolve(root, '..', 'CompositorTests', 'Fixtures', 'WindowsRoundTrip.comp'); await fs.mkdir(target, { recursive: true }); await fs.cp(destination, target, { recursive: true });
    const preview = await page.evaluate(async () => { const { editor } = await import('./app.js'); return editor.composite(true).toDataURL('image/png').split(',')[1]; });
    await fs.writeFile(path.join(path.dirname(target), 'WindowsRoundTrip-preview.png'), Buffer.from(preview, 'base64'));
  }
});

test('Chinese and English switching preserves project enums, user names, and saved preference', async () => {
  await createCanvas(100, 80);
  await page.evaluate(async () => { const { editor } = await import('./app.js'); editor.active.name = 'Normal'; editor.update(); });
  await page.locator('#language').selectOption('zh-CN');
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeVisible();
  await expect(page.locator('.layer-name')).toHaveText('Normal');
  await expect(page.getByRole('button', { name: '画笔工具', exact: true })).toBeVisible();
  await page.locator('#blend-mode').selectOption('Multiply');
  expect(await page.evaluate(async () => (await import('./app.js')).editor.active.blendMode)).toBe('Multiply');
  await page.evaluate(async () => { const { runCommand } = await import('./app.js'); void runCommand('adjust:Exposure'); });
  await expect(page.getByRole('heading', { name: '曝光', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('#language').selectOption('en');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  await page.locator('#language').selectOption('zh-CN'); await page.reload();
  await expect(page.getByRole('heading', { name: '欢迎使用 Compositor' })).toBeVisible();
  await expect(page.locator('#language')).toHaveValue('zh-CN');
});

test('editing scaled point text preserves its scale and transformed anchor', async () => {
  await createCanvas(500, 300);
  await page.evaluate(async () => {
    const { editor } = await import('./app.js'); editor.addText('Example');
    editor.active.transform.size = [280, 90]; editor.active.transform.rotation = 13; editor.update();
  });
  const before = await page.evaluate(async () => { const e = (await import('./app.js')).editor, { documentPoint } = await import('./core.js'), image = e.images.get(e.active.id); return { scale: [e.active.transform.size[0] / image.width, e.active.transform.size[1] / image.height], anchor: documentPoint({ x: 0, y: 0 }, e.active.transform), rotation: e.active.transform.rotation }; });
  await page.evaluate(async () => { void (await import('./app.js')).runCommand('edit-text'); });
  await page.getByRole('textbox', { name: 'Edit text on canvas' }).fill('Edited');
  await page.getByRole('button', { name: 'Apply text' }).click();
  const after = await page.evaluate(async () => { const e = (await import('./app.js')).editor, { documentPoint } = await import('./core.js'), image = e.images.get(e.active.id); return { scale: [e.active.transform.size[0] / image.width, e.active.transform.size[1] / image.height], anchor: documentPoint({ x: 0, y: 0 }, e.active.transform), rotation: e.active.transform.rotation }; });
  expect(after.scale[0]).toBeCloseTo(before.scale[0], 8); expect(after.scale[1]).toBeCloseTo(before.scale[1], 8); expect(after.anchor.x).toBeCloseTo(before.anchor.x, 8); expect(after.anchor.y).toBeCloseTo(before.anchor.y, 8); expect(after.rotation).toBe(before.rotation);
});

test('group and ungroup keep sibling order and follow Mac folder appearance semantics', async () => {
  await createCanvas(100, 80);
  const result = await page.evaluate(async () => {
    const { editor } = await import('./app.js'), { groupLayers, ungroupLayers } = await import('./layer-operations.js');
    editor.active.name = 'Bottom'; const bottom = editor.active.id; editor.addLayer(); editor.active.name = 'Top'; const top = editor.active.id;
    editor.selectedIDs = new Set([bottom]); editor.manifest.activeLayerID = bottom; groupLayers(editor);
    const group = editor.active; group.opacity = .5;
    const before = editor.manifest.layers.indexOf(group) < editor.manifest.layers.findIndex((layer) => layer.id === top);
    ungroupLayers(editor);
    return { before, names: editor.manifest.layers.map((layer) => layer.name), opacity: editor.manifest.layers[0].opacity, selected: [...editor.selectedIDs], bottom };
  });
  expect(result.before).toBe(true); expect(result.names).toEqual(['Bottom', 'Top']); expect(result.opacity).toBe(1); expect(result.selected).toEqual([result.bottom]);
});

test('external PNG edits reload even when the manifest stays unchanged', async () => {
  const snapshot = project(), source = path.join(directory, 'External.comp'); await store.writeProject(source, snapshot); await dialogs({ open: source });
  await page.getByRole('button', { name: 'Open', exact: true }).click(); await expect(page.locator('#document-title')).toHaveText('External');
  const layer = snapshot.manifest.layers[0];
  await fs.writeFile(path.join(source, 'images', layer.imageFile), png(4, 4, [0, 255, 0, 255]));
  await expect.poll(async () => pixels(3, 4), { timeout: 10000 }).toEqual([0, 255, 0, 255]);
  await expect(page.locator('#document-dirty')).toHaveText('');
});

test('native saving commits a pending gradient and reopens Unicode font and color runs from disk', async () => {
  await createCanvas(160, 120); await page.getByRole('button', { name: 'Gradient tool', exact: true }).click(); await page.getByLabel('Gradient style').selectOption('Foreground to Background'); await draw(1, 60, 159, 60);
  const target = path.join(directory, 'EditingParity.comp'); await dialogs({ save: target }); await page.getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.locator('#status-message')).toHaveText('Project saved');
  expect(await page.evaluate(async () => (await import('./app.js')).editor.gradient.pending)).toBe(false);
  await page.evaluate(async () => { const { editor: e } = await import('./app.js'), { createLayer } = await import('./core.js'), { renderText } = await import('./text-layout.js'); e.mutate('Styled Text', () => { const text = { content: 'A😀中文\nSecond', fontName: 'ArialMT', fontSize: 18, red: 0, green: 0, blue: 0, alignment: 'Left', tracking: 1, leading: 24, boxSize: [140, 80], colorRuns: [{ location: 1, length: 4, red: 1, green: 0, blue: 0 }], fontRuns: [{ location: 5, length: 7, fontName: 'CourierNewPSMT' }] }, image = renderText(text), layer = createLayer('Unicode', image.width, image.height); layer.transform.origin = [10, 10]; layer.text = text; e.manifest.layers.push(layer); e.manifest.activeLayerID = layer.id; e.storePixels(layer, image); }); });
  await page.getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.locator('#status-message')).toHaveText('Project saved');
  const saved = await store.readProject(target), before = await pixels(150, 110);
  await page.evaluate(async () => { await (await import('./app.js')).runCommand('close-tab'); }); await expect(page.getByRole('heading', { name: 'Welcome to Compositor' })).toBeVisible();
  await dialogs({ open: target }); await page.getByRole('button', { name: 'Open', exact: true }).click(); await expect(page.locator('#document-title')).toHaveText('EditingParity');
  expect(await page.evaluate(async () => (await import('./app.js')).editor.projectSnapshot())).toEqual(saved); expect(await pixels(150, 110)).toEqual(before);
});

test('Mac-saved project returns to Windows with matching metadata and rendered pixels', async () => {
  test.skip(!process.env.COMPOSITOR_MAC_ROUND_TRIP, 'Requires artifacts from the macOS compatibility job.');
  const source = path.join(directory, 'MacRoundTrip.comp');
  await fs.cp(path.join(process.env.COMPOSITOR_MAC_ROUND_TRIP, 'MacRoundTrip.comp'), source, { recursive: true });
  const snapshot = await store.readProject(source), reference = await fs.readFile(path.join(process.env.COMPOSITOR_MAC_ROUND_TRIP, 'MacRoundTrip-preview.png'));
  await dialogs({ open: source }); await page.getByRole('button', { name: 'Open', exact: true }).click(); await expect(page.locator('#layer-count')).toHaveText(String(snapshot.manifest.layers.length));
  const comparison = await page.evaluate(async (encoded) => {
    const { editor } = await import('./app.js'), { decodeImage } = await import('./compose.js');
    const image = await decodeImage('data:image/png;base64,' + encoded), actual = editor.composite(true), expected = document.createElement('canvas');
    expected.width = image.width; expected.height = image.height; expected.getContext('2d').drawImage(image, 0, 0);
    if (actual.width !== expected.width || actual.height !== expected.height) throw new Error('Render dimensions differ.');
    const a = actual.getContext('2d').getImageData(0, 0, actual.width, actual.height).data, b = expected.getContext('2d').getImageData(0, 0, expected.width, expected.height).data;
    let maximum = 0, sum = 0;
    for (let i = 0; i < a.length; i++) { const alpha = i - i % 4 + 3, difference = Math.abs(i % 4 === 3 ? a[i] - b[i] : Math.round(a[i] * a[alpha] / 255) - Math.round(b[i] * b[alpha] / 255)); maximum = Math.max(maximum, difference); sum += difference; }
    return { maximum, mean: sum / a.length, manifest: editor.manifest };
  }, reference.toString('base64'));
  expect(comparison.manifest).toEqual(snapshot.manifest); expect(comparison.maximum).toBeLessThanOrEqual(20); expect(comparison.mean).toBeLessThanOrEqual(3);
});
