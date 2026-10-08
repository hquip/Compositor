import { newQuickJSWASMModule, newVariant } from 'quickjs-emscripten';
import RELEASE from '@jitl/quickjs-wasmfile-release-sync';

let engine;
export async function pluginEngine() {
  engine ??= fetch(new URL('./quickjs.wasm', import.meta.url)).then((r) => r.arrayBuffer()).then((wasmBinary) => newQuickJSWASMModule(newVariant(RELEASE, { wasmBinary }))).catch((error) => { engine = null; throw error; });
  return engine;
}
