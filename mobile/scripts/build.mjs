import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = new URL('../', import.meta.url), output = new URL('www/', root);
await import('../../desktop/scripts/bundle-vendor.mjs');
await import('../../desktop/scripts/verify-assets.mjs');
await mkdir(output, { recursive: true });
await cp(new URL('../desktop/renderer/', root), output, { recursive: true });
await cp(new URL('../desktop/third-party/', root), new URL('third-party/', output), { recursive: true });
await cp(new URL('../LICENSE', root), new URL('LICENSE', output));
await cp(new URL('src/mobile.css', root), new URL('mobile.css', output));
let html = await readFile(new URL('index.html', output), 'utf8');
html = html.replace('src="app.js"', 'src="mobile-host.js"').replace('</head>', '<link rel="stylesheet" href="mobile.css">\n</head>');
await writeFile(new URL('index.html', output), html);
await build({ entryPoints: [fileURLToPath(new URL('src/host.js', root))], outfile: fileURLToPath(new URL('mobile-host.js', output)),
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', external: ['./app.js', './localization.js', './core.js', './icons.js', './settings-dialog.js'], legalComments: 'eof' });
for (const name of ['core', 'android', 'ios', 'filesystem', 'share', 'clipboard', 'app']) {
  await cp(new URL(`node_modules/@capacitor/${name}/LICENSE`, root), new URL(`third-party/Capacitor-${name}-LICENSE.txt`, output));
}
await cp(new URL('node_modules/fflate/LICENSE', root), new URL('third-party/fflate-LICENSE.txt', output));
await cp(new URL('node_modules/utif/LICENSE', root), new URL('third-party/UTIF-LICENSE.txt', output));
await cp(new URL('node_modules/utif/node_modules/pako/LICENSE', root), new URL('third-party/pako-TIFF-LICENSE.txt', output)).catch(async () => {
  await cp(new URL('node_modules/pako/LICENSE', root), new URL('third-party/pako-TIFF-LICENSE.txt', output));
});
console.log('Mobile editor assets prepared for Android and iOS.');
