import { pluginEngine } from './vendor/quickjs/quickjs.js';

self.onmessage = async ({ data }) => {
  let runtime, context;
  try {
    const engine = await pluginEngine(); runtime = engine.newRuntime(); runtime.setMemoryLimit(256 * 1024 * 1024); runtime.setMaxStackSize(512 * 1024);
    const deadline = Date.now() + 5000; runtime.setInterruptHandler(() => Date.now() > deadline); context = runtime.newContext();
    const input = context.newArrayBuffer(data.pixels); context.setProp(context.global, 'inputPixels', input); input.dispose();
    const options = context.newString(JSON.stringify(data.settings)); context.setProp(context.global, 'inputSettings', options); options.dispose();
    const code = `${data.source}\n;const pluginInput={width:${data.width},height:${data.height},data:new Uint8ClampedArray(inputPixels)};Promise.resolve(transform(pluginInput,JSON.parse(inputSettings))).then(result=>{if(!result||!(result.data instanceof Uint8ClampedArray)||result.width!==pluginInput.width||result.height!==pluginInput.height||result.data.byteLength!==pluginInput.data.byteLength)throw Error('Invalid plugin output');globalThis.pluginResult=result.data.buffer.slice(result.data.byteOffset,result.data.byteOffset+result.data.byteLength);}).catch(error=>{globalThis.pluginError=String(error.message||error);});`;
    const evaluation = context.evalCode(code); if (evaluation.error) { const error = context.dump(evaluation.error); evaluation.error.dispose(); throw new Error(error.message ?? String(error)); } evaluation.value.dispose();
    let jobs = 0; while (runtime.hasPendingJob()) { if (++jobs > 10000 || Date.now() > deadline) throw new Error('The image plugin exceeded its execution time limit.'); const result = runtime.executePendingJobs(); if (result.error) { const error = context.dump(result.error); result.error.dispose(); throw new Error(error.message ?? String(error)); } }
    const error = context.getProp(context.global, 'pluginError'); const message = context.dump(error); error.dispose(); if (message) throw new Error(String(message));
    const result = context.getProp(context.global, 'pluginResult');
    try { const buffer = context.getArrayBuffer(result); try { const pixels = buffer.value.slice().buffer; self.postMessage({ pixels }, [pixels]); } finally { buffer.dispose(); } } finally { result.dispose(); }
  } catch (error) { self.postMessage({ error: error.message ?? String(error) }); }
  finally { context?.dispose(); runtime?.dispose(); }
};
self.postMessage({ ready: true });
