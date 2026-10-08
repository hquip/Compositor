import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { encodePNG16, decodePNG } from '../renderer/png-pixels.js';
import { profileBytes, convertColors, describeProfile, validateProfile } from '../renderer/color-engine.js';
import { encodeTIFF } from '../renderer/tiff-export.js';
import { decodePrecisionFile, resizePrecision } from '../renderer/precision-raster.js';
import { applyPrecisionFilters } from '../renderer/precision-filters.js';
import { composePrecision } from '../renderer/precision-composite.js';
import { createManifest, createLayer } from '../renderer/core.js';

test('16-bit PNG and TIFF round trips retain least-significant bits and their ICC profile', async () => {
  const profile = await profileBytes('sRGB'), data = new Uint16Array([1, 258, 514, 65535, 12345, 23456, 34567, 45678]);
  const encoded = await encodePNG16({ width: 2, height: 1, data, profile }), decoded = await decodePNG(encoded); assert.deepEqual(decoded.data, data); assert.deepEqual(decoded.profile, profile); assert.equal(decoded.bits, 16);
  const tiff = encodeTIFF({ width: 2, height: 1, samples: data, channels: 4, alpha: true, profile, resolution: 300 });
  const restored = await decodePrecisionFile(tiff, 'Image.tiff'); assert.deepEqual(restored.data, data); assert.deepEqual(restored.profile, profile);
  const damaged = encoded.slice(); damaged[45] ^= 1; await assert.rejects(decodePNG(damaged));
});
test('ICC transforms keep 16-bit integer samples and reject malformed profiles', async () => {
  const srgb = await profileBytes('sRGB'), adobe = await profileBytes('Adobe RGB (1998)'), input = new Uint16Array([12345, 23456, 34567, 12346, 23457, 34568]);
  const identity = await convertColors(input, srgb, srgb); assert.deepEqual(identity.samples, input);
  const converted = await convertColors(input, srgb, adobe); assert.equal(converted.channels, 3); assert.ok(converted.samples.some((v) => v % 257 !== 0)); assert.notDeepEqual(converted.samples, input);
  assert.equal((await describeProfile(adobe)).space, 'RGB'); const invalid = srgb.slice(); invalid[36] = 0; assert.throws(() => validateProfile(invalid));
});
test('high-precision filters and source compositing retain values unavailable in an 8-bit preview', async () => {
  const data = new Uint16Array([12345, 23456, 34567, 65535, 12346, 23457, 34568, 65535]), source = { width: 2, height: 1, data, profile: await profileBytes('sRGB') };
  const inverted = applyPrecisionFilters(source, [{ enabled: true, adjustment: { kind: 'Invert' } }]); assert.deepEqual([...inverted.data], [53190, 42079, 30968, 65535, 53189, 42078, 30967, 65535]); assert.deepEqual(source.data, data);
  const manifest = createManifest(2, 1), layer = createLayer('16-bit original', 2, 1); layer.imageFile = `${layer.id}.png`; layer.filterSourceFile = `${layer.id}.source.png`; layer.filterWorkingSpace = 'sRGB'; layer.filters = [{ id: crypto.randomUUID(), enabled: false, adjustment: { kind: 'Exposure' } }]; manifest.layers.push(layer);
  const original = Buffer.from(await encodePNG16(source)).toString('base64'), snapshot = { manifest, assets: { [layer.filterSourceFile]: original, [layer.imageFile]: original } };
  const composed = await composePrecision(snapshot, { workingSpace: 'sRGB' }); assert.deepEqual(composed.data, data);
});
const cmykPath = 'C:/Windows/System32/spool/drivers/color/CoatedFOGRA39.icc';
test('installed CMYK profile supports 16-bit separation, embedded-profile TIFF, and soft proofing', { skip: !existsSync(cmykPath) }, async () => {
  const profile = new Uint8Array(await fs.readFile(cmykPath)), srgb = await profileBytes('sRGB'), input = new Uint16Array([65535, 10000, 8000, 12000, 20000, 30000]);
  assert.equal(validateProfile(profile), 'CMYK'); const separated = await convertColors(input, srgb, profile); assert.equal(separated.channels, 4); assert.equal(separated.samples.length, 8);
  const proof = await convertColors(input, srgb, srgb, { proofProfile: profile }); assert.equal(proof.channels, 3); assert.notDeepEqual(proof.samples, input);
  const bytes = encodeTIFF({ width: 2, height: 1, samples: separated.samples, channels: 4, cmyk: true, profile }); assert.ok(bytes.length > profile.length); assert.deepEqual([...bytes.subarray(0, 4)], [73, 73, 42, 0]);
  const restored = await decodePrecisionFile(bytes, 'Print.tiff'); assert.equal(restored.bits, 16); assert.equal(restored.originalSpace, 'CMYK'); assert.equal(validateProfile(restored.profile), 'RGB');
});

test('high-precision downsampling averages coverage without discarding the low bits', () => {
  const result = resizePrecision({ width: 2, height: 1, data: new Uint16Array([10001, 0, 0, 65535, 10003, 0, 0, 65535]) }, 1, 1); assert.deepEqual([...result.data], [10002, 0, 0, 65535]);
});
