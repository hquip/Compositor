import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectOpenEXR, decodeOpenEXR, encodeOpenEXR, floatToHalf, halfToFloat } from '../renderer/openexr.js';
import { HDR_SPACES, hdrColorMatrix, convertHDRColor, exrColorMetadata } from '../renderer/hdr-color.js';
import { zlibSync } from '../renderer/vendor/archive.js';

const directory = new URL('./fixtures/openexr/', import.meta.url), fixture = async (name) => new Uint8Array(await fs.readFile(new URL(name, directory))), expected = JSON.parse(await fs.readFile(new URL('expected.json', directory)));
const surface = { width: expected.width, height: expected.height, data: new Float32Array(expected.data) };
const near = (a, b, tolerance = 1e-5) => { assert.equal(a.length, b.length); a.forEach((value, i) => assert.ok(Math.abs(value - b[i]) <= tolerance * Math.max(1, Math.abs(b[i])), `sample ${i}: ${value} vs ${b[i]}`)); };
for (const bits of [16, 32]) for (const compression of ['none', 'zips', 'zip']) test(`official OpenEXR ${bits}/${compression} fixture preserves highlights, alpha and scanline offsets`, async () => {
  const bytes = await fixture(`rgba-${bits}-${compression}.exr`), result = decodeOpenEXR(bytes), header = inspectOpenEXR(bytes);
  assert.deepEqual([...result.data], expected.data); assert.deepEqual(result.dataWindow, [-2, 3, 2, 21]); assert.deepEqual(result.displayWindow, [-4, 1, 4, 23]); assert.equal(header.displayWidth, 9); assert.equal(header.displayHeight, 23);
});
test('official grayscale and named ACEScg channels skip depth and integer IDs', async () => {
  const gray = decodeOpenEXR(await fixture('gray.exr')); assert.deepEqual([...gray.data.slice(0, 4)], [8, 8, 8, 1]);
  const beauty = decodeOpenEXR(await fixture('beauty-acescg.exr'), { group: 'beauty' }); assert.equal(beauty.data[7], .5); assert.ok(beauty.data[4] > 8);
  near(hdrColorMatrix('ACEScg'), [1.70505099, -.62179212, -.08325887, -.13025642, 1.14080474, -.01054832, -.02400336, -.12896898, 1.15297233]);
});
test('HDR color conversions preserve white, negative colors, highlights and alpha in all presets', () => {
  const source = { width: 2, height: 1, data: new Float32Array([8, 8, 8, .25, 5, -2, .5, 1]) };
  for (const space of Object.keys(HDR_SPACES)) { const encoded = encodeOpenEXR(source, { space }); near(decodeOpenEXR(encoded).data, source.data); const converted = convertHDRColor(source, 'Linear sRGB', space); near(converted.data.slice(0, 4), source.data.slice(0, 4)); }
  assert.throws(() => hdrColorMatrix([0, 0, 0, 0, 0, 0, 0, 0]), /primaries/);
});
test('unknown color tags require assignment and conflicting tags allow explicit override', async () => {
  const bytes = await fixture('untagged.exr'); assert.throws(() => decodeOpenEXR(bytes), /color space is unknown/); near(decodeOpenEXR(bytes, { encoding: 'Linear sRGB' }).data, surface.data);
  const header = { colorInteropID: 'lin_rec709_scene', chromaticities: HDR_SPACES['Linear Rec.2020'].xy }; assert.throws(() => exrColorMetadata(header), /conflicts/); assert.equal(exrColorMetadata({ colorInteropID: 'log_unknown' }), null);
  assert.throws(() => exrColorMetadata({ colorInteropID: 'lin_rec709_scene', chromaticities: [NaN, .33, .3, .6, .15, .06, .3127, .329] }), /primaries/);
});
test('alpha convention is explicit and unsupported zero-alpha emission is not discarded', async () => {
  const straight = await fixture('straight.exr'); near(decodeOpenEXR(straight, { alpha: 'Straight' }).data, surface.data); assert.equal(decodeOpenEXR(straight).data[4], 10);
  const emissive = await fixture('emissive.exr'); assert.throws(() => decodeOpenEXR(emissive), /zero-alpha emissive/);
});
test('half conversion handles subnormals, signed zero, ties and refuses overflow', () => {
  assert.equal(floatToHalf(1.00048828125), 0x3c00); assert.equal(floatToHalf(1.00146484375), 0x3c02); assert.equal(floatToHalf(2 ** -25), 0); assert.equal(floatToHalf(2 ** -24), 1); assert.equal(floatToHalf(-0), 0x8000); assert.ok(Object.is(halfToFloat(0x8000), -0));
  for (let bits = 0; bits < 65536; bits++) if ((bits >> 10 & 31) !== 31) assert.equal(floatToHalf(halfToFloat(bits)), bits);
  assert.throws(() => floatToHalf(65505), /32-bit/); assert.throws(() => floatToHalf(NaN));
  assert.throws(() => encodeOpenEXR({ width: 1, height: 1, data: new Float32Array([65536, 0, 0, 1]) }, { bits: 16 }), /32-bit/);
  assert.throws(() => encodeOpenEXR({ width: 1, height: 1, data: new Float32Array([4, 0, 0, 2 ** -26]) }, { bits: 16 }), /alpha underflows/);
});
test('bounded decoder rejects unsupported formats, malformed offsets, checksums and excess inflation', async () => {
  const bytes = await fixture('rgba-32-zip.exr'), header = inspectOpenEXR(bytes), table = header.table;
  for (const flags of [0x202, 0x802, 0x1002]) { const bad = bytes.slice(); new DataView(bad.buffer).setUint32(4, flags, true); assert.throws(() => inspectOpenEXR(bad), /single-part/); }
  const piz = await fixture('piz.exr'); assert.throws(() => inspectOpenEXR(bytes, 10), /pixel budget/); assert.throws(() => inspectOpenEXR(piz), /compression/); assert.throws(() => decodeOpenEXR(bytes.slice(0, -1)), /Truncated/);
  const badOffset = bytes.slice(); new DataView(badOffset.buffer).setBigUint64(table, 2n ** 63n, true); assert.throws(() => decodeOpenEXR(badOffset), /offset/);
  const badOverlap = bytes.slice(), offsets = new DataView(badOverlap.buffer); offsets.setBigUint64(table + 8, offsets.getBigUint64(table, true), true); assert.throws(() => decodeOpenEXR(badOverlap), /coordinates/);
  const badChecksum = bytes.slice(), offset = Number(new DataView(bytes.buffer).getBigUint64(table, true)), length = new DataView(bytes.buffer).getInt32(offset + 4, true); badChecksum[offset + 8 + length - 1] ^= 1; assert.throws(() => decodeOpenEXR(badChecksum), /checksum/);
  const bomb = zlibSync(new Uint8Array(header.bytesPerLine * 16 + 100)); assert.ok(bomb.length < header.bytesPerLine * 16); const badInflation = bytes.slice(); new DataView(badInflation.buffer).setInt32(offset + 4, bomb.length, true); badInflation.set(bomb, offset + 8); assert.throws(() => decodeOpenEXR(badInflation), /length|ZIP block/);
});
test('exported HALF/FLOAT with all lossless compressions is accepted by official OpenEXR', { skip: !process.env.COMPOSITOR_EXR_PYTHON }, async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'compositor-exr-')); t.after(() => fs.rm(folder, { recursive: true, force: true }));
  for (const bits of [16, 32]) for (const compression of ['None', 'ZIPS', 'ZIP']) {
    const file = path.join(folder, `${bits}-${compression}.exr`); await fs.writeFile(file, encodeOpenEXR(surface, { bits, compression }));
    const result = spawnSync(process.env.COMPOSITOR_EXR_PYTHON, [fileURLToPath(new URL('./openexr-reference.py', import.meta.url)), 'inspect', file], { encoding: 'utf8', windowsHide: true }); assert.equal(result.status, 0, result.stderr);
    const decoded = JSON.parse(result.stdout); assert.equal(decoded.bits, bits); assert.equal(decoded.colorInteropID, 'lin_rec709_scene');
    const premultiplied = surface.data.map((n, i) => i % 4 === 3 ? n : n * surface.data[i - i % 4 + 3]); near(decoded.data, premultiplied);
  }
});
