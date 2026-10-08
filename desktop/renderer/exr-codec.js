import { inspectEXRContainer } from './vendor/exr-container.js';
import { HDR_SPACES, convertHDRColor, exrColorMetadata } from './hdr-color.js';
import { floatToHalf } from './openexr.js';

let pendingModule;
async function module() { pendingModule ??= import('./vendor/openexr/compositor-exr.mjs').then(({ default: create }) => create()); return pendingModule; }
const fail = (codec) => { throw new Error(codec.UTF8ToString(codec._exr_error()) || 'OpenEXR processing failed.'); };
function allocate(codec, bytes) { const pointer = codec._malloc(bytes.length); if (!pointer) throw new Error('OpenEXR exceeds the available memory.'); codec.HEAPU8.set(bytes, pointer); return pointer; }
const text = new TextEncoder(), allocateString = (codec, value) => allocate(codec, text.encode(value + '\0'));
export async function decodeEXR(bytes, options = {}) {
  const container = inspectEXRContainer(bytes, options.limit ?? 16000000), part = options.part ?? 0, header = container.parts[part]; if (!header) throw new Error('Invalid OpenEXR part.');
  const group = options.group ?? (header.groups.includes('') ? '' : header.groups[0]); if (!header.groups.includes(group)) throw new Error('Unknown OpenEXR channel group.');
  const codec = await module(), input = allocate(codec, bytes), name = allocateString(codec, group); let source;
  try {
    if (!codec._exr_open(input, bytes.length, options.limit ?? 16000000, options.sampleLimit ?? 8000000)) fail(codec);
    const pointer = codec._exr_decode(part, name, options.levelX ?? 0, options.levelY ?? 0, options.depthRange?.[0] ?? -Infinity, options.depthRange?.[1] ?? Infinity); if (!pointer) fail(codec);
    const width = codec._exr_width(), height = codec._exr_height(), data = codec.HEAPF32.slice(pointer / 4, pointer / 4 + width * height * 4), premultiplied = header.deep || (options.alpha ?? 'Premultiplied') === 'Premultiplied';
    for (let i = 0; i < data.length; i += 4) {
      if (!Number.isFinite(data[i + 3]) || data[i + 3] < 0 || data[i + 3] > 1) throw new Error('Invalid OpenEXR sample range.');
      for (let c = 0; c < 3; c++) { if (premultiplied) { if (!data[i + 3] && data[i + c]) throw new Error('OpenEXR zero-alpha emissive pixels require a premultiplied working pipeline. Convert this source before import.'); data[i + c] = data[i + 3] ? data[i + c] / data[i + 3] : 0; } if (!Number.isFinite(data[i + c]) || Math.abs(data[i + c]) > 1000000) throw new Error('Invalid OpenEXR sample range.'); }
    }
    const encoding = options.encoding ?? 'File color metadata', inherited = { chromaticities: header.chromaticities ?? container.chromaticities, colorInteropID: header.colorInteropID ?? container.colorInteropID }, color = encoding === 'File color metadata' ? exrColorMetadata(inherited) : encoding;
    if (!color) throw new Error('OpenEXR color space is unknown. Choose an explicit input color space.');
    source = convertHDRColor({ width, height, data, bits: 32, dataWindow: header.dataWindow, displayWindow: header.displayWindow, sampleCount: codec._exr_samples() }, color, options.workingSpace ?? 'Linear sRGB');
    return source;
  } finally { codec._exr_close(); codec._free(input); codec._free(name); }
}
export async function encodeEXR(frames, options = {}) {
  if (!Array.isArray(frames)) frames = [{ source: frames, name: 'Composite' }];
  const space = options.space ?? 'Linear sRGB', bits = options.bits ?? 32, compression = { None: 0, RLE: 1, ZIPS: 2, ZIP: 3, PIZ: 4, PXR24: 5, B44: 6, B44A: 7, DWAA: 8, DWAB: 9 }[options.compression ?? 'ZIP'];
  if (!frames.length || frames.length > 64 || !HDR_SPACES[space] || ![16, 32].includes(bits) || compression == null) throw new Error('Invalid OpenEXR export options.');
  if (frames.reduce((sum, frame) => sum + frame.source.width * frame.source.height, 0) > (options.limit ?? 16000000)) throw new Error('Multipart export exceeds the pixel budget.');
  const codec = await module(); codec._exr_output_begin();
  for (const frame of frames) {
    const source = convertHDRColor(frame.source, frame.source.linearSpace ?? 'Linear sRGB', space), data = source.data.slice();
    if (data.length !== source.width * source.height * 4) throw new Error('Invalid OpenEXR pixels.');
    for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 4; c++) {
      if (!Number.isFinite(data[i + c]) || (c === 3 ? data[i + c] < 0 || data[i + c] > 1 : Math.abs(data[i + c]) > 1000000)) throw new Error('Invalid HDR sample range.');
      if (c < 3) data[i + c] *= data[i + 3];
      if (bits === 16) { const half = floatToHalf(data[i + c]); if (c < 3 && (half & 0x7fff) && !floatToHalf(data[i + 3])) throw new Error('Half-float alpha underflows with nonzero color. Choose 32-bit float export.'); }
    }
    const pointer = allocate(codec, new Uint8Array(data.buffer)), name = allocateString(codec, frame.name ?? 'Part');
    try { if (!codec._exr_output_add(name, pointer, source.width, source.height)) fail(codec); } finally { codec._free(pointer); codec._free(name); }
  }
  const color = allocate(codec, new Uint8Array(new Float32Array(HDR_SPACES[space].xy).buffer)), colorID = allocateString(codec, HDR_SPACES[space].id);
  try { const pointer = codec._exr_output_finish(bits, compression, options.layout === 'Tiled' ? options.tileSize ?? 64 : 0, color, colorID); if (!pointer) fail(codec); return codec.HEAPU8.slice(pointer, pointer + codec._exr_output_size()); }
  finally { codec._free(color); codec._free(colorID); }
}
