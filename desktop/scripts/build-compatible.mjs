import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url), output = new URL('compatible-www/', root);
await import('./bundle-vendor.mjs'); await import('./verify-assets.mjs'); await mkdir(output, { recursive: true });
await cp(new URL('renderer/', root), output, { recursive: true }); await cp(new URL('third-party/', root), new URL('third-party/', output), { recursive: true });
await cp(new URL('compatible/legacy-platform.js', root), new URL('legacy-platform.js', output));
await cp(new URL('../LICENSE', root), new URL('LICENSE', output));
const html = (await readFile(new URL('index.html', output), 'utf8')).replace('src="app.js"','src="compatible-host.js"').replace("connect-src 'self'", "connect-src 'self' ipc: http://ipc.localhost");
await writeFile(new URL('index.html', output), html);
await build({ entryPoints: [fileURLToPath(new URL('compatible/host.js', root))], outfile: fileURLToPath(new URL('compatible-host.js', output)), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', external: ['../renderer/app.js', './legacy-platform.js'], legalComments: 'eof' });
let host = await readFile(new URL('compatible-host.js', output), 'utf8'); host = host.replaceAll("../renderer/app.js", "./app.js"); await writeFile(new URL('compatible-host.js', output), host);
console.log('Shared Linux/macOS-compatible editor assets prepared.');
