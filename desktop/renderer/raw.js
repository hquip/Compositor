import LibRaw from './vendor/libraw/index.js';
import { surface } from './raster.js';
import { settingsDialog, numberField as n, boolField as b } from './settings-dialog.js';

export async function developRaw(file) {
  if (window.desktop?.developRaw) {
    const metadata = await window.desktop.developRaw(file);
    const settings = await settingsDialog('Develop Camera RAW', [n('exposure', 'Exposure', -5, 5, 0, .1), b('cameraWhiteBalance', 'Camera white balance', true), n('temperature', 'Temperature', -100, 100), n('tint', 'Tint', -100, 100), n('boost', 'Tone boost', 0, 2, 1, .05)], {});
    if (!settings) return null;
    const decoded = await window.desktop.developRaw(file, { ...settings, asShotTemperature: metadata.temperature, asShotTint: metadata.tint }); return decoded.data;
  }
  const raw = new LibRaw(), bytes = Uint8Array.from(atob(file.data), (value) => value.charCodeAt(0));
  raw.worker.onerror = (event) => { event.preventDefault(); raw.dispose(); };
  raw.worker.onmessageerror = () => raw.dispose();
  try {
    await raw.open(bytes.slice(), { useCameraWb: true, outputBps: 8, outputColor: 1 });
    const metadata = await raw.metadata(true);
    const width = metadata?.width ?? metadata?.raw_width, height = metadata?.height ?? metadata?.raw_height;
    if (width > 30000 || height > 30000 || width * height > 200000000) throw new Error('The RAW image exceeds the document pixel limit.');
    const settings = await settingsDialog('Develop Camera RAW', [n('exposure', 'Exposure', -5, 5, 0, .1), b('cameraWhiteBalance', 'Camera white balance', true), n('temperature', 'Temperature', -100, 100), n('tint', 'Tint', -100, 100), n('boost', 'Tone boost', 0, 2, 1, .05)], {});
    if (!settings) return null;
    const camera = metadata?.color_data?.cam_mul ?? [1, 1, 1, 1], temperature = settings.temperature / 100, tint = settings.tint / 100;
    const multipliers = [camera[0] * (1 + temperature * .35 + tint * .15), camera[1] * (1 - tint * .3), camera[2] * (1 - temperature * .35 + tint * .15), (camera[3] || camera[1]) * (1 - tint * .3)];
    await raw.open(bytes.slice(), { useCameraWb: settings.cameraWhiteBalance && !temperature && !tint, userMul: temperature || tint || !settings.cameraWhiteBalance ? multipliers : null,
      expCorrec: true, expShift: 2 ** settings.exposure, bright: settings.boost, outputBps: 8, outputColor: 1, userQual: 3 });
    const decoded = await raw.imageData();
    if (!decoded?.data || !decoded.width || !decoded.height) throw new Error('RAW decoding did not return an image.');
    const canvas = surface(decoded.width, decoded.height), context = canvas.getContext('2d'), output = context.createImageData(canvas.width, canvas.height), channels = decoded.colors || 3;
    for (let i = 0; i < canvas.width * canvas.height; i++) { for (let c = 0; c < 3; c++) output.data[i * 4 + c] = decoded.data[i * channels + Math.min(c, channels - 1)]; output.data[i * 4 + 3] = 255; }
    context.putImageData(output, 0, 0); return canvas.toDataURL('image/png');
  } finally { raw.dispose(); }
}
