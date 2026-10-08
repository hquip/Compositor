import { Graphemer, zlibSync, unzlibSync } from './vendor/legacy.js';

if (!Array.prototype.at) Object.defineProperty(Array.prototype, 'at', { value(index) { return this[index < 0 ? this.length + index : index]; }, configurable: true });
if (!String.prototype.at) Object.defineProperty(String.prototype, 'at', { value(index) { return this[index < 0 ? this.length + index : index]; }, configurable: true });
if (!Object.hasOwn) Object.hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
if (!crypto.randomUUID) crypto.randomUUID = () => { const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128; const hex = [...bytes].map((v) => v.toString(16).padStart(2, '0')).join(''); return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`; };
if (!globalThis.structuredClone) globalThis.structuredClone = (value) => {
  const seen = new Map(); function clone(item) { if (!item || typeof item !== 'object') return item; if (seen.has(item)) return seen.get(item); if (item instanceof ArrayBuffer) return item.slice(0); if (ArrayBuffer.isView(item)) return item instanceof DataView ? new DataView(item.buffer.slice(item.byteOffset,item.byteOffset+item.byteLength)) : new item.constructor(item); if (item instanceof Date) return new Date(item); const copy = Array.isArray(item) ? [] : item instanceof Map ? new Map() : item instanceof Set ? new Set() : {}; seen.set(item, copy); if (item instanceof Map) for (const [key, value] of item) copy.set(clone(key), clone(value)); else if (item instanceof Set) for (const value of item) copy.add(clone(value)); else for (const [key, value] of Object.entries(item)) copy[key] = clone(value); return copy; } return clone(value);
};
if (!Intl.Segmenter) Intl.Segmenter = class {
  constructor() { this.splitter = new Graphemer(); }
  segment(text) { let index = 0; return this.splitter.splitGraphemes(text).map((segment) => { const item = { segment, index, input: text }; index += segment.length; return item; }); }
};
if (!AbortSignal.timeout) AbortSignal.timeout = (milliseconds) => { const controller = new AbortController(); setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), milliseconds); return controller.signal; };
function bufferedCodec(compress) {
  return class {
    constructor(format) {
      if (format !== 'deflate') throw new Error('Unsupported compression format.');
      const parts = []; let length = 0, controller;
      this.readable = new ReadableStream({ start(value) { controller = value; } });
      this.writable = new WritableStream({ write(value) { const bytes = new Uint8Array(value); length += bytes.length; if (length > 512 * 1024 * 1024) throw new Error('Compression exceeds the memory budget.'); parts.push(bytes.slice()); }, close() { const input = new Uint8Array(length); let at = 0; for (const part of parts) { input.set(part, at); at += part.length; } try { const output = compress ? zlibSync(input) : unzlibSync(input); controller.enqueue(output); controller.close(); } catch (error) { controller.error(error); } }, abort(error) { controller.error(error); } });
    }
  };
}
globalThis.CompressionStream ??= bufferedCodec(true); globalThis.DecompressionStream ??= bufferedCodec(false);
