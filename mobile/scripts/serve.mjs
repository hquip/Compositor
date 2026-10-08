import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../www/', import.meta.url));
http.createServer(async (request, response) => {
  const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname), filename = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
  if (!filename.startsWith(root)) { response.writeHead(403).end(); return; }
  try {
    const bytes = await readFile(filename), type = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream' }[path.extname(filename)] ?? 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type, 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }).end(bytes);
  } catch { response.writeHead(404).end(); }
}).listen(4173, '127.0.0.1', () => console.log('Mobile preview: http://127.0.0.1:4173'));
