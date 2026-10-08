import { execFileSync } from 'node:child_process';
const frames = new WeakMap();
export async function androidFrame(page, serial) {
  if (!/^emulator-\d+$/.test(serial)) throw new Error('Touch verification only uses an emulator.');
  const adb = (...args) => execFileSync('adb', ['-s', serial, ...args], { windowsHide: true, timeout: 20000 });
  let frame = frames.get(page);
  if (!frame) {
    const path = '/sdcard/compositor-vector-' + crypto.randomUUID() + '.xml';
    try { adb('shell', 'uiautomator', 'dump', path); }
    catch (error) { if (error.status !== 137 || !error.stdout?.toString().includes('dumped to: ' + path)) throw error; }
    const xml = adb('shell', 'cat', path).toString();
    const bounds = xml.match(/resource-id="com\.hquip\.compositor:id\/webview"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
      ?? xml.match(/class="android\.webkit\.WebView"[^>]*package="com\.hquip\.compositor"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (!bounds || !xml.trim().endsWith('</hierarchy>')) throw new Error('Could not locate the native editor frame.');
    frame = { left: Number(bounds[1]), top: Number(bounds[2]), ratio: (Number(bounds[3]) - Number(bounds[1])) / await page.evaluate(() => innerWidth) }; frames.set(page, frame);
  }
  return frame;
}
export async function androidTap(page, serial, x, y) {
  const frame = await androidFrame(page, serial);
  if (typeof x === 'function') { const point = await x(); x = point.x; y = point.y; }
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Invalid native touch coordinates.');
  execFileSync('adb', ['-s', serial, 'shell', 'input', 'tap', String(Math.round(frame.left + x * frame.ratio)), String(Math.round(frame.top + y * frame.ratio))], { windowsHide: true, timeout: 20000 });
}
