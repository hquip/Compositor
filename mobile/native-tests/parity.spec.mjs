import { test, expect, chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { parityCases } from '../../desktop/tests/parity-cases.mjs';
import { enhancementCases } from '../../desktop/tests/enhancement-cases.mjs';
import { vectorCases } from '../../desktop/tests/vector-cases.mjs';
import { filterMaskCases } from '../../desktop/tests/filter-mask-cases.mjs';
import { smartHDRCases } from '../../desktop/tests/smart-hdr-cases.mjs';
import { openEXRCases } from '../../desktop/tests/openexr-cases.mjs';
import { advancedEXRCases } from '../../desktop/tests/exr-advanced-cases.mjs';
import { professionalCases } from '../../desktop/tests/professional-cases.mjs';
import { androidTap, androidFrame } from '../scripts/android-input.mjs';
import fs from 'node:fs/promises';
import { decodeOpenEXR } from '../../desktop/renderer/openexr.js';

const serial = process.env.COMPOSITOR_ANDROID_SERIAL || 'emulator-5580';
if (!/^emulator-\d+$/.test(serial)) throw new Error('Native parity tests only install into an emulator.');
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args], { windowsHide: true });
let browser, page, port, errors;
vectorCases(test, expect, () => page, async () => { await browser.close(); await launchApp(); return page; }, (page, x, y) => androidTap(page, serial, x, y));
filterMaskCases(test, expect, () => page, async () => { await browser.close(); await launchApp(); return page; }, (page, x, y) => androidTap(page, serial, x, y));
smartHDRCases(test, expect, () => page);
openEXRCases(test, expect, () => page);
advancedEXRCases(test, expect, () => page);
parityCases(test, expect, () => page);
enhancementCases(test, expect, () => page, async () => { await browser.close(); await launchApp(); return page; });
professionalCases(test, expect, () => page, async () => { await browser.close(); await launchApp(); return page; });
test.beforeAll(async () => {
  adb('install', '-r', fileURLToPath(new URL('../android/app/build/outputs/apk/debug/app-debug.apk', import.meta.url)));
  adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'); adb('shell', 'wm', 'dismiss-keyguard'); adb('shell', 'svc', 'power', 'stayon', 'true');
});
test.beforeEach(async () => {
  errors = []; browser = null; page = null;
  const socket = net.createServer(); await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve)); port = socket.address().port; await new Promise((resolve) => socket.close(resolve));
  await launchApp();
  await androidFrame(page, serial);
  await page.evaluate(async () => { const store = new (await import('./recovery-store.js')).RecoveryStore(); for (const record of await store.list()) await store.remove(record.id); });
  await page.evaluate(async () => { const { library } = await import('./library-store.js'); for (const record of await library.list()) await library.remove(record.id); });
});
async function launchApp() {
  adb('shell', 'am', 'force-stop', 'com.hquip.compositor'); adb('shell', 'am', 'start', '-W', '-n', 'com.hquip.compositor/.MainActivity');
  const pid = adb('shell', 'pidof', 'com.hquip.compositor').toString().trim(); adb('forward', 'tcp:' + port, 'localabstract:webview_devtools_remote_' + pid);
  await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch { return false; } }, { timeout: 30000 }).toBe(true);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true }); page = browser.contexts()[0].pages()[0];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.locator('html')).toHaveAttribute('data-mobile-ready', 'true', { timeout: 30000 }); await page.locator('#language').selectOption('en');
  await expect(page.getByRole('heading', { name: 'Welcome to Compositor' })).toBeVisible();
}

