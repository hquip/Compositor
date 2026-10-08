import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
for (const name of ['renderer/vendor/openexr/compositor-exr.mjs', 'renderer/vendor/openexr/compositor-exr.wasm', 'renderer/vendor/exr-container.js', 'third-party/OpenEXR-LICENSE.txt', 'third-party/Imath-LICENSE.txt', 'third-party/Libdeflate-LICENSE.txt', 'third-party/OpenJPH-LICENSE.txt']) if (!(await stat(new URL(name, root))).size) throw new Error(`Missing OpenEXR runtime asset: ${name}`);
for (const name of ['renderer/pixels.wasm', 'renderer/vendor/psd.js', 'renderer/vendor/text.js', 'renderer/vendor/libheif.mjs',
  'renderer/vendor/lcms/lcms.js', 'renderer/vendor/lcms/lcms.wasm', 'third-party/lcms-wasm-LICENSE.txt', 'third-party/Compact-ICC-Profiles-LICENSE.txt',
  'renderer/profiles/sRGB-v2-magic.icc', 'renderer/profiles/AdobeCompat-v2.icc', 'renderer/profiles/DisplayP3-v4.icc', 'renderer/profiles/ProPhoto-v4.icc',
  'renderer/vendor/tiff.js', 'renderer/vendor/archive.js', 'renderer/vendor/float-tiff.js', 'renderer/openexr.js', 'renderer/hdr-color.js', 'renderer/hdr-io.js', 'renderer/hdr-io-worker.js', 'third-party/UTIF-LICENSE.txt', 'third-party/fflate-LICENSE.txt',
  'renderer/vendor/libraw/index.js', 'renderer/vendor/libraw/worker.js', 'renderer/vendor/libraw/libraw.js', 'renderer/vendor/libraw/libraw.wasm',
  'renderer/vendor/ort/ort.wasm.min.mjs', 'renderer/vendor/ort/ort-wasm-simd-threaded.mjs', 'renderer/vendor/ort/ort-wasm-simd-threaded.wasm',
  'third-party/NOTICES.md', 'third-party/ag-psd-LICENSE.txt', 'third-party/pako-LICENSE.txt', 'third-party/libheif-LICENSE.txt',
  'third-party/LibRaw-LICENSE.txt', 'third-party/Little-CMS-LICENSE.txt', 'third-party/ONNX-Runtime-LICENSE.txt', 'third-party/U-2-Net-LICENSE.txt',
  'third-party/bidi-js-LICENSE.txt', 'third-party/linebreak-LICENSE.txt', 'third-party/unicode-trie-LICENSE.txt', 'third-party/tiny-inflate-LICENSE.txt', 'third-party/base64-js-LICENSE.txt']) {
  if (!(await stat(new URL(name, root))).size) throw new Error(`Missing runtime asset: ${name}`);
}
const model = await readFile(new URL('renderer/models/u2netp.onnx', root));
if (createHash('sha256').update(model).digest('hex') !== '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8') {
  throw new Error('The bundled U2-Net-P model has an unexpected checksum.');
}
console.log('Runtime assets, notices, and model checksum verified.');
