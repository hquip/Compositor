import { chromium, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { cameraDng } from '../../desktop/tests/tiff-fixtures.mjs';
const serial = process.env.COMPOSITOR_ANDROID_SERIAL || 'emulator-5580';
if (!/^emulator-\d+$/.test(serial)) throw new Error('This automated smoke test only installs into an emulator.');
const root = fileURLToPath(new URL('../', import.meta.url)), pkg = 'com.hquip.compositor';
const projectName = 'Android 验收 ' + Date.now();
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args], { windowsHide: true });
async function nativeTap(page, x, y) {
  const hierarchy = '/sdcard/compositor-window-' + crypto.randomUUID() + '.xml';
  try { adb('shell', 'uiautomator', 'dump', hierarchy); }
  catch (error) { if (error.status !== 137 || !error.stdout?.toString().includes('dumped to: ' + hierarchy)) throw error; }
  const xml = adb('shell', 'cat', hierarchy).toString();
  if (!xml.trim().endsWith('</hierarchy>')) throw new Error('The native UI hierarchy is incomplete.');
  const bounds = xml.match(/resource-id="com\.hquip\.compositor:id\/webview"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
    ?? xml.match(/class="android\.webkit\.WebView"[^>]*package="com\.hquip\.compositor"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!bounds) throw new Error('Could not find the native WebView bounds.');
  const ratio = (Number(bounds[3]) - Number(bounds[1])) / await page.evaluate(() => innerWidth);
  adb('shell', 'input', 'tap', String(Math.round(Number(bounds[1]) + x * ratio)), String(Math.round(Number(bounds[2]) + y * ratio)));
}
adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
adb('shell', 'wm', 'dismiss-keyguard');
adb('shell', 'svc', 'power', 'stayon', 'true');
adb('install', '-r', root + '/android/app/build/outputs/apk/debug/app-debug.apk');
adb('shell', 'am', 'force-stop', pkg);
async function launch() {
  adb('shell', 'am', 'start', '-W', '-n', pkg + '/.MainActivity');
  let pid;
  await expect.poll(() => { try { pid = adb('shell', 'pidof', pkg).toString().trim(); return !!pid; } catch { return false; } }, { timeout: 30000 }).toBe(true);
  adb('forward', 'tcp:9223', 'localabstract:webview_devtools_remote_' + pid);
  await expect.poll(async () => { try { return (await fetch('http://127.0.0.1:9223/json/version')).ok; } catch { return false; } }, { timeout: 30000 }).toBe(true);
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { noDefaults: true });
  const page = browser.contexts()[0].pages()[0];
  page.on('pageerror', (error) => console.error(error));
  await expect(page.locator('html')).toHaveAttribute('data-mobile-ready', 'true', { timeout: 30000 });
  return { page, browser };
}
let { page, browser } = await launch();
try {
  await page.locator('#language').selectOption('zh-CN');
  await page.getByRole('button', { name: '创建画布', exact: true }).click();
  await page.locator('#new-width').fill('128'); await page.locator('#new-height').fill('96');
  await page.locator('#new-dialog').getByRole('button', { name: '创建画布' }).click();
  await page.getByRole('button', { name: '画笔工具', exact: true }).click();
  const point = await page.evaluate(async () => { const { editor } = await import('./app.js'), rect = editor.viewport.getBoundingClientRect(); return { x: rect.x + editor.pan.x + 64 * editor.zoom, y: rect.y + editor.pan.y + 48 * editor.zoom }; });
  await nativeTap(page, point.x, point.y);
  await page.locator('.app-bar [data-command="save"]').click();
  await page.getByRole('textbox', { name: '项目名称' }).fill(projectName);
  await page.locator('dialog[open]').getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#status-message')).toHaveText('项目已保存');
  await browser.close(); adb('shell', 'am', 'force-stop', pkg);
  ({ page, browser } = await launch());
  await expect(page.locator('#language')).toHaveValue('zh-CN');
  await page.getByRole('button', { name: '打开项目' }).click();
  await page.getByRole('button', { name: projectName, exact: true }).click();
  await expect(page.locator('#document-title')).toHaveText(projectName);
  const pixels = await page.evaluate(async () => { const { editor } = await import('./app.js'); return [...editor.composite(true).getContext('2d').getImageData(64, 48, 1, 1).data]; });
  expect(pixels[3]).toBeGreaterThan(0);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await mkdir(root + '/test-results', { recursive: true });
  // CDP synthetic input does not always invalidate Android's native compositor. Exercise a real touch before capturing it.
  await nativeTap(page, 20, 20);
  await writeFile(root + '/test-results/android-native.png', adb('exec-out', 'screencap', '-p'));
  console.log('Android native storage, cold restart, language preference, and rendered pixels passed.');
  await page.evaluate((data) => { window.rawCheck = import('./importers.js').then(async ({ importFiles }) => { const { editor } = await import('./app.js'); await importFiles(editor, [{ name: 'Sensor sample', kind: 'raw', data }]); return { width: editor.images.get(editor.active.id)?.width }; }).catch((error) => ({ error: error.message })); }, cameraDng().toString('base64'));
  await expect(page.getByRole('heading', { name: '处理相机 RAW' })).toBeVisible({ timeout: 30000 });
  await page.locator('.settings-dialog').getByRole('button', { name: '应用', exact: true }).click();
  expect(await page.evaluate(() => window.rawCheck)).toEqual({ width: 64 });
  console.log('Android native WebView RAW decoding passed on a synthetic Bayer DNG.');
} finally { await browser?.close(); adb('forward', '--remove', 'tcp:9223'); }
