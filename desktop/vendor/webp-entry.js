import encode, { init } from '@jsquash/webp/encode.js';

let ready;
export async function encodeWebP(image, options) {
  ready ??= init(undefined, { locateFile: (name) => new URL(name, import.meta.url).href });
  await ready;
  return encode(image, options);
}
