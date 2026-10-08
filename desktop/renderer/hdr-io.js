export function hdrIO(payload, signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./hdr-io-worker.js', import.meta.url), { type: 'module' }); let done = false;
    const finish = (error, result) => { if (done) return; done = true; signal?.removeEventListener('abort', abort); worker.terminate(); error ? reject(error) : resolve(result); };
    const abort = () => finish(new DOMException('Canceled', 'AbortError')); if (signal?.aborted) { abort(); return; } signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = (event) => { event.preventDefault(); finish(new Error(event.message || 'HDR processing failed.')); };
    worker.onmessage = ({ data }) => data.error ? finish(new Error(data.error)) : finish(null, data.result);
    worker.postMessage(payload, payload.action === 'encode-exr' ? (payload.frames ?? [{ source: payload.source }]).map((frame) => frame.source.data.buffer) : []);
  });
}
