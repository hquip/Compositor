import * as cms from './vendor/lcms/lcms.js';

export const RGB_PROFILES = { sRGB: 'sRGB-v2-magic.icc', 'Adobe RGB (1998)': 'AdobeCompat-v2.icc', 'Display P3': 'DisplayP3-v4.icc', 'ProPhoto RGB': 'ProPhoto-v4.icc' };
let instance;
async function readBytes(url) { return globalThis.process?.versions?.node ? new Uint8Array(await (await import('node:fs/promises')).readFile(url)) : new Uint8Array(await (await fetch(url)).arrayBuffer()); }
export async function profileBytes(name = 'sRGB') { if (!RGB_PROFILES[name]) throw new Error('Unknown color profile.'); return readBytes(new URL('./profiles/' + RGB_PROFILES[name], import.meta.url)); }
export function validateProfile(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 132 || bytes.length > 16 * 1024 * 1024) throw new Error('Invalid or oversized ICC profile.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), signature = (at) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (signature(36) !== 'acsp' || view.getUint32(0) > bytes.length || !['RGB ', 'CMYK', 'GRAY', 'Lab '].includes(signature(16))) throw new Error('Unsupported ICC profile.');
  const tags = view.getUint32(128); if (tags > 4096 || 132 + tags * 12 > bytes.length) throw new Error('Invalid ICC profile tags.');
  for (let i = 0; i < tags; i++) { const offset = view.getUint32(136 + i * 12), length = view.getUint32(140 + i * 12); if (offset < 128 || length > bytes.length || offset + length > bytes.length) throw new Error('Invalid ICC profile tags.'); }
  return signature(16).trim();
}
export async function colorEngine() {
  if (!instance) instance = (async () => cms.instantiate({ wasmBinary: await readBytes(new URL('./vendor/lcms/lcms.wasm', import.meta.url)) }))().catch((error) => { instance = null; throw error; });
  return instance;
}
export async function describeProfile(bytes) {
  const space = validateProfile(bytes), engine = await colorEngine(), handle = engine.cmsOpenProfileFromMem(bytes, bytes.length);
  if (!handle) throw new Error('Could not read the ICC profile.');
  try { return { space, name: engine.cmsGetProfileInfoASCII(handle, cms.cmsInfoDescription, 'en', 'US') || space }; }
  finally { engine.cmsCloseProfile(handle); }
}

export async function convertColors(samples, inputProfile, outputProfile, { intent = 1, blackPoint = true, proofProfile = null, inputBits = 16, outputBits = 16 } = {}) {
  if (![8, 16].includes(inputBits) || ![8, 16].includes(outputBits) || ![0, 1, 2, 3].includes(intent)) throw new Error('Invalid color conversion settings.');
  validateProfile(inputProfile); validateProfile(outputProfile); if (proofProfile) validateProfile(proofProfile);
  const engine = await colorEngine(), handles = []; let transform = 0, input = 0, output = 0;
  const open = (bytes) => { const handle = engine.cmsOpenProfileFromMem(bytes, bytes.length); if (!handle) throw new Error('Could not read the ICC profile.'); handles.push(handle); return handle; };
  try {
    const from = open(inputProfile), to = open(outputProfile), proof = proofProfile ? open(proofProfile) : 0;
    const inputFormat = engine.cmsFormatterForColorspaceOfProfile(from, inputBits / 8, false), outputFormat = engine.cmsFormatterForColorspaceOfProfile(to, outputBits / 8, false);
    const inputChannels = cms.T_CHANNELS(inputFormat), outputChannels = cms.T_CHANNELS(outputFormat);
    if (!inputChannels || samples.length % inputChannels || samples.BYTES_PER_ELEMENT !== inputBits / 8) throw new Error('Pixel channels do not match the color profile.');
    const count = samples.length / inputChannels, bytes = count * outputChannels * outputBits / 8;
    if (samples.byteLength + bytes > 512 * 1024 * 1024) throw new Error('The color conversion exceeds the memory budget.');
    const flags = blackPoint ? cms.cmsFLAGS_BLACKPOINTCOMPENSATION : 0;
    transform = proof ? engine.cmsCreateProofingTransform(from, inputFormat, to, outputFormat, proof, intent, intent, flags | cms.cmsFLAGS_SOFTPROOFING) : engine.cmsCreateTransform(from, inputFormat, to, outputFormat, intent, flags);
    if (!transform) throw new Error('This ICC profile does not support the requested conversion.');
    input = engine._malloc(samples.byteLength); output = engine._malloc(bytes); if (!input || !output) throw new Error('Not enough memory for color conversion.');
    // The convenience wrapper treats all integer arrays as bytes; use the C entry point for 16-bit samples.
    engine.HEAPU8.set(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength), input);
    engine._cmsDoTransform(transform, input, output, count);
    const data = engine.HEAPU8.slice(output, output + bytes);
    return { samples: outputBits === 16 ? new Uint16Array(data.buffer) : data, channels: outputChannels, space: engine.cmsGetColorSpaceASCII(to) };
  } finally { if (input) engine._free(input); if (output) engine._free(output); if (transform) engine.cmsDeleteTransform(transform); for (const handle of handles) engine.cmsCloseProfile(handle); }
}

