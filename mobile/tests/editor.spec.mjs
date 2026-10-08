import { test, expect } from '@playwright/test';
import { rgbTiff } from '../../desktop/tests/tiff-fixtures.mjs';
import { parityCases } from '../../desktop/tests/parity-cases.mjs';
import { enhancementCases } from '../../desktop/tests/enhancement-cases.mjs';
import { vectorCases } from '../../desktop/tests/vector-cases.mjs';
import { filterMaskCases } from '../../desktop/tests/filter-mask-cases.mjs';
import { smartHDRCases } from '../../desktop/tests/smart-hdr-cases.mjs';
import { openEXRCases } from '../../desktop/tests/openexr-cases.mjs';
import { advancedEXRCases } from '../../desktop/tests/exr-advanced-cases.mjs';
import { professionalCases } from '../../desktop/tests/professional-cases.mjs';
import { upstreamEnhancementCases } from '../../desktop/tests/upstream-enhancement-cases.mjs';
import { fullWorkflowCases } from '../../desktop/tests/full-workflow-cases.mjs';
import fs from 'node:fs/promises';
let sharedPage;
vectorCases(test, expect, () => sharedPage);
filterMaskCases(test, expect, () => sharedPage);
smartHDRCases(test, expect, () => sharedPage);
openEXRCases(test, expect, () => sharedPage);
advancedEXRCases(test, expect, () => sharedPage);
parityCases(test, expect, () => sharedPage);
enhancementCases(test, expect, () => sharedPage);
professionalCases(test, expect, () => sharedPage);
upstreamEnhancementCases(test, expect, () => sharedPage);
fullWorkflowCases(test, expect, () => sharedPage);
test.beforeEach(async ({ page }) => {
  sharedPage = page;
  page.on('pageerror', (error) => { throw error; });
  await page.goto('/'); await expect(page.locator('html')).toHaveAttribute('data-mobile-ready', 'true');
  await expect(page.getByRole('heading', { name: 'Welcome to Compositor' })).toBeVisible();
});
test('OpenEXR: phone image picker imports the selected float source and export dialog is localized', async ({ page }) => {
  const chooser = page.waitForEvent('filechooser'); await page.evaluate(async () => { window.exrPickerOperation = (await import('./app.js')).runCommand('import'); });
  await (await chooser).setFiles({ name: 'Reference.exr', mimeType: 'image/x-exr', buffer: await fs.readFile(new URL('../../desktop/tests/fixtures/openexr/rgba-32-zip.exr', import.meta.url)) });
  await page.locator('dialog[open]').last().getByRole('button', { name: 'Apply', exact: true }).click(); await page.evaluate(() => window.exrPickerOperation);
  expect(await page.evaluate(async () => (await import('./app.js')).editor.images.get((await import('./app.js')).editor.active.id).compositorHDR.data[4])).toBe(5);
  await page.locator('#language').selectOption('zh-CN'); await page.evaluate(async () => { window.exrPickerOperation = (await import('./app.js')).runCommand('export-exr'); });
  const dialog = page.locator('dialog[open]').last(); await expect(dialog.getByRole('heading')).toHaveText('导出 OpenEXR'); await expect(dialog.getByLabel('输出色彩空间')).toBeVisible(); await dialog.getByRole('button', { name: '取消', exact: true }).click(); await page.evaluate(() => window.exrPickerOperation);
});
test('phone layout switches languages, paints, saves locally, and reopens the project', async ({ page }) => {
  await page.locator('#language').selectOption('zh-CN');
  await expect(page.getByRole('heading', { name: '欢迎使用 Compositor' })).toBeVisible();
  await page.getByRole('button', { name: '创建画布', exact: true }).click();
  await page.locator('#new-width').fill('128'); await page.locator('#new-height').fill('96');
  await page.locator('#new-dialog').getByRole('button', { name: '创建画布' }).click();
  await page.getByRole('button', { name: '画笔工具', exact: true }).click();
  const point = await page.evaluate(async () => { const { editor } = await import('./app.js'), rect = editor.viewport.getBoundingClientRect(); return { x: rect.x + editor.pan.x + 64 * editor.zoom, y: rect.y + editor.pan.y + 48 * editor.zoom }; });
  await page.touchscreen.tap(point.x, point.y);
  expect(await page.evaluate(async () => { const { editor } = await import('./app.js'); return editor.composite(true).getContext('2d').getImageData(64, 48, 1, 1).data[3]; })).toBeGreaterThan(0);
  await page.locator('.app-bar [data-command="save"]').click();
  await page.getByRole('textbox', { name: '项目名称' }).fill('手机作品');
  await page.locator('dialog[open]').getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#status-message')).toHaveText('项目已保存');
  await page.reload(); await expect(page.getByRole('heading', { name: '欢迎使用 Compositor' })).toBeVisible();
  await page.getByRole('button', { name: '打开项目' }).click();
  await page.getByRole('button', { name: '手机作品', exact: true }).click();
  await expect(page.locator('#document-title')).toHaveText('手机作品');
  expect(await page.evaluate(async () => { const { editor } = await import('./app.js'); return editor.composite(true).getContext('2d').getImageData(64, 48, 1, 1).data[3]; })).toBeGreaterThan(0);
  await page.screenshot({ path: test.info().outputPath('mobile-chinese.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('mobile project sharing retains the desktop project folder format', async ({ page }) => {
  await page.getByRole('button', { name: 'Create canvas', exact: true }).click();
  await page.locator('#new-width').fill('64'); await page.locator('#new-height').fill('48'); await page.locator('#new-dialog').getByRole('button', { name: 'Create canvas' }).click();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Share project', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.comp\.zip$/);
});

test('mobile TIFF import decodes real pixels without relying on browser TIFF support', async ({ page }) => {
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Import an image', exact: true }).click();
  await (await chooser).setFiles({ name: 'Sample.tiff', mimeType: 'image/tiff', buffer: rgbTiff() });
  await expect(page.locator('#dimensions')).toHaveText('16 × 12 px');
  const pixel = await page.evaluate(async () => { const { editor } = await import('./app.js'); return [...editor.composite(true).getContext('2d').getImageData(2, 2, 1, 1).data]; });
  expect(pixel[3]).toBe(255); expect(pixel[0]).toBeGreaterThan(0);
});

test('phone bottom tools, brush settings, and layer sheet expose editing controls', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.getByRole('button', { name: 'Create canvas', exact: true }).click();
  await page.locator('#new-width').fill('128'); await page.locator('#new-height').fill('96'); await page.locator('#new-dialog').getByRole('button', { name: 'Create canvas' }).click();
  const canvas = await page.locator('#viewport').boundingBox(), dock = await page.locator('.mobile-tool-dock').boundingBox();
  expect(canvas.width).toBeGreaterThan(350); expect(canvas.height).toBeGreaterThan(480); expect(dock.y).toBeGreaterThan(canvas.y + canvas.height); expect(dock.y + dock.height).toBeLessThanOrEqual(741);
  await page.getByRole('button', { name: 'Brush tool', exact: true }).click(); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Brush settings' })).toBeVisible(); await page.getByRole('spinbutton', { name: 'Size', exact: true }).fill('67'); await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => page.evaluate(async () => (await import('./app.js')).editor.brushSize)).toBe(67);
  await page.getByRole('button', { name: 'All tools', exact: true }).click(); await page.screenshot({ path: test.info().outputPath('phone-tool-sheet.png') }); await page.getByRole('button', { name: 'Gradient', exact: true }).click();
  expect(await page.evaluate(async () => (await import('./app.js')).editor.tool)).toBe('gradient'); await expect(page.locator('.mobile-tools-sheet')).not.toBeVisible();
  await page.locator('#mobile-layers').click(); await page.getByRole('button', { name: 'Add layer', exact: true }).click();
  await page.locator('#mobile-layers').click(); await expect(page.locator('#layer-count')).toHaveText('2');
  await page.screenshot({ path: test.info().outputPath('phone-layer-sheet.png') });
  await page.getByRole('tab', { name: 'Properties' }).click(); await page.getByLabel('Layer X', { exact: true }).fill('12'); await page.getByLabel('Layer X', { exact: true }).press('Tab');
  expect(await page.evaluate(async () => (await import('./app.js')).editor.active.transform.origin[0])).toBe(12);
  await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('phone-bottom-tools.png') });
  await page.setViewportSize({ width: 812, height: 375 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const landscape = await page.locator('#viewport').boundingBox(); expect(landscape.height).toBeGreaterThan(180);
  await page.screenshot({ path: test.info().outputPath('phone-landscape.png') });
});

test('adjustments remain reachable from the phone menu without blocking their dialog', async ({ page }) => {
  await page.getByRole('button', { name: 'Create canvas', exact: true }).click(); await page.locator('#new-width').fill('128'); await page.locator('#new-height').fill('96'); await page.locator('#new-dialog').getByRole('button', { name: 'Create canvas' }).click();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.locator('.editor-menus summary').filter({ hasText: /^Adjust$/ }).click();
  await page.locator('[data-advanced="adjust:Exposure"]').click();
  await expect(page.getByRole('heading', { name: 'Exposure', exact: true })).toBeVisible(); await expect(page.locator('.mobile-command-sheet')).not.toBeVisible();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  expect(await page.evaluate(async () => (await import('./app.js')).editor.active.adjustment.kind)).toBe('Exposure');
});

test('two-finger zoom cancels the initial brush contact instead of leaving a stray mark', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Multi-touch injection uses the Chromium protocol.');
  await page.getByRole('button', { name: 'Create canvas', exact: true }).click(); await page.locator('#new-width').fill('128'); await page.locator('#new-height').fill('96'); await page.locator('#new-dialog').getByRole('button', { name: 'Create canvas' }).click();
  await page.getByRole('button', { name: 'Brush tool', exact: true }).click();
  const before = await page.evaluate(async () => { const e = (await import('./app.js')).editor; return { zoom: e.zoom, revision: e.history.revision }; });
  const rect = await page.locator('#viewport').boundingBox(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: x - 30, y }, { id: 2, x: x + 30, y }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: x - 60, y }, { id: 2, x: x + 60, y }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const after = await page.evaluate(async () => { const e = (await import('./app.js')).editor; return { zoom: e.zoom, revision: e.history.revision, alpha: e.composite(true).getContext('2d').getImageData(0, 0, 128, 96).data.filter((_, i) => i % 4 === 3).reduce((a, b) => a + b, 0) }; });
  expect(after.zoom).toBeGreaterThan(before.zoom * 1.5); expect(after.revision).toBe(before.revision); expect(after.alpha).toBe(0);
});

