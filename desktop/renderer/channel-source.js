export const CHANNEL_MODES = { RGB: 0, CMYK: 1, Lab: 2 };
export function encodeChannelSource(source) {
  const channels = source.mode === 'CMYK' ? 5 : 4, count = source.width * source.height * channels;
  if (!CHANNEL_MODES.hasOwnProperty(source.mode) || ![8, 16, 32].includes(source.bits) || source.data.length !== count || source.width < 1 || source.height < 1 || source.width * source.height > 16000000) throw new Error('Invalid authoritative channel source.');
  const bytes = new Uint8Array(32 + count * source.bits / 8), view = new DataView(bytes.buffer); bytes.set(new TextEncoder().encode('CCHN0001'));
  [source.width, source.height, CHANNEL_MODES[source.mode], source.bits, channels, 0].forEach((value, i) => view.setUint32(8 + i * 4, value, true));
  for (let i = 0; i < count; i++) {
    const c = i % channels, value = source.data[i]; if (!Number.isFinite(value)) throw new Error('Invalid channel sample.');
    if (source.bits === 32) view.setFloat32(32 + i * 4, value, true);
    else { const normalized = source.mode === 'Lab' && c < 3 ? c === 0 ? value / 100 : (value + 128) / 255 : value, scaled = Math.round(Math.max(0, Math.min(1, normalized)) * (source.bits === 8 ? 255 : 65535)); if (source.bits === 8) bytes[32 + i] = scaled; else view.setUint16(32 + i * 2, scaled, true); }
  }
  return bytes;
}
export function decodeChannelSource(bytes) {
  if (bytes.length < 32 || new TextDecoder().decode(bytes.slice(0, 8)) !== 'CCHN0001') throw new Error('Invalid channel source header.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), width = view.getUint32(8, true), height = view.getUint32(12, true), mode = Object.keys(CHANNEL_MODES).find((key) => CHANNEL_MODES[key] === view.getUint32(16, true)), bits = view.getUint32(20, true), channels = view.getUint32(24, true);
  if (!mode || ![8, 16, 32].includes(bits) || width < 1 || height < 1 || width > 30000 || height > 30000 || width * height > 16000000 || channels !== (mode === 'CMYK' ? 5 : 4) || bytes.length !== 32 + width * height * channels * bits / 8) throw new Error('Invalid channel source dimensions.');
  const data = new Float32Array(width * height * channels);
  for (let i = 0; i < data.length; i++) { let value = bits === 32 ? view.getFloat32(32 + i * 4, true) : bits === 8 ? bytes[32 + i] / 255 : view.getUint16(32 + i * 2, true) / 65535; const c = i % channels; if (bits !== 32 && mode === 'Lab' && c < 3) value = c === 0 ? value * 100 : value * 255 - 128; if (!Number.isFinite(value) || Math.abs(value) > 1000000 || c === channels - 1 && (value < 0 || value > 1)) throw new Error('Invalid channel sample.'); data[i] = value; }
  return { width, height, mode, bits, channels, data };
}
export function channelValue(source, pixel, channel, value) {
  const at = pixel * source.channels + channel; if (channel < 0 || channel >= source.channels || !Number.isFinite(value)) throw new Error('Invalid channel value.');
  source.data[at] = channel === source.channels - 1 ? Math.max(0, Math.min(1, value)) : source.mode === 'Lab' ? channel === 0 ? Math.max(0, Math.min(100, value)) : Math.max(-128, Math.min(127, value)) : source.mode === 'RGB' && source.bits === 32 ? Math.max(-1000000, Math.min(1000000, value)) : Math.max(0, Math.min(1, value));
}