test('native Android background checkpoint survives force-stop and cold restart', async () => {
  const id = await page.evaluate(async () => {
    const { editor: e } = await import('./app.js'), { surface } = await import('./raster.js'); e.newCanvas(64, 48);
    const image = surface(64, 48), ctx = image.getContext('2d'); ctx.fillStyle = '#33aa66'; ctx.fillRect(0, 0, 64, 48); e.storePixels(e.active, image); e.name = 'Android recovery'; e.update(); return e.workspace.id;
  });
  adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
  await expect.poll(() => page.evaluate(async (id) => { const store = new (await import('./recovery-store.js')).RecoveryStore(); return (await store.read(id))?.name; }, id)).toBe('Android recovery');
  await browser.close(); await launchApp();
  await page.locator('#recovery-status').click(); await page.getByRole('button', { name: 'Recover', exact: true }).click(); await expect(page.locator('#document-title')).toHaveText('Android recovery');
  expect(await page.evaluate(async () => [...(await import('./app.js')).editor.composite(true).getContext('2d').getImageData(20, 20, 1, 1).data])).toEqual([51, 170, 102, 255]);
});
test('OpenEXR: native Android save survives cold restart and native sharing writes a valid EXR', async () => {
  const projectName = `EXR native ${crypto.randomUUID().slice(0, 8)}`;
  const bytes = [...await fs.readFile(new URL('../../desktop/tests/fixtures/openexr/rgba-32-zip.exr', import.meta.url))];
  await page.evaluate(async (bytes) => { const { editor: e } = await import('./app.js'); window.exrOperation = (await import('./hdr-workflows.js')).importHDRFile(e, new Uint8Array(bytes), 'Android EXR'); }, bytes);
  await page.locator('dialog[open]').last().getByRole('button', { name: 'Apply', exact: true }).click(); await page.evaluate(() => window.exrOperation);
  const source = await page.evaluate(async (projectName) => { const { editor: e, runCommand } = await import('./app.js'); e.name = projectName; e.update(); window.exrOperation = runCommand('save'); return e.assets[e.active.hdrSourceFile]; }, projectName);
  await page.getByRole('textbox', { name: 'Project name' }).fill(projectName); await page.locator('dialog[open]').getByRole('button', { name: 'Save', exact: true }).click(); await page.evaluate(() => window.exrOperation);
  await browser.close(); await launchApp(); await page.evaluate(async () => { window.exrOperation = (await import('./app.js')).runCommand('open'); });
  await page.getByRole('button', { name: projectName, exact: true }).click(); await page.evaluate(() => window.exrOperation);
  expect(await page.evaluate(async () => { const { editor: e } = await import('./app.js'); return e.assets[e.active.hdrSourceFile]; })).toBe(source);
  const exportName = 'EXR-native-' + projectName.split(' ').at(-1) + '-HDR';
  await page.evaluate(async (exportName) => { const { editor: e } = await import('./app.js'), { composeHDRCanvas } = await import('./hdr-layer.js'), { hdrIO } = await import('./hdr-io.js'), { binaryBase64 } = await import('./psd-export.js'); const encoded = await hdrIO({ action: 'encode-exr', source: composeHDRCanvas(e.manifest, e.images, e.masks, 1, true), options: { bits: 32, compression: 'ZIP' } }); window.exrOperation = window.desktop.exportFile(binaryBase64(encoded), 'exr', exportName); }, exportName);
  const filename = `cache/exports/${exportName}.exr`; await expect.poll(() => { try { adb('shell', 'run-as', 'com.hquip.compositor', 'test', '-f', filename); return true; } catch { return false; } }).toBe(true);
  const encoded = new Uint8Array(adb('exec-out', 'run-as', 'com.hquip.compositor', 'cat', filename)), result = decodeOpenEXR(encoded); expect([...result.data.slice((2 * 9 + 3) * 4, (2 * 9 + 3) * 4 + 4)]).toEqual([5, .125, -.125, .5]);
  await expect.poll(() => adb('shell', 'dumpsys', 'activity', 'activities').toString().match(/(?:topResumedActivity=|mResumedActivity:)[^\n]+/)?.[0] ?? '').toMatch(/ChooserActivity|ResolverActivity/);
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await page.evaluate(() => window.exrOperation);
});
test.afterEach(async () => {
  try { expect(errors).toEqual([]); }
  finally { await browser?.close().catch(() => {}); if (port) adb('forward', '--remove', 'tcp:' + port); }
});
