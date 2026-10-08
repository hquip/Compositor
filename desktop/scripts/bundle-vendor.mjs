import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('..', import.meta.url));
const exrRuntime = JSON.parse(await readFile(root + '/native/exr/runtime.json', 'utf8'));
await mkdir(root + '/renderer/vendor', { recursive: true });
await build({ entryPoints: [root + '/vendor/legacy-entry.js'], outfile: root + '/renderer/vendor/legacy.js', bundle: true, minify: true,
  format: 'esm', platform: 'browser', target: 'es2022', legalComments: 'eof' });
await copyFile(root + '/node_modules/graphemer/LICENSE', root + '/third-party/Graphemer-LICENSE.txt');
await mkdir(root + '/renderer/vendor/openexr', { recursive: true });
await mkdir(root + '/renderer/vendor/quickjs', { recursive: true });
await build({ entryPoints: [root + '/vendor/quickjs-entry.js'], outfile: root + '/renderer/vendor/quickjs/quickjs.js', bundle: true, minify: true,
  format: 'esm', platform: 'browser', target: 'es2022', legalComments: 'eof' });
await copyFile(root + '/node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm', root + '/renderer/vendor/quickjs/quickjs.wasm');
await copyFile(root + '/node_modules/quickjs-emscripten/LICENSE', root + '/third-party/QuickJS-emscripten-LICENSE.txt');

await mkdir(root + '/renderer/vendor/webp', { recursive: true });
await build({ entryPoints: [root + '/vendor/webp-entry.js'], outfile: root + '/renderer/vendor/webp/webp.js', bundle: true, minify: true,
  format: 'esm', platform: 'browser', target: 'es2022', legalComments: 'eof' });
for (const name of ['webp_enc.wasm', 'webp_enc_simd.wasm']) await copyFile(root + '/node_modules/@jsquash/webp/codec/enc/' + name, root + '/renderer/vendor/webp/' + name);
await copyFile(root + '/node_modules/@jsquash/webp/LICENSE', root + '/third-party/jSquash-WebP-LICENSE.txt');
for (const [name, digest] of Object.entries(exrRuntime.files)) {
  const file = root + '/native/exr/prebuilt/' + name;
  if (createHash('sha256').update(await readFile(file)).digest('hex') !== digest) throw new Error('The bundled OpenEXR runtime has an unexpected checksum.');
  await copyFile(file, root + '/renderer/vendor/openexr/' + name);
}
await build({ entryPoints: [root + '/vendor/psd-entry.js'], outfile: root + '/renderer/vendor/psd.js', bundle: true, minify: true,
  format: 'esm', platform: 'browser', target: 'es2022', legalComments: 'eof' });
await build({ entryPoints: [root + '/vendor/text-entry.js'], outfile: root + '/renderer/vendor/text.js', bundle: true, minify: true,
  format: 'esm', platform: 'browser', target: 'es2022', legalComments: 'eof' });
await build({ entryPoints: [root + '/vendor/tiff-entry.js'], outfile: root + '/renderer/vendor/tiff.js', bundle: true, minify: true,
  format: 'esm', platform: 'browser', target: 'es2022', legalComments: 'eof' });
await copyFile(root + '/node_modules/utif/LICENSE', root + '/third-party/UTIF-LICENSE.txt');
await build({ entryPoints: [root + '/vendor/archive-entry.js'], outfile: root + '/renderer/vendor/archive.js', bundle: true, minify: true,
  format: 'esm', platform: 'browser', target: 'es2022', legalComments: 'eof' });
await copyFile(root + '/node_modules/fflate/LICENSE', root + '/third-party/fflate-LICENSE.txt');
await build({ entryPoints: [root + '/vendor/float-entry.js'], outfile: root + '/renderer/vendor/float-tiff.js', bundle: true, minify: true,
  format: 'esm', platform: 'browser', target: 'es2022', legalComments: 'eof' });
await build({ entryPoints: [root + '/vendor/exr-entry.js'], outfile: root + '/renderer/vendor/exr-container.js', bundle: true, minify: true,
  format: 'esm', platform: 'browser', target: 'es2022', legalComments: 'eof' });
for (const [name, file] of [['bidi-js', 'LICENSE.txt'], ['linebreak', 'LICENSE'], ['unicode-trie', 'LICENSE'], ['tiny-inflate', 'LICENSE'], ['base64-js', 'LICENSE']]) {
  await copyFile(root + '/node_modules/' + name + '/' + file, root + '/third-party/' + name + '-LICENSE.txt');
}
await copyFile(root + '/node_modules/libheif-js/libheif-wasm/libheif-bundle.mjs', root + '/renderer/vendor/libheif.mjs');
await mkdir(root + '/third-party', { recursive: true });
await mkdir(root + '/renderer/vendor/lcms', { recursive: true });
for (const name of ['lcms.js', 'lcms.wasm']) await copyFile(root + '/node_modules/lcms-wasm/dist/' + name, root + '/renderer/vendor/lcms/' + name);
await copyFile(root + '/node_modules/lcms-wasm/LICENSE.md', root + '/third-party/lcms-wasm-LICENSE.txt');
await copyFile(root + '/node_modules/ag-psd/LICENSE', root + '/third-party/ag-psd-LICENSE.txt');
await mkdir(root + '/renderer/vendor/ort', { recursive: true });
for (const name of ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) await copyFile(root + '/node_modules/onnxruntime-web/dist/' + name, root + '/renderer/vendor/ort/' + name);
await mkdir(root + '/renderer/vendor/libraw', { recursive: true });
for (const name of ['index.js', 'worker.js', 'libraw.js', 'libraw.wasm']) await copyFile(root + '/node_modules/libraw-wasm/dist/' + name, root + '/renderer/vendor/libraw/' + name);
await copyFile(root + '/node_modules/libheif-js/LICENSE', root + '/third-party/libheif-LICENSE.txt');
await copyFile(root + '/node_modules/libraw-wasm/package.json', root + '/third-party/LibRaw-Wasm-package.json');
await copyFile(root + '/node_modules/libraw-wasm/readme.md', root + '/third-party/LibRaw-Wasm-README.md');
