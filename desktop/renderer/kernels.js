const round = (x) => x < 0 ? -Math.round(-x) : Math.round(x);
const math = { ...Object.fromEntries(Object.getOwnPropertyNames(Math).filter((key) => typeof Math[key] === 'function').map((key) => [key, Math[key]])),
  fmin: Math.min, fmax: Math.max, fabs: Math.abs, fmod: (x, y) => x % y, exp2: (x) => 2 ** x, round, lround: round };
const bytes = globalThis.process?.versions?.node
  ? await (await import('node:fs/promises')).readFile(new URL('./pixels.wasm', import.meta.url))
  : await (await fetch(new URL('./pixels.wasm', import.meta.url))).arrayBuffer();
const module = await WebAssembly.compile(bytes);
const env = {};
for (const entry of WebAssembly.Module.imports(module)) {
  const name = entry.name;
  const fn = math[name] || math[name.replace(/f$/, '')];
  if (!fn) throw new Error(`Missing pixel kernel dependency: ${name}`);
  env[name] = fn;
}
export const kernels = (await WebAssembly.instantiate(module, { env })).exports;
export function independentKernels() { return new WebAssembly.Instance(module, { env }).exports; }

export function allocate(value) {
  const bytes = typeof value === 'number' ? value : value.byteLength;
  const pointer = kernels.malloc(bytes);
  if (!pointer && bytes) throw new Error('Not enough memory for this image operation.');
  if (typeof value !== 'number') new Uint8Array(kernels.memory.buffer, pointer, bytes).set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  return pointer;
}

export function pixelKernel(pixels, width, height, operation) {
  kernels.arena_reset();
  const pointer = allocate(pixels);
  const premultiplied = new Uint8Array(kernels.memory.buffer, pointer, pixels.length);
  for (let i = 0; i < pixels.length; i += 4) for (let c = 0; c < 3; c++) premultiplied[i + c] = Math.round(premultiplied[i + c] * premultiplied[i + 3] / 255);
  const result = operation(pointer, width, height, width * 4);
  if (kernels.arena_failed() || result === -1) throw new Error('Not enough memory for this image operation.');
  if (typeof result === 'number' && result < -1) throw new Error('The selected area does not have enough usable surrounding pixels.');
  const output = new Uint8Array(kernels.memory.buffer, pointer, pixels.length);
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = output[i + 3];
    for (let c = 0; c < 3; c++) pixels[i + c] = alpha ? Math.min(255, Math.round(output[i + c] * 255 / alpha)) : 0;
    pixels[i + 3] = alpha;
  }
  return pixels;
}