export function rgbaToRGB16(data, opaque = false) {
  const result = new Uint16Array(data.length / 4 * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) for (let c = 0; c < 3; c++) result[j + c] = Math.round((opaque ? data[i + c] * data[i + 3] / 255 + 255 - data[i + 3] : data[i + c]) * 257);
  return result;
}

export async function convertFloatChannels(samples, from, to, inputProfile, outputProfile, intent = 1) {
  const counts = { RGB: 3, CMYK: 4, Lab: 3 };
  if (!(samples instanceof Float32Array) || !counts[from] || !counts[to] || samples.length % counts[from] || ![0, 1, 2, 3].includes(intent)) throw new Error('Invalid floating color conversion.');
  const engine = await colorEngine(), handles = []; let transform = 0, input = 0, output = 0;
  const open = async (mode, profile) => {
    if (mode === 'Lab' && !profile) { const h = engine.cmsCreateLab4Profile(); handles.push(h); return h; }
    profile ??= await profileBytes('sRGB'); if (validateProfile(profile) !== mode) throw new Error('The ICC profile does not match the document color mode.');
    const h = engine.cmsOpenProfileFromMem(profile, profile.length); if (!h) throw new Error('Could not read the ICC profile.'); handles.push(h); return h;
  };
  try {
    const a = await open(from, inputProfile), b = await open(to, outputProfile), count = samples.length / counts[from], inputFormat = engine.cmsFormatterForColorspaceOfProfile(a, 4, true), outputFormat = engine.cmsFormatterForColorspaceOfProfile(b, 4, true);
    transform = engine.cmsCreateTransform(a, inputFormat, b, outputFormat, intent, cms.cmsFLAGS_BLACKPOINTCOMPENSATION);
    if (!transform) throw new Error('This ICC profile does not support conversion in that direction.');
    const prepared = samples.slice(); if (from === 'CMYK') for (let i = 0; i < prepared.length; i++) prepared[i] *= 100;
    const length = count * counts[to] * 4; if (prepared.byteLength + length > 512 * 1024 * 1024) throw new Error('The color conversion exceeds the memory budget.');
    input = engine._malloc(prepared.byteLength); output = engine._malloc(length); if (!input || !output) throw new Error('Not enough memory for color conversion.');
    engine.HEAPU8.set(new Uint8Array(prepared.buffer), input); engine._cmsDoTransform(transform, input, output, count);
    const result = new Float32Array(engine.HEAPU8.slice(output, output + length).buffer);
    if (to === 'CMYK') for (let i = 0; i < result.length; i++) result[i] /= 100;
    return result;
  } finally { if (input) engine._free(input); if (output) engine._free(output); if (transform) engine.cmsDeleteTransform(transform); for (const h of handles) if (h) engine.cmsCloseProfile(h); }
}
