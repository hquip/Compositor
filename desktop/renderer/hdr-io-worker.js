import { decodeFloatTIFF } from './vendor/float-tiff.js';
import { convertHDRColor } from './hdr-color.js';
import { decodeEXR, encodeEXR } from './exr-codec.js';
self.onmessage = async ({ data }) => {
  try {
    const result = data.action === 'encode-exr' ? await encodeEXR(data.frames ?? data.source, data.options) : data.action === 'decode-exr' ? await decodeEXR(data.bytes, data.options) : convertHDRColor(decodeFloatTIFF(data.bytes, data.options.limit), data.options.encoding, data.options.workingSpace ?? 'Linear sRGB');
    self.postMessage({ result }, [result.data?.buffer ?? result.buffer]);
  } catch (error) { self.postMessage({ error: error.message }); }
};