test('phone clone sampling, polygon completion, selection modes, and transform modes need no keyboard', async ({ page }) => {
  await page.getByRole('button', { name: 'Create canvas', exact: true }).click(); await page.locator('#new-width').fill('128'); await page.locator('#new-height').fill('96'); await page.locator('#new-dialog').getByRole('button', { name: 'Create canvas' }).click();
  async function point(x, y) { return await page.evaluate(async ({ x, y }) => { const { editor } = await import('./app.js'), r = editor.viewport.getBoundingClientRect(); return { x: r.x + editor.pan.x + x * editor.zoom, y: r.y + editor.pan.y + y * editor.zoom }; }, { x, y }); }
  await page.getByRole('button', { name: 'All tools', exact: true }).click(); await page.getByRole('button', { name: 'Clone stamp', exact: true }).click();
  await page.getByRole('button', { name: 'Choose source', exact: true }).click(); const source = await point(40, 30); await page.touchscreen.tap(source.x, source.y);
  const sampled = await page.evaluate(async () => (await import('./app.js')).editor.cloneSource); expect(sampled.x).toBeCloseTo(40, 0); expect(sampled.y).toBeCloseTo(30, 0);
  await page.getByRole('button', { name: 'All tools', exact: true }).click(); await page.getByRole('button', { name: 'Polygonal lasso', exact: true }).click();
  for (const [x, y] of [[10, 10], [60, 10], [60, 50], [10, 50]]) { const p = await point(x, y); await page.touchscreen.tap(p.x, p.y); }
  await page.getByRole('button', { name: 'Finish selection', exact: true }).click();
  expect(await page.evaluate(async () => { const { editor } = await import('./app.js'); return { points: editor.polygon, alpha: editor.selection.coverage.getContext('2d').getImageData(30, 30, 1, 1).data[3] }; })).toEqual({ points: null, alpha: 255 });
  await page.getByRole('combobox', { name: 'Selection mode' }).selectOption('add');
  await page.getByRole('button', { name: 'Selection tool', exact: true }).click(); const start = await point(80, 60), end = await point(120, 90);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 5 }); await page.mouse.up();
  const selected = await page.evaluate(async () => { const { editor } = await import('./app.js'); const ctx = editor.selection.coverage.getContext('2d'); return [ctx.getImageData(30, 30, 1, 1).data[3], ctx.getImageData(100, 75, 1, 1).data[3]]; }); expect(selected).toEqual([255, 255]);
  await page.getByRole('button', { name: 'Move tool', exact: true }).click(); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Mode', exact: true }).selectOption('Free Distort'); await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => page.evaluate(async () => (await import('./app.js')).editor.transformHandleMode)).toBe('Free Distort');
});
